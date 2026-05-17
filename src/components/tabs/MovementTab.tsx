/* eslint-disable @typescript-eslint/no-explicit-any */
// MovementTab for Special Leave (외특)
import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { Upload, CheckCircle2, AlertCircle, Send, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import axios from 'axios';
import { doc, onSnapshot, setDoc, serverTimestamp, collection, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const SPREADSHEET_URLS = {
    test: "https://docs.google.com/spreadsheets/d/1eyiNzyvJ1BguGzzpkYDnVegi-4U-zuCacCvy9bOW8R8/export?format=csv&gid=1529486829",
    prod: "https://docs.google.com/spreadsheets/d/1WBJXIzLbbtRxt09KOaJeXKXtgbht-GDjX3N4DyDztOY/export?format=csv&gid=1529486829"
};

interface MovementTabProps {
    baseDate?: Date;
}

export default function MovementTab({ baseDate }: MovementTabProps) {
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

        return () => {
            unsub();
            unsubMembers();
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

    const selectDefaultWeekIndex = (weeks: any[]) => {
        const today = baseDate ? new Date(baseDate) : new Date();
        today.setHours(0, 0, 0, 0);
        const year = today.getFullYear();

        let defaultIdx = 0;
        for (let i = 0; i < weeks.length; i++) {
            const w = weeks[i];
            if (!w) continue;
            let lastActivityDate = new Date();
            lastActivityDate.setFullYear(1970);

            for (let d = 0; d < w.timeline.length; d++) {
                const dateStr = w.timeline[d];
                const hasAct = w.data.some((m: any) => m.dayStatuses[dateStr] && m.dayStatuses[dateStr] !== 'none' && m.dayStatuses[dateStr] !== 'duty' && m.dayStatuses[dateStr] !== 'recovery');
                if (hasAct) {
                    const [mm, dd] = dateStr.split('.').map(Number);
                    lastActivityDate = new Date(year, mm - 1, dd);
                }
            }
            if (today <= lastActivityDate) {
                defaultIdx = i;
                break;
            }
            if (i === weeks.length - 1) {
                defaultIdx = i;
            }
        }
        return defaultIdx;
    };

    const activeWeekStartDateRef = useRef<string | null>(null);

    useEffect(() => {
        if (sheetWeeks && sheetWeeks[currentWeekIndex]) {
            activeWeekStartDateRef.current = sheetWeeks[currentWeekIndex].startDate;
        }
    }, [sheetWeeks, currentWeekIndex]);

    const findMatchingWeekIndex = (weeks: any[], targetStartDate: string | null) => {
        if (!targetStartDate) return selectDefaultWeekIndex(weeks);
        const idx = weeks.findIndex(w => w.startDate === targetStartDate);
        return idx !== -1 ? idx : selectDefaultWeekIndex(weeks);
    };

    const fetchSpreadsheet = async (mode: 'test' | 'prod', updatedAtStr?: string) => {
        const cacheKey = updatedAtStr ? `ncoa_movement_${mode}_${updatedAtStr}` : null;
        const cached = cacheKey ? localStorage.getItem(cacheKey) : null;

        // 1. 로컬 브라우저 캐시 확인
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed && Array.isArray(parsed)) {
                    setSheetWeeks(parsed);
                    setCurrentWeekIndex(findMatchingWeekIndex(parsed, activeWeekStartDateRef.current));
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
                const cacheDoc = await getDoc(doc(db, "movement_cache", `${mode}_${updatedAtStr}`));
                if (cacheDoc.exists()) {
                    const sharedData = cacheDoc.data().data;
                    setSheetWeeks(sharedData);
                    setCurrentWeekIndex(findMatchingWeekIndex(sharedData, activeWeekStartDateRef.current));

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
                    for (let c = 1; c < dateRow.length; c++) {
                        if (!dateRow[c]) continue;
                        const parts = dateRow[c].split(/[./]/).map(p => p.trim());
                        if (parts.length < 3) continue;
                        const m = parseInt(parts[1]);
                        const d = parseInt(parts[2]);
                        const date = new Date(year, m - 1, d);
                        cols.push({ col: c, date, dateStr: `${m}.${d}` });
                    }

                    const sortedCols = cols.sort((a, b) => a.date.getTime() - b.date.getTime());
                    if (sortedCols.length === 0) {
                        setLoading(false);
                        return;
                    }

                    const blockStarts: Date[] = [];
                    const firstDate = new Date(sortedCols[0].date);
                    const diffToWed = (firstDate.getDay() - 3 + 7) % 7;
                    firstDate.setDate(firstDate.getDate() - diffToWed);

                    const lastDate = sortedCols[sortedCols.length - 1].date;
                    const currWed = new Date(firstDate);
                    while (currWed <= lastDate) {
                        blockStarts.push(new Date(currWed));
                        currWed.setDate(currWed.getDate() + 7);
                    }

                    const parsedWeeks = blockStarts.map((wed) => {
                        const defaultEnd = new Date(wed);
                        defaultEnd.setDate(defaultEnd.getDate() + 9); // 수요일부터 다음주 금요일까지 (10일 범위)

                        const blockCols = sortedCols.filter(c => c.date >= wed && c.date <= defaultEnd);
                        if (blockCols.length === 0) return null;

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
                        // 최신 데이터 파싱 완료 시 새로운 시간의 캐시키로 로컬스토리지에 영구 저장
                        const cacheKey = `ncoa_movement_${mode}_${updatedAtStr}`;

                        // 기존 캐시 청소 (이전 시간에 저장된 동일 모드의 캐시 삭제)
                        const keysToRemove = [];
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            if (k && k.startsWith(`ncoa_movement_${mode}_`) && k !== cacheKey) {
                                keysToRemove.push(k);
                            }
                        }
                        keysToRemove.forEach(k => localStorage.removeItem(k));

                        localStorage.setItem(cacheKey, JSON.stringify(parsedWeeks));

                        // Firestore 공유 캐시 저장
                        try {
                            await setDoc(doc(db, "movement_cache", `${mode}_${updatedAtStr}`), {
                                data: parsedWeeks,
                                updatedAt: serverTimestamp()
                            });
                        } catch (e) {
                            console.error("Firestore movement cache write error:", e);
                        }
                    }

                    setSheetWeeks(parsedWeeks);
                    setCurrentWeekIndex(findMatchingWeekIndex(parsedWeeks, activeWeekStartDateRef.current));
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
                                    const rangeRegex = /(\d{1,2})[./](\d{1,2})\s*~\s*(\d{1,2})[./](\d{1,2})/;
                                    const singleRegex = /(\d{1,2})[./](\d{1,2})/;
                                    const rangeMatch = passPart.match(rangeRegex);

                                    if (rangeMatch) {
                                        const startM = parseInt(rangeMatch[1]);
                                        const startD = parseInt(rangeMatch[2]);
                                        const endM = parseInt(rangeMatch[3]);
                                        const endD = parseInt(rangeMatch[4]);

                                        const startDate = new Date(currentYear, startM - 1, startD);
                                        const endDate = new Date(currentYear, endM - 1, endD);
                                        const departDate = new Date(startDate);
                                        departDate.setDate(startDate.getDate() - 1);

                                        const passData = {
                                            name: `${rank} ${name}`,
                                            type: '외박',
                                            period: `${startM}.${startD}~${endM}.${endD}`,
                                            depart: `${departDate.getMonth() + 1}.${departDate.getDate()}`,
                                            return: `${endM}.${endD}`,
                                            stayDays: getDatesBetween(startDate, endDate, true)
                                        };

                                        const vacationPart = cleanLine.split('+')[1];
                                        if (vacationPart) {
                                            const vRangeMatch = vacationPart.match(rangeRegex);
                                            const vSingleMatch = vacationPart.match(singleRegex);

                                            if (vRangeMatch || vSingleMatch) {
                                                const vM1 = parseInt((vRangeMatch || vSingleMatch)![1]);
                                                const vD1 = parseInt((vRangeMatch || vSingleMatch)![2]);
                                                const vM2 = vRangeMatch ? parseInt(vRangeMatch[3]) : vM1;
                                                const vD2 = vRangeMatch ? parseInt(vRangeMatch[4]) : vD1;

                                                const vStartDate = new Date(currentYear, vM1 - 1, vD1);
                                                const vEndDate = new Date(currentYear, vM2 - 1, vD2);

                                                const vStartStr = `${vM1}.${vD1}`;
                                                const isLinked = vStartStr === passData.return;

                                                extractedData.push({
                                                    ...passData,
                                                    vacation: {
                                                        period: vRangeMatch ? `${vM1}.${vD1}~${vM2}.${vD2}` : `${vM1}.${vD1}`,
                                                        depart: vStartStr,
                                                        isLinked,
                                                        return: `${vM2}.${vD2}`,
                                                        stayDays: getDatesBetween(vStartDate, vEndDate, false)
                                                    }
                                                });
                                            } else {
                                                extractedData.push(passData);
                                            }
                                        } else {
                                            extractedData.push(passData);
                                        }
                                    } else {
                                        const singleMatch = passPart.match(singleRegex);
                                        if (singleMatch) {
                                            const m = parseInt(singleMatch[1]);
                                            const d = parseInt(singleMatch[2]);
                                            const endDate = new Date(currentYear, m - 1, d);
                                            const departDate = new Date(endDate);
                                            departDate.setDate(endDate.getDate() - 1);

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
                                                    stayDays: []
                                                };

                                                const vacationPart = cleanLine.split('+')[1];
                                                if (vacationPart) {
                                                    const vRangeMatch = vacationPart.match(rangeRegex);
                                                    const vSingleMatch = vacationPart.match(singleRegex);

                                                    if (vRangeMatch || vSingleMatch) {
                                                        const vM1 = parseInt((vRangeMatch || vSingleMatch)![1]);
                                                        const vD1 = parseInt((vRangeMatch || vSingleMatch)![2]);
                                                        const vM2 = vRangeMatch ? parseInt(vRangeMatch[3]) : vM1;
                                                        const vD2 = vRangeMatch ? parseInt(vRangeMatch[4]) : vD1;

                                                        const vStartDate = new Date(currentYear, vM1 - 1, vD1);
                                                        const vEndDate = new Date(currentYear, vM2 - 1, vD2);

                                                        const vStartStr = `${vM1}.${vD1}`;
                                                        const isLinked = vStartStr === passData.return;

                                                        extractedData.push({
                                                            ...passData,
                                                            vacation: {
                                                                period: vRangeMatch ? `${vM1}.${vD1}~${vM2}.${vD2}` : `${vM1}.${vD1}`,
                                                                depart: vStartStr,
                                                                isLinked,
                                                                return: `${vM2}.${vD2}`,
                                                                stayDays: getDatesBetween(vStartDate, vEndDate, false)
                                                            }
                                                        });
                                                    } else {
                                                        extractedData.push(passData);
                                                    }
                                                } else {
                                                    extractedData.push(passData);
                                                }
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

        function getDatesBetween(start: Date, end: Date, includeStart: boolean = true) {
            const dates = [];
            const curr = new Date(start);
            if (!includeStart) {
                curr.setDate(curr.getDate() + 1);
            }
            while (curr < end) {
                dates.push(`${curr.getMonth() + 1}.${curr.getDate()}`);
                curr.setDate(curr.getDate() + 1);
            }
            return dates;
        }

        reader.onerror = () => {
            setError('파일 읽기 실패');
            setLoading(false);
        };
        reader.readAsBinaryString(file);

        e.target.value = '';
    };

    const handleSync = async (resolvedData?: any[]) => {
        if (!parsedData && !resolvedData) return;
        if (!confirm('분석된 데이터를 스프레드시트에 반영할까요?')) return;

        setSyncing(true);
        setError(null);
        setSuccess(null);

        try {
            const isLocal = window.location.hostname === 'localhost';
            const baseUrl = isLocal
                ? 'http://127.0.0.1:5001/seniorkatusa-aa594/asia-northeast3'
                : 'https://asia-northeast3-seniorkatusa-aa594.cloudfunctions.net';

            const movementsToSync = (resolvedData || parsedData!).map(m => {
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
                setSuccess(`${response.data.count}개의 셀이 성공적으로 업데이트되었습니다!`);
                setAmbiguousMembers(null);
                setResolutions({});
                // 성공 후 시트 데이터 다시 로드
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

    const renderGrid = (timeline: string[], dataList: { name: string, dayStatuses: Record<string, string> }[]) => {
        const sortedEntries = [...dataList].sort((a, b) => {
            const cleanA = a.name.replace(/^(병장|상병|일병|이병)\s*/, '');
            const cleanB = b.name.replace(/^(병장|상병|일병|이병)\s*/, '');

            const memA = dbMembers.find(m => m.name === cleanA);
            const memB = dbMembers.find(m => m.name === cleanB);

            if (memA?.enlistmentDate && memB?.enlistmentDate) {
                if (memA.enlistmentDate !== memB.enlistmentDate) {
                    return memA.enlistmentDate < memB.enlistmentDate ? -1 : 1;
                }
            } else if (memA?.enlistmentDate) {
                return -1;
            } else if (memB?.enlistmentDate) {
                return 1;
            }

            const rankPriority: Record<string, number> = { '병장': 1, '상병': 2, '일병': 3, '이병': 4 };
            const rA = Object.keys(rankPriority).find(r => a.name.includes(r)) || '';
            const rB = Object.keys(rankPriority).find(r => b.name.includes(r)) || '';
            const pA = rankPriority[rA] || 99;
            const pB = rankPriority[rB] || 99;

            if (pA !== pB) return pA - pB;
            return a.name.localeCompare(b.name);
        });

        return sortedEntries.map((member, idx) => (
            <div key={idx} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:border-blue-200 transition-all flex items-center gap-4">
                <div className="w-24 shrink-0">
                    <span className="text-sm font-black text-gray-900 truncate block">{member.name}</span>
                </div>

                <div className="flex-1 flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar relative pt-4">
                    {timeline.map((dateStr, tIdx) => {
                        let status = member.dayStatuses[dateStr] || 'none';
                        const [m, d] = dateStr.split('.').map(Number);
                        const isWeekend = new Date(2026, m - 1, d).getDay() % 6 === 0;

                        // Dynamically detect if we are departing for/on a pass on the recovery day (day after duty)
                        if (status === 'pass-depart' || status === 'pass') {
                            const yesterdayStr = tIdx > 0 ? timeline[tIdx - 1] : null;
                            const yesterdayStatus = yesterdayStr ? (member.dayStatuses[yesterdayStr] || 'none') : 'none';
                            if (yesterdayStatus === 'duty') {
                                status = 'recovery-pass-depart';
                            }
                        }

                        return (
                            <div key={tIdx} className="flex flex-col items-center gap-1 relative">
                                <div
                                    className={cn(
                                        "w-4 h-4 rounded-sm transition-all duration-300",
                                        status === 'none' && "bg-gray-100",
                                        status === 'pass' && "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.3)]",
                                        status === 'pass-depart' && "",
                                        status === 'vacation' && "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.3)]",
                                        status === 'duty' && "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]",
                                        status === 'recovery' && "bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.4)]",
                                        status === 'linked' && "shadow-[0_0_8px_rgba(59,130,246,0.4)]",
                                        status === 'recovery-pass-depart' && "shadow-[0_0_6px_rgba(250,204,21,0.4)]",
                                        isWeekend && "border-2 border-black"
                                    )}
                                    style={
                                        status === 'linked' ? {
                                            background: 'linear-gradient(135deg, #3b82f6 50%, #f97316 50%)'
                                        } : status === 'pass-depart' ? {
                                            background: 'linear-gradient(135deg, #f3f4f6 50%, #3b82f6 50%)'
                                        } : status === 'recovery-pass-depart' ? {
                                            background: 'linear-gradient(135deg, #facc15 50%, #3b82f6 50%)'
                                        } : undefined
                                    }
                                />
                                {(() => {
                                    const isFirst = tIdx === 0;
                                    const isLast = tIdx === timeline.length - 1;
                                    const isSunday = new Date(2026, m - 1, d).getDay() === 0;
                                    const isMonthStart = d === 1;
                                    const today = baseDate || new Date();
                                    const isToday = today.getMonth() === m - 1 && today.getDate() === d;

                                    if (isFirst || isLast || isSunday || isMonthStart || isToday) {
                                        return (
                                            <span className={cn(
                                                "text-[8px] font-black absolute -top-4 whitespace-nowrap",
                                                isToday ? "text-red-500 font-extrabold" : "text-gray-300"
                                            )}>
                                                {dateStr}
                                            </span>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                        );
                    })}
                </div>
            </div>
        ));
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
            return { str: d, date: new Date(2026, m - 1, day) };
        }).sort((a, b) => a.date.getTime() - b.date.getTime());

        if (dateObjects.length === 0) return { timeline: [], dataList: [] };

        const startDate = new Date(dateObjects[0].date);
        const currentDay = startDate.getDay();
        const diffToWed = (currentDay - 3 + 7) % 7;
        startDate.setDate(startDate.getDate() - diffToWed);

        const endDate = new Date(dateObjects[dateObjects.length - 1].date);
        const timeline: string[] = [];
        const curr = new Date(startDate);
        while (curr <= endDate) {
            timeline.push(`${curr.getMonth() + 1}.${curr.getDate()}`);
            curr.setDate(curr.getDate() + 1);
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
                            if (status !== 'duty' && status !== 'recovery') status = 'linked';
                        } else if (isPassDepart) {
                            if (status === 'none') status = 'pass-depart';
                        } else {
                            if (item.return === dateStr || item.stayDays.includes(dateStr)) {
                                if (status !== 'duty' && status !== 'recovery' && status !== 'vacation' && status !== 'linked') status = 'pass';
                            }
                            if (item.vacation) {
                                if (item.vacation.depart === dateStr || item.vacation.return === dateStr || item.vacation.stayDays.includes(dateStr)) {
                                    if (status !== 'duty' && status !== 'recovery' && status !== 'linked') status = 'vacation';
                                }
                            }
                        }
                    }
                });
                dayStatuses[dateStr] = status;
            });
            return { name, dayStatuses };
        });

        return { timeline, dataList };
    };

    return (
        <div className="pt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            <header className="flex items-start justify-between gap-2 sm:gap-4 mb-8">
                <div className="flex items-center h-[44px]">
                    <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight whitespace-nowrap">
                        외박 특이사항
                    </h1>
                </div>

                <div className="flex items-center bg-gray-100 p-1 rounded-2xl w-[180px] h-[44px] justify-center shrink-0">
                    {sheetMode === null ? (
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <>
                            <button
                                onClick={() => toggleMode()}
                                className={cn(
                                    "flex-1 h-full rounded-xl text-sm font-black transition-all",
                                    sheetMode === 'prod'
                                        ? "bg-white text-red-600 shadow-sm"
                                        : "text-gray-400 hover:text-gray-600"
                                )}
                            >
                                PROD
                            </button>
                            <button
                                onClick={() => toggleMode()}
                                className={cn(
                                    "flex-1 h-full rounded-xl text-sm font-black transition-all",
                                    sheetMode === 'test'
                                        ? "bg-white text-blue-600 shadow-sm"
                                        : "text-gray-400 hover:text-gray-600"
                                )}
                            >
                                TEST
                            </button>
                        </>
                    )}
                </div>
            </header>

            {loading && (
                <div className="flex items-center justify-center py-10">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {error && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-600">
                    <AlertCircle className="w-5 h-5" />
                    <p className="font-bold">{error}</p>
                </div>
            )}

            {/* Sheet Mode View */}
            {viewMode === 'sheet' && sheetWeeks.length > 0 && !loading && (
                <div className="space-y-4 animate-in zoom-in-95 duration-300">
                    <div className="flex flex-row items-center justify-between bg-white border border-gray-200 rounded-2xl p-2 sm:p-3 shadow-sm gap-2 sm:gap-4 overflow-hidden">
                        {/* Left: File upload button */}
                        <div className="relative group shrink-0">
                            <input
                                type="file"
                                accept=".xlsx, .xls"
                                onChange={handleFileUpload}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />
                            <button className="flex items-center justify-center gap-1.5 px-2.5 sm:px-4 h-[44px] bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm">
                                <Upload className="w-4 h-4 text-blue-500 shrink-0" />
                                <span className="hidden sm:inline">엑셀 파일 업로드</span>
                                <span className="inline sm:hidden">업로드</span>
                            </button>
                        </div>

                        {/* Center: Date Range */}
                        <div className="text-[17px] sm:text-lg md:text-xl font-black text-gray-900 tracking-tight text-center whitespace-nowrap shrink-0">
                            {sheetWeeks[currentWeekIndex].startDate} ~ {sheetWeeks[currentWeekIndex].endDate}
                        </div>

                        {/* Right: Navigation buttons side-by-side */}
                        <div className="flex items-center justify-center gap-1.5 shrink-0">
                            <button
                                onClick={() => setCurrentWeekIndex(i => Math.max(0, i - 1))}
                                disabled={currentWeekIndex === 0}
                                className="w-9 h-9 sm:w-11 sm:h-11 bg-gray-50 rounded-xl flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-gray-50 transition-all text-gray-600"
                            >
                                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                            <button
                                onClick={() => setCurrentWeekIndex(i => Math.min(sheetWeeks.length - 1, i + 1))}
                                disabled={currentWeekIndex === sheetWeeks.length - 1}
                                className="w-9 h-9 sm:w-11 sm:h-11 bg-gray-50 rounded-xl flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-gray-50 transition-all text-gray-600"
                            >
                                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        {renderGrid(sheetWeeks[currentWeekIndex].timeline, sheetWeeks[currentWeekIndex].data)}
                    </div>
                </div>
            )}

            {/* Excel Mode View */}
            {viewMode === 'excel' && parsedData && (
                <div className="space-y-4 animate-in zoom-in-95 duration-300">
                    <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-center justify-between gap-3 text-green-700">
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="w-5 h-5 shrink-0" />
                            <p className="font-bold whitespace-nowrap text-sm sm:text-base">업로드 데이터 ({parsedData.length}건)</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleSync()}
                                disabled={syncing}
                                className="px-4 py-2 bg-green-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-green-200 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
                            >
                                {syncing ? (
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <Send className="w-4 h-4" />
                                )}
                                시트 동기화
                            </button>
                            <button
                                onClick={() => { setViewMode('sheet'); setParsedData(null); }}
                                className="px-4 py-2 bg-white text-gray-600 border border-gray-200 rounded-xl font-bold text-sm active:scale-95 transition-all"
                            >
                                취소
                            </button>
                        </div>
                    </div>

                    {success && (
                        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center gap-3 text-blue-600 animate-in slide-in-from-top-2">
                            <CheckCircle2 className="w-5 h-5" />
                            <p className="font-bold">{success}</p>
                        </div>
                    )}

                    <div className="grid gap-2">
                        {(() => {
                            const { timeline, dataList } = getExcelTimelineAndData();
                            return renderGrid(timeline, dataList);
                        })()}
                    </div>
                </div>
            )}

            {/* 동명이인 해결 모달 */}
            {ambiguousMembers && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-6 text-white text-center">
                            <h3 className="text-xl font-black mb-1">동명이인 확인 필요</h3>
                            <p className="text-sm opacity-90 font-bold">엑셀의 이름과 일치하는 인원이 여러 명입니다.</p>
                        </div>

                        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                            {ambiguousMembers.map((member, idx) => (
                                <div key={idx} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                                    <div className="text-sm font-black text-gray-400 mb-3 uppercase tracking-tighter">
                                        엑셀 표기: <span className="text-gray-800">{member.excelName}</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {member.options.map((option: string) => (
                                            <button
                                                key={option}
                                                onClick={() => setResolutions(prev => ({ ...prev, [member.excelName]: option }))}
                                                className={cn(
                                                    "p-3 rounded-xl text-sm font-black transition-all duration-200 border-2 text-left flex items-center justify-between",
                                                    resolutions[member.excelName] === option
                                                        ? "bg-orange-50 border-orange-500 text-orange-600 shadow-md scale-[1.02]"
                                                        : "bg-white border-gray-100 text-gray-500 hover:border-orange-200"
                                                )}
                                            >
                                                {option}
                                                {resolutions[member.excelName] === option && <CheckCircle2 className="w-4 h-4" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="p-6 bg-gray-50 flex gap-3 border-t border-gray-100">
                            <button
                                onClick={() => {
                                    setAmbiguousMembers(null);
                                    setResolutions({});
                                }}
                                className="flex-1 py-4 bg-white border border-gray-200 rounded-2xl text-gray-500 font-black hover:bg-gray-50 transition-colors"
                            >
                                취소
                            </button>
                            <button
                                onClick={() => handleSync()}
                                disabled={Object.keys(resolutions).length < ambiguousMembers.length}
                                className={cn(
                                    "flex-1 py-4 rounded-2xl font-black text-white transition-all shadow-lg shadow-orange-200",
                                    Object.keys(resolutions).length < ambiguousMembers.length
                                        ? "bg-gray-300 cursor-not-allowed"
                                        : "bg-orange-500 hover:bg-orange-600 active:scale-95"
                                )}
                            >
                                선택 완료 및 계속
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
