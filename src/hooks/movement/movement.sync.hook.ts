/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import axios from 'axios';
import { doc, onSnapshot, setDoc, serverTimestamp, collection, getDoc, writeBatch, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { MovementRecord } from '../../types/movement/movement.type';

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
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setDbMembers(rows);
        });

        const unsubMovements = onSnapshot(collection(db, 'movements'), (snap) => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as MovementRecord));
            setMovements(rows);
        });

        return () => {
            unsub();
            unsubMembers();
            unsubMovements();
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

            const timer = setTimeout(() => {
                fetchSpreadsheet(sheetMode, sheetUpdatedAt);
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

    const fetchSpreadsheet = async (mode: 'test' | 'prod', updatedAtStr?: string) => {
        const cacheKey = updatedAtStr ? `ncoa_movement_${mode}_${updatedAtStr}_v2` : null;
        const cached = cacheKey ? localStorage.getItem(cacheKey) : null;

        // 1. 로컬 브라우저 캐시 확인
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed && Array.isArray(parsed)) {
                    setSheetWeeks(parsed);
                    setCurrentWeekIndex(selectDefaultWeekIndex(parsed, baseDate));
                    setViewMode('sheet');
                    setParsedData(null);
                    setLoading(false);
                    return; // 완전 일치하는 캐시가 있으면 여기서 네트워크 요청 즉시 중단!
                }
            } catch (e) {
                console.error('Cache parsing error:', e);
            }
        }

        // 2. Firestore 공유 캐시 확인
        if (updatedAtStr) {
            try {
                const cacheDoc = await getDoc(doc(db, "movement_cache_v2", `${mode}_${updatedAtStr}`));
                if (cacheDoc.exists()) {
                    const sharedData = cacheDoc.data().data;
                    setSheetWeeks(sharedData);
                    setCurrentWeekIndex(selectDefaultWeekIndex(sharedData, baseDate));

                    // 로컬에도 캐싱
                    if (cacheKey) {
                        localStorage.setItem(cacheKey, JSON.stringify(sharedData));
                    }

                    setViewMode('sheet');
                    setParsedData(null);
                    setLoading(false);
                    return;
                }
            } catch (e) {
                console.error("Firestore movement cache read error:", e);
            }
        }

        // 캐시가 없거나, 구글 시트 변동으로 인해 새로운 updatedAt이 내려왔을 경우에만 스피너와 함께 새로 다운로드
        setLoading(true);
        setError(null);
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

                            let hasActivity = false;
                            const dayStatuses: Record<string, string> = {};

                            blockCols.forEach((c, idx) => {
                                const cell = row[c.col] || '';
                                let status = 'none';
                                if (cell.includes('외박')) {
                                    if (cell.includes('출발')) status = 'pass-depart';
                                    else status = 'pass';
                                }
                                if (cell.includes('휴가')) {
                                    status = 'vacation';
                                }
                                if (cell.includes('당직')) status = 'duty';
                                if (cell.includes('연계')) status = 'linked';

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

                                if (status !== 'none' && status !== 'duty' && status !== 'recovery') {
                                    hasActivity = true;
                                }
                                dayStatuses[c.dateStr] = status;
                            });

                            if (hasActivity) {
                                weekData.push({
                                    name: nameWithRank,
                                    dayStatuses
                                });
                            }
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
                        const cacheKey = `ncoa_movement_${mode}_${updatedAtStr}_v2`;

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
                            await setDoc(doc(db, "movement_cache_v2", `${mode}_${updatedAtStr}`), {
                                data: parsedWeeks,
                                updatedAt: serverTimestamp()
                            });
                        } catch (e) {
                            console.error("Firestore movement cache write error:", e);
                        }
                    }

                    setSheetWeeks(parsedWeeks);
                    setCurrentWeekIndex(selectDefaultWeekIndex(parsedWeeks, baseDate));
                    setViewMode('sheet');
                    setParsedData(null);
                    setLoading(false);
                }
            });
        } catch (e) {
            console.error("fetchSpreadsheet error:", e);
            setError('스프레드시트 데이터를 불러오는 중 오류가 발생했습니다.');
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
                let isCapturing = false;
                let isDutyCapturing = false;

                const currentYear = new Date().getFullYear();

                for (let i = 0; i < rawData.length; i++) {
                    const content = String(rawData[i]['댓글 내용'] || '').trim();

                    if (content === 'ㅌㅇㅅㅎ') {
                        isCapturing = true;
                        isDutyCapturing = false;
                        continue;
                    }

                    if (content.includes('당직') && !content.startsWith('ㄴ')) {
                        isDutyCapturing = true;
                        isCapturing = false;
                        continue;
                    }

                    if (isCapturing) {
                        if (content.startsWith('ㄴ')) {
                            const lines = content.split('\n');
                            lines.forEach(line => {
                                const cleanLine = line.replace(/^ㄴ/, '').trim();
                                const nameMatch = cleanLine.match(/^(병장|상병|일병|이병)\s+([가-힣]+)/);
                                if (nameMatch) {
                                    const rank = nameMatch[1];
                                    const name = nameMatch[2];
                                    const passPart = cleanLine.split('+')[0];
                                    const vacationRaw = cleanLine.split('+')[1];
                                    const rangeRegex = /(\d{1,2})[./](\d{1,2})\s*~\s*(\d{1,2})[./](\d{1,2})/;
                                    const singleRegex = /(\d{1,2})[./](\d{1,2})/;
                                    const rangeMatch = passPart.match(rangeRegex);

                                    // 연가 파싱 헬퍼: vacationPart에서 날짜 추출 후 vacation 객체 생성
                                    const parseVacation = (vacationPart: string, passReturn?: string) => {
                                        const vRangeMatch = vacationPart.match(rangeRegex);
                                        const vSingleMatch = vacationPart.match(singleRegex);
                                        if (!vRangeMatch && !vSingleMatch) return null;
                                        const vM1 = parseInt((vRangeMatch || vSingleMatch)![1]);
                                        const vD1 = parseInt((vRangeMatch || vSingleMatch)![2]);
                                        const vM2 = vRangeMatch ? parseInt(vRangeMatch[3]) : vM1;
                                        const vD2 = vRangeMatch ? parseInt(vRangeMatch[4]) : vD1;
                                        const vStartDate = new Date(currentYear, vM1 - 1, vD1, 12, 0, 0, 0);
                                        const vEndDate = new Date(currentYear, vM2 - 1, vD2, 12, 0, 0, 0);
                                        const vStartStr = `${vM1}.${vD1}`;
                                        const vEndStr = `${vM2}.${vD2}`;
                                        // 외휴연계 O이면 true, X이면 false, 없으면 주소 비교 fallback
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
                                        vReason = vReason.trim();

                                        return {
                                            period: vRangeMatch ? `${vM1}.${vD1}~${vM2}.${vD2}` : `${vM1}.${vD1}`,
                                            depart: vStartStr,
                                            isLinked,
                                            return: vEndStr,
                                            stayDays: getDatesBetween(vStartDate, vEndDate, false),
                                            reason: vReason
                                        };
                                    };

                                    let passReason = passPart.trim();
                                    passReason = passReason.replace(/^(병장|상병|일병|이병)\s+[가-힣]+\s*/, '');
                                    passReason = passReason.replace(rangeRegex, '');
                                    passReason = passReason.replace(singleRegex, '');
                                    passReason = passReason.replace(/\([^\)]+\)/g, '');
                                    passReason = passReason.trim();

                                    if (rangeMatch) {
                                        // '+' 앞에 날짜 범위 있음 → 외박 처리
                                        const startM = parseInt(rangeMatch[1]);
                                        const startD = parseInt(rangeMatch[2]);
                                        const endM = parseInt(rangeMatch[3]);
                                        const endD = parseInt(rangeMatch[4]);

                                        const startDate = new Date(currentYear, startM - 1, startD, 12, 0, 0, 0);
                                        const endDate = new Date(currentYear, endM - 1, endD, 12, 0, 0, 0);
                                        const departDate = new Date(startDate);
                                        departDate.setDate(startDate.getDate() - 1);
                                        departDate.setHours(12, 0, 0, 0);

                                        const passData = {
                                            name: `${rank} ${name}`,
                                            type: '외박',
                                            period: `${startM}.${startD}~${endM}.${endD}`,
                                            depart: `${departDate.getMonth() + 1}.${departDate.getDate()}`,
                                            return: `${endM}.${endD}`,
                                            stayDays: getDatesBetween(startDate, endDate, true),
                                            reason: passReason
                                        };

                                        if (vacationRaw) {
                                            const vacation = parseVacation(vacationRaw, passData.return);
                                            if (vacation) {
                                                extractedData.push({ ...passData, vacation });
                                            } else {
                                                extractedData.push(passData);
                                            }
                                        } else {
                                            extractedData.push(passData);
                                        }
                                    } else {
                                        const singleMatch = passPart.match(singleRegex);
                                        if (singleMatch) {
                                            // '+' 앞에 단일 날짜 있음 → 외박(원데이) 처리
                                            const m = parseInt(singleMatch[1]);
                                            const d = parseInt(singleMatch[2]);
                                            const endDate = new Date(currentYear, m - 1, d, 12, 0, 0, 0);
                                            const departDate = new Date(endDate);
                                            departDate.setDate(endDate.getDate() - 1);
                                            departDate.setHours(12, 0, 0, 0);

                                            const isDayOff = passPart.match(/(원|투|쓰리|포|파이브)데이/);
                                            const hasStayKeyword = passPart.includes('잔류');

                                            if (hasStayKeyword && !isDayOff) {
                                                extractedData.push({ name: `${rank} ${name}`, type: '잔류', detail: '당직/업무 등으로 인한 잔류' });
                                            } else {
                                                const passData = {
                                                    name: `${rank} ${name}`,
                                                    type: '외박',
                                                    period: `${m}.${d} (원데이)`,
                                                    depart: `${departDate.getMonth() + 1}.${departDate.getDate()}`,
                                                    return: `${m}.${d}`,
                                                    stayDays: [] as string[],
                                                    reason: passReason
                                                };

                                                if (vacationRaw) {
                                                    const vacation = parseVacation(vacationRaw, passData.return);
                                                    if (vacation) {
                                                        extractedData.push({ ...passData, vacation });
                                                    } else {
                                                        extractedData.push(passData);
                                                    }
                                                } else {
                                                    extractedData.push(passData);
                                                }
                                            }
                                        } else if (vacationRaw) {
                                            // '+' 앞에 날짜 없음 (잔류 등) → 외박 없이 연가만 처리
                                            const vacation = parseVacation(vacationRaw);
                                            if (vacation) {
                                                extractedData.push({
                                                    name: `${rank} ${name}`,
                                                    type: '외박',
                                                    period: '',
                                                    depart: '',
                                                    return: vacation.return,
                                                    stayDays: [] as string[],
                                                    reason: '',
                                                    vacation
                                                });
                                            } else {
                                                // 연가 날짜도 없으면 잔류 처리
                                                extractedData.push({ name: `${rank} ${name}`, type: '잔류', detail: '잔류' });
                                            }
                                        } else if (passPart.includes('잔류')) {
                                            extractedData.push({ name: `${rank} ${name}`, type: '잔류', detail: '잔류' });
                                        } else {
                                            extractedData.push({ name: `${rank} ${name}`, type: '잔류', detail: '날짜 데이터 없음' });
                                        }
                                    }
                                }
                            });
                        } else if (content !== '') {
                            isCapturing = false;
                        }
                    }

                    if (isDutyCapturing) {
                        if (content.startsWith('ㄴ')) {
                            const cleanLine = content.replace(/^ㄴ/, '').trim();
                            const dutyMatch = cleanLine.match(/^(병장|상병|일병|이병)\s+([가-힣]+)[,\s]+(\d{1,2})\s*[./월]\s*(\d{1,2})/);

                            if (dutyMatch) {
                                const rank = dutyMatch[1];
                                const name = dutyMatch[2];
                                const m = dutyMatch[3];
                                const d = dutyMatch[4];

                                extractedData.push({
                                    name: `${rank} ${name}`,
                                    type: '당직',
                                    date: `${m}.${d}`
                                });
                            }
                        } else if (content !== '') {
                            isDutyCapturing = false;
                        }
                    }
                }

                setParsedData(extractedData);
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
        if (!confirm('분석된 데이터를 스프레드시트에 반영할까요?')) return;

        setSyncing(true);
        setError(null);
        setSuccess(null);

        try {
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const baseUrl = isLocal
                ? (import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:5001/seniorkatusa-aa594/asia-northeast3')
                : 'https://asia-northeast3-seniorkatusa-aa594.cloudfunctions.net';

            const movementsToSync = targetData.map(m => {
                const resolvedName = resolutions[m.name] || m.name;
                return { ...m, name: resolvedName };
            });

            const response = await axios.post(`${baseUrl}/syncMovementToSheet`, {
                movements: movementsToSync
            });

            if (response.data.status === "ambiguous") {
                setAmbiguousMembers(response.data.ambiguousMembers);
                setSyncing(false);
                return;
            }

            if (response.data.status === 'success') {
                const currentYear = new Date().getFullYear();
                const toISODate = (monthDayStr: string) => {
                    if (!monthDayStr) return '';
                    const clean = monthDayStr.replace(/\(원데이\)/, '').trim();
                    const parts = clean.split(/[./~]/).map(p => p.trim());
                    if (parts.length < 2) return '';
                    const m = parseInt(parts[0]);
                    const d = parseInt(parts[1]);
                    if (isNaN(m) || isNaN(d)) return '';
                    return `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                };

                // Find date range of sync and names
                let minDate = '9999-12-31';
                let maxDate = '0000-01-01';
                const namesToSync = new Set<string>();

                movementsToSync.forEach(m => {
                    const cleanName = m.name.replace(/^(병장|상병|일병|이병)\s*/, '');
                    namesToSync.add(cleanName);

                    if (m.period && m.type === '외박') {
                        const [startStr, endStr] = m.period.split('~').map((s: string) => s.trim());
                        const startDate = toISODate(startStr);
                        const endDate = endStr ? toISODate(endStr) : startDate;
                        if (startDate && startDate < minDate) minDate = startDate;
                        if (endDate && endDate > maxDate) maxDate = endDate;
                    }
                    if (m.vacation) {
                        const startDate = toISODate(m.vacation.depart);
                        const endDate = toISODate(m.vacation.return);
                        if (startDate && startDate < minDate) minDate = startDate;
                        if (endDate && endDate > maxDate) maxDate = endDate;
                    }
                });

                // 1. Delete existing movements for these names that overlap with this range
                if (namesToSync.size > 0 && minDate !== '9999-12-31' && maxDate !== '0000-01-01') {
                    const namesArray = Array.from(namesToSync);
                    const chunkSize = 30;
                    const existingDocs: any[] = [];

                    for (let i = 0; i < namesArray.length; i += chunkSize) {
                        const chunk = namesArray.slice(i, i + chunkSize);
                        const qExisting = query(
                            collection(db, 'movements'),
                            where('name', 'in', chunk)
                        );
                        const snapExisting = await getDocs(qExisting);
                        existingDocs.push(...snapExisting.docs);
                    }

                    const deleteBatch = writeBatch(db);
                    let shouldCommitDelete = false;

                    existingDocs.forEach(docSnap => {
                        const data = docSnap.data();
                        if (data.startDate <= maxDate && data.endDate >= minDate) {
                            deleteBatch.delete(docSnap.ref);
                            shouldCommitDelete = true;
                        }
                    });
                    if (shouldCommitDelete) {
                        await deleteBatch.commit();
                    }
                }

                // Determine the main pass dates of this synced batch (most frequent pass period)
                const passPeriods: Record<string, number> = {};
                movementsToSync.forEach(m => {
                    if (m.type === '외박' && m.period && !m.period.includes('원데이')) {
                        passPeriods[m.period] = (passPeriods[m.period] || 0) + 1;
                    }
                });
                let maxPeriodCount = 0;
                let mainPassPeriod = '';
                Object.entries(passPeriods).forEach(([p, count]) => {
                    if (count > maxPeriodCount) {
                        maxPeriodCount = count;
                        mainPassPeriod = p;
                    }
                });

                let mainPassStart = '';
                let mainPassEnd = '';
                if (mainPassPeriod) {
                    const [startStr, endStr] = mainPassPeriod.split('~').map((s: string) => s.trim());
                    mainPassStart = toISODate(startStr);
                    mainPassEnd = endStr ? toISODate(endStr) : mainPassStart;
                    if (mainPassStart && mainPassEnd && mainPassEnd < mainPassStart) {
                        const [y, m, d] = mainPassEnd.split('-').map(Number);
                        mainPassEnd = `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    }
                }
                if (!mainPassStart && minDate !== '9999-12-31' && maxDate !== '0000-01-01') {
                    mainPassStart = minDate;
                    mainPassEnd = maxDate;
                }

                // 2. Add new movements to Firestore
                const addBatch = writeBatch(db);
                let shouldCommitAdd = false;

                movementsToSync.forEach(m => {
                    const cleanName = m.name.replace(/^(병장|상병|일병|이병)\s*/, '');

                    // Save pass movement
                    if (m.period && m.type === '외박') {
                        const [startStr, endStr] = m.period.split('~').map((s: string) => s.trim());
                        const startDate = toISODate(startStr);
                        const endDate = endStr ? toISODate(endStr) : startDate;

                        if (startDate && endDate) {
                            const docRef = doc(collection(db, 'movements'));
                            addBatch.set(docRef, {
                                name: cleanName,
                                type: 'pass',
                                startDate,
                                endDate,
                                reason: m.reason || '',
                                createdAt: serverTimestamp()
                            });
                            shouldCommitAdd = true;
                        }
                    }

                    // Save stayback movement
                    if (m.type === '잔류' && mainPassStart && mainPassEnd) {
                        const docRef = doc(collection(db, 'movements'));
                        addBatch.set(docRef, {
                            name: cleanName,
                            type: 'stay',
                            startDate: mainPassStart,
                            endDate: mainPassEnd,
                            reason: m.detail || '잔류',
                            createdAt: serverTimestamp()
                        });
                        shouldCommitAdd = true;
                    }

                    // Save vacation movement
                    if (m.vacation) {
                        const startDate = toISODate(m.vacation.depart);
                        const endDate = toISODate(m.vacation.return);

                        if (startDate && endDate) {
                            const docRef = doc(collection(db, 'movements'));
                            addBatch.set(docRef, {
                                name: cleanName,
                                type: 'vacation',
                                startDate,
                                endDate,
                                reason: m.vacation.reason || '',
                                createdAt: serverTimestamp()
                            });
                            shouldCommitAdd = true;
                        }
                    }
                });

                if (shouldCommitAdd) {
                    await addBatch.commit();
                }

                setSuccess(`${response.data.count}개의 셀이 성공적으로 업데이트되었습니다!`);
                setAmbiguousMembers(null);
                setResolutions({});
                if (sheetMode) fetchSpreadsheet(sheetMode);
            } else {
                throw new Error(response.data.message);
            }
        } catch (err: any) {
            console.error('Sync error:', err);
            setError(`동기화 실패: ${err.response?.data?.message || err.message}`);
        } finally {
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

        const dateObjects = Array.from(new Set(allDates)).map(d => {
            const [m, day] = d.split('.').map(Number);
            return { str: d, date: new Date(2026, m - 1, day, 12, 0, 0, 0) };
        }).sort((a, b) => a.date.getTime() - b.date.getTime());

        if (dateObjects.length === 0) return { timeline: [], dataList: [] };

        const startDate = new Date(dateObjects[0].date);
        startDate.setHours(12, 0, 0, 0);
        const currentDay = startDate.getDay();
        const diffToWed = (currentDay - 3 + 7) % 7;
        startDate.setDate(startDate.getDate() - diffToWed);
        startDate.setHours(12, 0, 0, 0);

        const endDate = new Date(dateObjects[dateObjects.length - 1].date);
        endDate.setHours(12, 0, 0, 0);
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
                    const yesterdayStr = tIdx > 0 ? timeline[tIdx - 1] : null;
                    const isRecovery = item.type === '당직' && item.date === yesterdayStr;

                    if (item.type === '당직' && item.date === dateStr) {
                        status = 'duty';
                    } else if (isRecovery) {
                        if (status !== 'duty') status = 'recovery';
                    } else if (item.type === '외박') {
                        const isPassDepart = item.depart === dateStr;
                        const isPassReturn = item.return === dateStr;
                        const isVacationDepart = item.vacation?.depart === dateStr;
                        const isLinked = item.vacation?.isLinked && isPassReturn && isVacationDepart;

                        if (isLinked) {
                            status = 'linked';
                        } else if (isPassDepart) {
                            if (status !== 'duty' && status !== 'recovery' && status !== 'vacation' && status !== 'linked')
                                status = 'pass-depart';
                        } else {
                            if (item.return === dateStr || item.stayDays.includes(dateStr)) {
                                if (status !== 'duty' && status !== 'recovery' && status !== 'vacation' && status !== 'linked')
                                    status = 'pass';
                            }
                            if (item.vacation) {
                                if (item.vacation.depart === dateStr || item.vacation.return === dateStr || item.vacation.stayDays.includes(dateStr)) {
                                    if (status !== 'duty' && status !== 'recovery' && status !== 'linked')
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
        toggleMode,
        handleFileUpload,
        handleSync,
        getExcelTimelineAndData,
        fetchSpreadsheet
    };
}
