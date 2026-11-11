import type { CalendarEvent } from '../types/calendar/calendar.type';

export const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
export const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

/** 로컬 날짜를 'YYYY-MM-DD'로 바꾼다 (toISOString은 UTC라 한국 시간 새벽에 하루 전이 된다). */
const toIsoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 점호 탭 날짜의 다음 날 (점호 '익일 주요일정'이 쓰는 날짜). 날짜가 없으면 undefined. */
export const nextDayOf = (d?: Date) =>
    d ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) : undefined;

/**
 * BLC 기수의 수료식(Graduation) 날짜: 캘린더 그리드와 같은 규칙으로 Day 0 다음 날부터 일요일·공식 휴일(당직 휴일 제외)을 빼고 세어
 * 기수 일수(30일 기수 30, 22일 기수 22)째 되는 날. 수료포데이는 이 날의 다음 날부터 4일이다.
 */
export const getBlcGraduationIso = (b: CalendarEvent, events: CalendarEvent[]) => {
    const isHoliday = (s: string) =>
        events.some(e => e.type === 'holiday' && e.holidayType !== 'duty' && s >= e.startDate && s <= e.endDate);
    const limit = isBlc30Days(b.batch) ? 30 : 22;
    const cur = new Date(`${b.startDate}T00:00:00`);
    let count = 0;
    while (count < limit) {
        cur.setDate(cur.getDate() + 1);
        if (cur.getDay() !== 0 && !isHoliday(toIsoDate(cur))) count++;
    }
    return toIsoDate(cur);
};

/** 기수 기준 날짜. 기본은 실제 오늘, 점호 탭 날짜(ref)를 넘기면 그 날짜 기준으로 고른다. */
export const getKtaReferenceDate = (events: CalendarEvent[], ref: Date = new Date()) => {
    const todayStr = toIsoDate(ref);
    const ktaBatches = events
        .filter(e => e.type === 'kta' && e.memo?.includes('Day 0'))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (ktaBatches.length === 0) return null;

    const activeBatch = ktaBatches.filter(b => {
        const start = new Date(b.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + 20);
        const endStr = end.toISOString().split('T')[0];
        return todayStr >= b.startDate && todayStr <= endStr;
    }).pop();

    if (activeBatch) return new Date(activeBatch.startDate);

    const nextBatch = ktaBatches.find(b => b.startDate > todayStr);
    if (nextBatch) return new Date(nextBatch.startDate);

    return new Date(ktaBatches[ktaBatches.length - 1].startDate);
};

export const getKtaReferenceBatch = (events: CalendarEvent[], ref: Date = new Date()) => {
    const todayStr = toIsoDate(ref);
    const ktaBatches = events
        .filter(e => e.type === 'kta' && e.memo?.includes('Day 0') && e.batch)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (ktaBatches.length === 0) return "";

    const activeBatch = ktaBatches.filter(b => {
        const start = new Date(b.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + 20);
        const endStr = end.toISOString().split('T')[0];
        return todayStr >= b.startDate && todayStr <= endStr;
    }).pop();

    if (activeBatch) return activeBatch.batch || "";

    const nextBatch = ktaBatches.find(b => b.startDate > todayStr);
    if (nextBatch) return nextBatch.batch || "";

    return ktaBatches[ktaBatches.length - 1].batch || "";
};

export const getKtaReferenceType = (events: CalendarEvent[], ref: Date = new Date()) => {
    const todayStr = toIsoDate(ref);
    const ktaBatches = events
        .filter(e => e.type === 'kta' && e.memo?.includes('Day 0') && e.batch)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (ktaBatches.length === 0) return "A";

    const activeBatch = ktaBatches.filter(b => {
        const start = new Date(b.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + 20);
        const endStr = end.toISOString().split('T')[0];
        return todayStr >= b.startDate && todayStr <= endStr;
    }).pop();

    if (activeBatch) return activeBatch.ktaType || "A";

    const nextBatch = ktaBatches.find(b => b.startDate > todayStr);
    if (nextBatch) return nextBatch.ktaType || "A";

    return ktaBatches[ktaBatches.length - 1].ktaType || "A";
};

export const getBlcReferenceDate = (events: CalendarEvent[], ref: Date = new Date()) => {
    const todayStr = toIsoDate(ref);
    const blcBatches = events
        .filter(e => e.type === 'blc' && e.memo?.includes('Day 0'))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (blcBatches.length === 0) return null;

    const activeBatch = blcBatches.filter(b => {
        return todayStr >= b.startDate && todayStr <= getBlcGraduationIso(b, events);
    }).pop();

    if (activeBatch) return new Date(activeBatch.startDate);

    const nextBatch = blcBatches.find(b => b.startDate > todayStr);
    if (nextBatch) return new Date(nextBatch.startDate);

    return new Date(blcBatches[blcBatches.length - 1].startDate);
};

export const getBlcReferenceBatch = (events: CalendarEvent[], ref: Date = new Date()) => {
    const todayStr = toIsoDate(ref);
    const blcBatches = events
        .filter(e => e.type === 'blc' && e.memo?.includes('Day 0'))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (blcBatches.length === 0) return "";

    const activeBatch = blcBatches.filter(b => {
        return todayStr >= b.startDate && todayStr <= getBlcGraduationIso(b, events);
    }).pop();

    if (activeBatch) return activeBatch.batch || "";

    const nextBatch = blcBatches.find(b => b.startDate > todayStr);
    if (nextBatch) return nextBatch.batch || "";

    return blcBatches[blcBatches.length - 1].batch || "";
};

export const formatDateWithDay = (baseDate: Date, addDays: number) => {
    const targetDate = new Date(baseDate);
    targetDate.setDate(baseDate.getDate() + addDays);
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayNames[targetDate.getDay()];
    return `${mm}.${dd}(${dayName})`;
};

export const sortedWithIndex = (evts: string[]) =>
    evts.map((evt, idx) => ({ evt, oi: idx }))
        .sort((a, b) => (a.evt.match(/^\d{4}/)?.[0] || '9999').localeCompare(b.evt.match(/^\d{4}/)?.[0] || '9999'));

export function isBlc30Days(batch?: string): boolean {
    if (!batch) return true;
    const match = batch.match(/^(\d+)-(\d+)$/);
    if (!match) return true;
    const n1 = parseInt(match[1], 10);
    const n2 = parseInt(match[2], 10);
    let year = 2000;
    let month = 1;
    if (n1 >= 20) {
        year = 2000 + n1;
        month = n2;
    } else {
        month = n1;
        year = 2000 + n2;
    }
    if (year > 2026) return true;
    if (year === 2026 && month >= 8) return true;
    return true;
}
