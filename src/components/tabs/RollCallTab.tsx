import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { Copy, Check, Clock, FileText, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { db } from '../../lib/firebase';
import { collection, onSnapshot, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';




interface Member {
    name: string;
    rank: string;
    role: string;
    enlistmentDate?: string;
    sections?: string[];
    earlyPromotion?: number;
}

interface SheetEvent {
    memo: string;
    startDate: string;
    endDate: string;
    type: string;
    isDepartDay?: boolean;
    isConsecutive?: boolean;
    dateText?: string;
}

interface Stats {
    total: number;
    present: number;
    absent: number;
    dutyCount: number;
    vacationCount: number;
    passCount: number;
}

interface EveningData {
    duties: string[];
    vacations: any[];
    passes: any[];
    recoveries: string[];
    tomorrowDuties: string[];
    tomorrowDeparts: string[];
}

interface MorningData {
    duties: string[];
    recoveries: string[];
    vacations: string[];
    passes: string[];
    tomorrowStr: string;
    presentMembers: string[];
}

interface RollCallData {
    stats: Stats;
    evening: EveningData;
    morning: MorningData;
    sheetEvents: SheetEvent[];
}

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
    const [rollCallData, setRollCallData] = useState<RollCallData | null>(null);
    const [sheetMode, setSheetMode] = useState<'test' | 'prod'>('test');
    const [sheetUpdatedAt, setSheetUpdatedAt] = useState<string>('0');
    
    // 세션 UI 렌더링용 멤버 목록 (Firestore 실시간 구독)
    const [members, setMembers] = useState<Member[]>([]);

    // Firestore 멤버 구독 (섹션 분류 UI 용)
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'members'), (snapshot) => {
            const data = snapshot.docs.map(doc => doc.data() as Member);
            const sorted = [...data].sort((a, b) => {
                const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
                const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
                if (dateA !== dateB) return dateA < dateB ? -1 : 1;
                return (a.name || '').localeCompare(b.name || '');
            });
            setMembers(sorted);
        });
        return () => unsub();
    }, []);

    // 실시간 스프레드시트 업데이트 감지
    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'settings', 'spreadsheet'), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const currentMode = data.mode || 'test';
                setSheetMode(currentMode);
                
                const targetKey = currentMode === 'prod' ? 'prodUpdatedAt' : 'testUpdatedAt';
                const lastUpdate = data[targetKey] || data.updatedAt;
                if (lastUpdate) {
                    setSheetUpdatedAt(lastUpdate.toMillis ? lastUpdate.toMillis().toString() : lastUpdate.toString());
                } else {
                    setSheetUpdatedAt(Date.now().toString());
                }
            } else {
                setSheetMode('test');
            }
        });
        return () => unsub();
    }, []);

    const handleManualRefresh = async () => {
        setRollCallData(null);
        try {
            const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
            const FUNCTION_URL = `https://getrollcalldata-daomamzojq-du.a.run.app`;
            const res = await fetch(`${FUNCTION_URL}?date=${dateStr}&t=${Date.now()}`);
            const json = await res.json();
            
            if (json.status === 'success') {
                const data = json.data;
                setRollCallData(data);
                
                if (sheetUpdatedAt !== '0') {
                    const cacheKey = `rollcall_${sheetMode}_${dateStr}_${sheetUpdatedAt}`;
                    localStorage.setItem(cacheKey, JSON.stringify(data));

                    try {
                        await setDoc(doc(db, "rollcall_cache", `${sheetMode}_${dateStr}_${sheetUpdatedAt}`), {
                            data: data,
                            updatedAt: serverTimestamp()
                        });
                    } catch (e) {
                        console.error("Firestore cache write error:", e);
                    }
                }
            }
        } catch (err) {
            console.error('Manual refresh error:', err);
        }
    };

    // 백엔드 API 호출 함수
    const fetchData = async (mode: 'test' | 'prod', updatedAtStr?: string) => {
        try {
            const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
            
            // 캐시 키 설정
            const cacheKey = updatedAtStr ? `rollcall_${mode}_${dateStr}_${updatedAtStr}` : null;
            const cached = cacheKey ? localStorage.getItem(cacheKey) : null;

            // 1. 로컬 캐시 확인
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    setRollCallData(parsed);
                    return;
                } catch (e) {
                    console.error('Cache parsing error:', e);
                }
            }

            // 로딩 상태 표시를 위해 데이터 초기화
            setRollCallData(null);

            // 2. Firestore 공유 캐시 확인
            if (updatedAtStr) {
                try {
                    const cacheDoc = await getDoc(doc(db, "rollcall_cache", `${mode}_${dateStr}_${updatedAtStr}`));
                    if (cacheDoc.exists()) {
                        const sharedData = cacheDoc.data().data;
                        setRollCallData(sharedData);
                        
                        // 로컬에도 저장
                        if (cacheKey) {
                            localStorage.setItem(cacheKey, JSON.stringify(sharedData));
                        }
                        return;
                    }
                } catch (e) {
                    console.error("Firestore cache read error:", e);
                }
            }

            // 3. 백엔드 API 호출 (캐시 없음)
            const FUNCTION_URL = `https://getrollcalldata-daomamzojq-du.a.run.app`;
            const res = await fetch(`${FUNCTION_URL}?date=${dateStr}`);
            const json = await res.json();
            
            if (json.status === 'success') {
                const data = json.data;
                setRollCallData(data);
                
                if (updatedAtStr) {
                    const cacheKey = `rollcall_${mode}_${dateStr}_${updatedAtStr}`;
                    
                    // 기존 캐시 청소 (이전 시간에 저장된 동일 날짜의 캐시 삭제)
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && k.startsWith(`rollcall_${mode}_${dateStr}_`) && k !== cacheKey) {
                            keysToRemove.push(k);
                        }
                    }
                    keysToRemove.forEach(k => localStorage.removeItem(k));
                    
                    localStorage.setItem(cacheKey, JSON.stringify(data));

                    // Firestore 공유 캐시에 저장 (다른 사용자와 공유)
                    try {
                        await setDoc(doc(db, "rollcall_cache", `${mode}_${dateStr}_${updatedAtStr}`), {
                            data: data,
                            updatedAt: serverTimestamp()
                        });
                    } catch (e) {
                        console.error("Firestore cache write error:", e);
                    }
                }
            } else {
                console.error('백엔드 오류:', json.message);
            }
        } catch (err) {
            console.error('fetchData error:', err);
        }
    };

    const lastLoadedTimestampRef = useRef<string>('0');
    const lastLoadedModeRef = useRef<'test' | 'prod'>('test');
    const lastLoadedDateRef = useRef<string>('');

    // 데이터 로드 로직
    useEffect(() => {
        if (sheetMode && sheetUpdatedAt !== '0') {
            const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
            
            const isInitialLoad = lastLoadedTimestampRef.current === '0';
            const isModeChange = sheetMode !== lastLoadedModeRef.current;
            const isDateChange = dateStr !== lastLoadedDateRef.current;
            const isTimestampChange = !isInitialLoad && !isModeChange && !isDateChange && sheetUpdatedAt !== lastLoadedTimestampRef.current;
            
            // 시트 타임스탬프가 변경된 경우(편집 발생): 4초 디바운스 대기하여 연속 편집 신호 수집
            // 초기 진입, 모드 전환, 날짜 전환인 경우: 즉시 로딩(0초)
            const delay = isTimestampChange ? 4000 : 0;

            const timer = setTimeout(() => {
                fetchData(sheetMode, sheetUpdatedAt);
                lastLoadedTimestampRef.current = sheetUpdatedAt;
                lastLoadedModeRef.current = sheetMode;
                lastLoadedDateRef.current = dateStr;
            }, delay);

            return () => clearTimeout(timer);
        }
    }, [baseDate, sheetMode, sheetUpdatedAt]);

    const sheetEvents = rollCallData?.sheetEvents || [];

    // 날짜 문자열 (date input용)
    const todayStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;

    // 백엔드에서 받은 데이터로 저녁점호 보고서 생성
    const generateReport = () => {
        if (!rollCallData) return '데이터를 불러오는 중입니다...';

        const { stats, evening } = rollCallData;
        const dateStr = `${baseDate.getFullYear()}.${String(baseDate.getMonth() + 1).padStart(2, '0')}.${String(baseDate.getDate()).padStart(2, '0')}`;

        const exceptionsSummaryArr = [];
        if (stats.dutyCount > 0) exceptionsSummaryArr.push(`당직 ${stats.dutyCount}명`);
        if (stats.vacationCount > 0) exceptionsSummaryArr.push(`휴가 ${stats.vacationCount}명`);
        if (stats.passCount > 0) exceptionsSummaryArr.push(`외박 ${stats.passCount}명`);

        let report = `단결, 안녕하십니까.\n\n`;
        report += `${dateStr}\n`;
        report += `카투사교육대 인원 보고 드리겠습니다.\n\n`;
        report += `총원 ${stats.total}명\n`;
        report += `현재원 ${stats.present}명\n`;
        report += `열외 ${stats.absent}명\n`;
        report += `(열외 내용: ${exceptionsSummaryArr.length > 0 ? exceptionsSummaryArr.join(', ') : '없음'})\n\n`;

        // 건강 특이사항
        report += `<건강 특이사항>\n`;
        if (healthNote.trim()) {
            healthNote.split('\n').filter(l => l.trim()).forEach(line => { report += `-${line.trim()}\n`; });
        } else {
            report += `-없음\n`;
        }
        report += `\n`;

        // 익일 특이사항
        report += `<익일 특이사항>\n`;
        let hasSpecial = false;
        (evening.tomorrowDuties || []).forEach((name: string) => { report += `-${name} 당직\n`; hasSpecial = true; });
        (evening.recoveries || []).forEach((name: string) => { report += `-${name} 리커버리\n`; hasSpecial = true; });
        if ((evening.tomorrowDeparts || []).length > 0) {
            report += `-${evening.tomorrowDeparts.join(', ')} 휴가 출발\n`;
            hasSpecial = true;
        }
        if (tomorrowNote.trim()) {
            tomorrowNote.split('\n').filter(l => l.trim()).forEach(line => { report += `-${line.trim()}\n`; });
            hasSpecial = true;
        }
        if (!hasSpecial) report += `-없음\n`;
        report += `\n`;

        // 주요일정
        report += `<주요일정>\n`;
        const scheduleLines = scheduleText.trim().split('\n').filter(l => l.trim().length > 0);
        if (scheduleLines.length > 0) {
            scheduleLines.forEach(l => { report += `-${l.trim()}\n`; });
            report += `\n`;
        } else {
            report += `-없음\n\n`;
        }

        // 휴가
        report += `<휴가>\n`;
        if ((evening.vacations || []).length > 0) {
            evening.vacations.forEach((v: any) => { report += `-${v.name}${v.dateText ? `(${v.dateText})` : ''}\n`; });
            report += `\n`;
        } else {
            report += `-없음\n\n`;
        }

        // 외박
        report += `<외박>\n`;
        if ((evening.passes || []).length > 0) {
            evening.passes.forEach((p: any) => { report += `-${p.name}${p.dateText ? `(${p.dateText})` : ''}\n`; });
            report += `\n`;
        } else {
            report += `-없음\n\n`;
        }

        // 듀티
        report += `<듀티>\n`;
        if ((evening.duties || []).length > 0) {
            evening.duties.forEach((name: string) => { report += `-${name}\n`; });
        } else {
            report += `-없음\n`;
        }

        return report;
    };

    // 백엔드에서 받은 데이터로 아침점호 보고서 생성
    const generateMorningReport = () => {
        if (!rollCallData) return '데이터를 불러오는 중입니다...';

        const { morning } = rollCallData;

        // 스케줄 참여 인원은 프런트에서만 관리 (실시간 선택 UI)
        const scheduleOffNames = [
            ...Object.values(scheduleParticipants).flat(),
            ...customSchedules.flatMap(s => s.participants)
        ];
        const allOffNames = new Set([
            ...(morning.duties || []),
            ...(morning.recoveries || []),
            ...(morning.vacations || []),
            ...(morning.passes || []),
            ...scheduleOffNames,
        ]);

        // 아침점호 출석 인원 = 백엔드가 보낸 전체 인원 중 열외자 제외
        const presentMembers = (morning.presentMembers || []).filter(
            (name: string) => !Array.from(allOffNames).some(off => name.startsWith(off.split(' ')[0]))
        );

        const totalCount = rollCallData.stats.total;
        const offCount = allOffNames.size;
        const presentCount = totalCount - offCount;

        let exceptionsTextArr: string[] = [];
        if ((morning.duties || []).length > 0) exceptionsTextArr.push(`당직 ${morning.duties.length}명`);
        if ((morning.recoveries || []).length > 0) exceptionsTextArr.push(`리커버리 ${morning.recoveries.length}명`);
        if ((morning.vacations || []).length > 0) exceptionsTextArr.push(`휴가 ${morning.vacations.length}명`);
        if ((morning.passes || []).length > 0) exceptionsTextArr.push(`외박 ${morning.passes.length}명`);
        Object.entries(scheduleParticipants).forEach(([category, list]) => {
            if (list.length > 0) exceptionsTextArr.push(`${category} ${list.length}명`);
        });
        customSchedules.forEach(s => {
            if (s.participants.length > 0) exceptionsTextArr.push(`${s.name} ${s.participants.length}명`);
        });

        let report = `단결, 안녕하십니까.\n\n`;
        report += `${(morning.tomorrowStr || '').replace(/-/g, '.')}\n`;
        report += `카투사교육대 아침점호 인원보고 드리겠습니다.\n\n`;
        report += `총원 ${totalCount}명\n`;
        report += `현재원 ${presentCount}명\n`;
        report += `열외 ${offCount}명\n`;
        report += `(열외내용: ${exceptionsTextArr.length > 0 ? exceptionsTextArr.join(', ') : '없음'})\n\n`;

        report += `<아침점호 인원>\n`;
        if (presentMembers.length > 0) {
            presentMembers.forEach((name: string) => { report += `-${name}\n`; });
        } else {
            report += `-없음\n`;
        }
        report += `\n`;

        report += `<건강 특이사항>\n`;
        if (healthNote.trim()) {
            healthNote.split('\n').filter(l => l.trim()).forEach(line => { report += `-${line.trim()}\n`; });
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

    const renderMemberButton = (m: Member, currentCategory: string) => {
        const isSelectedHere = (scheduleParticipants[currentCategory] || []).includes(m.name) ||
            (customSchedules.find(s => s.name === currentCategory)?.participants.includes(m.name));

        const isSelectedElsewhere =
            Object.entries(scheduleParticipants).some(([cat, list]) => cat !== currentCategory && list.includes(m.name)) ||
            customSchedules.some(s => s.name !== currentCategory && s.participants.includes(m.name));

        // 당직 여부: 백엔드에서 받은 evening.duties/tomorrowDuties 목록으로 판단
        const isDuty = (rollCallData?.evening?.duties || []).some((name: string) => name.startsWith(m.name)) ||
            (rollCallData?.evening?.tomorrowDuties || []).some((name: string) => name.startsWith(m.name));

        // 부재중 여부: 내일 변시트 이벤트 기준 (다음날 휴가/외박 중이거나, 연계외박로 이어지는 휴가출발인 경우 코 포함)
        const tomorrowDt = new Date(baseDate);
        tomorrowDt.setDate(tomorrowDt.getDate() + 1);
        const tomStr = `${tomorrowDt.getFullYear()}-${String(tomorrowDt.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDt.getDate()).padStart(2, '0')}`;
        const isAway = sheetEvents.filter((e: SheetEvent) =>
            e.startDate === tomStr && (
                !e.isDepartDay ||                          // 다음날이 휴가/외박 중간일
                (e.isDepartDay && e.isConsecutive)         // 휴가출발이지만 연계 외박(복귀 X)
            )
        ).some((e: SheetEvent) => e.memo === m.name);

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

    // Refs for focus management
    // Use actual refs instead of useState for DOM access
    const [healthTextArea, setHealthTextArea] = useState<HTMLTextAreaElement | null>(null);
    const [tomorrowTextArea, setTomorrowTextArea] = useState<HTMLTextAreaElement | null>(null);

    // Autocomplete state
    const [mentionSearch, setMentionSearch] = useState<{ query: string, target: 'health' | 'tomorrow', cursor: number } | null>(null);
    const [mentionSuggestions, setMentionSuggestions] = useState<Member[]>([]);

    const handleTextChange = (value: string, target: 'health' | 'tomorrow', cursor: number) => {
        if (target === 'health') setHealthNote(value);
        else setTomorrowNote(value);

        // Find the word being typed at the cursor
        const textBeforeCursor = value.substring(0, cursor);
        const words = textBeforeCursor.split(/\s|\n/);
        const lastWord = words[words.length - 1];

        // Trigger if lastWord starts with 1 or more characters (e.g., "이", "박")
        if (lastWord.length >= 1 && /^[가-힣]+$/.test(lastWord)) {
            const filtered = members.filter(m => m.name.startsWith(lastWord));
            if (filtered.length > 0) {
                setMentionSearch({ query: lastWord, target, cursor });
                setMentionSuggestions(filtered);
            } else {
                setMentionSearch(null);
            }
        } else {
            setMentionSearch(null);
        }
    };

    const insertMention = (member: Member) => {
        if (!mentionSearch) return;
        const note = mentionSearch.target === 'health' ? healthNote : tomorrowNote;
        const before = note.substring(0, mentionSearch.cursor - mentionSearch.query.length);
        const after = note.substring(mentionSearch.cursor);
        
        // Format: "이희승 일병 " (Strip paygrade like '3호봉' if present)
        const cleanRank = member.rank.split(' ')[0];
        const textToInsert = `${member.name} ${cleanRank} `;
        const newText = before + textToInsert + after;
        
        if (mentionSearch.target === 'health') setHealthNote(newText);
        else setTomorrowNote(newText);
        
        const targetArea = mentionSearch.target === 'health' ? healthTextArea : tomorrowTextArea;
        const newCursorPos = before.length + textToInsert.length;

        setMentionSearch(null);

        // Focus back and set cursor position after state update
        setTimeout(() => {
            if (targetArea) {
                targetArea.focus();
                targetArea.setSelectionRange(newCursorPos, newCursorPos);
            }
        }, 0);
    };

    return (
        <div className="pt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            <header className="flex items-center justify-between gap-2 sm:gap-4 mb-8">
                <div className="flex items-center gap-2 sm:gap-4 min-h-[44px]">
                    <img src="/favicon.png" alt="로고" className="w-10 h-10 sm:w-11 sm:h-11 object-contain" />
                    <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight leading-none translate-y-[-2px] whitespace-nowrap">점호 보고</h1>
                </div>
                <div className="flex flex-col gap-1.5 w-[116px] sm:w-[125px] shrink-0">
                    <div className="relative group w-full">
                        <input
                            type="date"
                            value={todayStr}
                            onChange={(e) => setBaseDate(new Date(e.target.value))}
                            className="w-full h-[32px] sm:h-[38px] bg-white border-2 border-slate-200 rounded-xl pl-1.5 pr-0.5 sm:px-3 text-[10px] sm:text-[11px] font-bold text-slate-600 focus:outline-none focus:border-blue-500 transition-all hover:border-slate-300 appearance-none m-0"
                        />
                    </div>
                    <button
                        onClick={handleManualRefresh}
                        className="w-full h-[32px] sm:h-[38px] flex items-center justify-center gap-1 px-2 sm:px-3 rounded-xl bg-white border-2 border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95 shadow-sm shadow-slate-100"
                    >
                        <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span className="text-[10px] sm:text-[11px] font-bold">새로고침</span>
                    </button>
                    </div>
            </header>


            {/* Health */}
            <section className="space-y-1.5 relative">
                <label className={labelBase}>1. 건강 특이사항</label>
                {mentionSearch?.target === 'health' && (
                    <div className="absolute bottom-full left-0 mb-2 z-[150] bg-white border border-gray-200 rounded-2xl shadow-2xl p-2 max-h-48 overflow-y-auto w-48 animate-in slide-in-from-bottom-2 duration-200">
                        <p className="text-[10px] font-bold text-gray-400 px-2 mb-1">부대원 선택</p>
                        {mentionSuggestions.map((m, idx) => (
                            <button
                                key={idx}
                                onClick={() => insertMention(m)}
                                className="w-full text-left px-3 py-2 hover:bg-blue-50 rounded-xl transition-colors flex items-center justify-between"
                            >
                                <span className="text-xs font-black text-gray-900">{m.name}</span>
                                <span className="text-[10px] font-bold text-blue-500">{m.rank.split(' ')[0]}</span>
                            </button>
                        ))}
                    </div>
                )}
                <textarea
                    ref={setHealthTextArea}
                    value={healthNote}
                    onChange={(e) => handleTextChange(e.target.value, 'health', e.target.selectionStart)}
                    className={cn(inputBase, "min-h-[50px] resize-y")}
                />
            </section>

            {/* Tomorrow Special Notes */}
            <section className="space-y-1.5 relative">
                <label className={labelBase}>2. 익일 특이사항</label>
                {mentionSearch?.target === 'tomorrow' && (
                    <div className="absolute bottom-full left-0 mb-2 z-[150] bg-white border border-gray-200 rounded-2xl shadow-2xl p-2 max-h-48 overflow-y-auto w-48 animate-in slide-in-from-bottom-2 duration-200">
                        <p className="text-[10px] font-bold text-gray-400 px-2 mb-1">부대원 선택</p>
                        {mentionSuggestions.map((m, idx) => (
                            <button
                                key={idx}
                                onClick={() => insertMention(m)}
                                className="w-full text-left px-3 py-2 hover:bg-blue-50 rounded-xl transition-colors flex items-center justify-between"
                            >
                                <span className="text-xs font-black text-gray-900">{m.name}</span>
                                <span className="text-[10px] font-bold text-blue-500">{m.rank.split(' ')[0]}</span>
                            </button>
                        ))}
                    </div>
                )}
                <textarea
                    ref={setTomorrowTextArea}
                    value={tomorrowNote}
                    onChange={(e) => handleTextChange(e.target.value, 'tomorrow', e.target.selectionStart)}
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
                                            ? '대상 인원이 없습니다.'
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
                        const allNonRunners = members.filter(m => m.role !== 'runner');
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
                                    {allNonRunners.map(m => renderMemberButton(m, schedule.name))}
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


