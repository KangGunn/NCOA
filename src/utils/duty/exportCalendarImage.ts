import type { CalendarEvent } from '../../types/calendar/calendar.type';
import { isBlc30Days } from '../calendar.utils';

export interface DutyHoliday {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
}

interface ExportParams {
    year: number;
    month: number;
    calendarDays: { dayNumber: number; dateStr: string; isCurrentMonth: boolean }[];
    duties: CalendarEvent[];
    events: CalendarEvent[];
    dutyHolidays: DutyHoliday[];
    ktaDayLabels: Record<number, string>;
    blcDayLabels: Record<number, string>;
    monthlyDayLabels?: Record<string, string>;
}

export function exportCalendarImage({
    year,
    month,
    calendarDays,
    duties,
    events,
    dutyHolidays,
    ktaDayLabels,
    blcDayLabels,
    monthlyDayLabels
}: ExportParams) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dimensions
    const cellWidth = 180;
    const cellHeight = 130;
    const headerHeight = 60;
    const bottomHeight = 100;
    const gridCols = 7;
    const gridRows = Math.ceil(calendarDays.length / 7);

    const canvasWidth = cellWidth * gridCols;
    const canvasHeight = headerHeight + (cellHeight * gridRows) + bottomHeight;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Clear background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Helpers
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
        const isDayBeforeHolidayStart = dutyHolidays.some(h => dateStr === getPrevDateStr(h.startDate));
        if (isDayBeforeHolidayStart) return 'friSun';

        const isHolidayLastDay = dutyHolidays.some(h => dateStr === h.endDate);
        if (isHolidayLastDay) return 'friSun';

        const isHolidayBetween = dutyHolidays.some(h => dateStr >= h.startDate && dateStr < h.endDate);
        if (isHolidayBetween) return 'sat';

        const d = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = d.getDay();

        if (dayOfWeek === 6) return 'sat';
        if (dayOfWeek === 0 || dayOfWeek === 5) return 'friSun';
        return 'weekday';
    };

    const parseLocalDate = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    };

    const isHolidayDate = (dateStr: string) => events.some((e: CalendarEvent) => e.type === 'holiday' && e.holidayType !== 'duty' && dateStr >= e.startDate && dateStr <= e.endDate);

    const getKtaBlcEventsForDate = (dateStr: string) => {
        const ktaBlcEvents: CalendarEvent[] = [];
        const blcDay0s = events.filter((e: CalendarEvent) => e.type === 'blc' && e.memo?.includes('Day 0'));

        blcDay0s.forEach((day0: CalendarEvent) => {
            const start = parseLocalDate(day0.startDate);
            const batch = day0.batch || "";
            let dayCount = 0;
            let current = new Date(start);

            if (day0.startDate === dateStr) {
                ktaBlcEvents.push({ id: `blc-day0-${day0.id}`, type: 'blc', startDate: day0.startDate, endDate: day0.startDate, memo: `Day 0 (${batch})`, batch });
            }

            const limit = isBlc30Days(batch) ? 30 : 22;
            while (dayCount < limit) {
                current.setDate(current.getDate() + 1);
                const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                const isSunday = current.getDay() === 0;

                if (!isSunday && !isHolidayDate(currentStr)) {
                    dayCount++;
                    if (dayCount === limit && currentStr === dateStr) {
                        const isDuringPoday = currentStr >= '2026-06-19' && currentStr <= '2026-06-22';
                        if (!isDuringPoday) {
                            ktaBlcEvents.push({ id: `dynamic-blc-grad-${batch}`, type: 'blc', startDate: currentStr, endDate: currentStr, memo: `Graduation (${batch})`, batch });
                        }
                    }
                }
            }
        });

        const ktaEvents = events.filter((e: CalendarEvent) => e.type === 'kta');
        ktaEvents.forEach((e: CalendarEvent) => {
            if (e.startDate === dateStr) {
                if (e.memo?.includes('Day 0') || e.memo?.includes('Graduation') || e.memo?.includes('수료') || e.memo?.includes('🎓') || e.memo?.includes('수료포데이')) {
                    ktaBlcEvents.push(e);
                }
            }
        });

        return ktaBlcEvents;
    };

    const getBlcActiveDay = (day0DateStr: string, targetDateStr: string, batch?: string) => {
        const start = parseLocalDate(day0DateStr);
        const target = parseLocalDate(targetDateStr);
        if (start.getTime() === target.getTime()) return 0;

        if (target > start) {
            let dayCount = 0;
            let current = new Date(start);
            const limit = isBlc30Days(batch) ? 30 : 22;
            while (current < target) {
                current.setDate(current.getDate() + 1);
                if (dayCount < limit) {
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
            const diffTime = target.getTime() - start.getTime();
            return Math.round(diffTime / (1000 * 60 * 60 * 24));
        }
    };

    // Draw Headers
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px "Noto Sans KR", "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let c = 0; c < gridCols; c++) {
        const x = c * cellWidth;
        // Header cell box
        ctx.strokeRect(x, 0, cellWidth, headerHeight);
        ctx.fillText(dayNames[c], x + cellWidth / 2, headerHeight / 2);
    }

    // Draw Grid Cells
    calendarDays.forEach((cell, index) => {
        const col = index % 7;
        const row = Math.floor(index / 7);
        const x = col * cellWidth;
        const y = headerHeight + row * cellHeight;

        // Background color
        let bgColor = '#ffffff'; // weekday
        if (cell.isCurrentMonth) {
            const dt = getDutyType(cell.dateStr);
            if (dt === 'sat') {
                bgColor = '#f0d0d0'; // 토당 (light red)
            } else if (dt === 'friSun') {
                bgColor = '#d2e1f8'; // 금일당 (light blue)
            }
        } else {
            bgColor = '#ffffff'; // non-current month is white but we will skip text/duties
        }

        ctx.fillStyle = bgColor;
        ctx.fillRect(x, y, cellWidth, cellHeight);
        ctx.strokeRect(x, y, cellWidth, cellHeight);

        // If not current month, we only draw the border and background
        if (!cell.isCurrentMonth) return;

        // Draw day number (top-left)
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 16px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(String(cell.dayNumber), x + 12, y + 12);

        // Find duty assigned
        const duty = duties.find((d: CalendarEvent) => d.startDate === cell.dateStr);
        if (duty && duty.memo) {
            ctx.fillStyle = '#000000';
            ctx.font = '15px "Noto Sans KR", sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(duty.memo, x + cellWidth - 12, y + cellHeight - 12);
        }

        // Collect all active labels for this day
        const cellLabels: string[] = [];

        // 1. Custom KTA badges from ktaDayLabels
        const ktaDay0sForCell = events.filter(e => e.type === 'kta' && e.memo?.includes('Day 0'));
        ktaDay0sForCell.forEach(e => {
            const startKta = parseLocalDate(e.startDate);
            const currentDay = parseLocalDate(cell.dateStr);
            const diffTime = currentDay.getTime() - startKta.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            const customLabel = ktaDayLabels[diffDays];
            if (customLabel) {
                cellLabels.push(`KTA ${customLabel}`);
            }
        });

        // 2. Custom BLC badges from blcDayLabels
        const blcDay0sForCell = events.filter(e => e.type === 'blc' && e.memo?.includes('Day 0'));
        blcDay0sForCell.forEach(day0 => {
            const diffDays = getBlcActiveDay(day0.startDate, cell.dateStr, day0.batch);
            const customLabel = blcDayLabels[diffDays];
            if (customLabel) {
                cellLabels.push(`BLC ${customLabel}`);
            }
        });

        // 3. Regular calendar events (Day 0, Grad etc.)
        const day0Events = getKtaBlcEventsForDate(cell.dateStr);
        day0Events.forEach(e => {
            const isBlc = e.type === 'blc';
            const isPoday = e.memo?.includes('수료포데이');
            const isGrad = !isPoday && (e.memo?.includes('Graduation') || e.memo?.includes('수료') || e.memo?.includes('🎓'));
            const dayText = isPoday ? '포데이' : isGrad ? 'GRAD' : (e.memo?.match(/Day -?\d+/)?.[0] || e.memo?.match(/Day \d+/)?.[0] || '');
            if (dayText) {
                cellLabels.push(`${isBlc ? 'BLC' : 'KTA'} ${dayText.toUpperCase()}`);
            }
        });

        // 4. Monthly Custom Day Labels
        if (monthlyDayLabels?.[cell.dateStr]) {
            cellLabels.push(monthlyDayLabels[cell.dateStr]);
        }

        // De-duplicate
        const finalLabels = Array.from(new Set(cellLabels));

        if (finalLabels.length > 0) {
            const lineHeight = 15;
            const totalHeight = finalLabels.length * lineHeight;
            const startY = y + (cellHeight - totalHeight) / 2;

            finalLabels.forEach((label, idx) => {
                ctx.fillStyle = '#000000';
                ctx.font = 'bold 11px "Noto Sans KR", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(label, x + cellWidth / 2, startY + idx * lineHeight);
            });
        }
    });

    // Draw Footer (Legend & Holidays)
    const footerY = headerHeight + (cellHeight * gridRows);

    // Border line above footer
    ctx.beginPath();
    ctx.moveTo(0, footerY);
    ctx.lineTo(canvasWidth, footerY);
    ctx.stroke();

    // Draw Legends
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '14px "Noto Sans KR", sans-serif';

    // 토당 (Red)
    ctx.fillStyle = '#f0d0d0';
    ctx.fillRect(20, footerY + 25, 20, 20);
    ctx.strokeRect(20, footerY + 25, 20, 20);
    ctx.fillStyle = '#000000';
    ctx.fillText('토당', 50, footerY + 35);

    // 금일당 (Blue)
    ctx.fillStyle = '#d2e1f8';
    ctx.fillRect(20, footerY + 55, 20, 20);
    ctx.strokeRect(20, footerY + 55, 20, 20);
    ctx.fillStyle = '#000000';
    ctx.fillText('금일당', 50, footerY + 65);

    // Holidays / Special Note
    const activeMonthStart = new Date(year, month, 1);
    const activeMonthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const activeMonthHolidays = dutyHolidays.filter((h) => {
        const start = new Date(h.startDate + 'T00:00:00');
        const end = new Date(h.endDate + 'T23:59:59');
        return !(end < activeMonthStart || start > activeMonthEnd);
    });

    if (activeMonthHolidays.length > 0) {
        const noteText = '특이사항: ' + activeMonthHolidays.map((h) => {
            const start = new Date(h.startDate);
            const end = new Date(h.endDate);
            const startStr = `${start.getMonth() + 1}/${start.getDate()}`;
            const endStr = `${end.getMonth() + 1}/${end.getDate()}`;
            return `${startStr}- ${endStr} ${h.name.toUpperCase()}`;
        }).join(', ');

        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(noteText, canvasWidth - 20, footerY + 50);
    }

    // Return Data URL for preview modal
    return canvas.toDataURL('image/png');
}
