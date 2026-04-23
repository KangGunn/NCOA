import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { Copy, Check, Clock, FileText } from 'lucide-react';
import { cn } from '../../lib/utils';
import { db, auth } from '../../lib/firebase';
import { calculateRank } from '../../lib/rankUtils';
import { collection, onSnapshot, query } from 'firebase/firestore';
import Papa from 'papaparse';




interface RollCallTabProps {
    healthNote: string;
    setHealthNote: Dispatch<SetStateAction<string>>;
    tomorrowNote: string;
    setTomorrowNote: Dispatch<SetStateAction<string>>;
    baseDate: Date;
    setBaseDate: Dispatch<SetStateAction<Date>>;
    scheduleText: string;
    setScheduleText: Dispatch<SetStateAction<string>>;
    scheduleParticipants: Record<string, string[]>;
    setScheduleParticipants: Dispatch<SetStateAction<Record<string, string[]>>>;
    customSchedules: { name: string; participants: string[] }[];
    setCustomSchedules: Dispatch<SetStateAction<{ name: string; participants: string[] }[]>>;
}

export default function RollCallTab({
    healthNote,
    setHealthNote,
    tomorrowNote,
    setTomorrowNote,
    baseDate,
    setBaseDate,
    scheduleText,
    setScheduleText,
    scheduleParticipants,
    setScheduleParticipants,
    customSchedules,
    setCustomSchedules
}: RollCallTabProps) {
    const [newScheduleName, setNewScheduleName] = useState('');

    const addCustomSchedule = () => {
        const trimmed = newScheduleName.trim();
        if (!trimmed) return;
        if (customSchedules.find(s => s.name === trimmed)) return;
        setCustomSchedules((prev: { name: string; participants: string[] }[]) => [...prev, { name: trimmed, participants: [] }]);
        setNewScheduleName('');
    };

    const handleSortSchedules = () => {
        const sorted = scheduleText
            .split('\n')
            .filter(line => line.trim().length > 0)
            .sort((a, b) => {
                const timeA = a.trim().substring(0, 4);
                const timeB = b.trim().substring(0, 4);
                return timeA.localeCompare(timeB);
            })
            .join('\n');
        setScheduleText(sorted);
    };

    const removeCustomSchedule = (name: string) => {
        setCustomSchedules(prev => prev.filter(s => s.name !== name));
    };

    const [copiedType, setCopiedType] = useState<'evening' | 'morning' | null>(null);
    const [totalMembers, setTotalMembers] = useState(0);
    const [members, setMembers] = useState<{ name: string; rank: string; role: string; enlistmentDate?: string; sections?: string[]; earlyPromotion?: number }[]>([]);
    const [events, setEvents] = useState<{ id: string; type: string; startDate: string; endDate: string; memo: string }[]>([]);
    const [sheetEvents, setSheetEvents] = useState<{ id: string; type: string; startDate: string; endDate: string; memo: string; isReturnDay: boolean; isDepartDay: boolean; isConsecutive: boolean; dateText?: string }[]>([]);

    useEffect(() => {
        const unsubMembers = onSnapshot(collection(db, "members"), (snapshot) => {
            const data = snapshot.docs.map(doc => doc.data() as { name: string; rank: string; role: string; enlistmentDate?: string; sections?: string[]; earlyPromotion?: number });

            const sortedData = [...data].sort((a, b) => {
                const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
                const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
                if (dateA !== dateB) return dateA < dateB ? -1 : 1;

                const nameA = typeof a.name === 'string' ? a.name.trim() : '';
                const nameB = typeof b.name === 'string' ? b.name.trim() : '';
                return nameA < nameB ? -1 : 1;
            });

            setMembers(sortedData);
            const count = data.filter(m => m.role !== 'runner').length;
            setTotalMembers(count);
        });

        let unsubEvents: () => void = () => { };
        const authUnsub = auth.onAuthStateChanged(user => {
            if (user) {
                const qEvents = query(collection(db, "schedules"));
                unsubEvents = onSnapshot(qEvents, (snapshot) => {
                    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
                    setEvents(data);
                });
            }
        });

        const fetchSheet = async () => {
            try {
                const now = new Date();
                const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
                
                // 로컬 저장소에서 캐시된 정보 가져오기
                const cachedUrl = localStorage.getItem('ncoa_spreadsheet_url');
                const cachedMonth = localStorage.getItem('ncoa_spreadsheet_month');
                
                let csvUrl = cachedUrl;

                // 캐시가 없거나, 저장된 달이 현재와 다를 경우에만 백엔드 호출
                if (!csvUrl || cachedMonth !== currentMonth) {
                    console.log('Fetching new spreadsheet URL from backend...');
                    const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbw8liY7D3qd1CF0T9gsr4pBq9Gt65YRDXrgdTx9FXTqR8rawJ42sRFfIO9fjxGj0IY/exec';
                    const backendRes = await fetch(BACKEND_URL);
                    const backendData = await backendRes.json();

                    if (backendData.status === 'success' && backendData.csvUrl) {
                        const newUrl = backendData.csvUrl;
                        csvUrl = newUrl;
                        // 캐시 업데이트
                        localStorage.setItem('ncoa_spreadsheet_url', newUrl);
                        localStorage.setItem('ncoa_spreadsheet_month', currentMonth);
                    } else {
                        console.error('Failed to get spreadsheet URL from backend:', backendData);
                        if (!csvUrl) return; // 캐시도 없으면 중단
                    }
                }

                // 시트 데이터 가져오기
                const res = await fetch(csvUrl!);
                const csvText = await res.text();
                Papa.parse(csvText, {
                    complete: (results) => {
                        const rows = results.data as string[][];
                        if (rows.length < 2) return;
                        const dateRow = rows[0];
                        const parsed: any[] = [];
                        for (let i = 2; i < rows.length; i++) {
                            const row = rows[i];
                            if (!row || !row[0]) continue;
                            const nameWithRank = row[0];
                            const name = nameWithRank.split(' ')[1] || nameWithRank;

                            const rowDays: any[] = [];
                            for (let colIndex = 1; colIndex < row.length; colIndex++) {
                                const rawDate = dateRow[colIndex];
                                const cell = row[colIndex];
                                if (!rawDate) continue;
                                const dateParts = rawDate.split('.').map(p => p.trim());
                                if (dateParts.length < 3) continue;
                                const y = dateParts[0];
                                const m = dateParts[1].padStart(2, '0');
                                const d = dateParts[2].padStart(2, '0');
                                rowDays.push({
                                    dateStr: `${y}-${m}-${d}`,
                                    m: Number(m),
                                    d: Number(d),
                                    cell: cell || ''
                                });
                            }

                            // 선택된 날짜와 그 다음 날 인덱스만 추출
                            const todayStrLocal = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
                            const tomorrow = new Date(baseDate);
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            const tomorrowStrLocal = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

                            const targetIndices = [];
                            const tIdx = rowDays.findIndex(d => d.dateStr === todayStrLocal);
                            const mIdx = rowDays.findIndex(d => d.dateStr === tomorrowStrLocal);
                            if (tIdx !== -1) targetIndices.push(tIdx);
                            if (mIdx !== -1) targetIndices.push(mIdx);

                            targetIndices.forEach(idx => {
                                const day = rowDays[idx];
                                const c = day.cell;
                                if (!c || c.trim() === '') return;
                                if (!c.includes('외박') && !c.includes('휴가') && !c.includes('연계')) return;

                                const type = c.includes('휴가') ? 'vacation' : 'pass';

                                // 시작일 찾기
                                let startIdx = idx;
                                for (let k = idx; k >= 0 && k >= idx - 14; k--) {
                                    const pc = rowDays[k].cell;
                                    if (pc.includes('출발')) {
                                        // 휴가는 출발 당일부터 기간에 포함, 외박은 출발 다음 날부터 포함
                                        if (type === 'vacation') {
                                            startIdx = k;
                                        } else {
                                            startIdx = Math.min(k + 1, rowDays.length - 1);
                                        }
                                        break;
                                    }
                                    if (!pc.includes('외박') && !pc.includes('휴가') && !pc.includes('연계')) {
                                        startIdx = k + 1;
                                        break;
                                    }
                                    if (k === 0) startIdx = 0;
                                }

                                // 종료일 찾기
                                let endIdx = idx;
                                for (let k = idx; k < rowDays.length && k <= idx + 14; k++) {
                                    const nc = rowDays[k].cell;
                                    if (nc.includes('복귀')) {
                                        endIdx = k;
                                        break;
                                    }
                                    if (k > idx && nc.includes('출발')) {
                                        endIdx = k;
                                        break;
                                    }
                                    if (!nc.includes('외박') && !nc.includes('휴가') && !nc.includes('연계')) {
                                        endIdx = k - 1;
                                        break;
                                    }
                                    if (k === rowDays.length - 1) endIdx = rowDays.length - 1;
                                }

                                // 출발일이 복귀일보다 늦은 경우 보정 (최소 당일)
                                const finalStartIdx = startIdx > endIdx ? endIdx : startIdx;
                                const s = rowDays[finalStartIdx];
                                const e = rowDays[endIdx];

                                const dateText = s.m === e.m && s.d === e.d ? `${s.m}.${s.d}` : `${s.m}.${s.d}~${e.m}.${e.d}`;

                                parsed.push({
                                    id: `sheet-${type}-${name}-${day.dateStr}`,
                                    type,
                                    startDate: day.dateStr,
                                    endDate: day.dateStr,
                                    memo: name,
                                    isReturnDay: c.includes('복귀'),
                                    isDepartDay: c.includes('출발'),
                                    isConsecutive: c.includes('연계'),
                                    dateText
                                });
                            });
                        }
                        setSheetEvents(parsed);
                    }
                });
            } catch (err) {
                console.error("Sheet fetch error", err);
            }
        };

        fetchSheet();

        return () => {
            unsubMembers();
            unsubEvents();
            authUnsub();
        };
    }, [baseDate]);

    // Calendar 당직 및 일정 파싱
    const today = baseDate;
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const tomorrowDate = new Date(baseDate);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;

    const todayDuties = events.filter(e => e.type === 'duty' && e.startDate === todayStr);
    const tomorrowDuties = events.filter(e => e.type === 'duty' && e.startDate === tomorrowStr);

    // 외박 및 휴가는 캘린더 + 구글 시트 결합 (저녁점호 기준: 복귀일은 불포함)
    const todayVacations = [
        ...events.filter(e => e.type === 'vacation' && e.startDate <= todayStr && e.endDate >= todayStr),
        ...sheetEvents.filter(e => e.type === 'vacation' && e.startDate === todayStr && !e.isReturnDay)
    ];
    const todayPasses = [
        ...events.filter(e => e.type === 'pass' && e.startDate <= todayStr && e.endDate >= todayStr),
        ...sheetEvents.filter(e => e.type === 'pass' && e.startDate === todayStr && !e.isReturnDay)
    ];


    const generateReport = () => {
        const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

        // 인원 계산 (저녁점호 기준)
        const totalCount = totalMembers;

        const dutyCount = todayDuties.filter(d => {
            const m = members.find(member => member.name === d.memo);
            return m?.role !== 'runner';
        }).length;
        const passCount = todayPasses.filter(p => {
            const m = members.find(member => member.name === p.memo);
            return m?.role !== 'runner';
        }).length;
        const vacationCount = todayVacations.filter(v => {
            const m = members.find(member => member.name === v.memo);
            return m?.role !== 'runner';
        }).length;

        const offCount = dutyCount + passCount + vacationCount;
        const currentCount = totalCount - offCount;

        let report = `단결, 안녕하십니까.\n\n`;
        report += `${dateStr}\n`;
        report += `카투사교육대 인원 보고 드리겠습니다.\n\n`;
        report += `총원 ${totalCount}명\n`;
        report += `현재원 ${currentCount}명\n`;
        report += `열외 ${offCount}명\n`;

        const exceptionsSummaryArr = [];
        if (dutyCount > 0) exceptionsSummaryArr.push(`당직 ${dutyCount}명`);
        if (vacationCount > 0) exceptionsSummaryArr.push(`휴가 ${vacationCount}명`);
        if (passCount > 0) exceptionsSummaryArr.push(`외박 ${passCount}명`);

        report += `(열외 내용: ${exceptionsSummaryArr.length > 0 ? exceptionsSummaryArr.join(', ') : '없음'})\n\n`;

        const getEventDateText = (e: any) => {
            if (e.dateText) return `(${e.dateText})`;
            if (e.startDate && e.endDate) {
                const partsS = e.startDate.split('-');
                const partsE = e.endDate.split('-');
                if (partsS.length !== 3 || partsE.length !== 3) return '';

                const sm = Number(partsS[1]);
                const sd = Number(partsS[2]);
                const em = Number(partsE[1]);
                const ed = Number(partsE[2]);

                return `(${sm}.${sd}~${em}.${ed})`;
            }
            return '';
        };

        // 건강 특이사항
        report += `<건강 특이사항>\n`;
        if (healthNote.trim()) {
            healthNote.split('\n').filter(l => l.trim()).forEach(line => {
                report += `-${line.trim()}\n`;
            });
        } else {
            report += `-없음\n`;
        }
        report += `\n`;

        // Calendar 당직 불러오는 부분 상단으로 이동됨

        const getMemberRank = (memoName: string) => {
            const member = members.find(m => m.name === memoName);
            if (!member) return memoName;
            if (member.role !== 'runner' && member.enlistmentDate) {
                const realRank = calculateRank(new Date(member.enlistmentDate), member.earlyPromotion || 0);
                return `${member.name} ${realRank.split(' ')[0]}`;
            }
            // 미군 러너인 경우 계급에서 불필요한 숫자 제거
            const cleanRank = member.role === 'runner' ? member.rank.split(' ')[0] : member.rank;
            return `${member.name} ${cleanRank}`;
        };

        // 익일 특이사항 (당직, 리커버리, 출발)
        report += `<익일 특이사항>\n`;
        let hasSpecial = false;

        tomorrowDuties.forEach(d => {
            report += `-${getMemberRank(d.memo)} 당직\n`;
            hasSpecial = true;
        });

        todayDuties.forEach(d => {
            report += `-${getMemberRank(d.memo)} 리커버리\n`;
            hasSpecial = true;
        });

        const tomorrowDeparts = sheetEvents.filter(e => e.startDate === tomorrowStr && e.isDepartDay && e.type === 'vacation');
        if (tomorrowDeparts.length > 0) {
            const groupedNames = tomorrowDeparts.map(e => getMemberRank(e.memo)).join(', ');
            report += `-${groupedNames} 휴가 출발\n`;
            hasSpecial = true;
        }

        if (tomorrowNote.trim()) {
            tomorrowNote.split('\n').filter(l => l.trim()).forEach(line => {
                report += `-${line.trim()}\n`;
            });
            hasSpecial = true;
        }

        if (!hasSpecial) {
            report += `-없음\n`;
        }
        report += `\n`;

        // 주요일정
        report += `<주요일정>\n`;
        const scheduleLines = scheduleText.trim().split('\n').filter(l => l.trim().length > 0);
        if (scheduleLines.length > 0) {
            scheduleLines.forEach(l => {
                report += `-${l.trim()}\n`;
            });
            report += `\n`;
        } else {
            report += `-없음\n\n`;
        }

        // 휴가
        report += `<휴가>\n`;
        if (todayVacations.length > 0) {
            todayVacations.forEach(v => {
                report += `-${getMemberRank(v.memo)}${getEventDateText(v)}\n`;
            });
            report += `\n`;
        } else {
            report += `-없음\n\n`;
        }

        // 외박
        report += `<외박>\n`;
        if (todayPasses.length > 0) {
            todayPasses.forEach(p => {
                report += `-${getMemberRank(p.memo)}${getEventDateText(p)}\n`;
            });
            report += `\n`;
        } else {
            report += `-없음\n\n`;
        }

        // 듀티
        report += `<듀티>\n`;
        if (todayDuties.length > 0) {
            todayDuties.forEach(d => {
                report += `-${getMemberRank(d.memo)}\n`;
            });
        } else {
            report += `-없음\n`;
        }

        return report;
    };

    const getOffsetStr = (offset: number) => {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + offset);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const generateMorningReport = () => {
        const tomorrowStrForMorning = getOffsetStr(1);

        const morningDuties = events.filter(e => {
            if (e.type !== 'duty' || e.startDate !== tomorrowStrForMorning) return false;
            const m = members.find(member => member.name === e.memo);
            return m?.role !== 'runner';
        });
        const morningRecoveries = events.filter(e => {
            if (e.type !== 'duty' || e.startDate !== getOffsetStr(0)) return false;
            const m = members.find(member => member.name === e.memo);
            return m?.role !== 'runner';
        });
        const morningVacations = [
            ...events.filter(e => e.type === 'vacation' && e.startDate <= tomorrowStrForMorning && e.endDate >= tomorrowStrForMorning),
            ...sheetEvents.filter(e => e.type === 'vacation' && e.startDate === tomorrowStrForMorning && !e.isDepartDay)
        ].filter(e => {
            const m = members.find(member => member.name === e.memo);
            return m?.role !== 'runner';
        });
        const morningPasses = [
            ...events.filter(e => e.type === 'pass' && e.startDate <= tomorrowStrForMorning && e.endDate >= tomorrowStrForMorning),
            ...sheetEvents.filter(e => e.type === 'pass' && e.startDate === tomorrowStrForMorning && !e.isDepartDay),
            ...sheetEvents.filter(e => e.type === 'vacation' && e.startDate === tomorrowStrForMorning && e.isDepartDay && e.isConsecutive === true)
        ].filter(e => {
            const m = members.find(member => member.name === e.memo);
            return m?.role !== 'runner';
        });

        const getMemberRank = (memoName: string) => {
            const member = members.find(m => m.name === memoName);
            if (!member) return memoName;
            if (member.role !== 'runner' && member.enlistmentDate) {
                const realRank = calculateRank(new Date(member.enlistmentDate), member.earlyPromotion || 0);
                return `${member.name} ${realRank.split(' ')[0]}`;
            }
            // 미군 러너인 경우 계급에서 불필요한 숫자 제거
            const cleanRank = member.role === 'runner' ? member.rank.split(' ')[0] : member.rank;
            return `${member.name} ${cleanRank}`;
        };

        const offNames = [
            ...morningDuties.map(d => d.memo),
            ...morningRecoveries.map(d => d.memo),
            ...morningVacations.map(d => d.memo),
            ...morningPasses.map(d => d.memo),
            ...Object.values(scheduleParticipants).flat(),
            ...customSchedules.flatMap(s => s.participants)
        ];
        // 중복 제거하여 열외 인원 수 정확히 계산
        const uniqueOffNames = Array.from(new Set(offNames));

        const morningPresentMembersObj = members
            .filter(m => m.role !== 'runner')
            .filter(m => !uniqueOffNames.includes(m.name));

        const totalCount = totalMembers;
        const presentCount = morningPresentMembersObj.length;
        const offCount = totalCount - presentCount;

        const dutyCount = morningDuties.length;
        const recoveryCount = morningRecoveries.length;
        const vacationCount = morningVacations.length;
        const passCount = morningPasses.length;

        let exceptionsTextArr = [];
        if (dutyCount > 0) exceptionsTextArr.push(`당직 ${dutyCount}명`);
        if (recoveryCount > 0) exceptionsTextArr.push(`리커버리 ${recoveryCount}명`);
        if (vacationCount > 0) exceptionsTextArr.push(`휴가 ${vacationCount}명`);
        if (passCount > 0) exceptionsTextArr.push(`외박 ${passCount}명`);

        Object.entries(scheduleParticipants).forEach(([category, list]) => {
            if (list.length > 0) {
                exceptionsTextArr.push(`${category} ${list.length}명`);
            }
        });
        customSchedules.forEach(s => {
            if (s.participants.length > 0) {
                exceptionsTextArr.push(`${s.name} ${s.participants.length}명`);
            }
        });

        const exceptionsStr = exceptionsTextArr.length > 0 ? exceptionsTextArr.join(', ') : '없음';

        let report = `단결, 안녕하십니까.\n\n`;
        report += `${tomorrowStrForMorning.replace(/-/g, '.')}\n`;
        report += `카투사교육대 아침점호 인원보고 드리겠습니다.\n\n`;
        report += `총원 ${totalCount}명\n`;
        report += `현재원 ${presentCount}명\n`;
        report += `열외 ${offCount}명\n`;
        report += `(열외내용: ${exceptionsStr})\n\n`;

        // Morning report usually doesn't show detail lists of pass/vacations in text unless requested.
        // If needed, we can append it. For now, matching the prompt:
        report += `<아침점호 인원>\n`;
        if (morningPresentMembersObj.length > 0) {
            morningPresentMembersObj.forEach(m => {
                report += `-${getMemberRank(m.name)}\n`;
            });
        } else {
            report += `-없음\n`;
        }
        report += `\n`;

        // 건강 특이사항
        report += `<건강 특이사항>\n`;
        if (healthNote.trim()) {
            healthNote.split('\n').filter(l => l.trim()).forEach(line => {
                report += `-${line.trim()}\n`;
            });
        } else {
            report += `-없음\n`;
        }
        report += `\n`;

        return report;
    };

    const handleCopy = (text: string, type: 'evening' | 'morning') => {
        navigator.clipboard.writeText(text);
        setCopiedType(type);
        setTimeout(() => setCopiedType(null), 2000);
    };

    const inputBase = "w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-900";
    const labelBase = "text-sm font-bold text-gray-700 mb-1.5 block ml-1";

    const renderMemberButton = (m: any, currentCategory: string) => {
        const isSelectedHere = (scheduleParticipants[currentCategory] || []).includes(m.name) ||
            (customSchedules.find(s => s.name === currentCategory)?.participants.includes(m.name));

        const isSelectedElsewhere =
            Object.entries(scheduleParticipants).some(([cat, list]) => cat !== currentCategory && list.includes(m.name)) ||
            customSchedules.some(s => s.name !== currentCategory && s.participants.includes(m.name));

        const tomStr = getOffsetStr(1);

        // 1. 당직/리커버리 여부
        const isDuty = todayDuties.some((d: any) => d.memo === m.name) ||
            tomorrowDuties.some((d: any) => d.memo === m.name);

        // 2. 내일 휴가/외박 여부 (부재중)
        const isAway = [
            ...events.filter(e => (e.type === 'vacation' || e.type === 'pass') && e.startDate <= tomStr && e.endDate >= tomStr),
            ...sheetEvents.filter(e => e.startDate === tomStr && !e.isDepartDay)
        ].some(e => e.memo === m.name);

        const isDisabled = isDuty || isAway;

        return (
            <button
                key={m.name}
                onClick={() => {
                    if (isDisabled) return;

                    // 상태 업데이트 로직 통합
                    if (isSelectedHere) {
                        // 현재 카테고리에서 제거
                        if (scheduleParticipants[currentCategory]) {
                            setScheduleParticipants((prev: Record<string, string[]>) => ({
                                ...prev,
                                [currentCategory]: prev[currentCategory].filter((n: string) => n !== m.name)
                            }));
                        } else {
                            setCustomSchedules((prev: { name: string; participants: string[] }[]) => prev.map((s: { name: string; participants: string[] }) =>
                                s.name === currentCategory ? { ...s, participants: s.participants.filter((n: string) => n !== m.name) } : s
                            ));
                        }
                    } else {
                        // 다른 모든 곳에서 제거하고 현재 카테고리에 추가 (반전 로직)
                        setScheduleParticipants((prev: Record<string, string[]>) => {
                            const updated = { ...prev };
                            Object.keys(updated).forEach((cat: string) => {
                                updated[cat] = updated[cat].filter((n: string) => n !== m.name);
                            });
                            // 고정 일정인 경우 여기서 바로 추가
                            if (updated[currentCategory]) {
                                updated[currentCategory] = [...updated[currentCategory], m.name];
                            }
                            return updated;
                        });

                        setCustomSchedules((prev: { name: string; participants: string[] }[]) => prev.map((s: { name: string; participants: string[] }) => {
                            const filteredParticipants = s.participants.filter((n: string) => n !== m.name);
                            // 임시 일정인 경우 여기서 바로 추가
                            if (s.name === currentCategory) {
                                return { ...s, participants: [...filteredParticipants, m.name] };
                            }
                            return { ...s, participants: filteredParticipants };
                        }));
                    }
                }}
                disabled={isDisabled}
                className={cn(
                    "px-3 py-2 rounded-xl text-[11px] font-black transition-all border break-keep",
                    isDuty
                        ? "bg-amber-100 border-amber-300 text-amber-700 opacity-80 cursor-not-allowed"
                        : isAway
                            ? "bg-slate-100 border-slate-200 text-slate-400 opacity-60 cursor-not-allowed"
                            : isSelectedHere
                                ? "bg-blue-500 border-blue-600 text-white shadow-md shadow-blue-200/50 scale-105"
                                : isSelectedElsewhere
                                    ? "bg-white border border-dashed border-gray-400 text-gray-400"
                                    : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-white hover:border-gray-300"
                )}
            >
                {m.name}
            </button>
        );
    };

    return (
        <div className="flex flex-col gap-8 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="pt-8 px-1">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-wider">Attendance</span>
                    </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">점호 보고 입력</h1>
                    <div className="relative group">
                        <input
                            type="date"
                            value={todayStr}
                            onChange={(e) => setBaseDate(new Date(e.target.value))}
                            className="bg-white border-2 border-slate-200 rounded-2xl px-3 py-1.5 text-[11px] font-bold text-slate-600 focus:outline-none focus:border-blue-500 transition-all hover:border-slate-300"
                        />
                    </div>
                </div>
            </header>


            {/* Health */}
            <section className="space-y-1.5">
                <label className={labelBase}>1. 건강 특이사항</label>
                <textarea
                    value={healthNote}
                    onChange={(e) => setHealthNote(e.target.value)}
                    className={cn(inputBase, "min-h-[50px] resize-y")}
                />
            </section>

            {/* Tomorrow Special Notes */}
            <section className="space-y-1.5">
                <label className={labelBase}>2. 익일 특이사항</label>
                <textarea
                    value={tomorrowNote}
                    onChange={(e) => setTomorrowNote(e.target.value)}
                    className={cn(inputBase, "min-h-[50px] resize-y")}
                />
            </section>

            <section className="space-y-4">
                <div className="flex justify-between items-center pr-1">
                    <label className={labelBase}>3. 주요 일정</label>
                    <button
                        onClick={handleSortSchedules}
                        className="text-[10px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-2 py-1 transition-all flex items-center gap-1"
                    >
                        <Clock className="w-3 h-3" />
                        시간순 정렬
                    </button>
                </div>
                <div className="space-y-3">
                    <textarea
                        value={scheduleText}
                        onChange={(e) => setScheduleText(e.target.value)}
                        className={cn(inputBase, "min-h-[120px] resize-y")}
                    />
                </div>
            </section>

            {/* Daily Schedules & Participation */}
            <section className="space-y-3">
                <div className="flex justify-between items-end pr-1">
                    <label className={labelBase}>4. 익일 일정 참여 인원</label>
                </div>
                <div className="flex flex-col gap-4">
                    {Object.keys(scheduleParticipants).map(category => {
                        const targetSection = category.split(' ')[0]; // 'HQ', 'KTA', 'MEDIC', 'BLC'

                        let sectionMembers: typeof members = [];
                        if (targetSection === 'HQ') {
                            const excludeList = ['KTA', 'MEDIC', 'RSO'];
                            sectionMembers = members.filter(m =>
                                m.role !== 'runner' &&
                                (!m.sections || !m.sections.some(s => excludeList.includes(s)))
                            );
                        } else {
                            sectionMembers = members.filter(m =>
                                m.role !== 'runner' &&
                                m.sections?.includes(targetSection)
                            );
                        }

                        return (
                            <div key={category} className="p-5 bg-white border border-gray-200 rounded-3xl shadow-sm">
                                <h3 className="text-sm font-black text-gray-900 mb-3 flex items-center justify-between">
                                    {category}
                                </h3>
                                {sectionMembers.length === 0 ? (
                                    <p className="text-xs text-gray-400 font-bold bg-gray-50 p-3 rounded-xl border border-dashed border-gray-200">
                                        {targetSection === 'HQ'
                                            ? "대상 인원이 없습니다."
                                            : `인원 탭에서 이 섹션( ${targetSection} )에 소속된 인원을 먼저 설정해주세요.`}
                                    </p>
                                ) : targetSection === 'HQ' ? (
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap gap-2">
                                            {sectionMembers.filter(m => !m.sections?.includes('BLC')).map(m => renderMemberButton(m, category))}
                                        </div>
                                        {sectionMembers.some(m => m.sections?.includes('BLC')) && (
                                            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                                                {sectionMembers.filter(m => m.sections?.includes('BLC')).map(m => renderMemberButton(m, category))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {sectionMembers.map(m => renderMemberButton(m, category))}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* 임시 추가 일정 카드 */}
                    {customSchedules.map(schedule => {
                        const allMembers = members.filter(m => m.role !== 'runner');
                        return (
                            <div key={schedule.name} className="p-5 bg-white border border-indigo-200 rounded-3xl shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-black text-indigo-700">{schedule.name}</h3>
                                    <button
                                        onClick={() => removeCustomSchedule(schedule.name)}
                                        className="text-[10px] font-black text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2 py-1 transition-all"
                                    >
                                        삭제
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {allMembers.map(m => renderMemberButton(m, schedule.name))}
                                </div>
                            </div>
                        );
                    })}

                    {/* 새 일정 추가 입력 */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newScheduleName}
                            onChange={e => setNewScheduleName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addCustomSchedule(); }}
                            placeholder="일정 이름 입력 후 + 버튼 클릭"
                            className="flex-1 px-4 py-3 rounded-xl bg-gray-50 border border-dashed border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all text-gray-900 text-sm placeholder:text-gray-400"
                        />
                        <button
                            onClick={addCustomSchedule}
                            className="px-4 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-black text-sm transition-all active:scale-95 shadow-md shadow-indigo-200/50"
                        >
                            +
                        </button>
                    </div>
                </div>
            </section>

            {/* Previews */}
            <div className="pt-8 space-y-6">
                <h2 className="text-2xl font-black text-gray-900 tracking-tight ml-1">점호 보고서 미리보기</h2>

                {/* Evening Roll Call Preview */}
                <div className="rounded-3xl bg-slate-900 shadow-2xl border border-slate-800 relative flex flex-col">
                    <div className="absolute top-0 left-0 p-4 opacity-5 pointer-events-none">
                        <FileText className="w-48 h-48 text-white" />
                    </div>

                    <div className="flex items-center justify-between p-5 border-b border-slate-800 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            <span className="text-sm font-black text-slate-200 tracking-wide">저녁점호 보고</span>
                        </div>

                        <button
                            onClick={() => handleCopy(generateReport(), 'evening')}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95",
                                copiedType === 'evening'
                                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                    : "bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30"
                            )}
                        >
                            {copiedType === 'evening' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copiedType === 'evening' ? '복사 완료' : '문자 복사하기'}
                        </button>
                    </div>

                    <div className="p-6 relative z-10">
                        <pre className="text-[13px] leading-relaxed text-slate-300 font-mono whitespace-pre-wrap break-all">
                            {generateReport()}
                        </pre>
                    </div>
                </div>

                {/* Morning Roll Call Preview */}
                <div className="rounded-3xl bg-slate-900 shadow-2xl border border-slate-800 relative flex flex-col">
                    <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                        <FileText className="w-48 h-48 text-white" />
                    </div>

                    <div className="flex items-center justify-between p-5 border-b border-slate-800 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                            <span className="text-sm font-black text-slate-200 tracking-wide">아침점호 보고</span>
                        </div>

                        <button
                            onClick={() => handleCopy(generateMorningReport(), 'morning')}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95",
                                copiedType === 'morning'
                                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                    : "bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 border border-yellow-500/30"
                            )}
                        >
                            {copiedType === 'morning' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copiedType === 'morning' ? '복사 완료' : '문자 복사하기'}
                        </button>
                    </div>

                    <div className="p-6 relative z-10">
                        <pre className="text-[13px] leading-relaxed text-slate-300 font-mono whitespace-pre-wrap break-all">
                            {generateMorningReport()}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
}


