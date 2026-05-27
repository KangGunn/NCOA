import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { db } from '../../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { cn } from '../../lib/utils';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

interface DutyTrackerModalProps {
    isOpen: boolean;
    onClose: () => void;
    events: CalendarEvent[];
    members: CalendarMember[];
    currentDate: Date;
}

type SortField = 'seniority' | 'total';
type SortOrder = 'asc' | 'desc';

interface MonthOption {
    label: string;
    key: string;
    year: number;
    month: number;
}

const MONTH_LABELS: MonthOption[] = [
    { label: '3월 이전 (누적 기준선)', key: 'baseline', year: 2026, month: 3 },
    { label: '2026년 4월 (누적)', key: '2026-04', year: 2026, month: 4 },
    { label: '2026년 5월 (누적)', key: '2026-05', year: 2026, month: 5 },
    { label: '2026년 6월 (누적)', key: '2026-06', year: 2026, month: 6 },
    { label: '2026년 7월 (누적)', key: '2026-07', year: 2026, month: 7 },
    { label: '2026년 8월 (누적)', key: '2026-08', year: 2026, month: 8 },
    { label: '2026년 9월 (누적)', key: '2026-09', year: 2026, month: 9 },
    { label: '2026년 10월 (누적)', key: '2026-10', year: 2026, month: 10 },
    { label: '2026년 11월 (누적)', key: '2026-11', year: 2026, month: 11 },
    { label: '2026년 12월 (누적)', key: '2026-12', year: 2026, month: 12 },
];

