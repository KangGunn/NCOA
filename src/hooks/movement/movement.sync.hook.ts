/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import axios from 'axios';
import { doc, onSnapshot, setDoc, serverTimestamp, collection, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { MovementRecord } from '../../types/movement/movement.type';
import { extractDayCountFromText, extractPureMemberName } from '../../utils/movement.utils';
import { stayWeekendMD } from '../../utils/movement/movement.stay-weekend';
import { submitMovementImport } from '../../utils/movement/movement.import-job';
import { nearestYearDate, rangeEndDate, toIsoDate } from '../../utils/movement/movement.year';
import { movementSaveQueue } from '../../utils/movement/movement.save-runner';
import { sheetCellToStatus } from '../../utils/movement/movement.sheet-cell';


/** 이 기기에서 저장한 뒤 이 시간 안에 오는 시트 갱신 신호는 조용히 다시 읽는다 */
const SELF_UPDATE_WINDOW_MS = 90_000;

/** 주차 데이터 캐시 버전. 파싱 결과 형태가 바뀌면 올린다. (v4: 활동이 없는 인원 행 포함) */
const MOVEMENT_CACHE_VERSION = 'v4';

const SPREADSHEET_URLS = {
    test: "https://docs.google.com/spreadsheets/d/1eyiNzyvJ1BguGzzpkYDnVegi-4U-zuCacCvy9bOW8R8/export?format=csv&gid=1529486829",
    prod: "https://docs.google.com/spreadsheets/d/1WBJXIzLbbtRxt09KOaJeXKXtgbht-GDjX3N4DyDztOY/export?format=csv&gid=1529486829"
};

// Pure utility helper functions
export function getDatesBetween(start: Date, end: Date, includeStart: boolean = true) {
    const dates = [];
    const curr = new Date(start);
    curr.setHours(12, 0, 0, 0);
    const targetEnd = new Date(end);
    targetEnd.setHours(12, 0, 0, 0);
    if (!includeStart) {
        curr.setDate(curr.getDate() + 1);
        curr.setHours(12, 0, 0, 0);
    }
    while (curr < targetEnd) {
        dates.push(`${curr.getMonth() + 1}.${curr.getDate()}`);
        curr.setDate(curr.getDate() + 1);
        curr.setHours(12, 0, 0, 0);
    }
    return dates;
}

export function selectDefaultWeekIndex(weeks: any[], baseDate?: Date) {
    if (!weeks || weeks.length === 0) return 0;

    const today = baseDate ? new Date(baseDate) : new Date();
    today.setHours(12, 0, 0, 0);
    const year = today.getFullYear();

    // 계산식: (today.getDay() - 3 + 7) % 7
    // 오늘 요일 기준 가장 최근(혹은 당일) 수요일을 구함
    const targetWed = new Date(today);
    const diffToWed = (today.getDay() - 3 + 7) % 7;
    targetWed.setDate(today.getDate() - diffToWed);
    targetWed.setHours(12, 0, 0, 0);

    const targetWedStr = `${targetWed.getMonth() + 1}.${targetWed.getDate()}`;

    // 1. 정확한 수요일 시작 주차 탐색
    const exactIdx = weeks.findIndex(w => w && w.startDate === targetWedStr);
    if (exactIdx !== -1) return exactIdx;

    // 2. 정확한 매칭이 없을 경우, 시간적으로 가장 가까운 주차 선택 (Fallback)
    let minDiff = Infinity;
    let fallbackIdx = 0;

    for (let i = 0; i < weeks.length; i++) {
        const w = weeks[i];
        if (!w || !w.startDate) continue;
        const [m, d] = w.startDate.split('.').map(Number);

        let wYear = year;
        // 년도 전환기 처리 (예: 오늘이 1월인데 매칭되는 주차가 12월인 경우 등)
        if (today.getMonth() === 0 && m === 12) {
            wYear = year - 1;
        } else if (today.getMonth() === 11 && m === 1) {
            wYear = year + 1;
        }

        const wDate = new Date(wYear, m - 1, d, 12, 0, 0, 0);
        const diff = Math.abs(wDate.getTime() - targetWed.getTime());
        if (diff < minDiff) {
            minDiff = diff;
            fallbackIdx = i;
        }
    }

    return fallbackIdx;
}

export function useMovementSync(baseDate?: Date) {
    const [parsedData, setParsedData] = useState<any[] | null>(null);
    const [sheetWeeks, setSheetWeeks] = useState<any[]>([]);
    const [currentWeekIndex, setCurrentWeekIndex] = useState(0);
    const [viewMode, setViewMode] = useState<'sheet' | 'excel'>('sheet');

    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [ambiguousMembers, setAmbiguousMembers] = useState<any[] | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, string>>({});
    const [sheetMode, setSheetMode] = useState<'test' | 'prod' | null>(null);
    const [sheetUpdatedAt, setSheetUpdatedAt] = useState<string>('0');
    const [dbMembers, setDbMembers] = useState<any[]>([]);
    const [movements, setMovements] = useState<MovementRecord[]>([]);
    const [dutySchedules, setDutySchedules] = useState<any[]>([]);

    const recentEditsRef = useRef<Map<string, { dayStatuses: Record<string, string>; timestamp: number }>>(new Map());

    const isRecentlyEdited = (cleanName: string): boolean => {
        const item = recentEditsRef.current.get(cleanName);
        if (!item) return false;
        // 뒤에서 저장 중인(또는 실패해 다시 시도를 기다리는) 인원은 시간과 관계없이 화면 값을 유지한다
        if (Date.now() - item.timestamp < 45000 || movementSaveQueue.hasPendingFor(cleanName)) return true;
        recentEditsRef.current.delete(cleanName);
        return false;
    };

    // 이 기기에서 저장한 직후 시트 갱신 신호가 오면, 화면은 이미 최신이므로 로딩 화면 없이 뒤에서만 다시 읽는다
    const selfUpdateUntilRef = useRef(0);
    // 마지막으로 파싱한 엑셀의 기준 주말 (서버가 월.일의 연도를 정할 때 쓴다)
    const parsedAnchorIsoRef = useRef<string>('');

    const handleLocalScheduleUpdate = (cleanName: string, updatedStatuses: Record<string, string>, savedMovement?: any) => {
        recentEditsRef.current.set(cleanName, { dayStatuses: updatedStatuses, timestamp: Date.now() });
        selfUpdateUntilRef.current = Date.now() + SELF_UPDATE_WINDOW_MS;

        setSheetWeeks(prevWeeks => {
            return prevWeeks.map(week => {
                const rowIdx = week.data.findIndex((r: any) => {
                    const c = r.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim();
                    return c === cleanName;
                });
                if (rowIdx === -1) return week;
                const updatedData = [...week.data];
                updatedData[rowIdx] = {
                    ...updatedData[rowIdx],
                    dayStatuses: {
                        ...updatedData[rowIdx].dayStatuses,
                        ...updatedStatuses
                    }
                };
                return {
                    ...week,
                    data: updatedData
                };
            });
        });

        if (savedMovement) {
            setMovements(prev => {
                const filtered = prev.filter(m => {
                    if (m.name !== cleanName) return true;
                    if (savedMovement.type === m.type && m.startDate <= savedMovement.endDate && m.endDate >= savedMovement.startDate) {
                        return false;
                    }
                    return true;
                });
                return [...filtered, savedMovement];
            });
        }
    };

    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'settings', 'spreadsheet'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                const currentMode = data.mode || 'test';
                setSheetMode(currentMode);

                // 현재 모드에 알맞은 수정 시각(testUpdatedAt / prodUpdatedAt)을 추적, 없으면 전체 updatedAt 사용
                const targetKey = currentMode === 'prod' ? 'prodUpdatedAt' : 'testUpdatedAt';
                const lastUpdate = data[targetKey] || data.updatedAt;
                if (lastUpdate) {
                    setSheetUpdatedAt(lastUpdate.toMillis ? lastUpdate.toMillis().toString() : lastUpdate.toString());
                } else {
                    // DB에 타임스탬프가 없는 경우 임의의 시간으로 설정하여 무한 대기를 방지하고 최초 1회 로드 유도
                    setSheetUpdatedAt(Date.now().toString());
                }
            } else {
                setSheetMode('test');
            }
        });

        const unsubMembers = onSnapshot(collection(db, 'members'), (snap) => {
            const rows = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter((m: any) => m.role !== 'holdover');
            setDbMembers(rows);
        });

        const unsubMovements = onSnapshot(collection(db, 'movements'), (snap) => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as MovementRecord));
            setMovements(rows);
        });

        const unsubSchedules = onSnapshot(collection(db, 'schedules'), (snap) => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setDutySchedules(rows);
        });

        return () => {
            unsub();
            unsubMembers();
            unsubMovements();
            unsubSchedules();
        };
    }, []);

    const lastLoadedTimestampRef = useRef<string>('0');
    const lastLoadedModeRef = useRef<'test' | 'prod'>('test');

    useEffect(() => {
        if (sheetMode && sheetUpdatedAt !== '0') {
            const isInitialLoad = lastLoadedTimestampRef.current === '0';
            const isModeChange = sheetMode !== lastLoadedModeRef.current;
            const isTimestampChange = !isInitialLoad && !isModeChange && sheetUpdatedAt !== lastLoadedTimestampRef.current;

            // 시트 타임스탬프가 변경된 경우(편집 발생): 4초 디바운스 대기하여 연속 편집 신호 수집
            // 초기 진입, 모드 전환인 경우: 즉시 로딩(0초)
            const delay = isTimestampChange ? 4000 : 0;
            // 방금 이 기기에서 저장해서 생긴 갱신이면 조용히(로딩 화면·주차 이동 없이) 다시 읽는다
            const silent = isTimestampChange && (
                Date.now() < selfUpdateUntilRef.current
                || movementSaveQueue.getState().jobs.length > 0
                || Date.now() - movementSaveQueue.getState().lastCompletedAt < 30_000
            );

            const timer = setTimeout(() => {
                fetchSpreadsheet(sheetMode, sheetUpdatedAt, { silent });
                lastLoadedTimestampRef.current = sheetUpdatedAt;
                lastLoadedModeRef.current = sheetMode;
            }, delay);

            return () => clearTimeout(timer);
        }
    }, [sheetMode, sheetUpdatedAt]);

    const activeWeekStartDateRef = useRef<string | null>(null);

    useEffect(() => {
        if (sheetWeeks && sheetWeeks[currentWeekIndex]) {
            activeWeekStartDateRef.current = sheetWeeks[currentWeekIndex].startDate;
        }
    }, [sheetWeeks, currentWeekIndex]);

    const fetchSpreadsheet = async (mode: 'test' | 'prod', updatedAtStr?: string, options: { silent?: boolean } = {}) => {
        // silent: 로딩 화면을 띄우지 않고, 보고 있던 주차를 유지한 채 데이터만 바꾼다
        const silent = !!options.silent && sheetWeeks.length > 0;
        const applyWeeks = (weeks: any[]) => {
            setSheetWeeks(weeks);
            if (silent) {
                const keep = weeks.findIndex((w: any) => w.startDate === activeWeekStartDateRef.current);
                setCurrentWeekIndex(keep !== -1 ? keep : selectDefaultWeekIndex(weeks, baseDate));
            } else {
                setCurrentWeekIndex(selectDefaultWeekIndex(weeks, baseDate));
                setViewMode('sheet');
                setParsedData(null);
            }
            setLoading(false);
        };

        // v4: 활동이 없는 인원 행도 포함 (v3 캐시에는 빠져 있으므로 버전을 올려 다시 읽는다)
        const cacheKey = updatedAtStr ? `ncoa_movement_${mode}_${updatedAtStr}_${MOVEMENT_CACHE_VERSION}` : null;
        const cached = cacheKey ? localStorage.getItem(cacheKey) : null;

        // 1. 로컬 브라우저 캐시 확인
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed && Array.isArray(parsed)) {
                    applyWeeks(parsed);
                    return; // 완전 일치하는 캐시가 있으면 여기서 네트워크 요청 즉시 중단!
                }
            } catch (e) {
                console.error('Cache parsing error:', e);
            }
        }

        // 2. Firestore 공유 캐시 확인
        if (updatedAtStr) {
            try {
                const cacheDoc = await getDoc(doc(db, "movement_cache_v3", `${mode}_${updatedAtStr}_${MOVEMENT_CACHE_VERSION}`));
                if (cacheDoc.exists()) {
                    const sharedData = cacheDoc.data().data;

                    // 로컬에도 캐싱
                    if (cacheKey) {
                        localStorage.setItem(cacheKey, JSON.stringify(sharedData));
                    }

                    applyWeeks(sharedData);
                    return;
                }
            } catch (e) {
                console.error("Firestore movement cache read error:", e);
            }
        }

        // 캐시가 없거나, 구글 시트 변동으로 인해 새로운 updatedAt이 내려왔을 경우에만 새로 다운로드 (silent면 스피너 없이)
        if (!silent) {
            setLoading(true);
            setError(null);
        }
        try {
            const url = `${SPREADSHEET_URLS[mode]}&t=${Date.now()}`;
            const res = await axios.get(url);
            Papa.parse(res.data, {
                complete: async (results) => {
                    const rows = results.data as string[][];
                    if (rows.length < 2) {
                        setLoading(false);
                        return;
                    }

                    const dateRow = rows[0];
                    const year = new Date().getFullYear();

                    const cols: { col: number, date: Date, dateStr: string }[] = [];
                    const seenDates = new Set<string>();

                    for (let c = 1; c < dateRow.length; c++) {
                        if (!dateRow[c]) continue;
                        const parts = dateRow[c].split(/[./]/).map(p => p.trim());
                        if (parts.length < 3) continue;
                        const m = parseInt(parts[1]);
                        const d = parseInt(parts[2]);
                        const dateStr = `${m}.${d}`;

                        if (seenDates.has(dateStr)) continue;
                        seenDates.add(dateStr);

                        const date = new Date(year, m - 1, d, 12, 0, 0, 0);
                        cols.push({ col: c, date, dateStr });
                    }

                    const sortedCols = cols.sort((a, b) => a.date.getTime() - b.date.getTime());
                    if (sortedCols.length === 0) {
                        setLoading(false);
                        return;
                    }

                    const blockStarts: Date[] = [];
                    const firstDate = new Date(sortedCols[0].date);
                    firstDate.setHours(12, 0, 0, 0);
                    const diffToWed = (firstDate.getDay() - 3 + 7) % 7;
                    firstDate.setDate(firstDate.getDate() - diffToWed);
                    firstDate.setHours(12, 0, 0, 0);

                    const lastDate = sortedCols[sortedCols.length - 1].date;
                    const currWed = new Date(firstDate);
                    currWed.setHours(12, 0, 0, 0);
                    while (currWed <= lastDate) {
                        blockStarts.push(new Date(currWed));
                        currWed.setDate(currWed.getDate() + 7);
                        currWed.setHours(12, 0, 0, 0);
                    }

                    const parsedWeeks = blockStarts.map((wed) => {
                        const defaultEnd = new Date(wed);
                        defaultEnd.setHours(12, 0, 0, 0);
                        defaultEnd.setDate(defaultEnd.getDate() + 9); // 수요일부터 다음주 금요일까지 (10일 범위)
                        defaultEnd.setHours(12, 0, 0, 0);

                        const blockCols = sortedCols.filter(c => c.date >= wed && c.date <= defaultEnd);
                        if (blockCols.length < 4) return null;

                        const weekData: any[] = [];
                        for (let r = 2; r < rows.length; r++) {
                            const row = rows[r];
                            if (!row || !row[0]) continue;
                            const nameWithRank = row[0].trim();

                            const dayStatuses: Record<string, string> = {};

                            blockCols.forEach((c, idx) => {
                                const cell = row[c.col] || '';
                                // 새 값('외박복귀/휴가출발' 등)과 예전 값('휴가출발(연계)' 등)을 모두 읽는다
                                let status = sheetCellToStatus(cell);

                                if (status === 'none' && idx > 0) {
                                    const yesterdayCell = row[blockCols[idx - 1].col] || '';
                                    if (yesterdayCell.includes('당직')) status = 'recovery';
                                } else if (status === 'none' && idx === 0) {
                                    const overallColIdx = cols.findIndex(col => col.col === c.col);
                                    if (overallColIdx > 0) {
                                        const yCell = row[cols[overallColIdx - 1].col] || '';
                                        if (yCell.includes('당직')) status = 'recovery';
                                    }
                                }

                                dayStatuses[c.dateStr] = status;
                            });

                            const clean = nameWithRank.replace(/^(병장|상병|일병|이병)\s*/, '').trim();
                            const pending = recentEditsRef.current.get(clean);
                            if (pending) {
                                if (Date.now() - pending.timestamp < 45000 || movementSaveQueue.hasPendingFor(clean)) {
                                    Object.assign(dayStatuses, pending.dayStatuses);
                                } else {
                                    recentEditsRef.current.delete(clean);
                                }
                            }

                            // 이번 주 출타·당직이 없는 인원도 카드로 보여 직접 입력할 수 있게 모든 행을 넣는다.
                            // (패스지는 movement.sheet-view에서 활동이 있는 행만 골라 쓴다)
                            weekData.push({
                                name: nameWithRank,
                                dayStatuses
                            });
                        }

                        return {
                            id: wed.getTime(),
                            startDate: blockCols[0].dateStr,
                            endDate: blockCols[blockCols.length - 1].dateStr,
                            timeline: blockCols.map(c => c.dateStr),
                            data: weekData
                        };
                    }).filter(Boolean).filter((w: any) => w.data.length > 0) as any[];

                    if (updatedAtStr) {
                        const cacheKey = `ncoa_movement_${mode}_${updatedAtStr}_${MOVEMENT_CACHE_VERSION}`;

                        const keysToRemove = [];
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            if (k && k.startsWith(`ncoa_movement_${mode}_`) && k !== cacheKey) {
                                keysToRemove.push(k);
                            }
                        }
                        keysToRemove.forEach(k => localStorage.removeItem(k));

                        localStorage.setItem(cacheKey, JSON.stringify(parsedWeeks));

                        try {
                            await setDoc(doc(db, "movement_cache_v3", `${mode}_${updatedAtStr}_${MOVEMENT_CACHE_VERSION}`), {
                                data: parsedWeeks,
                                updatedAt: serverTimestamp()
                            });
                        } catch (e) {
                            console.error("Firestore movement cache write error:", e);
                        }
                    }

                    applyWeeks(parsedWeeks);
                }
            });
        } catch (e) {
            console.error("fetchSpreadsheet error:", e);
            // 조용히 다시 읽다가 실패하면 지금 화면(이미 저장 내용 반영됨)을 그대로 둔다
            if (!silent) setError('스프레드시트 데이터를 불러오는 중 오류가 발생했습니다.');
            setLoading(false);
        }
    };

    const toggleMode = async () => {
        const newMode = sheetMode === 'test' ? 'prod' : 'test';
        try {
            await setDoc(doc(db, 'settings', 'spreadsheet'), {
                mode: newMode
            }, { merge: true });
        } catch (err) {
            console.error('Error updating mode:', err);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        setError(null);
        setSuccess(null);
        setParsedData(null);
        setAmbiguousMembers(null);
        setResolutions({});
        setViewMode('excel');

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const rawData = XLSX.utils.sheet_to_json(ws) as any[];

                const extractedData: any[] = [];
                // 댓글에는 연도가 없으므로 월.일마다 기준일(점호 날짜, 없으면 오늘)에서 가장 가까운 연도를 쓴다
                const yearRef = baseDate ? new Date(baseDate) : new Date();
                const dateOf = (m: number, d: number) => nearestYearDate(m, d, yearRef);

                const dayOfWeekMap: Record<string, number> = {
                    '일': 0, '일당': 0,
                    '월': 1, '월당': 1,
                    '화': 2, '화당': 2,
                    '수': 3, '수당': 3,
                    '목': 4, '목당': 4,
                    '금': 5, '금당': 5,
                    '토': 6, '토당': 6
                };

                const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

                // 날짜 정규식 (~ 및 - 모두 허용, 뒷자리 월 생략 형태 지원)
                const rangeRegex = /(\d{1,2})[./](\d{1,2})\s*[~\-]\s*(?:(\d{1,2})[./])?(\d{1,2})/;
                const singleRegex = /(\d{1,2})[./](\d{1,2})/;

                // ----------------------------------------------------
                // [Pass 1] 전체 엑셀에서 날짜를 사전 수집하여 대표 주말 날짜 확정
                // ----------------------------------------------------
                const allDetectedDates: Date[] = [];
                const allDetectedMonths: number[] = [];

                for (let i = 0; i < rawData.length; i++) {
                    const content = String(rawData[i]['댓글 내용'] || rawData[i]['내용'] || '').trim();
                    if (!content) continue;

                    const lines = content.split('\n');
                    lines.forEach(line => {
                        const cleanLine = line.replace(/^[ㄴ\-\*•\[\]\.\s]+/, '').trim();
                        const passPart = cleanLine.split('+')[0];
                        const vacationRaw = cleanLine.split('+')[1];

                        const rangeMatch = passPart.match(rangeRegex);
                        if (rangeMatch) {
                            const startM = parseInt(rangeMatch[1]);
                            const startD = parseInt(rangeMatch[2]);
                            const endM = rangeMatch[3] ? parseInt(rangeMatch[3]) : startM;
                            const endD = parseInt(rangeMatch[4]);
                            allDetectedMonths.push(startM, endM);
                            allDetectedDates.push(
                                dateOf(startM, startD),
                                rangeEndDate(dateOf(startM, startD), endM, endD)
                            );
                        } else {
                            const splitGlobalRegex = /(\d{1,2})[./](\d{1,2})/g;
                            let sMatch: RegExpExecArray | null;
                            let foundAny = false;
                            while ((sMatch = splitGlobalRegex.exec(passPart)) !== null) {
                                const m = parseInt(sMatch[1]);
                                const d = parseInt(sMatch[2]);
                                allDetectedMonths.push(m);
                                allDetectedDates.push(dateOf(m, d));
                                foundAny = true;
                            }
                            if (!foundAny) {
                                const singleMatch = passPart.match(singleRegex);
                                if (singleMatch) {
                                    const m = parseInt(singleMatch[1]);
                                    const d = parseInt(singleMatch[2]);
                                    allDetectedMonths.push(m);
                                    allDetectedDates.push(dateOf(m, d));
                                }
                            }
                        }

                        if (vacationRaw) {
                            const vRangeMatch = vacationRaw.match(rangeRegex);
                            const vSingleMatch = vacationRaw.match(singleRegex);
                            if (vRangeMatch) {
                                const vM1 = parseInt(vRangeMatch[1]);
                                const vD1 = parseInt(vRangeMatch[2]);
                                const vM2 = vRangeMatch[3] ? parseInt(vRangeMatch[3]) : vM1;
                                const vD2 = parseInt(vRangeMatch[4]);
                                allDetectedMonths.push(vM1, vM2);
                                allDetectedDates.push(
                                    dateOf(vM1, vD1),
                                    rangeEndDate(dateOf(vM1, vD1), vM2, vD2)
                                );
                            } else if (vSingleMatch) {
                                const vM = parseInt(vSingleMatch[1]);
                                const vD = parseInt(vSingleMatch[2]);
                                allDetectedMonths.push(vM);
                                allDetectedDates.push(dateOf(vM, vD));
                            }
                        }
                    });
                }

                // 대표 주말 기준일(토요일 우선, 없으면 금/일, 없으면 수집 첫 날짜, 없으면 baseDate)
                let anchorWeekend: Date;
                if (allDetectedDates.length > 0) {
                    const sat = allDetectedDates.find(d => d.getDay() === 6);
                    const fri = allDetectedDates.find(d => d.getDay() === 5);
                    const sun = allDetectedDates.find(d => d.getDay() === 0);
                    anchorWeekend = sat || fri || sun || allDetectedDates[0];
                } else {
                    anchorWeekend = baseDate ? new Date(baseDate) : new Date();
                }

                // 헬퍼: 기준일과 가장 가까운 해당 요일(targetDay: 0~6)의 Date 반환
                const getClosestDateForDayOfWeek = (refDate: Date, targetDay: number): Date => {
                    const refDay = refDate.getDay();
                    let bestDiff = 0;
                    let minDistance = Infinity;

                    for (let diff = -6; diff <= 6; diff++) {
                        const candidateDay = (refDay + diff + 70) % 7;
                        if (candidateDay === targetDay) {
                            const distance = Math.abs(diff);
                            if (distance < minDistance) {
                                minDistance = distance;
                                bestDiff = diff;
                            }
                        }
                    }

                    const res = new Date(refDate);
                    res.setDate(refDate.getDate() + bestDiff);
                    res.setHours(12, 0, 0, 0);
                    return res;
                };

                // 헬퍼: 사유 텍스트에서 당직 키워드(금당, 토당, 일당 등)를 감지하여 당직 항목 생성 및 검증
                const checkAndExtractDutyFromReason = (fullName: string, text: string, memberDates: Date[]) => {
                    const dowMatch = text.match(/(월당|화당|수당|목당|금당|토당|일당)/) || text.match(/\((월|화|수|목|금|토|일)\)\s*당직/) || text.match(/(월|화|수|목|금|토|일)\s*당직/);
                    if (!dowMatch) return null;

                    const rawDow = dowMatch[1];
                    const expectedDayIndex = dayOfWeekMap[rawDow] !== undefined ? dayOfWeekMap[rawDow] : dayNames.indexOf(rawDow);
                    if (expectedDayIndex === undefined || expectedDayIndex === -1) return null;

                    // 해당 대원의 날짜가 있으면 그 날짜 기준, 없으면 전체 외박 주간의 대표 주말 기준 역산!
                    const refDate = memberDates.length > 0 ? memberDates[0] : anchorWeekend;
                    const targetDate = getClosestDateForDayOfWeek(refDate, expectedDayIndex);

                    const m = targetDate.getMonth() + 1;
                    const d = targetDate.getDate();
                    const targetDateISO = `${targetDate.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

                    const warnings: string[] = [];
                    const savedDuty = dutySchedules.find((s: any) => (s.type === 'duty' || !s.type) && s.startDate === targetDateISO);
                    const cleanName = extractPureMemberName(fullName);

                    if (savedDuty && savedDuty.memo) {
                        const savedNameClean = extractPureMemberName(savedDuty.memo);
                        if (savedNameClean && cleanName && savedNameClean !== cleanName) {
                            warnings.push(`${m}.${d}일 캘린더 등록 당직자('${savedDuty.memo}')와 엑셀 입력 당직자('${fullName}')가 일치하지 않습니다.`);
                        }
                    }

                    return {
                        name: fullName,
                        type: '당직',
                        date: `${m}.${d}`,
                        warning: warnings.length > 0 ? warnings.join(' / ') : null
                    };
                };

                // 독립적인 당직 라인(구 양식) 호환 파서
                const parseDutyLine = (line: string) => {
                    const cleanLine = line.replace(/^[ㄴ\-\*•\[\]\.\s]+/, '').trim();
                    const nameMatch = cleanLine.match(/(병장|상병|일병|이병)\s*([가-힣]{2,5})/);
                    if (!nameMatch) return null;

                    const rank = nameMatch[1];
                    const name = nameMatch[2];
                    const fullName = `${rank} ${name}`;
                    const lineAfterName = cleanLine.replace(nameMatch[0], '').trim();

                    let m: number | null = null;
                    let d: number | null = null;

                    const fullDateMatch = lineAfterName.match(/(\d{1,2})\s*[./월]\s*(\d{1,2})\s*일?/);
                    if (fullDateMatch) {
                        m = parseInt(fullDateMatch[1], 10);
                        d = parseInt(fullDateMatch[2], 10);
                    } else {
                        const dayMatch = lineAfterName.match(/(\d{1,2})\s*일/) || lineAfterName.match(/\b(\d{1,2})\b/);
                        if (dayMatch) {
                            d = parseInt(dayMatch[1], 10);
                        }
                    }

                    let specDayOfWeek: string | null = null;
                    let expectedDayIndex: number | null = null;

                    const parenMatch = lineAfterName.match(/\((월|화|수|목|금|토|일)\)/);
                    if (parenMatch) {
                        specDayOfWeek = parenMatch[1];
                        expectedDayIndex = dayOfWeekMap[specDayOfWeek];
                    } else {
                        const dowMatch = lineAfterName.match(/(월당|화당|수당|목당|금당|토당|일당)/);
                        if (dowMatch) {
                            specDayOfWeek = dowMatch[1];
                            expectedDayIndex = dayOfWeekMap[specDayOfWeek];
                        }
                    }

                    if (m === null && d !== null) {
                        const matchedDate = allDetectedDates.find(dateObj => dateObj.getDate() === d);
                        if (matchedDate) {
                            m = matchedDate.getMonth() + 1;
                        } else {
                            m = allDetectedMonths.length > 0
                                ? allDetectedMonths[0]
                                : (baseDate ? baseDate.getMonth() + 1 : new Date().getMonth() + 1);
                        }
                    } else if (m === null && d === null && expectedDayIndex !== null) {
                        const targetDate = getClosestDateForDayOfWeek(anchorWeekend, expectedDayIndex);
                        m = targetDate.getMonth() + 1;
                        d = targetDate.getDate();
                    }

                    const warnings: string[] = [];

                    if (d !== null && m !== null) {
                        const targetDate = dateOf(m, d);
                        const actualDayIndex = targetDate.getDay();

                        if (expectedDayIndex !== null && actualDayIndex !== expectedDayIndex) {
                            warnings.push(`${m}.${d}일은 ${dayNames[actualDayIndex]}요일이나, 댓글에는 '${specDayOfWeek}'(으)로 표기되어 일치하지 않습니다.`);
                        }

                        const targetDateISO = toIsoDate(targetDate);
                        const savedDuty = dutySchedules.find((s: any) => (s.type === 'duty' || !s.type) && s.startDate === targetDateISO);
                        if (savedDuty && savedDuty.memo) {
                            const excelNameClean = extractPureMemberName(name);
                            const savedNameClean = extractPureMemberName(savedDuty.memo);
                            if (savedNameClean && excelNameClean && savedNameClean !== excelNameClean) {
                                warnings.push(`${m}.${d}일 캘린더 등록 당직자('${savedDuty.memo}')와 엑셀 입력 당직자('${fullName}')가 일치하지 않습니다.`);
                            }
                        }

                        return {
                            name: fullName,
                            type: '당직',
                            date: `${m}.${d}`,
                            warning: warnings.length > 0 ? warnings.join(' / ') : null
                        };
                    } else if (expectedDayIndex !== null && m !== null) {
                        return {
                            name: fullName,
                            type: '당직',
                            date: `${m}.${specDayOfWeek}`,
                            warning: null
                        };
                    }

                    return null;
                };

                // 연가 파싱 헬퍼
                const parseVacation = (vacationPart: string, passReturn?: string) => {
                    const vRangeMatch = vacationPart.match(rangeRegex);
                    const vSingleMatch = vacationPart.match(singleRegex);
                    if (!vRangeMatch && !vSingleMatch) return null;
                    const vM1 = parseInt((vRangeMatch || vSingleMatch)![1]);
                    const vD1 = parseInt((vRangeMatch || vSingleMatch)![2]);
                    const vM2 = vRangeMatch ? (vRangeMatch[3] ? parseInt(vRangeMatch[3]) : vM1) : vM1;
                    const vD2 = vRangeMatch ? parseInt(vRangeMatch[4]) : vD1;

                    const vStartDate = dateOf(vM1, vD1);
                    const vEndDate = rangeEndDate(dateOf(vM1, vD1), vM2, vD2);

                    const vStartStr = `${vM1}.${vD1}`;
                    const vEndStr = `${vM2}.${vD2}`;
                    let isLinked: boolean;
                    if (/외휴연계\s*O/i.test(vacationPart)) {
                        isLinked = true;
                    } else if (/외휴연계\s*X/i.test(vacationPart)) {
                        isLinked = false;
                    } else {
                        isLinked = passReturn ? vStartStr === passReturn : false;
                    }

                    let vReason = vacationPart.trim();
                    vReason = vReason.replace(rangeRegex, '');
                    vReason = vReason.replace(singleRegex, '');
                    vReason = vReason.replace(/\([^\)]+\)/g, '');
                    vReason = vReason.replace(/외휴연계\s*[OX]?/gi, '');
                    vReason = vReason.replace(/사용/gi, '').trim();
                    vReason = vReason.replace(/,/gi, '').trim();
                    vReason = vReason.trim();

                    const diffDays = Math.round((vEndDate.getTime() - vStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                    const parsedCount = extractDayCountFromText(vacationPart);
                    let warning: string | null = null;
                    if (parsedCount !== null && parsedCount !== diffDays) {
                        warning = `휴가 사유(${parsedCount}일)와 입력된 기간(${diffDays}일)이 일치하지 않습니다.`;
                    }

                    // "연가 N일" 그대로 보존 및 사유 미지정 시 자동 계산
                    if (!vReason || vReason === '연가') {
                        vReason = `연가 ${diffDays}일`;
                    } else if (!/\d+일/.test(vReason) && diffDays > 0) {
                        vReason = `${vReason} ${diffDays}일`;
                    }

                    return {
                        period: vRangeMatch ? `${vM1}.${vD1}~${vM2}.${vD2}` : `${vM1}.${vD1}`,
                        depart: vStartStr,
                        isLinked,
                        return: vEndStr,
                        stayDays: getDatesBetween(vStartDate, vEndDate, false),
                        reason: vReason,
                        warning
                    };
                };

                const extractStayDetail = (part: string): string => {
                    const clean = part.replace(/^(병장|상병|일병|이병)\s+[가-힣]+\s*/, '').trim();
                    return clean || '잔류';
                };

                // ----------------------------------------------------
                // [Pass 2] 모든 댓글 행 순회 파싱 및 당직 생성
                // ----------------------------------------------------
                for (let i = 0; i < rawData.length; i++) {
                    const content = String(rawData[i]['댓글 내용'] || rawData[i]['내용'] || '').trim();
                    if (!content) continue;

                    const lines = content.split('\n');
                    lines.forEach(line => {
                        const cleanLine = line.replace(/^[ㄴ\-\*•\[\]\.\s]+/, '').trim();
                        const nameMatch = cleanLine.match(/^(병장|상병|일병|이병)\s+([가-힣]+)/);

                        if (nameMatch) {
                            const rank = nameMatch[1];
                            const name = nameMatch[2];
                            const fullName = `${rank} ${name}`;
                            const passPart = cleanLine.split('+')[0];
                            const vacationRaw = cleanLine.split('+')[1];
                            const rangeMatch = passPart.match(rangeRegex);

                            let passReason = passPart.trim();
                            passReason = passReason.replace(/^(병장|상병|일병|이병)\s+[가-힣]+\s*/, '');
                            passReason = passReason.replace(rangeRegex, '');
                            // Remove all date tokens like 9/4(목출금복), 9/7(일출월복), 9/4, 9.7 etc.
                            passReason = passReason.replace(/\d{1,2}[./]\d{1,2}(?:\s*\([^)]*\))?/g, '');
                            passReason = passReason.replace(/\([^)]+\)/g, '');
                            passReason = passReason.replace(/^[,~/\-\s]+/, '');
                            passReason = passReason.trim();

                            const memberDates: Date[] = [];

                            // Check if passPart contains multiple single date segments, e.g. "9/4(목출금복), 9/7(일출월복)"
                            const splitTokenRegex = /(\d{1,2})[./](\d{1,2})(?:\s*\(([^)]+)\))?/g;
                            const splitMatches: { m: number; d: number; note?: string }[] = [];
                            if (!rangeMatch) {
                                let match: RegExpExecArray | null;
                                while ((match = splitTokenRegex.exec(passPart)) !== null) {
                                    splitMatches.push({
                                        m: parseInt(match[1]),
                                        d: parseInt(match[2]),
                                        note: match[3]
                                    });
                                }
                            }

                            if (splitMatches.length > 1) {
                                // Multi-segment single date passes (e.g. 9/4(목출금복), 9/7(일출월복))
                                splitMatches.forEach(item => {
                                    const m = item.m;
                                    const d = item.d;
                                    const endDate = dateOf(m, d);
                                    const departDate = new Date(endDate);
                                    departDate.setDate(endDate.getDate() - 1);
                                    departDate.setHours(12, 0, 0, 0);

                                    memberDates.push(endDate);

                                    const passData = {
                                        name: fullName,
                                        type: '외박',
                                        period: `${m}.${d} (원데이)`,
                                        depart: `${departDate.getMonth() + 1}.${departDate.getDate()}`,
                                        return: `${m}.${d}`,
                                        stayDays: [] as string[],
                                        reason: passReason,
                                        warning: null
                                    };
                                    extractedData.push(passData);
                                });

                                if (vacationRaw) {
                                    const vacation = parseVacation(vacationRaw);
                                    if (vacation) {
                                        extractedData.push({
                                            name: fullName,
                                            type: '외박',
                                            period: '',
                                            depart: '',
                                            return: vacation.return,
                                            stayDays: [] as string[],
                                            reason: '',
                                            vacation,
                                            warning: vacation.warning
                                        });
                                    }
                                }
                            } else if (rangeMatch) {
                                const startM = parseInt(rangeMatch[1]);
                                const startD = parseInt(rangeMatch[2]);
                                const endM = rangeMatch[3] ? parseInt(rangeMatch[3]) : startM;
                                const endD = parseInt(rangeMatch[4]);

                                const startDate = dateOf(startM, startD);
                                const endDate = rangeEndDate(dateOf(startM, startD), endM, endD);
                                const departDate = new Date(startDate);
                                departDate.setDate(startDate.getDate() - 1);
                                departDate.setHours(12, 0, 0, 0);

                                memberDates.push(startDate, endDate);

                                const vacation = vacationRaw ? parseVacation(vacationRaw, `${endM}.${endD}`) : null;
                                const warning: string | null = null;

                                const passData = {
                                    name: fullName,
                                    type: '외박',
                                    period: `${startM}.${startD}~${endM}.${endD}`,
                                    depart: `${departDate.getMonth() + 1}.${departDate.getDate()}`,
                                    return: `${endM}.${endD}`,
                                    stayDays: getDatesBetween(startDate, endDate, true),
                                    reason: passReason,
                                    warning
                                };

                                if (vacation) {
                                    extractedData.push({ ...passData, vacation, warning: warning || vacation.warning });
                                } else {
                                    extractedData.push(passData);
                                }
                            } else {
                                const singleMatch = passPart.match(singleRegex);
                                if (singleMatch) {
                                    const m = parseInt(singleMatch[1]);
                                    const d = parseInt(singleMatch[2]);

                                    const endDate = dateOf(m, d);
                                    const departDate = new Date(endDate);
                                    departDate.setDate(endDate.getDate() - 1);
                                    departDate.setHours(12, 0, 0, 0);

                                    memberDates.push(endDate);

                                    const isDayOff = passPart.match(/(원|투|쓰리|포|파이브)데이/);
                                    const hasStayKeyword = passPart.includes('잔류');

                                    if (hasStayKeyword && !isDayOff) {
                                        extractedData.push({ name: fullName, type: '잔류', detail: extractStayDetail(passPart) });
                                    } else {
                                        const warning: string | null = null;

                                        const passData = {
                                            name: fullName,
                                            type: '외박',
                                            period: `${m}.${d} (원데이)`,
                                            depart: `${departDate.getMonth() + 1}.${departDate.getDate()}`,
                                            return: `${m}.${d}`,
                                            stayDays: [] as string[],
                                            reason: passReason,
                                            warning
                                        };

                                        if (vacationRaw) {
                                            const vacation = parseVacation(vacationRaw, passData.return);
                                            if (vacation) {
                                                extractedData.push({ ...passData, vacation, warning: warning || vacation.warning });
                                            } else {
                                                extractedData.push(passData);
                                            }
                                        } else {
                                            extractedData.push(passData);
                                        }
                                    }
                                } else if (vacationRaw) {
                                    const vacation = parseVacation(vacationRaw);
                                    const hasStayKeyword = passPart.includes('잔류');
                                    if (hasStayKeyword) {
                                        extractedData.push({
                                            name: fullName,
                                            type: '잔류',
                                            detail: extractStayDetail(passPart),
                                            vacation: vacation || undefined,
                                            warning: vacation?.warning || null
                                        });
                                    } else if (vacation) {
                                        extractedData.push({
                                            name: fullName,
                                            type: '외박',
                                            period: '',
                                            depart: '',
                                            return: vacation.return,
                                            stayDays: [] as string[],
                                            reason: '',
                                            vacation,
                                            warning: vacation.warning
                                        });
                                    } else {
                                        extractedData.push({ name: fullName, type: '잔류', detail: extractStayDetail(passPart) });
                                    }
                                } else if (passPart.includes('잔류')) {
                                    extractedData.push({ name: fullName, type: '잔류', detail: extractStayDetail(passPart) });
                                } else {
                                    extractedData.push({ name: fullName, type: '잔류', detail: '날짜 데이터 없음' });
                                }
                            }

                            // 사유(passReason, detail, 또는 cleanLine 전체)에서 당직(금당, 토당 등) 감지 및 당직 목록에 추가
                            const dutyFromReason = checkAndExtractDutyFromReason(fullName, cleanLine, memberDates);
                            if (dutyFromReason) {
                                extractedData.push(dutyFromReason);
                            }
                        } else {
                            // 대원 이름 포맷이 아닌 경우, 구버전 독립 당직 라인 포맷 확인
                            const dutyItem = parseDutyLine(line);
                            if (dutyItem) {
                                extractedData.push(dutyItem);
                            }
                        }
                    });
                }

                // 잔류 기록 기간은 항상 기준 주의 토요일~일요일
                const stayWeek = stayWeekendMD(anchorWeekend);
                parsedAnchorIsoRef.current = toIsoDate(anchorWeekend);
                setParsedData(extractedData.map((item: any) => (item.type === '잔류' ? { ...item, stayStart: stayWeek.start, stayEnd: stayWeek.end } : item)));
                setLoading(false);
            } catch (err) {
                console.error('Error parsing excel:', err);
                setError('파일을 읽는 중 오류가 발생했습니다.');
                setLoading(false);
            }
        };

        reader.onerror = () => {
            setError('파일 읽기 실패');
            setLoading(false);
        };
        reader.readAsBinaryString(file);

        e.target.value = '';
    };

    const handleSync = async (resolvedData?: any[]) => {
        const targetData = resolvedData || parsedData;
        if (!targetData) return;
        // 경고가 있는 항목이 하나라도 있으면 반영하지 않는다 (엑셀을 고쳐 다시 올린다)
        const warned = targetData.filter((m: any) => m.warning);
        if (warned.length > 0) {
            setError(`경고가 있는 항목 ${warned.length}건이 있어 반영하지 않았습니다. 엑셀을 고친 뒤 다시 올려 주세요.`);
            return;
        }
        if (!confirm('분석된 데이터를 스프레드시트에 반영할까요?')) return;

        setSyncing(true);
        setError(null);
        setSuccess(null);

        // 동명이인에서 고른 이름을 반영한다
        const movementsToSync = targetData.map(m => ({ ...m, name: resolutions[m.name] || m.name }));
        try {
            // 시트와 Firestore 기록은 서버가 처리한다 (앱을 닫아도 계속된다). 결과만 받아 화면에 보여 준다.
            await submitMovementImport(movementsToSync, parsedAnchorIsoRef.current || toIsoDate(new Date()), (state) => {
                if (state.status === 'pending' || state.status === 'running') return;
                setSyncing(false);
                if (state.status === 'done') {
                    setSuccess(`${state.count ?? 0}개의 셀이 성공적으로 업데이트되었습니다!`);
                    setAmbiguousMembers(null);
                    setResolutions({});
                    if (sheetMode) fetchSpreadsheet(sheetMode);
                } else if (state.status === 'ambiguous') {
                    setAmbiguousMembers(state.ambiguousMembers || []);
                } else if (state.status === 'warning') {
                    // 시트에 없는 이름·날짜: 아무것도 쓰지 않았다. 해당 항목에 경고를 붙여 검토 화면에 보여 주고 반영을 막는다.
                    const warnings = state.warnings || [];
                    const reverse = new Map(Object.entries(resolutions).map(([excel, sheet]) => [sheet, excel]));
                    setParsedData(prev => {
                        if (!prev) return prev;
                        const used = new Set<number>();
                        const next = prev.map((item: any) => ({ ...item }));
                        warnings.forEach(w => {
                            const idx = next.findIndex((item: any, i: number) => !used.has(i) && (item.name === w.name || item.name === reverse.get(w.name)));
                            if (idx === -1) return;
                            used.add(idx);
                            next[idx].warning = next[idx].warning ? `${next[idx].warning} / ${w.message}` : w.message;
                        });
                        return next;
                    });
                    setError(`시트와 맞지 않는 항목 ${warnings.length}건이 있어 반영하지 않았습니다. 아래 경고를 확인하세요.`);
                } else if (state.status === 'failed') {
                    const detail = state.errorDetail && state.errorDetail !== state.lastError ? ` (원인: ${state.errorDetail})` : '';
                    setError(`반영 실패: ${state.lastError || '알 수 없는 오류'}${detail}`);
                }
            });
        } catch (err: any) {
            console.error('Sync error:', err);
            setError(`동기화 실패: ${err.message}`);
            setSyncing(false);
        }
    };

    const getExcelTimelineAndData = () => {
        if (!parsedData) return { timeline: [], dataList: [] };
        const groupedMap = new Map<string, any[]>();
        parsedData.forEach(item => {
            if (!groupedMap.has(item.name)) groupedMap.set(item.name, []);
            groupedMap.get(item.name)?.push(item);
        });

        const allDates: string[] = [];
        parsedData.forEach(d => {
            if (d.depart) allDates.push(d.depart);
            if (d.return) allDates.push(d.return);
            if (d.stayDays) allDates.push(...d.stayDays);
            if (d.vacation) {
                if (d.vacation.depart) allDates.push(d.vacation.depart);
                if (d.vacation.return) allDates.push(d.vacation.return);
                if (d.vacation.stayDays) allDates.push(...d.vacation.stayDays);
            }
            if (d.date) allDates.push(d.date);
        });

        // 연말을 넘는 날짜도 순서대로 놓이도록, 엑셀 기준 주말(없으면 점호 날짜)에서 가장 가까운 연도를 쓴다
        const yearRef = parsedAnchorIsoRef.current ? new Date(`${parsedAnchorIsoRef.current}T12:00:00`) : (baseDate ? new Date(baseDate) : new Date());
        const dateObjects = Array.from(new Set(allDates)).map(d => {
            const [m, day] = d.split('.').map(Number);
            return { str: d, date: nearestYearDate(m, day, yearRef) };
        }).sort((a, b) => a.date.getTime() - b.date.getTime());

        if (dateObjects.length === 0) return { timeline: [], dataList: [] };

        const startDate = new Date(dateObjects[0].date);
        startDate.setHours(12, 0, 0, 0);
        const currentDay = startDate.getDay();
        const diffToWed = (currentDay - 3 + 7) % 7;
        startDate.setDate(startDate.getDate() - diffToWed);
        startDate.setHours(12, 0, 0, 0);

        const defaultEnd = new Date(startDate);
        defaultEnd.setDate(startDate.getDate() + 9);
        defaultEnd.setHours(12, 0, 0, 0);

        const lastDetectedDate = dateObjects[dateObjects.length - 1].date;
        const endDate = lastDetectedDate.getTime() > defaultEnd.getTime() ? lastDetectedDate : defaultEnd;
        const timeline: string[] = [];
        const curr = new Date(startDate);
        curr.setHours(12, 0, 0, 0);
        while (curr <= endDate) {
            timeline.push(`${curr.getMonth() + 1}.${curr.getDate()}`);
            curr.setDate(curr.getDate() + 1);
            curr.setHours(12, 0, 0, 0);
        }

        const dataList = Array.from(groupedMap.entries()).map(([name, items]) => {
            const dayStatuses: Record<string, string> = {};
            timeline.forEach((dateStr, tIdx) => {
                let status = 'none';
                items.forEach(item => {
                    const yesterdayStr = tIdx > 0 ? timeline[tIdx - 1] : (() => {
                        const prevD = new Date(startDate);
                        prevD.setDate(prevD.getDate() - 1);
                        return `${prevD.getMonth() + 1}.${prevD.getDate()}`;
                    })();
                    const isRecovery = item.type === '당직' && item.date === yesterdayStr;

                    if (item.type === '당직' && item.date === dateStr) {
                        status = 'duty';
                    } else if (isRecovery) {
                        if (status !== 'duty') status = 'recovery';
                    } else if (item.type === '외박') {
                        const isPassDepart = item.depart === dateStr;
                        const isPassReturn = item.return === dateStr;
                        const isVacationDepart = item.vacation?.depart === dateStr;
                        const isVacationReturn = item.vacation?.return === dateStr;
                        const isLinked = item.vacation?.isLinked && isPassReturn && isVacationDepart;

                        if (isLinked) {
                            status = 'linked';
                        } else if (isVacationReturn && (isPassDepart || (item.period && item.period.startsWith(dateStr)))) {
                            status = 'vacation-pass-depart';
                        } else if (isPassDepart) {
                            if (status !== 'duty' && status !== 'recovery' && status !== 'vacation' && status !== 'linked' && status !== 'vacation-pass-depart')
                                status = 'pass-depart';
                        } else {
                            if (item.return === dateStr || item.stayDays.includes(dateStr)) {
                                if (status !== 'duty' && status !== 'recovery' && status !== 'vacation' && status !== 'linked' && status !== 'vacation-pass-depart')
                                    status = 'pass';
                            }
                            if (item.vacation) {
                                if (item.vacation.depart === dateStr || item.vacation.return === dateStr || item.vacation.stayDays.includes(dateStr)) {
                                    if (status !== 'duty' && status !== 'recovery' && status !== 'linked' && status !== 'vacation-pass-depart')
                                        status = 'vacation';
                                }
                            }
                        }
                    }
                });

                if (status === 'recovery') {
                    const hasPassDepart = items.some(item => item.type === '외박' && item.depart === dateStr);
                    if (hasPassDepart) status = 'recovery-pass-depart';
                }

                if (status !== 'duty' && status !== 'recovery' && status !== 'linked') {
                    const hasVacReturn = items.some(item => item.vacation?.return === dateStr);
                    const hasPassDep = items.some(item => item.type === '외박' && (item.depart === dateStr || (item.period && item.period.startsWith(dateStr))));
                    if (hasVacReturn && hasPassDep) {
                        status = 'vacation-pass-depart';
                    }
                }

                dayStatuses[dateStr] = status;
            });
            return { name, dayStatuses };
        });

        return { timeline, dataList };
    };

    return {
        parsedData,
        sheetWeeks,
        currentWeekIndex,
        setCurrentWeekIndex,
        viewMode,
        setViewMode,
        loading,
        syncing,
        error,
        success,
        ambiguousMembers,
        setAmbiguousMembers,
        resolutions,
        setResolutions,
        sheetMode,
        dbMembers,
        movements,
        dutySchedules,
        toggleMode,
        handleFileUpload,
        handleSync,
        getExcelTimelineAndData,
        fetchSpreadsheet,
        handleLocalScheduleUpdate,
        isRecentlyEdited
    };
}
