/* eslint-disable @typescript-eslint/no-explicit-any */
// MovementTab for Special Leave (외특)
import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, CheckCircle2, AlertCircle, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import axios from 'axios';
import { doc, onSnapshot, setDoc, serverTimestamp, collection } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export default function MovementTab() {
    const [fileName, setFileName] = useState<string | null>(null);
    const [parsedData, setParsedData] = useState<any[] | null>(null);

    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [ambiguousMembers, setAmbiguousMembers] = useState<any[] | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, string>>({});
    const [sheetMode, setSheetMode] = useState<'test' | 'prod' | null>(null);
    const [dbMembers, setDbMembers] = useState<any[]>([]);

    React.useEffect(() => {
        const unsub = onSnapshot(doc(db, 'settings', 'spreadsheet'), (snap) => {
            if (snap.exists()) {
                setSheetMode(snap.data().mode || 'test');
            } else {
                setSheetMode('test'); // 문서가 없으면 기본값 test
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

    const toggleMode = async () => {
        const newMode = sheetMode === 'test' ? 'prod' : 'test';
        try {
            await setDoc(doc(db, 'settings', 'spreadsheet'), {
                mode: newMode,
                updatedAt: serverTimestamp()
            }, { merge: true });
        } catch (err) {
            console.error('Error updating mode:', err);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        setLoading(true);
        setError(null);
        setSuccess(null); // 기존 성공 메시지 초기화
        setParsedData(null); // 기존 분석 데이터 초기화
        setAmbiguousMembers(null);
        setResolutions({});

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

                // 연도는 현재 시스템 연도 사용 (2026)
                const currentYear = new Date().getFullYear();

                for (let i = 0; i < rawData.length; i++) {
                    const content = String(rawData[i]['댓글 내용'] || '').trim();

                    // 1. 외박 특이사항 (ㅌㅇㅅㅎ) 시작 체크
                    if (content === 'ㅌㅇㅅㅎ') {
                        isCapturing = true;
                        isDutyCapturing = false;
                        continue;
                    }

                    // 2. 당직 시작 체크 (내용에 '당직' 포함)
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

                                // 1. 관등성명 인식
                                const nameMatch = cleanLine.match(/^(병장|상병|일병|이병)\s+([가-힣]+)/);
                                if (nameMatch) {
                                    const rank = nameMatch[1];
                                    const name = nameMatch[2];

                                    // 2. + 기준 분리 (앞은 외박)
                                    const passPart = cleanLine.split('+')[0];

                                    // 3. 날짜 추출 로직 (기간 -> 단일 날짜 순서)
                                    const rangeRegex = /(\d{1,2})[./](\d{1,2})\s*~\s*(\d{1,2})[./](\d{1,2})/;
                                    const singleRegex = /(\d{1,2})[./](\d{1,2})/;

                                    const rangeMatch = passPart.match(rangeRegex);

                                    if (rangeMatch) {
                                        // 5. 날짜 범위인 경우 (5/23~5/25)
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

                                        // 7. 휴가 부분 처리 (+ 이후)
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

                                            // 단일 날짜인데 '잔류'가 있고 '데이' 표현이 없으면 잔류로 처리
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

                                                // 단일 날짜 뒤에 휴가가 있는 경우 처리
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
                                            // 날짜도 없고 '잔류'라는 단어가 있을 때만 잔류 처리
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

                    // 4. 당직 파싱 영역
                    if (isDutyCapturing) {
                        if (content.startsWith('ㄴ')) {
                            const cleanLine = content.replace(/^ㄴ/, '').trim();
                            // "ㄴ 상병 김대호, 5월 9일 (토) 당직입니다." 형식 파싱 (/, ., 월/일 모두 지원)
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

        // 날짜 사이의 중간 날짜들 구하는 헬퍼 함수
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

        // 입력창 초기화 (동일 파일 재업로드 가능하게 함)
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

            // 해결된 데이터가 있으면 그것을 사용, 없으면 원본 파싱 데이터 사용
            const movementsToSync = (resolvedData || parsedData!).map(m => {
                // 이미 해결된 동명이인이라면 이름 교체
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

    return (
        <div className="pt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            <header className="flex items-center justify-between gap-4">
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">
                    외박 특이사항
                </h1>

                <div className="flex items-center bg-gray-100 p-1 rounded-2xl w-[180px] h-[48px] justify-center shrink-0">
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

            <div className="bg-white rounded-[2rem] border-2 border-dashed border-gray-200 p-10 flex flex-col items-center justify-center gap-4 transition-colors hover:border-blue-400 group relative overflow-hidden">
                <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform relative">
                    <Upload className="w-8 h-8 text-blue-600" />
                </div>
                <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">
                        {fileName || '밴드 댓글 .xlsx 파일을 업로드하세요'}
                    </p>
                    <p className="text-sm text-gray-400 font-medium mt-1">
                        최대 용량 20MB (실제 파일은 약 20kb 내외)
                    </p>
                </div>
            </div>

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

            {parsedData && (
                <div className="space-y-4 animate-in zoom-in-95 duration-300">
                    <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-center justify-between gap-3 text-green-700">
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="w-5 h-5 shrink-0" />
                            <p className="font-bold whitespace-nowrap text-sm sm:text-base">분석 완료 ({parsedData.length}건)</p>
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
                            // 1. 이름별로 데이터 그룹화
                            const groupedMap = new Map<string, any[]>();
                            parsedData.forEach(item => {
                                if (!groupedMap.has(item.name)) groupedMap.set(item.name, []);
                                groupedMap.get(item.name)?.push(item);
                            });

                            // 2. 전체 날짜 범위 계산
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

                            if (dateObjects.length === 0) return null;

                            const startDate = new Date(dateObjects[0].date);
                            // 수요일부터 시작하도록 조정 (0:일, 1:월, 2:화, 3:수, 4:목, 5:금, 6:토)
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

                            // 3. 짬순(입대일 순) 정렬 로직
                            const sortedEntries = Array.from(groupedMap.entries()).sort(([nameA], [nameB]) => {
                                // DB에서 인원 정보를 찾아 입대일 비교
                                const cleanA = nameA.replace(/^(병장|상병|일병|이병)\s*/, '');
                                const cleanB = nameB.replace(/^(병장|상병|일병|이병)\s*/, '');

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

                                // 입대일 정보가 없으면 기존 계급순Fallback
                                const rankPriority: Record<string, number> = { '병장': 1, '상병': 2, '일병': 3, '이병': 4 };
                                const rA = Object.keys(rankPriority).find(r => nameA.includes(r)) || '';
                                const rB = Object.keys(rankPriority).find(r => nameB.includes(r)) || '';
                                const pA = rankPriority[rA] || 99;
                                const pB = rankPriority[rB] || 99;

                                if (pA !== pB) return pA - pB;
                                return nameA.localeCompare(nameB);
                            });

                            // 4. 정렬된 이름별로 카드 렌더링
                            return sortedEntries.map(([name, items], idx) => (
                                <div key={idx} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:border-blue-200 transition-all flex items-center gap-4">
                                    <div className="w-24 shrink-0">
                                        <span className="text-sm font-black text-gray-900 truncate block">{name}</span>
                                    </div>

                                    <div className="flex-1 flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar relative pt-4">
                                        {timeline.map((dateStr, tIdx) => {
                                            let status = 'none';

                                            // 해당 인원의 모든 항목을 검사 (우선순위: 당직 > 리커버리 > 연계 > 휴가 > 외박)
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

                                            const [m, d] = dateStr.split('.').map(Number);
                                            const isWeekend = new Date(2026, m - 1, d).getDay() % 6 === 0;

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
                                                            isWeekend && "border-2 border-black"
                                                        )}
                                                        style={
                                                            status === 'linked' ? {
                                                                background: 'linear-gradient(135deg, #3b82f6 50%, #f97316 50%)'
                                                            } : status === 'pass-depart' ? {
                                                                background: 'linear-gradient(135deg, #f3f4f6 50%, #3b82f6 50%)'
                                                            } : undefined
                                                        }
                                                    />
                                                    {(() => {
                                                        const isFirst = tIdx === 0;
                                                        const isLast = tIdx === timeline.length - 1;
                                                        const isSunday = new Date(2026, m - 1, d).getDay() === 0;
                                                        const isMonthStart = d === 1;
                                                        
                                                        if (isFirst || isLast || isSunday || isMonthStart) {
                                                            return (
                                                                <span className={cn(
                                                                    "text-[8px] font-black absolute -top-4 whitespace-nowrap",
                                                                    isSunday ? "text-red-400" : "text-gray-300"
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
