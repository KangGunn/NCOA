import { Trash2 } from 'lucide-react';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';
import { calculateRank } from '../../lib/rankUtils';

interface DutyCalendarGridProps {
    calendarDays: { dayNumber: number; dateStr: string; isCurrentMonth: boolean }[];
    members: CalendarMember[];
    events: CalendarEvent[];
    currentMonthDuties: CalendarEvent[];
    ktaDayLabels: Record<number, string>;
    blcDayLabels: Record<number, string>;
    monthlyDayLabels?: Record<string, string>;
    currentDate: Date;

    getKtaBlcEventsForDate: (dateStr: string) => CalendarEvent[];
    getDutyForDate: (dateStr: string) => CalendarEvent | undefined;
    isMemberEligibleForDuty: (member: CalendarMember) => boolean;
    getMemberDutyRestrictionReason: (member: CalendarMember, dateStr: string) => string | null;
    handleCellClick: (dateStr: string, directMemberName?: string) => void;
    handleClearDate: (e: React.MouseEvent, id: string) => void;
    togglePersonalRestriction: (dateStr: string, memberName: string) => void;
    dutyHolidays: any[];
    selectedMember: CalendarMember | null;
}

export function DutyCalendarGrid({
    calendarDays, members, events,
    ktaDayLabels, blcDayLabels, monthlyDayLabels, currentDate,
    getKtaBlcEventsForDate, getDutyForDate,
    isMemberEligibleForDuty, getMemberDutyRestrictionReason, handleCellClick, handleClearDate, togglePersonalRestriction,
    dutyHolidays, selectedMember
}: DutyCalendarGridProps) {
    const getOffsetDateStr = (dateStr: string, offset: number) => {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + offset);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const getPrevDateStr = (dateStr: string) => getOffsetDateStr(dateStr, -1);

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

    const isDateDuringKtaPeriod = (dateStr: string, allEvents: CalendarEvent[]): boolean => {
        const ktaDay0s = allEvents.filter(e => e.type === 'kta' && e.memo?.includes('Day 0'));
        const ktaGrads = allEvents.filter(e => e.type === 'kta' && (
            e.memo?.includes('Graduation') || e.memo?.includes('수료') || e.memo?.includes('🎓')
        ));
        return ktaDay0s.some(day0 => {
            const grad = ktaGrads.find(g => {
                if (day0.batch && g.batch) return g.batch === day0.batch && g.startDate >= day0.startDate;
                const d0t = new Date(day0.startDate + 'T00:00:00').getTime();
                const gt = new Date(g.startDate + 'T00:00:00').getTime();
                return gt >= d0t && (gt - d0t) <= 30 * 24 * 60 * 60 * 1000;
            });
            if (grad) return dateStr >= day0.startDate && dateStr <= grad.startDate;
            return false;
        });
    };

    const getDutyTypeForMember = (dateStr: string, member: CalendarMember): 'weekday' | 'friSun' | 'sat' => {
        const isKtaOrMedic = member.sections?.includes('KTA') || member.sections?.includes('MEDIC');
        if (isKtaOrMedic && isDateDuringKtaPeriod(dateStr, events)) {
            const d = new Date(dateStr + 'T00:00:00');
            const dayOfWeek = d.getDay(); // 0: Sun, 5: Fri, 6: Sat
            if (dayOfWeek === 6) return 'sat';
            if (dayOfWeek === 0 || dayOfWeek === 5) return 'friSun';
            return 'weekday';
        }
        return getDutyType(dateStr);
    };

    return (
        <div className="flex-1 min-h-0 grid grid-cols-7 bg-slate-950/20 w-full h-full relative auto-rows-fr">
            {calendarDays.map((cell) => {
                const duty = getDutyForDate(cell.dateStr);
                const ktaBlcEvents = getKtaBlcEventsForDate(cell.dateStr);
                
                // If a member is selected, determine the duty type from their perspective
                const currentDutyType = selectedMember && cell.isCurrentMonth
                    ? getDutyTypeForMember(cell.dateStr, selectedMember)
                    : getDutyType(cell.dateStr);

                let highlightClass = "";
                if (selectedMember && cell.isCurrentMonth) {
                    const restrictionReason = getMemberDutyRestrictionReason(selectedMember, cell.dateStr);
                    if (restrictionReason) {
                        highlightClass = "opacity-40 bg-slate-950/60";
                    } else {
                        if (currentDutyType === 'weekday') {
                            highlightClass = "bg-amber-950/30 border-amber-500/50 hover:bg-amber-900/40 ring-1 ring-amber-500/20";
                        } else if (currentDutyType === 'friSun') {
                            highlightClass = "bg-sky-950/35 border-sky-500/50 hover:bg-sky-900/40 ring-1 ring-sky-500/20";
                        } else if (currentDutyType === 'sat') {
                            highlightClass = "bg-rose-950/30 border-rose-500/50 hover:bg-rose-900/40 ring-1 ring-rose-500/20";
                        }
                    }
                }
                
                let eligibleMembers: CalendarMember[] = [];
                
                if (cell.isCurrentMonth) {
                    eligibleMembers = members.filter(m => {
                        if (m.joinDate && cell.dateStr < m.joinDate) return false;
                        return isMemberEligibleForDuty(m);
                    });
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
                                const isHoliday = events.some((e: CalendarEvent) => e.type === 'holiday' && e.holidayType !== 'duty' && currentStr >= e.startDate && currentStr <= e.endDate);
                                if (!isSunday && !isHoliday) {
                                    dayCount++;
                                }
                            } else {
                                dayCount++;
                            }
                        }
                        return dayCount;
                    } else {
                        // 입소일(Day 0) 이전의 날짜는 단순 달력 일수 차이(음수)로 계산합니다.
                        // 입소 전이기 때문에 주말/공휴일 제외 규칙을 적용하지 않습니다.
                        const diffTime = target.getTime() - start.getTime();
                        return Math.round(diffTime / (1000 * 60 * 60 * 24));
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
                            label: customLabel
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
                            label: customLabel
                        });
                    }
                });

                return (
                    <div 
                        key={cell.dateStr} 
                        onClick={() => handleCellClick(cell.dateStr)}
                        className={`border-r border-b border-slate-850 p-1.5 flex flex-col justify-between select-none relative transition-all group overflow-hidden ${
                            cell.isCurrentMonth 
                                ? highlightClass 
                                    ? `${highlightClass} cursor-crosshair`
                                    : 'bg-slate-900/10 hover:bg-slate-800/40 cursor-crosshair' 
                                : 'bg-slate-950/40 text-slate-700 pointer-events-none'
                        }`}
                    >
                        <div className="flex justify-between items-center shrink-0 w-full gap-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`text-[11px] font-black tracking-tight shrink-0 ${
                                    cell.isCurrentMonth
                                        ? currentDutyType === 'sat'
                                            ? 'text-rose-500 font-black' 
                                            : currentDutyType === 'friSun'
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
                                            {label}{batchSuffix}
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
                                            {(() => {
                                                const m = members.find((member: CalendarMember) => member.name === duty.memo);
                                                if (!m) return '대원';
                                                return m.role === 'runner'
                                                    ? (m.rank || '러너')
                                                    : (m.enlistmentDate
                                                        ? calculateRank(new Date(m.enlistmentDate), m.earlyPromotion || 0, currentDate)
                                                        : (m.rank || '대원'));
                                            })()}
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
                                                const reason = getMemberDutyRestrictionReason(member, cell.dateStr);
                                                const isDisabled = !!reason;
                                                
                                                let btnClassName = "";
                                                let titleText = "";
                                                if (isDisabled) {
                                                    if (reason === '개인 사정 불가') {
                                                        btnClassName = "bg-red-950/20 border-red-900/30 text-red-450 line-through opacity-55 hover:bg-red-900/20 cursor-not-allowed";
                                                    } else if (reason === '개인: 앞뒤 이틀 내 당직 있음' || reason === '같은 섹션: 연달아 당직 불가') {
                                                        btnClassName = "bg-amber-950/20 border-amber-900/30 text-amber-500 line-through opacity-55 cursor-not-allowed";
                                                    } else {
                                                        btnClassName = "bg-slate-900/20 border-slate-850 text-slate-600 line-through opacity-50 cursor-not-allowed";
                                                    }
                                                    
                                                    if (reason === '신병보호기간') {
                                                        titleText = reason;
                                                    } else {
                                                        titleText = `${reason} (우클릭 시 개인 제한 토글)`;
                                                    }
                                                } else {
                                                    btnClassName = "bg-slate-900/60 border-slate-800/80 text-slate-350 hover:bg-indigo-650 hover:border-indigo-500 hover:text-white cursor-pointer";
                                                    titleText = "배정하기 (우클릭 시 개인 제한 토글)";
                                                }

                                                return (
                                                    <button
                                                        key={member.id}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (isDisabled) return;
                                                            handleCellClick(cell.dateStr, member.name);
                                                        }}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            if (reason === '신병보호기간') return;
                                                            togglePersonalRestriction(cell.dateStr, member.name);
                                                        }}
                                                        className={`px-1.5 py-0.5 rounded text-[8.5px] font-black transition-all text-center shrink-0 border ${btnClassName}`}
                                                        title={titleText}
                                                    >
                                                        {member.name}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                )
                             )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
