const isBlc30Days = (batch) => false; // assuming not 30 days
const events = []; // no holidays for simplicity now, let's see

const parseLocalDate = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const getBlcActiveDay = (day0DateStr, targetDateStr, batch) => {
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
                const isHoliday = events.some((e) => e.type === 'holiday' && e.holidayType !== 'duty' && currentStr >= e.startDate && currentStr <= e.endDate);
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

const day0 = '2026-07-17';
console.log('Active days for 2026-08-12:', getBlcActiveDay(day0, '2026-08-12'));
console.log('Active days for 2026-08-13:', getBlcActiveDay(day0, '2026-08-13'));