export function DutyTrackerModal({ isOpen, onClose, events, members, currentDate }: DutyTrackerModalProps) {
    const [showCompleted, setShowCompleted] = useState(false);
    const [showCriteriaSettings, setShowCriteriaSettings] = useState(false);

    const [criteriaWeekday, setCriteriaWeekday] = useState<number>(() => {
        const saved = localStorage.getItem('ncoa_criteria_weekday');
        return saved ? parseInt(saved, 10) : 13;
    });
    const [criteriaFriSun, setCriteriaFriSun] = useState<number>(() => {
        const saved = localStorage.getItem('ncoa_criteria_frisun');
        return saved ? parseInt(saved, 10) : 9;
    });
    const [criteriaSat, setCriteriaSat] = useState<number>(() => {
        const saved = localStorage.getItem('ncoa_criteria_sat');
        return saved ? parseInt(saved, 10) : 6;
    });

    const handleSaveCriteria = (w: number, f: number, s: number) => {
        setCriteriaWeekday(w);
        setCriteriaFriSun(f);
        setCriteriaSat(s);
        localStorage.setItem('ncoa_criteria_weekday', String(w));
        localStorage.setItem('ncoa_criteria_frisun', String(f));
        localStorage.setItem('ncoa_criteria_sat', String(s));
    };

    const sortField: SortField = 'seniority';
    const sortOrder: SortOrder = 'asc';
    
    // Switcher state
    const [selectedMonthIndex, setSelectedMonthIndex] = useState(0);

    // Local state for baselines: Record<memberId, { weekday, friSun, sat }>
    const [baselines, setBaselines] = useState<Record<string, { weekday: number | string; friSun: number | string; sat: number | string }>>({});

    // Initialize switcher index based on currentDate ONLY when modal opens
    useEffect(() => {
        if (isOpen) {
            const curYear = currentDate.getFullYear();
            const curMonth = currentDate.getMonth() + 1; // 1-indexed
            if (curYear === 2026) {
                const found = MONTH_LABELS.findIndex(m => m.year === curYear && m.month === curMonth);
                setSelectedMonthIndex(found !== -1 ? found : 2); // Default to current month or May
            } else {
                setSelectedMonthIndex(2); // May
            }
        }
    }, [isOpen]);

    // Sync baselines local state whenever members change
    useEffect(() => {
        if (isOpen) {
            const initialBaselines: Record<string, { weekday: number | string; friSun: number | string; sat: number | string }> = {};
            members.forEach(m => {
                initialBaselines[m.id] = {
                    weekday: m.baselineWeekday || 0,
                    friSun: m.baselineFriSun || 0,
                    sat: m.baselineSat || 0
                };
            });
            setBaselines(initialBaselines);
        }
    }, [isOpen, members]);

    if (!isOpen) return null;

    // Filter out runners
    const activeMembers = members.filter(m => m.role !== 'runner');

    // Duty classification logic from Duty Planner
    const getDutyType = (dateStr: string): 'weekday' | 'friSun' | 'sat' => {
        const isHolidayDate = (dStr: string) => {
            return events.some(e => e.type === 'holiday' && e.holidayType === 'duty' && dStr >= e.startDate && dStr <= e.endDate);
        };
        const getPrevDateStr = (dStr: string) => {
            const d = new Date(dStr + 'T00:00:00');
            d.setDate(d.getDate() - 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const getNextDateStr = (dStr: string) => {
            const d = new Date(dStr + 'T00:00:00');
            d.setDate(d.getDate() + 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };

        if (isHolidayDate(dateStr)) return 'sat';
        if (isHolidayDate(getNextDateStr(dateStr))) return 'friSun';
        if (isHolidayDate(getPrevDateStr(dateStr))) return 'friSun';

        const d = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = d.getDay();
        if (dayOfWeek === 6) return 'sat';
        if (dayOfWeek === 0 || dayOfWeek === 5) return 'friSun';
        return 'weekday';
    };

    // Save baseline value to Firestore
    const handleSaveBaselineField = async (memberId: string, field: 'baselineWeekday' | 'baselineFriSun' | 'baselineSat', val: number) => {
        try {
            await updateDoc(doc(db, 'members', memberId), {
                [field]: val
            });
        } catch (e) {
            console.error(`Error updating ${field}:`, e);
            alert("기준 당직 횟수 저장 중 오류가 발생했습니다.");
        }
    };

    const handlePrevMonth = () => {
        setSelectedMonthIndex(prev => Math.max(0, prev - 1));
    };

    const handleNextMonth = () => {
        setSelectedMonthIndex(prev => Math.min(MONTH_LABELS.length - 1, prev + 1));
    };

    const isBaselineMode = selectedMonthIndex === 0;

    // Calculate cumulative stats for each member
    const memberStats = activeMembers.map(member => {
        const localBaseline = baselines[member.id] || {
            weekday: member.baselineWeekday || 0,
            friSun: member.baselineFriSun || 0,
            sat: member.baselineSat || 0
        };

        let extraWeekday = 0;
        let extraFriSun = 0;
        let extraSat = 0;

        if (!isBaselineMode) {
            // Count all duties from April 2026 (4) up to the selected switcher month
            const memberDuties = events.filter(e => e.type === 'duty' && e.memo === member.name && e.startDate.startsWith('2026-'));
            const targetMonth = MONTH_LABELS[selectedMonthIndex].month;

            memberDuties.forEach(d => {
                const parts = d.startDate.split('-');
                const eventMonth = parseInt(parts[1], 10);
                const eventYear = parseInt(parts[0], 10);

                if (eventYear === 2026 && eventMonth >= 4 && eventMonth <= targetMonth) {
                    const type = getDutyType(d.startDate);
                    if (type === 'weekday') extraWeekday++;
                    else if (type === 'friSun') extraFriSun++;
                    else if (type === 'sat') extraSat++;
                }
            });
        }

        const parsedBaselineWeekday = typeof localBaseline.weekday === 'string' ? (parseInt(localBaseline.weekday, 10) || 0) : localBaseline.weekday;
        const parsedBaselineFriSun = typeof localBaseline.friSun === 'string' ? (parseInt(localBaseline.friSun, 10) || 0) : localBaseline.friSun;
        const parsedBaselineSat = typeof localBaseline.sat === 'string' ? (parseInt(localBaseline.sat, 10) || 0) : localBaseline.sat;

        const weekday = parsedBaselineWeekday + extraWeekday;
        const friSun = parsedBaselineFriSun + extraFriSun;
        const sat = parsedBaselineSat + extraSat;
        const total = weekday + friSun + sat;

        const isSK = member.sections?.includes('SK') || false;

        // Completion logic: 평 criteriaWeekday, 금일 criteriaFriSun, 토 criteriaSat, or SK section
        const isCompleted = isSK || (weekday >= criteriaWeekday && friSun >= criteriaFriSun && sat >= criteriaSat);

        return {
            member,
            name: member.name,
            rank: member.rank || '대원',
            weekday,
            friSun,
            sat,
            total,
            isCompleted,
            isSK,
            localBaseline
        };
    });

    // Apply search filter
    const filteredStats = memberStats;

    // Apply sorting
    const sortedStats = [...filteredStats].sort((a, b) => {
        if (sortField === 'seniority') {
            const dateA = a.member.enlistmentDate || '';
            const dateB = b.member.enlistmentDate || '';
            if (dateA && dateB) {
                if (dateA !== dateB) {
                    return sortOrder === 'asc' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
                }
            } else if (dateA) {
                return sortOrder === 'asc' ? -1 : 1;
            } else if (dateB) {
                return sortOrder === 'asc' ? 1 : -1;
            }
            return a.name.localeCompare(b.name);
        } else {
            let valA: number = a.total;
            let valB: number = b.total;
            return sortOrder === 'asc' ? valA - valB : valB - valA;
        }
    });

    const activeStats = sortedStats.filter(s => !s.isCompleted);
    const completedStats = sortedStats.filter(s => s.isCompleted);

    const renderMemberCard = ({ member, name, rank, weekday, friSun, sat, total, isCompleted, isSK, localBaseline }: any) => (
        <div 
            key={member.id} 
            style={{ transition: 'all 0.2s ease-in-out' }}
            className={cn(
                "flex flex-col gap-2.5 px-4 py-3.5 bg-white border rounded-2xl transition-all shadow-xs",
                isCompleted 
                    ? "border-green-200 bg-green-50/5 hover:border-green-300 hover:bg-green-50/15" 
                    : "border-gray-100 hover:border-yellow-250 hover:bg-yellow-50/5"
            )}
        >
            {/* Main Info Row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-gray-900">{name}</span>
                    <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">{rank}</span>
                    {isCompleted && (
                        <span className="text-[9px] font-black text-green-600 bg-green-50 px-1.5 py-0.5 rounded border border-green-200 animate-pulse shrink-0">
                            {isSK ? "당직 완료 ✅ (SK)" : "당직 완료 ✅"}
                        </span>
                    )}
                </div>
                
                <div className={cn(
                    "text-xs font-black px-3 py-1 rounded-xl border",
                    isCompleted 
                        ? "text-green-600 bg-green-50 border-green-100/30" 
                        : "text-yellow-600 bg-yellow-50 border-yellow-100/30"
                )}>
                    누적합: <span className={cn("text-sm font-extrabold ml-0.5", isCompleted ? "text-green-700" : "text-yellow-700")}>{total}회</span>
                </div>
            </div>
            
            {/* Breakdown Column or Editable inputs under baseline */}
            <div className="pt-2.5 border-t border-gray-50 flex items-center justify-between text-[10px] font-black text-gray-400">
                <span />
                
                {isBaselineMode ? (
                    /* Manually editable baseline inputs (using type="text" for spinner-free direct typing) */
                    <div className="flex gap-2 items-center">
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-gray-400 font-bold">평당:</span>
                            <input
                                type="text"
                                inputMode="text"
                                value={localBaseline.weekday === 0 ? '' : localBaseline.weekday}
                                placeholder="0"
                                onChange={(e) => {
                                    let raw = e.target.value.replace(/[^0-9-]/g, '');
                                    if (raw.startsWith('-')) {
                                        raw = '-' + raw.substring(1).replace(/-/g, '');
                                    } else {
                                        raw = raw.replace(/-/g, '');
                                    }
                                    setBaselines(prev => ({ ...prev, [member.id]: { ...localBaseline, weekday: raw } }));
                                }}
                                onBlur={() => {
                                    const val = parseInt(String(localBaseline.weekday), 10) || 0;
                                    setBaselines(prev => ({ ...prev, [member.id]: { ...localBaseline, weekday: val } }));
                                    handleSaveBaselineField(member.id, 'baselineWeekday', val);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const val = parseInt(String(localBaseline.weekday), 10) || 0;
                                        setBaselines(prev => ({ ...prev, [member.id]: { ...localBaseline, weekday: val } }));
                                        handleSaveBaselineField(member.id, 'baselineWeekday', val);
                                        (e.target as HTMLInputElement).blur();
                                    }
                                }}
                                style={{ width: '36px' }}
                                className="h-6 text-center bg-gray-50 border border-gray-255 rounded-lg text-xs font-black text-gray-800 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                            />
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-blue-500 font-bold">금일:</span>
                            <input
                                type="text"
                                inputMode="text"
                                value={localBaseline.friSun === 0 ? '' : localBaseline.friSun}
                                placeholder="0"
                                onChange={(e) => {
                                    let raw = e.target.value.replace(/[^0-9-]/g, '');
                                    if (raw.startsWith('-')) {
                                        raw = '-' + raw.substring(1).replace(/-/g, '');
                                    } else {
                                        raw = raw.replace(/-/g, '');
                                    }
                                    setBaselines(prev => ({ ...prev, [member.id]: { ...localBaseline, friSun: raw } }));
                                }}
                                onBlur={() => {
                                    const val = parseInt(String(localBaseline.friSun), 10) || 0;
                                    setBaselines(prev => ({ ...prev, [member.id]: { ...localBaseline, friSun: val } }));
                                    handleSaveBaselineField(member.id, 'baselineFriSun', val);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const val = parseInt(String(localBaseline.friSun), 10) || 0;
                                        setBaselines(prev => ({ ...prev, [member.id]: { ...localBaseline, friSun: val } }));
                                        handleSaveBaselineField(member.id, 'baselineFriSun', val);
                                        (e.target as HTMLInputElement).blur();
                                    }
                                }}
                                style={{ width: '36px' }}
                                className="h-6 text-center bg-gray-50 border border-gray-255 rounded-lg text-xs font-black text-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-red-500 font-bold">토당:</span>
                            <input
                                type="text"
                                inputMode="text"
                                value={localBaseline.sat === 0 ? '' : localBaseline.sat}
                                placeholder="0"
                                onChange={(e) => {
                                    let raw = e.target.value.replace(/[^0-9-]/g, '');
                                    if (raw.startsWith('-')) {
                                        raw = '-' + raw.substring(1).replace(/-/g, '');
                                    } else {
                                        raw = raw.replace(/-/g, '');
                                    }
                                    setBaselines(prev => ({ ...prev, [member.id]: { ...localBaseline, sat: raw } }));
                                }}
                                onBlur={() => {
                                    const val = parseInt(String(localBaseline.sat), 10) || 0;
                                    setBaselines(prev => ({ ...prev, [member.id]: { ...localBaseline, sat: val } }));
                                    handleSaveBaselineField(member.id, 'baselineSat', val);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const val = parseInt(String(localBaseline.sat), 10) || 0;
                                        setBaselines(prev => ({ ...prev, [member.id]: { ...localBaseline, sat: val } }));
                                        handleSaveBaselineField(member.id, 'baselineSat', val);
                                        (e.target as HTMLInputElement).blur();
                                    }
                                }}
                                style={{ width: '36px' }}
                                className="h-6 text-center bg-gray-50 border border-gray-255 rounded-lg text-xs font-black text-red-600 focus:outline-none focus:ring-1 focus:ring-red-500"
                            />
                        </div>
                    </div>
                ) : (
                    /* Cumulative Readonly Displays */
                    <div className="flex gap-3 text-gray-500 font-bold text-xs select-none">
                        <span>
                            평: <span className={cn("font-extrabold", weekday >= 13 ? "text-green-600" : "text-gray-700")}>{weekday}</span>
                        </span>
                        <span className={friSun >= 9 ? "text-green-600" : "text-blue-500"}>
                            금일: <span className={cn("font-extrabold", friSun >= 9 ? "text-green-600" : "text-blue-600")}>{friSun}</span>
                        </span>
                        <span className={sat >= 6 ? "text-green-600" : "text-red-500"}>
                            토당: <span className={cn("font-extrabold", sat >= 6 ? "text-green-600" : "text-red-600")}>{sat}</span>
                        </span>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(
        <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-4 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[85vh] flex flex-col">
                
                {/* Header */}
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">📊 당직 횟수 트래커</h2>
                    </div>
                    <button onClick={onClose} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                {/* Month Switcher Header Capsule */}
                <div className="flex items-center justify-between bg-gray-50 p-2 rounded-2xl border border-gray-100 shrink-0 select-none">
                    <button
                        onClick={handlePrevMonth}
                        disabled={selectedMonthIndex === 0}
                        className="p-2 bg-white border border-gray-150 rounded-xl hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-white text-gray-500 active:scale-95 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs sm:text-sm font-black text-gray-800 tracking-tight bg-white px-4 py-1.5 rounded-xl border border-gray-150 shadow-xs min-w-[140px] text-center">
                        {MONTH_LABELS[selectedMonthIndex].label}
                    </span>
                    <button
                        onClick={handleNextMonth}
                        disabled={selectedMonthIndex === MONTH_LABELS.length - 1}
                        className="p-2 bg-white border border-gray-150 rounded-xl hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-white text-gray-500 active:scale-95 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                {/* Members List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 pr-1 min-h-0">
                    {/* Active (Uncompleted) Members */}
                    {activeStats.map(stat => renderMemberCard(stat))}

                    {/* Completed Members with Expandable / Fold Section */}
                    {completedStats.length > 0 && (
                        <div className="space-y-2.5 pt-1">
                            <button 
                                onClick={() => setShowCompleted(!showCompleted)}
                                className="w-full py-2.5 bg-green-50 hover:bg-green-100/70 border border-green-200/50 rounded-2xl flex items-center justify-center gap-2 text-xs font-black text-green-700 transition-all active:scale-[0.99] cursor-pointer"
                            >
                                <span>✅ 당직 완료 대원 {showCompleted ? "접기" : "보기"} ({completedStats.length}명)</span>
                                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", showCompleted && "rotate-180")} />
                            </button>

                            {showCompleted && completedStats.map(stat => renderMemberCard(stat))}
                        </div>
                    )}

                    {sortedStats.length === 0 && (
                        <div className="text-center py-8 text-xs text-gray-400 font-bold italic">
                            검색 결과가 없습니다.
                        </div>
                    )}
                </div>

                {/* Collapsible criteria settings */}
                {showCriteriaSettings ? (
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3 animate-in slide-in-from-bottom-2 shrink-0 select-none">
                        <h3 className="text-xs font-black text-gray-800">⚙️ 당직 완료 기준 설정</h3>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="flex flex-col gap-1">
                                <span className="text-[9px] text-gray-500 font-bold ml-1">평당 기준</span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={criteriaWeekday}
                                    onChange={(e) => {
                                        const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                        handleSaveCriteria(val, criteriaFriSun, criteriaSat);
                                    }}
                                    className="h-9 px-3 bg-white border border-gray-205 rounded-xl text-center text-xs font-black focus:outline-none focus:ring-1 focus:ring-yellow-500"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-[9px] text-blue-500 font-bold ml-1">금일 기준</span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={criteriaFriSun}
                                    onChange={(e) => {
                                        const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                        handleSaveCriteria(criteriaWeekday, val, criteriaSat);
                                    }}
                                    className="h-9 px-3 bg-white border border-gray-205 rounded-xl text-center text-xs font-black focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-[9px] text-red-500 font-bold ml-1">토당 기준</span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={criteriaSat}
                                    onChange={(e) => {
                                        const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                        handleSaveCriteria(criteriaWeekday, criteriaFriSun, val);
                                    }}
                                    className="h-9 px-3 bg-white border border-gray-205 rounded-xl text-center text-xs font-black focus:outline-none focus:ring-1 focus:ring-red-500"
                                />
                            </div>
                        </div>
                        <button
                            onClick={() => setShowCriteriaSettings(false)}
                            className="w-full py-2 bg-gray-200 hover:bg-gray-300 rounded-xl text-[10px] font-black text-gray-700 transition-colors"
                        >
                            닫기
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowCriteriaSettings(true)}
                        className="w-full py-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200/50 rounded-2xl flex items-center justify-center gap-1.5 text-xs font-black text-gray-500 transition-all cursor-pointer shrink-0"
                    >
                        ⚙️ 당직 완료 기준 설정
                    </button>
                )}
            </div>
        </div>,
        document.body
    );
}
