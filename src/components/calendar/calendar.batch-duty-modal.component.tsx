import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

interface BatchDutyModalProps {
    isBatchDutyAdding: boolean;
    setIsBatchDutyAdding: (val: boolean) => void;
    currentDate: Date;
    members: CalendarMember[];
    dutyHistory: string[];
    setDutyHistory: React.Dispatch<React.SetStateAction<string[]>>;
    handleBatchSaveDuties: () => void;
    isBatchSaving: boolean;
    events: CalendarEvent[];
}

export function BatchDutyModal({
    isBatchDutyAdding,
    setIsBatchDutyAdding,
    currentDate,
    members,
    dutyHistory,
    setDutyHistory,
    handleBatchSaveDuties,
    isBatchSaving,
    events
}: BatchDutyModalProps) {
    if (!isBatchDutyAdding) return null;

    const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

    // Load criteria values from localStorage
    const criteriaWeekday = (() => {
        const saved = localStorage.getItem('ncoa_criteria_weekday');
        return saved ? parseInt(saved, 10) : 13;
    })();
    const criteriaFriSun = (() => {
        const saved = localStorage.getItem('ncoa_criteria_frisun');
        return saved ? parseInt(saved, 10) : 9;
    })();
    const criteriaSat = (() => {
        const saved = localStorage.getItem('ncoa_criteria_sat');
        return saved ? parseInt(saved, 10) : 6;
    })();

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

    const checkIfCompletedBefore = (member: CalendarMember) => {
        const isSK = member.sections?.includes('SK') || false;
        if (isSK) return true;

        const baselineWeekday = member.baselineWeekday || 0;
        const baselineFriSun = member.baselineFriSun || 0;
        const baselineSat = member.baselineSat || 0;

        let extraWeekday = 0;
        let extraFriSun = 0;
        let extraSat = 0;

        const prevMonthLimit = currentDate.getMonth(); // 1-indexed prev month limit
        const memberDuties = events.filter(e => e.type === 'duty' && e.memo === member.name && e.startDate.startsWith('2026-'));
        
        memberDuties.forEach(d => {
            const parts = d.startDate.split('-');
            const eventMonth = parseInt(parts[1], 10);
            const eventYear = parseInt(parts[0], 10);

            if (eventYear === 2026 && eventMonth >= 4 && eventMonth <= prevMonthLimit) {
                const type = getDutyType(d.startDate);
                if (type === 'weekday') extraWeekday++;
                else if (type === 'friSun') extraFriSun++;
                else if (type === 'sat') extraSat++;
            }
        });

        const totalWeekday = baselineWeekday + extraWeekday;
        const totalFriSun = baselineFriSun + extraFriSun;
        const totalSat = baselineSat + extraSat;

        return totalWeekday >= criteriaWeekday && totalFriSun >= criteriaFriSun && totalSat >= criteriaSat;
    };

    const activeSelectionMembers = members.filter(m => {
        if (m.role === 'runner') return true;
        return !checkIfCompletedBefore(m);
    });

    const handleNameClick = (name: string) => {
        const totalDays = daysInMonth(currentDate.getFullYear(), currentDate.getMonth());
        if (dutyHistory.length < totalDays) {
            setDutyHistory(prev => [...prev, name]);
        }
    };

    const handleUndo = () => {
        setDutyHistory(prev => prev.slice(0, -1));
    };

    return createPortal(
        <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-5 shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-2xl font-black text-gray-900">{currentDate.getMonth() + 1}월 당직 등록</h2>
                        <p className="text-xs text-gray-500 font-bold mt-1">부대원 이름을 연속해서 눌러 당직을 채워보세요.</p>
                    </div>
                    <button onClick={() => setIsBatchDutyAdding(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <div className="grid grid-cols-5 gap-1.5 shrink-0 py-2 border-b border-gray-100">
                    {activeSelectionMembers.map(m => (
                        <button
                            key={m.id}
                            onClick={() => handleNameClick(m.name)}
                            className="py-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200 rounded-xl text-[11px] font-black transition-colors truncate px-1"
                            title={m.name}
                        >
                            {m.name}
                        </button>
                    ))}
                    <button
                        onClick={() => handleNameClick('')}
                        className="py-2.5 bg-gray-100 text-gray-500 hover:bg-gray-200 active:bg-gray-300 rounded-xl text-[11px] font-black transition-colors"
                    >
                        비우기
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 min-h-[150px] custom-scrollbar py-2">
                    <div className="grid grid-cols-5 gap-2">
                        {Array.from({ length: daysInMonth(currentDate.getFullYear(), currentDate.getMonth()) }, (_, i) => i + 1).map(day => {
                            const assignedTo = dutyHistory[day - 1];
                            const isNext = dutyHistory.length === day - 1;
                            return (
                                <div key={day} className={cn(
                                    "flex flex-col items-center justify-center p-1 rounded-xl border-2 transition-all",
                                    assignedTo ? "border-yellow-200 bg-yellow-50" :
                                        isNext ? "border-blue-400 bg-blue-50 shadow-inner scale-105" : "border-gray-50 bg-gray-50/50 opacity-50"
                                )}>
                                    <span className="text-[9px] font-black text-gray-400 mb-0.5">{day}일</span>
                                    <span className={cn(
                                        "text-[10px] font-black truncate max-w-full w-full text-center px-0.5",
                                        assignedTo ? "text-yellow-700" : "text-transparent"
                                    )}>
                                        {assignedTo || '-'}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div className="pt-2 shrink-0 flex gap-2">
                    <button
                        onClick={handleUndo}
                        disabled={dutyHistory.length === 0}
                        className="px-6 py-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-[1.5rem] font-black text-lg shadow-sm active:scale-95 transition-all outline-none disabled:opacity-50"
                    >
                        실행 취소
                    </button>
                    <button
                        onClick={handleBatchSaveDuties}
                        disabled={isBatchSaving}
                        className={cn(
                            "flex-1 py-4 rounded-[1.5rem] font-black text-lg transition-all outline-none",
                            isBatchSaving
                                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                : "bg-yellow-500 hover:bg-yellow-600 text-white shadow-xl shadow-yellow-100 active:scale-95"
                        )}
                    >
                        {isBatchSaving ? '저장 중...' : '당직 일괄 저장'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
