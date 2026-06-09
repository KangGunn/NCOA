import { Trash2 } from 'lucide-react';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

interface DutyCalendarGridProps {
    calendarDays: { dayNumber: number; dateStr: string; isCurrentMonth: boolean }[];
    members: CalendarMember[];
    events: CalendarEvent[];
    currentMonthDuties: CalendarEvent[];
    personalRestrictions: Record<string, string[]>;
    ktaDayLabels: Record<number, string>;
    blcDayLabels: Record<number, string>;
    monthlyDayLabels?: Record<string, string>;
    getHolidayForDate: (dateStr: string) => any;
    getKtaBlcEventsForDate: (dateStr: string) => CalendarEvent[];
    getDutyForDate: (dateStr: string) => CalendarEvent | undefined;
    isMemberEligibleForDuty: (member: CalendarMember, dateStr: string) => boolean;
    handleCellClick: (dateStr: string, directMemberName?: string) => void;
    handleClearDate: (e: React.MouseEvent, id: string) => void;
    togglePersonalRestriction: (dateStr: string, memberName: string) => void;
    dutyHolidays: any[];
}

export function DutyCalendarGrid({
    calendarDays, members, events,
    personalRestrictions, ktaDayLabels, blcDayLabels, monthlyDayLabels,
    getHolidayForDate, getKtaBlcEventsForDate, getDutyForDate,
    isMemberEligibleForDuty, handleCellClick, handleClearDate, togglePersonalRestriction,
    dutyHolidays
}: DutyCalendarGridProps) {
    const getPrevDateStr = (dateStr: string) => {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const getDutyType = (dateStr: string): 'weekday' | 'friSun' | 'sat' => {
        // 1. 연휴 시작 전날 -> 금일당 ('friSun')
        const isDayBeforeHolidayStart = dutyHolidays.some(h => dateStr === getPrevDateStr(h.startDate));
        if (isDayBeforeHolidayStart) {
            return 'friSun';
        }

        // 2. 연휴 마지막 날 -> 금일당 ('friSun')
        const isHolidayLastDay = dutyHolidays.some(h => dateStr === h.endDate);
        if (isHolidayLastDay) {
            return 'friSun';
        }

        // 3. 연휴 그 사이 -> 토당 ('sat')
        const isHolidayBetween = dutyHolidays.some(h => dateStr >= h.startDate && dateStr < h.endDate);
        if (isHolidayBetween) {
            return 'sat';
        }
        
        // 4. 일반적인 주말 및 금요일 판단
        const d = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = d.getDay(); // 0: Sun, 5: Fri, 6: Sat
        
        if (dayOfWeek === 6) {
            return 'sat'; // 토요일 -> 토당
        }
        if (dayOfWeek === 0 || dayOfWeek === 5) {
            return 'friSun'; // 금요일, 일요일 -> 금일당
        }
        
        // 5. 일반 평일 -> 평당 ('weekday')
        return 'weekday';
    };

    return (
        <div className="flex-1 min-h-0 grid grid-cols-7 bg-slate-950/20 w-full h-full relative auto-rows-fr">
            {calendarDays.map((cell) => {
                const duty = getDutyForDate(cell.dateStr);
                const holiday = getHolidayForDate(cell.dateStr);
                const ktaBlcEvents = getKtaBlcEventsForDate(cell.dateStr);
                const dutyType = getDutyType(cell.dateStr);
                
                let eligibleMembers: CalendarMember[] = [];
                let personalRestrictedNames: string[] = [];
                
                if (cell.isCurrentMonth) {
                    eligibleMembers = members.filter(m => isMemberEligibleForDuty(m, cell.dateStr));
                    personalRestrictedNames = personalRestrictions[cell.dateStr] || [];
                }

                const parseLocalDate = (dateStr: string) => {
                    const [y, m, d] = dateStr.split('-').map(Number);
                    return new Date(y, m - 1, d);
                };

                const getBlcActiveDay = (day0DateStr: string, targetDateStr: string) => {
                    const start = parseLocalDate(day0DateStr);
                    const target = parseLocalDate(targetDateStr);

                    if (start.getTime() === target.getTime()) return 0;

                    if (target > start) {
                        let dayCount = 0;
                        let current = new Date(start);
                        while (current < target) {
                            current.setDate(current.getDate() + 1);
                            if (dayCount < 22) {
                                const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                                const isSunday = current.getDay() === 0;
                                const isHoliday = events.some((e: CalendarEvent) => e.type === 'holiday' && currentStr >= e.startDate && currentStr <= e.endDate);
                                if (!isSunday && !isHoliday) {
                                    dayCount++;
                                }
                            } else {
                                dayCount++;
                            }
                        }
                        return dayCount;
                    } else {
                        let dayCount = 0;
                        let current = new Date(start);
                        while (current > target) {
                            current.setDate(current.getDate() - 1);
                            if (dayCount <= 22) {
                                const nextStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                                const nextSunday = current.getDay() === 0;
                                const isHoliday = events.some((e: CalendarEvent) => e.type === 'holiday' && nextStr >= e.startDate && nextStr <= e.endDate);
                                if (!nextSunday && !isHoliday) {
                                    dayCount--;
                                }
                            } else {
                                dayCount--;
                            }
                        }
                        return dayCount;
                    }
                };

                const customKtaBadges: { id: string; label: string }[] = [];
                const ktaDay0s = events.filter(e => e.type === 'kta' && e.memo?.includes('Day 0'));
                ktaDay0s.forEach(e => {
                    const startKta = parseLocalDate(e.startDate);
                    const currentDay = parseLocalDate(cell.dateStr);
                    const diffTime = currentDay.getTime() - startKta.getTime();
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                    const customLabel = ktaDayLabels[diffDays];
                    if (customLabel) {
                        customKtaBadges.push({
                            id: `kta-cust-${e.id}-${diffDays}`,
                            label: `K-${customLabel}`
                        });
                    }
                });

                const customBlcBadges: { id: string; label: string }[] = [];
                const blcDay0s = events.filter(e => e.type === 'blc' && e.memo?.includes('Day 0'));
                blcDay0s.forEach(day0 => {
                    const diffDays = getBlcActiveDay(day0.startDate, cell.dateStr);
                    const customLabel = blcDayLabels[diffDays];
                    if (customLabel) {
                        customBlcBadges.push({
                            id: `blc-cust-${day0.id}-${diffDays}`,
                            label: `B-${customLabel}`
                        });
                    }
                });

                return (
                    <div 
                        key={cell.dateStr} 
                        onClick={() => handleCellClick(cell.dateStr)}
                        className={`border-r border-b border-slate-850 p-1.5 flex flex-col justify-between select-none relative transition-all group overflow-hidden ${
                            cell.isCurrentMonth 
                                ? 'bg-slate-900/10 hover:bg-slate-800/40 cursor-crosshair' 
                                : 'bg-slate-950/40 text-slate-700 pointer-events-none'
                        }`}
                    >
                        <div className="flex justify-between items-center shrink-0 w-full gap-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`text-[11px] font-black tracking-tight shrink-0 ${
                                    cell.isCurrentMonth
                                        ? dutyType === 'sat'
                                            ? 'text-rose-500 font-black' 
                                            : dutyType === 'friSun'
                                                ? 'text-sky-500 font-black' 
                                                : 'text-slate-100 font-extrabold'
                                        : 'text-slate-700'
                                 }`}>
                                    {cell.dayNumber}
                                </span>
                                {/* Monthly Custom Day Label (Green Badge) immediately to the right of the date */}
                                {monthlyDayLabels?.[cell.dateStr] && cell.isCurrentMonth && (
                                    <span className="text-[8.5px] font-black bg-emerald-950 text-emerald-400 border border-emerald-900/50 rounded px-1.5 py-0.5 leading-none shrink-0 whitespace-nowrap truncate max-w-[120px]" title={monthlyDayLabels[cell.dateStr]}>
                                        {monthlyDayLabels[cell.dateStr]}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center justify-end gap-1 min-w-0 overflow-hidden select-none">
                                {/* BLC / KTA Badges */}
                                {ktaBlcEvents.map(e => {
                                    const isBlc = e.type === 'blc';
                                    const isGraduation = e.memo?.includes('Graduation') || e.memo?.includes('수료') || e.memo?.includes('🎓');
                                    let label = isGraduation ? 'Grad' : (e.memo?.match(/Day \d+/)?.[0] || '');
                                    
                                    const isDay0OrGrad = e.memo?.includes('Day 0') || isGraduation;
                                    let batchSuffix = (isDay0OrGrad && e.batch) ? `(${e.batch})` : '';

                                    if (!label) return null;

                                    const badgeBg = isBlc
                                        ? 'bg-indigo-950/80 text-indigo-400 border border-indigo-900/35' 
                                        : 'bg-rose-950/80 text-rose-400 border border-rose-900/35';

                                    return (
                                        <span 
                                            key={e.id}
                                            className={`text-[8.5px] font-black px-1.5 py-0.5 rounded leading-none shrink-0 whitespace-nowrap ${badgeBg}`}
                                            title={e.memo}
                                        >
                                            {isBlc ? 'B' : 'K'}-{label}{batchSuffix}
                                        </span>
                                    );
                                })}
                                {customKtaBadges.map(b => (
                                    <span 
                                        key={b.id}
                                        className="text-[8.5px] font-black px-1.5 py-0.5 rounded leading-none shrink-0 whitespace-nowrap bg-rose-950/80 text-rose-400 border border-rose-900/35"
                                    >
                                        {b.label}
                                    </span>
                                ))}
                                {customBlcBadges.map(b => (
                                    <span 
                                        key={b.id}
                                        className="text-[8.5px] font-black px-1.5 py-0.5 rounded leading-none shrink-0 whitespace-nowrap bg-indigo-950/80 text-indigo-400 border border-indigo-900/35"
                                    >
                                        {b.label}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 mt-1 pt-1 border-t border-slate-800/40 flex flex-col gap-0.5 w-full overflow-hidden">
                            {duty ? (
                                <div className="w-full flex items-center justify-between p-1 bg-slate-900 border border-slate-800 rounded-lg hover:border-slate-700 transition-all shadow-md shrink-0">
                                    <div className="flex flex-col gap-0.5 min-w-0">
                                        <span className="text-[10px] font-black text-slate-200 truncate pr-1">
                                            {duty.memo}
                                        </span>
                                        <span className="text-[8px] font-bold text-slate-500">
                                            {members.find((m: CalendarMember) => m.name === duty.memo)?.rank || '대원'}
                                        </span>
                                    </div>
                                    <button
                                        onClick={(e) => handleClearDate(e, duty.id)}
                                        className="p-0.5 hover:bg-slate-800 hover:text-red-400 rounded text-slate-500 transition-all shrink-0 opacity-0 group-hover:opacity-100"
                                        title="당직자 삭제"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            ) : (
                                cell.isCurrentMonth && (
                                    <div 
                                        className="flex-1 overflow-y-auto no-scrollbar flex flex-wrap gap-0.5 content-start w-full pt-0.5"
                                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                                    >
                                        <style>{`
                                            .no-scrollbar::-webkit-scrollbar {
                                                display: none;
                                            }
                                        `}</style>
                                        {eligibleMembers.length === 0 ? (
                                            <span className="text-[8px] font-bold text-rose-500/70 py-0.5">🚫 가능 인원 없음</span>
                                        ) : (
                                            eligibleMembers.map(member => {
                                                const isRestricted = personalRestrictedNames.includes(member.name);
                                                return (
                                                    <button
                                                        key={member.id}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleCellClick(cell.dateStr, member.name);
                                                        }}
                                                        className={`px-1.5 py-0.5 rounded text-[8.5px] font-black transition-all text-center shrink-0 cursor-pointer border ${
                                                            isRestricted 
                                                                ? 'bg-red-950/20 border-red-900/30 text-red-450 line-through opacity-55 hover:bg-red-900/20'
                                                                : 'bg-slate-900/60 border-slate-800/80 text-slate-350 hover:bg-indigo-650 hover:border-indigo-500 hover:text-white'
                                                        }`}
                                                    >
                                                        {member.name}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                )
                            )}

                            {cell.isCurrentMonth && personalRestrictedNames.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5 shrink-0">
                                    {personalRestrictedNames.map(name => (
                                        <button
                                            key={name}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                togglePersonalRestriction(cell.dateStr, name);
                                            }}
                                            className="px-1 py-0.5 bg-red-950/40 hover:bg-red-900/30 border border-red-500/20 text-red-300 text-[7.5px] rounded font-black flex items-center gap-0.5 shrink-0 transition-all hover:scale-[1.02] cursor-pointer"
                                            title="클릭 시 제한 해제"
                                        >
                                            🚫 {name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
