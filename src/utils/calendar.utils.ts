import type { CalendarEvent } from '../types/calendar/calendar.type';

export const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
export const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

export const getKtaReferenceDate = (events: CalendarEvent[]) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const ktaBatches = events
        .filter(e => e.type === 'kta' && e.memo?.includes('Day 0'))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (ktaBatches.length === 0) return null;

    const activeBatch = ktaBatches.find(b => {
        const start = new Date(b.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + 20);
        const endStr = end.toISOString().split('T')[0];
        return todayStr >= b.startDate && todayStr <= endStr;
    });

    if (activeBatch) return new Date(activeBatch.startDate);

    const nextBatch = ktaBatches.find(b => b.startDate > todayStr);
    if (nextBatch) return new Date(nextBatch.startDate);

    return new Date(ktaBatches[ktaBatches.length - 1].startDate);
};

export const getKtaReferenceBatch = (events: CalendarEvent[]) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const ktaBatches = events
        .filter(e => e.type === 'kta' && e.memo?.includes('Day 0') && e.batch)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (ktaBatches.length === 0) return "";

    const activeBatch = ktaBatches.find(b => {
        const start = new Date(b.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + 20);
        const endStr = end.toISOString().split('T')[0];
        return todayStr >= b.startDate && todayStr <= endStr;
    });

    if (activeBatch) return activeBatch.batch || "";

    const nextBatch = ktaBatches.find(b => b.startDate > todayStr);
    if (nextBatch) return nextBatch.batch || "";

    return ktaBatches[ktaBatches.length - 1].batch || "";
};

export const getKtaReferenceType = (events: CalendarEvent[]) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const ktaBatches = events
        .filter(e => e.type === 'kta' && e.memo?.includes('Day 0') && e.batch)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (ktaBatches.length === 0) return "A";

    const activeBatch = ktaBatches.find(b => {
        const start = new Date(b.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + 20);
        const endStr = end.toISOString().split('T')[0];
        return todayStr >= b.startDate && todayStr <= endStr;
    });

    if (activeBatch) return activeBatch.ktaType || "A";

    const nextBatch = ktaBatches.find(b => b.startDate > todayStr);
    if (nextBatch) return nextBatch.ktaType || "A";

    return ktaBatches[ktaBatches.length - 1].ktaType || "A";
};

export const getBlcReferenceDate = (events: CalendarEvent[]) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const blcBatches = events
        .filter(e => e.type === 'blc' && e.memo?.includes('Day 0'))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (blcBatches.length === 0) return null;

    const activeBatch = blcBatches.find(b => {
        const start = new Date(b.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + 25);
        const endStr = end.toISOString().split('T')[0];
        return todayStr >= b.startDate && todayStr <= endStr;
    });

    if (activeBatch) return new Date(activeBatch.startDate);

    const nextBatch = blcBatches.find(b => b.startDate > todayStr);
    if (nextBatch) return new Date(nextBatch.startDate);

    return new Date(blcBatches[blcBatches.length - 1].startDate);
};

export const getBlcReferenceBatch = (events: CalendarEvent[]) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const blcBatches = events
        .filter(e => e.type === 'blc' && e.memo?.includes('Day 0'))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (blcBatches.length === 0) return "";

    const activeBatch = blcBatches.find(b => {
        const start = new Date(b.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + 25);
        const endStr = end.toISOString().split('T')[0];
        return todayStr >= b.startDate && todayStr <= endStr;
    });

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
