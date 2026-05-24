import { cn } from '../../lib/utils';
import type { CalendarEvent } from '../../types/calendar/calendar.type';

interface CalendarDate {
    d: number;
    m: number;
    y: number;
    isCurrentMonth: boolean;
    dateStr: string;
}

interface CalendarGridProps {
    currentDate: Date;
    baseDate?: Date;
    events: CalendarEvent[];
    onDateClick: (dateStr: string) => void;
    ktaDayLabels?: Record<number, string>;
    blcDayLabels?: Record<number, string>;
}

export function CalendarGrid({ currentDate, baseDate, events, onDateClick }: CalendarGridProps) {
    const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

    const isHolidayDate = (dateStr: string) => {
        return events.some(e => e.type === 'holiday' && dateStr >= e.startDate && dateStr <= e.endDate);
    };

    const isDateInRange = (dateStr: string, start: string, end: string) => {
        return dateStr >= start && dateStr <= end;
    };

    const getEventsForDate = (dateStr: string) => {
        const baseEvents = events.filter(e => isDateInRange(dateStr, e.startDate, e.endDate));
        const blcDay0s = events.filter(e => e.type === 'blc' && e.memo?.includes('Day 0'));
        const dynamicBlcEvents: CalendarEvent[] = [];

        blcDay0s.forEach(day0 => {
            const start = new Date(day0.startDate);
            const batch = day0.batch || "";
            let dayCount = 0;
            let current = new Date(start);

            while (dayCount < 22) {
                current.setDate(current.getDate() + 1);
                const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                const isSunday = current.getDay() === 0;

                if (!isSunday && !isHolidayDate(currentStr)) {
                    dayCount++;
                    if (currentStr === dateStr) {
                        dynamicBlcEvents.push({
                            id: `dynamic-blc-${batch}-${dayCount}`,
                            type: 'blc',
                            startDate: currentStr,
                            endDate: currentStr,
                            memo: dayCount === 22 ? `Graduation (${batch})` : `Day ${dayCount} (${batch})`,
                            batch: batch
                        });
                    }
                }
            }
        });

        const finalEvents = [
            ...baseEvents.filter(e => !(e.type === 'blc' && !e.memo?.includes('Day 0'))),
            ...dynamicBlcEvents
        ];

        return finalEvents;
    };

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);

    const allDates: CalendarDate[] = [];

    const prevMonthDate = new Date(year, month, 0);
    const prevMonthYear = prevMonthDate.getFullYear();
    const prevMonthMonth = prevMonthDate.getMonth();
    const prevMonthLastDate = prevMonthDate.getDate();
    for (let i = startDay - 1; i >= 0; i--) {
        const d = prevMonthLastDate - i;
        allDates.push({ d, m: prevMonthMonth, y: prevMonthYear, isCurrentMonth: false, dateStr: `${prevMonthYear}-${String(prevMonthMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    for (let d = 1; d <= totalDays; d++) {
        allDates.push({ d, m: month, y: year, isCurrentMonth: true, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    const nextMonthDate = new Date(year, month + 1, 1);
    const nextMonthYear = nextMonthDate.getFullYear();
    const nextMonthMonth = nextMonthDate.getMonth();
    const remainingCells = allDates.length % 7 === 0 ? 0 : 7 - (allDates.length % 7);
    for (let d = 1; d <= remainingCells; d++) {
        allDates.push({ d, m: nextMonthMonth, y: nextMonthYear, isCurrentMonth: false, dateStr: `${nextMonthYear}-${String(nextMonthMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    const weeks: CalendarDate[][] = [];
    for (let i = 0; i < allDates.length; i += 7) {
        weeks.push(allDates.slice(i, i + 7));
    }

    const eventStyle = (type: string) => {
        switch (type) {
            case 'duty': return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
            case 'kta': return { bg: 'bg-red-100', text: 'text-red-700' };
            case 'blc': return { bg: 'bg-blue-100', text: 'text-blue-700' };
            case 'holiday': return { bg: 'bg-purple-100', text: 'text-purple-700' };
            default: return { bg: 'bg-gray-100', text: 'text-gray-700' };
        }
    };

    const computeWeekEvents = (week: CalendarDate[]) => {
        const weekStart = week[0].dateStr;
        const weekEnd = week[6].dateStr;
        const seen = new Set<string>();
        const weekEvents: { event: CalendarEvent; startCol: number; endCol: number }[] = [];

        for (let col = 0; col < 7; col++) {
            const dateEvents = getEventsForDate(week[col].dateStr);
            for (const ev of dateEvents) {
                if (seen.has(ev.id)) continue;
                seen.add(ev.id);
                const evStart = ev.startDate < weekStart ? weekStart : ev.startDate;
                const evEnd = ev.endDate > weekEnd ? weekEnd : ev.endDate;
                const startCol = week.findIndex(d => d.dateStr >= evStart);
                const endCol = week.findIndex(d => d.dateStr >= evEnd);
                if (startCol !== -1 && endCol !== -1) {
                    weekEvents.push({ event: ev, startCol, endCol });
                }
            }
        }

        const order = { duty: 1, blc: 2, holiday: 2, kta: 3 };
        weekEvents.sort((a, b) => (order[a.event.type as keyof typeof order] || 0) - (order[b.event.type as keyof typeof order] || 0));

        const lanes: { event: CalendarEvent; startCol: number; endCol: number }[][] = [];
        for (const we of weekEvents) {
            let placed = false;
            for (const lane of lanes) {
                const overlaps = lane.some(item => !(we.endCol < item.startCol || we.startCol > item.endCol));
                if (!overlaps) {
                    lane.push(we);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                lanes.push([we]);
            }
        }
        return lanes;
    };

    const ROW_HEIGHT = 16;
    const ROW_GAP = 2;
    const DATE_HEADER = 28;

    return (
        <div className="bg-white rounded-[2.5rem] border-2 border-gray-50 p-4 shadow-sm overflow-hidden">
            <div className="grid grid-cols-7 mb-2">
                {['일', '월', '화', '수', '목', '금', '토'].map((day, i) => (
                    <div key={day} className={cn(
                        "text-center text-[10px] font-black uppercase tracking-widest pb-2",
                        i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-300"
                    )}>
                        {day}
                    </div>
                ))}
            </div>
            <div>
                {weeks.map((week, wi) => {
                    const lanes = computeWeekEvents(week);
                    const MIN_WEEK_HEIGHT = 100;
                    const eventAreaHeight = Math.max(lanes.length * (ROW_HEIGHT + ROW_GAP), ROW_HEIGHT + ROW_GAP);
                    const totalHeight = Math.max(MIN_WEEK_HEIGHT, DATE_HEADER + eventAreaHeight + 8);

                    return (
                        <div key={wi} className="relative border-t border-gray-50 group" style={{ height: totalHeight }}>
                            <div className="grid grid-cols-7 absolute inset-0 h-full">
                                {week.map((cell, ci) => {
                                    const isToday = baseDate
                                        ? `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}` === cell.dateStr
                                        : new Date().toISOString().split('T')[0] === cell.dateStr;

                                    return (
                                        <div
                                            key={cell.dateStr}
                                            onClick={() => onDateClick(cell.dateStr)}
                                            className={cn(
                                                "h-full cursor-pointer transition-colors hover:bg-blue-50/10",
                                                !cell.isCurrentMonth && "bg-gray-50/30",
                                                ci > 0 && "border-l border-gray-50/50"
                                            )}
                                        >
                                            <div className="p-1 flex items-center justify-between flex-wrap gap-1">
                                                <span className={cn(
                                                    "text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full shrink-0",
                                                    isToday ? "bg-blue-600 text-white" :
                                                        cell.isCurrentMonth ? "text-gray-400" : "text-gray-300"
                                                )}>
                                                    {cell.d}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="absolute left-0 right-0" style={{ top: DATE_HEADER }}>
                                {lanes.map((lane, li) =>
                                    lane.map((item) => {
                                        const style = eventStyle(item.event.type);
                                        const isMultiDay = item.event.startDate !== item.event.endDate;
                                        const isHol = item.event.type === 'holiday';
                                        const startsBeforeWeek = item.event.startDate < week[0].dateStr;
                                        const endsAfterWeek = item.event.endDate > week[6].dateStr;

                                        const leftPct = (item.startCol / 7) * 100;
                                        const widthPct = ((item.endCol - item.startCol + 1) / 7) * 100;

                                        const isVisualStart = !startsBeforeWeek;
                                        const isVisualEnd = !endsAfterWeek;

                                        let displayMemo = item.event.memo || '';
                                        if ((item.event.type === 'blc' || item.event.type === 'kta') && displayMemo) {
                                            const isDay0OrGrad = displayMemo.includes('Day 0') || displayMemo.includes('Graduation') || displayMemo.includes('수료') || displayMemo.includes('🎓');
                                            if (!isDay0OrGrad) {
                                                displayMemo = displayMemo.replace(/\s*\([^)]*\)/g, '').trim();
                                            }
                                        }

                                        const marginLeft = isVisualStart ? 3 : 0;
                                        const marginRight = isVisualEnd ? 3 : 0;

                                        return (
                                            <div
                                                key={`${item.event.id}-${wi}`}
                                                className={cn(
                                                    "absolute text-[8.5px] font-black leading-none flex items-center pointer-events-none",
                                                    style.bg, style.text,
                                                    isMultiDay ? "justify-center" : "justify-start",
                                                    isMultiDay && isHol ? cn(
                                                        isVisualStart && isVisualEnd ? "rounded-md" :
                                                            isVisualStart ? "rounded-l-md" :
                                                                isVisualEnd ? "rounded-r-md" : ""
                                                    ) : "rounded-md"
                                                )}
                                                style={{
                                                    left: `calc(${leftPct}% + ${marginLeft}px)`,
                                                    width: `calc(${widthPct}% - ${marginLeft + marginRight}px)`,
                                                    top: li * (ROW_HEIGHT + ROW_GAP),
                                                    height: ROW_HEIGHT,
                                                    paddingLeft: isMultiDay ? (isVisualStart ? 6 : 4) : 4,
                                                    paddingRight: isMultiDay ? (isVisualEnd ? 6 : 4) : 4,
                                                }}
                                            >
                                                <span className="truncate">{displayMemo}</span>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
