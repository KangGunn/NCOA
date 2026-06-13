import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

// ── Types ─────────────────────────────────────────────────

export interface MemberDutyTarget {
    memberName: string;
    weekday: number;
    friSun: number;
    sat: number;
    free: number;
    isLocked?: boolean;
}

export type DutyType = 'weekday' | 'friSun' | 'sat';

export interface AssignedDuty {
    dateStr: string;
    memberName: string;
    dutyType: DutyType;
}

export interface DistributeWarning {
    type: 'unassigned' | 'shortfall';
    dateStr?: string;
    memberName?: string;
    targetWeekday?: number;
    targetFriSun?: number;
    targetSat?: number;
    targetFree?: number;
    assignedWeekday?: number;
    assignedFriSun?: number;
    assignedSat?: number;
    assignedFree?: number;
}

export interface RuleViolation {
    ruleId: string;
    level: 'hard' | 'soft';
    message: string;
    dates?: string[];
    memberName?: string;
}

export interface DistributeResult {
    assignments: AssignedDuty[];
    warnings: DistributeWarning[];
    violations: RuleViolation[];
}

// ── Date utilities ────────────────────────────────────────

function parseLocalDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysStr(dateStr: string, n: number): string {
    const d = parseLocalDate(dateStr);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
}

function diffDays(a: string, b: string): number {
    return Math.round(
        (parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / (1000 * 60 * 60 * 24)
    );
}

// ── Duty type calculation ─────────────────────────────────

function getDutyTypeGeneral(dateStr: string, dutyHolidays: any[]): DutyType {
    if (dutyHolidays.some(h => dateStr === addDaysStr(h.startDate, -1))) return 'friSun';
    if (dutyHolidays.some(h => dateStr === h.endDate)) return 'friSun';
    if (dutyHolidays.some(h => dateStr >= h.startDate && dateStr < h.endDate)) return 'sat';
    const dow = parseLocalDate(dateStr).getDay();
    if (dow === 6) return 'sat';
    if (dow === 0 || dow === 5) return 'friSun';
    return 'weekday';
}

function isDateDuringKtaPeriod(dateStr: string, allEvents: CalendarEvent[]): boolean {
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
}

function getDutyTypeForMember(
    dateStr: string,
    member: CalendarMember,
    dutyHolidays: any[],
    allEvents: CalendarEvent[]
): DutyType {
    const isKtaOrMedic = member.sections?.includes('KTA') || member.sections?.includes('MEDIC');
    if (isKtaOrMedic && isDateDuringKtaPeriod(dateStr, allEvents)) {
        const dow = parseLocalDate(dateStr).getDay();
        if (dow === 6) return 'sat';
        if (dow === 0 || dow === 5) return 'friSun';
        return 'weekday';
    }
    return getDutyTypeGeneral(dateStr, dutyHolidays);
}

function getBlcActiveDay(day0: string, target: string, isHoliday: (s: string) => boolean): number {
    const start = parseLocalDate(day0);
    const tgt = parseLocalDate(target);
    if (start.getTime() === tgt.getTime()) return 0;
    if (tgt > start) {
        let cnt = 0;
        const cur = new Date(start);
        while (cur < tgt) {
            cur.setDate(cur.getDate() + 1);
            const cs = toDateStr(cur);
            if (cur.getDay() !== 0 && !isHoliday(cs)) cnt++;
            if (cnt >= 22) break;
        }
        return cnt;
    }
    return Math.round((tgt.getTime() - start.getTime()) / 86400000);
}

function isDateDuringBlcPeriod(dateStr: string, allEvents: CalendarEvent[]): boolean {
    const blcDay0s = allEvents.filter(e => e.type === 'blc' && e.memo?.includes('Day 0'));
    const isHoliday = (ds: string) => allEvents.some(e => e.type === 'holiday' && ds >= e.startDate && ds <= e.endDate);
    return blcDay0s.some(day0 => {
        if (dateStr < day0.startDate) return false;
        const diffDays = getBlcActiveDay(day0.startDate, dateStr, isHoliday);
        return diffDays >= 0 && diffDays <= 22;
    });
}

// ── Counts type ───────────────────────────────────────────

type Counts = { weekday: number; friSun: number; sat: number };

function incrCounts(c: Counts, dt: DutyType): Counts {
    if (dt === 'weekday') return { ...c, weekday: c.weekday + 1 };
    if (dt === 'friSun') return { ...c, friSun: c.friSun + 1 };
    return { ...c, sat: c.sat + 1 };
}

function copyCountsMap(m: Map<string, Counts>): Map<string, Counts> {
    const r = new Map<string, Counts>();
    for (const [k, v] of m) r.set(k, { ...v });
    return r;
}

// ── Search state ──────────────────────────────────────────

type SearchState = {
    assignments: AssignedDuty[];
    counts: Map<string, Counts>;
    pending: string[];
    unassigned: string[];
};

// ── Main function ─────────────────────────────────────────

export function runAutoDistribute(params: {
    year: number;
    month: number;
    members: CalendarMember[];
    allDuties: CalendarEvent[];
    allEvents: CalendarEvent[];
    personalRestrictions: Record<string, string[]>;
    dutyHolidays: any[];
    targets: MemberDutyTarget[];
    restrictions: Record<number, Record<string, boolean>>;
    blcRestrictions: Record<number, Record<string, boolean>>;
    ktaSections: string[];
    blcSections: string[];
    dutyStats: Record<string, { total: number; weekday: number; friSun: number; sat: number }>;
    currentDate: Date;
    criteria: { weekday: number; friSun: number; sat: number };
}): DistributeResult {
    const {
        year, month, members, allDuties, allEvents,
        personalRestrictions, dutyHolidays,
        targets, restrictions, blcRestrictions,
        ktaSections, blcSections, dutyStats, currentDate, criteria
    } = params;

    const TIME_LIMIT_MS = 55_000;
    const startTime = Date.now();

    // All dates in month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const allDatesInMonth: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
        allDatesInMonth.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }

    const isHoliday = (ds: string) =>
        allEvents.some(e => e.type === 'holiday' && ds >= e.startDate && ds <= e.endDate);

    const blcActiveDayFn = (day0: string, tds: string) => getBlcActiveDay(day0, tds, isHoliday);

    const memberByName = new Map<string, CalendarMember>();
    for (const m of members) memberByName.set(m.name, m);

    // Duty type cache
    const dutyTypeCache = new Map<string, DutyType>();
    function getDT(dateStr: string, member: CalendarMember): DutyType {
        const key = `${dateStr}:${member.name}`;
        let v = dutyTypeCache.get(key);
        if (v === undefined) {
            v = getDutyTypeForMember(dateStr, member, dutyHolidays, allEvents);
            dutyTypeCache.set(key, v);
        }
        return v;
    }

    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;

    // Existing duty index for gap checks
    const existingByMember = new Map<string, string[]>();
    const existingByDate = new Map<string, string[]>();
    for (const m of members) existingByMember.set(m.name, []);
    for (const d of allDuties) {
        if (d.type !== 'duty' || !d.memo) continue;
        const arr = existingByMember.get(d.memo) || [];
        arr.push(d.startDate);
        existingByMember.set(d.memo, arr);
        const byD = existingByDate.get(d.startDate) || [];
        byD.push(d.memo);
        existingByDate.set(d.startDate, byD);
    }

    // Precompute base restrictions (existing duties → O(1) lookup)
    const baseRestrictions = new Set<string>(); // `${memberName}:${dateStr}`
    for (const m of members) {
        for (const eDate of existingByMember.get(m.name) || []) {
            for (const offset of [-2, -1, 1, 2]) {
                baseRestrictions.add(`${m.name}:${addDaysStr(eDate, offset)}`);
            }
        }
        if (m.sections && m.sections.length > 0) {
            for (const [eDate, assignedNames] of existingByDate) {
                for (const an of assignedNames) {
                    if (an === m.name) continue;
                    const other = memberByName.get(an);
                    if (other?.sections?.some(s => {
                        if (s === 'S6') return false;
                        if ((s === 'KTA' || s === 'MEDIC') && !isDateDuringKtaPeriod(eDate, allEvents)) return false;
                        if (s === 'BLC' && !isDateDuringBlcPeriod(eDate, allEvents)) return false;
                        return m.sections!.includes(s);
                    })) {
                        baseRestrictions.add(`${m.name}:${addDaysStr(eDate, -1)}`);
                        baseRestrictions.add(`${m.name}:${addDaysStr(eDate, 1)}`);
                    }
                }
            }
        }
    }

    // Existing counts this month
    const existingCountsBase = new Map<string, Counts>();
    for (const m of members) existingCountsBase.set(m.name, { weekday: 0, friSun: 0, sat: 0 });
    for (const d of allDuties) {
        if (d.type !== 'duty' || !d.memo || !d.startDate.startsWith(monthPrefix)) continue;
        const mo = memberByName.get(d.memo);
        if (!mo) continue;
        const dt = getDT(d.startDate, mo);
        const cnt = existingCountsBase.get(d.memo)!;
        existingCountsBase.set(d.memo, incrCounts(cnt, dt));
    }

    // Target map
    const targetMap = new Map<string, MemberDutyTarget>();
    for (const t of targets) {
        if (t.weekday > 0 || t.friSun > 0 || t.sat > 0 || t.free > 0 || t.isLocked) {
            targetMap.set(t.memberName, t);
        }
    }

    // KTA/BLC event cache
    const ktaDay0Events = allEvents.filter(e => e.type === 'kta' && e.memo?.includes('Day 0'));
    const blcDay0Events = allEvents.filter(e => e.type === 'blc' && e.memo?.includes('Day 0'));

    // Pre-assigned & fixed
    const preAssigned = new Set<string>(
        allDuties.filter(d => d.type === 'duty' && d.startDate.startsWith(monthPrefix)).map(d => d.startDate)
    );

    const pendingDates = allDatesInMonth.filter(d => !preAssigned.has(d));

    // Initial counts (start from 0, representing newly assigned duties in this run)
    const initialCounts = new Map<string, Counts>();
    for (const m of members) initialCounts.set(m.name, { weekday: 0, friSun: 0, sat: 0 });

    // ── isRestricted ──────────────────────────────────────
    function isRestricted(
        member: CalendarMember,
        dateStr: string,
        newAssignments: AssignedDuty[]
    ): boolean {
        if (member.role === 'runner' || member.dutyCompleted || member.sections?.includes('SK')) return true;
        if (member.joinDate) {
            const diff = diffDays(member.joinDate, dateStr);
            if (diff >= 0 && diff < 15) return true;
            if (diffDays(dateStr, member.joinDate) > 0) return true;
        }
        if (personalRestrictions[dateStr]?.includes(member.name)) return true;
        if (baseRestrictions.has(`${member.name}:${dateStr}`)) return true;

        const ms = member.sections || [];
        for (const na of newAssignments) {
            if (na.memberName === member.name) {
                const diff = Math.abs(diffDays(na.dateStr, dateStr));
                if (diff > 0 && diff <= 2) return true;
            }
        }

        const getSectionsOnDateLocal = (dStr: string): string[] => {
            const names = existingByDate.get(dStr) || [];
            const newAssigns = newAssignments.filter(a => a.dateStr === dStr).map(a => a.memberName);
            const allNames = [...names, ...newAssigns];
            const secs: string[] = [];
            for (const n of allNames) {
                const other = memberByName.get(n);
                if (other && other.sections) secs.push(...other.sections);
            }
            return secs;
        };
        const hasCommonSectionLocal = (secs1: string[], secs2: string[]) => secs1.some(s => {
            if (s === 'S6') return false;
            if ((s === 'KTA' || s === 'MEDIC') && !isDateDuringKtaPeriod(dateStr, allEvents)) return false;
            if (s === 'BLC' && !isDateDuringBlcPeriod(dateStr, allEvents)) return false;
            return secs2.includes(s);
        });

        if (ms.length > 0) {
            const sMinus2 = getSectionsOnDateLocal(addDaysStr(dateStr, -2));
            const sMinus1 = getSectionsOnDateLocal(addDaysStr(dateStr, -1));
            const sPlus1 = getSectionsOnDateLocal(addDaysStr(dateStr, 1));
            const sPlus2 = getSectionsOnDateLocal(addDaysStr(dateStr, 2));
            
            if (hasCommonSectionLocal(ms, sMinus1) && hasCommonSectionLocal(ms, sMinus2)) return true;
            if (hasCommonSectionLocal(ms, sMinus1) && hasCommonSectionLocal(ms, sPlus1)) return true;
            if (hasCommonSectionLocal(ms, sPlus1) && hasCommonSectionLocal(ms, sPlus2)) return true;
        }

        const mKta = ms.filter(s => ktaSections.includes(s));
        if (mKta.length > 0) {
            for (const ev of ktaDay0Events) {
                const diff = diffDays(ev.startDate, dateStr);
                if (diff >= -3 && diff <= 24) {
                    const r = restrictions[diff];
                    if (r && (mKta.some(s => r[s]) || (mKta.includes('KTA') && r['kta']) ||
                        (mKta.includes('MEDIC') && r['medic']) || (mKta.includes('PAO') && r['pao']))) return true;
                }
            }
        }

        const mBlc = ms.filter(s => blcSections.includes(s));
        if (mBlc.length > 0) {
            for (const ev of blcDay0Events) {
                const diff = blcActiveDayFn(ev.startDate, dateStr);
                if (diff >= -1 && diff <= 26) {
                    const r = blcRestrictions[diff];
                    if (r && (mBlc.some(s => r[s]) || (mBlc.includes('BLC') && r['blc']) ||
                        (mBlc.includes('S3') && r['s3']) || (mBlc.includes('PAO') && r['pao']))) return true;
                }
            }
        }

        return false;
    }

    // ── hasCapacity ───────────────────────────────────────
    function hasCapacity(name: string, dt: DutyType, counts: Map<string, Counts>): boolean {
        const cnt = counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
        const totalNew = cnt.weekday + cnt.friSun + cnt.sat;
        const existing = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
        const totalExisting = existing.weekday + existing.friSun + existing.sat;
        const monthlyTotal = totalNew + totalExisting;

        const target = targetMap.get(name);

        if (target && target.isLocked) {
            const totalTarget = target.weekday + target.friSun + target.sat + target.free;
            if (totalNew >= totalTarget) return false;
            const freeUsed = Math.max(0, cnt.weekday - target.weekday)
                + Math.max(0, cnt.friSun - target.friSun)
                + Math.max(0, cnt.sat - target.sat);
            const freeLeft = target.free - freeUsed;
            if (dt === 'weekday' && cnt.weekday >= target.weekday && freeLeft <= 0) return false;
            if (dt === 'friSun' && cnt.friSun >= target.friSun && freeLeft <= 0) return false;
            if (dt === 'sat' && cnt.sat >= target.sat && freeLeft <= 0) return false;
            return true;
        }

        const member = memberByName.get(name);
        if (member && !member.dutyCompleted) {
            if (monthlyTotal >= 3) return false;

            const stats = dutyStats[name] || { weekday: 0, friSun: 0, sat: 0 };
            if (dt === 'weekday' && stats.weekday + cnt.weekday >= criteria.weekday) return false;
            if (dt === 'friSun' && stats.friSun + cnt.friSun >= criteria.friSun) return false;
            if (dt === 'sat' && stats.sat + cnt.sat >= criteria.sat) return false;
        }

        return true;
    }

    // ── getCandidates ─────────────────────────────────────
    function getCandidates(dateStr: string, assignments: AssignedDuty[], counts: Map<string, Counts>): CalendarMember[] {
        const result: CalendarMember[] = [];
        for (const m of members) {
            if (isRestricted(m, dateStr, assignments)) continue;
            if (!hasCapacity(m.name, getDT(dateStr, m), counts)) continue;
            result.push(m);
        }
        return result;
    }

    // ── getPacingExpected ─────────────────────────────────
    function getPacingExpected(member: CalendarMember) {
        if (!member.enlistmentDate) return null;
        const enlist = new Date(member.enlistmentDate);
        if (isNaN(enlist.getTime())) return null;
        const msDiff = currentDate.getTime() - enlist.getTime();
        const months = Math.max(0, msDiff / (1000 * 60 * 60 * 24 * 30.44));
        const rateW = 6 / 8;
        const rateF = 4 / 8;
        const rateS = 3 / 8;
        return {
            weekday: months * rateW,
            friSun: months * rateF,
            sat: months * rateS,
            total: months * (rateW + rateF + rateS)
        };
    }

    const isEligibleLocal = (m: CalendarMember): boolean => {
        if (m.role === 'runner' || m.dutyCompleted || m.sections?.includes('SK')) return false;

        const stats = dutyStats[m.name] || { total: 0, weekday: 0, friSun: 0, sat: 0 };
        if (stats.weekday >= criteria.weekday && stats.friSun >= criteria.friSun && stats.sat >= criteria.sat) return false;

        const daysInMonthLocal = new Date(year, month + 1, 0).getDate();
        const lastDayStrLocal = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonthLocal).padStart(2, '0')}`;
        const firstDayStrLocal = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        if (m.joinDate && lastDayStrLocal < m.joinDate) return false;

        let dischargeStrLocal: string | null = null;
        if (m.enlistmentDate) {
            const enlist = new Date(m.enlistmentDate);
            if (!isNaN(enlist.getTime())) {
                const d = new Date(enlist);
                d.setMonth(d.getMonth() + 18);
                d.setDate(d.getDate() - 1);
                dischargeStrLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
        }
        if (dischargeStrLocal && dischargeStrLocal < firstDayStrLocal) return false;

        return true;
    };

    // ── computeCost ───────────────────────────────────────
    function computeCost(counts: Map<string, Counts>, unassignedCount: number, assignments: AssignedDuty[]): number {
        let cost = unassignedCount * 1000000;

        for (const m of members) {
            const name = m.name;
            const cnt = counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
            const existing = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
            const monthlyTotal = (cnt.weekday + cnt.friSun + cnt.sat) + (existing.weekday + existing.friSun + existing.sat);

            if (monthlyTotal < 1 && isEligibleLocal(m)) {
                cost += 500000;
            }

            const expected = getPacingExpected(m);
            if (expected) {
                const stats = dutyStats[name] || { weekday: 0, friSun: 0, sat: 0 };
                const tW = stats.weekday + cnt.weekday;
                const tF = stats.friSun + cnt.friSun;
                const tS = stats.sat + cnt.sat;
                const tAll = tW + tF + tS;

                cost += Math.pow(tW - expected.weekday, 2) * 50000;
                cost += Math.pow(tF - expected.friSun, 2) * 50000;
                cost += Math.pow(tS - expected.sat, 2) * 50000;
                cost += Math.pow(tAll - expected.total, 2) * 20000;
            }

            const target = targetMap.get(name);
            if (target) {
                if (!target.isLocked) {
                    const tW = target.weekday;
                    const tF = target.friSun;
                    const tS = target.sat;
                    const tFree = target.free;
                    const totalTarget = tW + tF + tS + tFree;
                    const totalNew = cnt.weekday + cnt.friSun + cnt.sat;

                    if (tW > 0) cost += Math.pow(Math.max(0, tW - cnt.weekday), 2) * 10000;
                    if (tF > 0) cost += Math.pow(Math.max(0, tF - cnt.friSun), 2) * 10000;
                    if (tS > 0) cost += Math.pow(Math.max(0, tS - cnt.sat), 2) * 10000;
                    if (totalTarget > 0) cost += Math.pow(totalTarget - totalNew, 2) * 10000;
                }
            } else if (!m.dutyCompleted) {
                const ext = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                const existingTotal = ext.weekday + ext.friSun + ext.sat;
                const totalThisMonth = cnt.weekday + cnt.friSun + cnt.sat + existingTotal;
                cost += Math.pow(2 - totalThisMonth, 2) * 5000;
            }
        }

        const getSectionsOnDateLocal = (dStr: string): string[] => {
            const names = existingByDate.get(dStr) || [];
            const newAssigns = assignments.filter(a => a.dateStr === dStr).map(a => a.memberName);
            const allNames = [...names, ...newAssigns];
            const secs: string[] = [];
            for (const n of allNames) {
                const other = memberByName.get(n);
                if (other && other.sections) secs.push(...other.sections);
            }
            return secs;
        };

        for (let i = 1; i < allDatesInMonth.length; i++) {
            const d1 = allDatesInMonth[i - 1];
            const d2 = allDatesInMonth[i];
            const s1 = getSectionsOnDateLocal(d1);
            const s2 = getSectionsOnDateLocal(d2);
            if (s1.some(s => s2.includes(s))) cost += 1000;
        }

        return cost;
    }

    // ── scoreMember: 부족분 클수록 우선 ───────────────────
    function scoreMember(m: CalendarMember, dateStr: string, counts: Map<string, Counts>): number {
        const target = targetMap.get(m.name);
        const cnt = counts.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
        const dt = getDT(dateStr, m);
        const existing = existingCountsBase.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
        const monthlyTotal = (cnt.weekday + cnt.friSun + cnt.sat) + (existing.weekday + existing.friSun + existing.sat);

        let score = 0;
        if (monthlyTotal === 0 && isEligibleLocal(m)) {
            score += 500000;
        }

        if (target && target.isLocked) {
            const typeShort = dt === 'weekday' ? target.weekday - cnt.weekday
                : dt === 'friSun' ? target.friSun - cnt.friSun
                : target.sat - cnt.sat;
            const totalShort = (target.weekday + target.friSun + target.sat + target.free)
                - (cnt.weekday + cnt.friSun + cnt.sat);
            score += typeShort * 100000 + totalShort * 10000;
        } else {
            const expected = getPacingExpected(m);
            if (expected) {
                const stats = dutyStats[m.name] || { weekday: 0, friSun: 0, sat: 0 };
                const tW = stats.weekday + cnt.weekday;
                const tF = stats.friSun + cnt.friSun;
                const tS = stats.sat + cnt.sat;
                const diff = dt === 'weekday' ? expected.weekday - tW
                    : dt === 'friSun' ? expected.friSun - tF
                    : expected.sat - tS;
                score += diff * 50000;
            }

            if (target && !target.isLocked) {
                const typeShort = dt === 'weekday' ? target.weekday - cnt.weekday
                    : dt === 'friSun' ? target.friSun - cnt.friSun
                    : target.sat - cnt.sat;
                const totalShort = (target.weekday + target.friSun + target.sat + target.free)
                    - (cnt.weekday + cnt.friSun + cnt.sat);
                score += typeShort * 10000 + totalShort * 5000;
            } else {
                if (monthlyTotal < 2) score += (2 - monthlyTotal) * 5000;
            }
        }
        return score;
    }

    // ── AC-3 propagation (자동결정점검) ───────────────────
    // dirtyDates: 재확인할 날짜 목록. 없으면 전체 pending 검사.
    function propagate(state: SearchState, dirtyDates?: string[]): SearchState {
        const assignments = [...state.assignments];
        const counts = copyCountsMap(state.counts);
        const pendingSet = new Set(state.pending);
        const unassigned = [...state.unassigned];

        // dirty queue: 후보 수가 바뀔 수 있는 날짜들
        let dirty = new Set<string>(dirtyDates ? dirtyDates.filter(d => pendingSet.has(d)) : pendingSet);

        while (dirty.size > 0) {
            const nextDirty = new Set<string>();
            for (const dateStr of dirty) {
                if (!pendingSet.has(dateStr)) continue;
                const cands = getCandidates(dateStr, assignments, counts);
                if (cands.length === 0) {
                    // 자동결정: 배정 불가 → unassigned
                    unassigned.push(dateStr);
                    pendingSet.delete(dateStr);
                } else if (cands.length === 1) {
                    // 자동결정: 후보 1명 → 강제 배정
                    const m = cands[0];
                    const dt = getDT(dateStr, m);
                    assignments.push({ dateStr, memberName: m.name, dutyType: dt });
                    const cnt = counts.get(m.name)!;
                    counts.set(m.name, incrCounts(cnt, dt));
                    pendingSet.delete(dateStr);
                    // 인접 날짜 재확인
                    for (const offset of [-2, -1, 1, 2]) {
                        const adj = addDaysStr(dateStr, offset);
                        if (pendingSet.has(adj)) nextDirty.add(adj);
                    }
                }
                // 2명 이상: 변화 없음
            }
            dirty = nextDirty;
        }

        return { assignments, counts, pending: Array.from(pendingSet), unassigned };
    }

    // ── Best solution tracking ────────────────────────────
    let bestCost = Infinity;
    let bestAssignments: AssignedDuty[] = [];
    let bestUnassigned: string[] = [];

    // ── Branch & Bound backtracking ───────────────────────
    function backtrack(state: SearchState, lastDateStr?: string): void {
        if (Date.now() - startTime > TIME_LIMIT_MS) return;

        // 자동결정점검
        const prop = propagate(
            state,
            lastDateStr ? [addDaysStr(lastDateStr, -2), addDaysStr(lastDateStr, -1),
                addDaysStr(lastDateStr, 1), addDaysStr(lastDateStr, 2)] : undefined
        );

        // 하한선 pruning: 이미 unassigned 비용만으로 최적해 초과
        if (prop.unassigned.length * 1000 >= bestCost) return;

        // 고정(Lock) 부대원의 목표 정밀 프루닝
        for (const [name, target] of targetMap) {
            if (target.isLocked) {
                const cnt = prop.counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                const total = cnt.weekday + cnt.friSun + cnt.sat;
                const totalTarget = target.weekday + target.friSun + target.sat + target.free;

                // 1. Upper bound check (초과 배정 여부)
                const excessWeekday = Math.max(0, cnt.weekday - target.weekday);
                const excessFriSun = Math.max(0, cnt.friSun - target.friSun);
                const excessSat = Math.max(0, cnt.sat - target.sat);
                if (excessWeekday + excessFriSun + excessSat > target.free) return;
                if (total > totalTarget) return;

                // 2. Lower bound check (남은 날짜로 목표 달성 가능 여부)
                let pendingWeekday = 0;
                let pendingFriSun = 0;
                let pendingSat = 0;
                for (const dateStr of prop.pending) {
                    const mo = memberByName.get(name);
                    if (mo) {
                        const dt = getDT(dateStr, mo);
                        if (dt === 'weekday') pendingWeekday++;
                        else if (dt === 'friSun') pendingFriSun++;
                        else if (dt === 'sat') pendingSat++;
                    }
                }

                const neededWeekday = Math.max(0, target.weekday - cnt.weekday);
                const neededFriSun = Math.max(0, target.friSun - cnt.friSun);
                const neededSat = Math.max(0, target.sat - cnt.sat);
                const neededTotal = totalTarget - total;

                if (neededWeekday > pendingWeekday) return;
                if (neededFriSun > pendingFriSun) return;
                if (neededSat > pendingSat) return;
                if (neededTotal > prop.pending.length) return;
            }
        }

        if (prop.pending.length === 0) {
            // locked member 최종 검증
            for (const [name, target] of targetMap) {
                if (target.isLocked) {
                    const cnt = prop.counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                    const total = cnt.weekday + cnt.friSun + cnt.sat;
                    const totalTarget = target.weekday + target.friSun + target.sat + target.free;
                    const isSatisfied = cnt.weekday >= target.weekday &&
                                        cnt.friSun >= target.friSun &&
                                        cnt.sat >= target.sat &&
                                        total === totalTarget;
                    if (!isSatisfied) {
                        return; // 목표 미충족 -> 무효화
                    }
                }
            }
            // 월 최소 1회 필수 규칙 최종 검증
            for (const m of members) {
                if (m.role === 'runner' || m.dutyCompleted || m.sections?.includes('SK')) continue;
                
                const stats = dutyStats[m.name] || { total: 0, weekday: 0, friSun: 0, sat: 0 };
                if (stats.weekday >= criteria.weekday && stats.friSun >= criteria.friSun && stats.sat >= criteria.sat) continue;

                const daysInMonthLocal = new Date(year, month + 1, 0).getDate();
                const lastDayStrLocal = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonthLocal).padStart(2, '0')}`;
                const firstDayStrLocal = `${year}-${String(month + 1).padStart(2, '0')}-01`;
                if (m.joinDate && lastDayStrLocal < m.joinDate) continue;

                let dischargeStrLocal: string | null = null;
                if (m.enlistmentDate) {
                    const enlist = new Date(m.enlistmentDate);
                    if (!isNaN(enlist.getTime())) {
                        const d = new Date(enlist);
                        d.setMonth(d.getMonth() + 18);
                        d.setDate(d.getDate() - 1);
                        dischargeStrLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    }
                }
                if (dischargeStrLocal && dischargeStrLocal < firstDayStrLocal) continue;

                const cnt = prop.counts.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
                const ext = existingCountsBase.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
                const total = cnt.weekday + cnt.friSun + cnt.sat + ext.weekday + ext.friSun + ext.sat;
                if (total < 1) {
                    return; // 최소 1회 미달 -> 무효화
                }
            }
            const cost = computeCost(prop.counts, prop.unassigned.length, prop.assignments);
            if (cost < bestCost) {
                bestCost = cost;
                bestAssignments = [...prop.assignments];
                bestUnassigned = [...prop.unassigned];
            }
            return;
        }

        const lb = computeCost(prop.counts, prop.unassigned.length, prop.assignments);
        if (lb >= bestCost) return;

        // MRV: 선택지가 가장 적은 날짜 선택
        let minCount = Infinity;
        let chosenDate = prop.pending[0];
        for (const dateStr of prop.pending) {
            const n = getCandidates(dateStr, prop.assignments, prop.counts).length;
            if (n < minCount) {
                minCount = n;
                chosenDate = dateStr;
                if (n === 0) break;
            }
        }

        const candidates = minCount === 0
            ? [] : getCandidates(chosenDate, prop.assignments, prop.counts);

        if (candidates.length === 0) {
            backtrack({
                ...prop,
                pending: prop.pending.filter(d => d !== chosenDate),
                unassigned: [...prop.unassigned, chosenDate]
            }, chosenDate);
            return;
        }

        // 부족분 내림차순 정렬 (best-first → 초기 pruning 강화)
        candidates.sort((a, b) => scoreMember(b, chosenDate, prop.counts) - scoreMember(a, chosenDate, prop.counts));

        const nextPending = prop.pending.filter(d => d !== chosenDate);

        for (const m of candidates) {
            if (Date.now() - startTime > TIME_LIMIT_MS) break;
            if (bestCost === 0) return;

            const dt = getDT(chosenDate, m);
            const newCounts = copyCountsMap(prop.counts);
            newCounts.set(m.name, incrCounts(newCounts.get(m.name)!, dt));

            backtrack({
                assignments: [...prop.assignments, { dateStr: chosenDate, memberName: m.name, dutyType: dt }],
                counts: newCounts,
                pending: nextPending,
                unassigned: prop.unassigned
            }, chosenDate);
        }
    }

    // ── 초기 탐욕적 해 (backtracking pruning 상한선 확보) ──
    {
        const initState = propagate({
            assignments: [],
            counts: copyCountsMap(initialCounts),
            pending: [...pendingDates],
            unassigned: []
        });

        let { assignments, counts, pending, unassigned } = initState;
        let currentPending = [...pending];
        
        while (currentPending.length > 0) {
            let minCount = Infinity;
            let chosenDate = currentPending[0];
            for (const dateStr of currentPending) {
                const n = getCandidates(dateStr, assignments, counts).length;
                if (n < minCount) {
                    minCount = n;
                    chosenDate = dateStr;
                    if (n === 0) break;
                }
            }
            
            const cands = minCount === 0 ? [] : getCandidates(chosenDate, assignments, counts);
            if (cands.length === 0) {
                unassigned = [...unassigned, chosenDate];
            } else {
                const best = cands.reduce((prev, cur) =>
                    scoreMember(cur, chosenDate, counts) > scoreMember(prev, chosenDate, counts) ? cur : prev
                );
                const dt = getDT(chosenDate, best);
                const newCounts = copyCountsMap(counts);
                newCounts.set(best.name, incrCounts(newCounts.get(best.name)!, dt));
                assignments = [...assignments, { dateStr: chosenDate, memberName: best.name, dutyType: dt }];
                counts = newCounts;
            }
            currentPending = currentPending.filter(d => d !== chosenDate);
        }
        
        let greedyValid = true;
        for (const [name, target] of targetMap) {
            if (target.isLocked) {
                const cnt = counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                const total = cnt.weekday + cnt.friSun + cnt.sat;
                const totalTarget = target.weekday + target.friSun + target.sat + target.free;
                if (cnt.weekday < target.weekday || cnt.friSun < target.friSun || cnt.sat < target.sat || total !== totalTarget) {
                    greedyValid = false;
                    break;
                }
            }
        }

        if (greedyValid) {
            bestCost = computeCost(counts, unassigned.length, assignments);
            bestAssignments = assignments;
            bestUnassigned = unassigned;
        }
    }

    // ── Backtracking 실행 ─────────────────────────────────
    backtrack({
        assignments: [],
        counts: copyCountsMap(initialCounts),
        pending: [...pendingDates],
        unassigned: []
    });

    // ── 경고 생성 ─────────────────────────────────────────
    const warnings: DistributeWarning[] = [];

    for (const dateStr of bestUnassigned) {
        warnings.push({ type: 'unassigned', dateStr });
    }

    for (const [name, target] of targetMap) {
        const newCnt: Counts = { weekday: 0, friSun: 0, sat: 0 };
        for (const a of bestAssignments) {
            if (a.memberName === name) {
                if (a.dutyType === 'weekday') newCnt.weekday++;
                else if (a.dutyType === 'friSun') newCnt.friSun++;
                else newCnt.sat++;
            }
        }
        const tW = newCnt.weekday;
        const tF = newCnt.friSun;
        const tS = newCnt.sat;
        const tAll = tW + tF + tS;
        const tTarget = target.weekday + target.friSun + target.sat + target.free;
        if (tW < target.weekday || tF < target.friSun || tS < target.sat || tAll < tTarget) {
            warnings.push({
                type: 'shortfall', memberName: name,
                targetWeekday: target.weekday, targetFriSun: target.friSun,
                targetSat: target.sat, targetFree: target.free,
                assignedWeekday: tW, assignedFriSun: tF, assignedSat: tS, assignedFree: 0
            });
        }
    }

    // ── 규칙 위반 검사 (브리핑용) ─────────────────────────
    const violations: RuleViolation[] = [];

    // isEligibleLocal is defined above

    // 1. 미배정 날짜
    for (const dateStr of bestUnassigned) {
        violations.push({
            ruleId: 'unassigned',
            level: 'soft',
            message: `${dateStr} 날짜에 배정된 대원이 없습니다.`,
            dates: [dateStr]
        });
    }

    // 2. 이틀 텀 제한 (필수 규칙)
    for (const m of members) {
        if (!isEligibleLocal(m)) continue;
        const mDuties = [
            ...(existingByMember.get(m.name) || []),
            ...bestAssignments.filter(a => a.memberName === m.name).map(a => a.dateStr)
        ].filter(dStr => {
            const d = parseLocalDate(dStr);
            const startLimit = new Date(year, month, -5);
            const endLimit = new Date(year, month + 1, 5);
            return d >= startLimit && d <= endLimit;
        }).sort();

        const newAssignedDates = new Set(bestAssignments.filter(a => a.memberName === m.name).map(a => a.dateStr));

        for (let i = 1; i < mDuties.length; i++) {
            const d1 = mDuties[i - 1];
            const d2 = mDuties[i];
            if (diffDays(d1, d2) <= 2) {
                if (newAssignedDates.has(d1) || newAssignedDates.has(d2)) {
                    violations.push({
                        ruleId: 'gap_2_day',
                        level: 'hard',
                        message: `${m.name} 대원이 이틀 이내에 다시 당직을 섭니다.`,
                        dates: [d1, d2],
                        memberName: m.name
                    });
                }
            }
        }
    }

    // 3. 개인 제한 (필수 규칙)
    for (const a of bestAssignments) {
        if (personalRestrictions[a.dateStr]?.includes(a.memberName)) {
            violations.push({
                ruleId: 'personal_restriction',
                level: 'hard',
                message: `${a.memberName} 대원이 개인 제한 날짜에 당직을 섭니다.`,
                dates: [a.dateStr],
                memberName: a.memberName
            });
        }
    }

    // 4. KTA/BLC 제한 (필수 규칙)
    for (const a of bestAssignments) {
        const mo = memberByName.get(a.memberName);
        if (mo) {
            const ms = mo.sections || [];
            // KTA check
            const mKta = ms.filter(s => ktaSections.includes(s));
            if (mKta.length > 0) {
                for (const ev of ktaDay0Events) {
                    const diff = diffDays(ev.startDate, a.dateStr);
                    if (diff >= -3 && diff <= 24) {
                        const r = restrictions[diff];
                        if (r && (mKta.some(s => r[s]) || (mKta.includes('KTA') && r['kta']) ||
                            (mKta.includes('MEDIC') && r['medic']) || (mKta.includes('PAO') && r['pao']))) {
                            violations.push({
                                ruleId: 'kta_blc_restriction',
                                level: 'hard',
                                message: `${a.memberName} 대원이 KTA 일정 제한 날짜에 당직을 섭니다.`,
                                dates: [a.dateStr],
                                memberName: a.memberName
                            });
                        }
                    }
                }
            }
            // BLC check
            const mBlc = ms.filter(s => blcSections.includes(s));
            if (mBlc.length > 0) {
                for (const ev of blcDay0Events) {
                    const diff = blcActiveDayFn(ev.startDate, a.dateStr);
                    if (diff >= -1 && diff <= 26) {
                        const r = blcRestrictions[diff];
                        if (r && (mBlc.some(s => r[s]) || (mBlc.includes('BLC') && r['blc']) ||
                            (mBlc.includes('S3') && r['s3']) || (mBlc.includes('PAO') && r['pao']))) {
                            violations.push({
                                ruleId: 'kta_blc_restriction',
                                level: 'hard',
                                message: `${a.memberName} 대원이 BLC 일정 제한 날짜에 당직을 섭니다.`,
                                dates: [a.dateStr],
                                memberName: a.memberName
                            });
                        }
                    }
                }
            }
        }
    }

    // 5. 월 최대 3회 제한 (필수 규칙)
    for (const m of members) {
        if (!isEligibleLocal(m)) continue;
        const newCnt = bestAssignments.filter(a => a.memberName === m.name).length;
        const ext = existingCountsBase.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
        const existing = ext.weekday + ext.friSun + ext.sat;
        const total = newCnt + existing;
        if (total > 3) {
            violations.push({
                ruleId: 'max_3_duties',
                level: 'hard',
                message: `${m.name} 대원의 이번 달 당직 횟수가 3회를 초과합니다 (총 ${total}회).`,
                memberName: m.name
            });
        }
    }

    // 6. 월 최소 1회 제한 (필수 규칙)
    for (const m of members) {
        if (!isEligibleLocal(m)) continue;
        const newCnt = bestAssignments.filter(a => a.memberName === m.name).length;
        const ext = existingCountsBase.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
        const existing = ext.weekday + ext.friSun + ext.sat;
        const total = newCnt + existing;
        if (total < 1) {
            violations.push({
                ruleId: 'min_1_duty',
                level: 'hard',
                message: `${m.name} 대원이 이번 달에 당직을 한 번도 서지 않습니다.`,
                memberName: m.name
            });
        }
    }

    // Helper for sections on a date
    const getSectionsOnDate = (dStr: string): string[] => {
        const names = existingByDate.get(dStr) || [];
        const newAssigns = bestAssignments.filter(a => a.dateStr === dStr).map(a => a.memberName);
        const allNames = [...names, ...newAssigns];
        const secs: string[] = [];
        for (const n of allNames) {
            const other = memberByName.get(n);
            if (other && other.sections) secs.push(...other.sections);
        }
        return secs;
    };

    // 7. 동일 섹션 3연속 제한 (필수 규칙)
    const newDatesSet = new Set(bestAssignments.map(a => a.dateStr));
    for (let i = 2; i < allDatesInMonth.length; i++) {
        const d1 = allDatesInMonth[i - 2];
        const d2 = allDatesInMonth[i - 1];
        const d3 = allDatesInMonth[i];
        if (!newDatesSet.has(d1) && !newDatesSet.has(d2) && !newDatesSet.has(d3)) continue;

        const s1 = getSectionsOnDate(d1);
        const s2 = getSectionsOnDate(d2);
        const s3 = getSectionsOnDate(d3);
        const common = s1.filter(s => s2.includes(s) && s3.includes(s));
        for (const s of common) {
            violations.push({
                ruleId: 'section_consecutive_3',
                level: 'hard',
                message: `${s} 섹션이 3일 연속으로 당직을 섭니다.`,
                dates: [d1, d2, d3]
            });
        }
    }

    // 8. 동일 섹션 2연속 제한 (선호 규칙)
    for (let i = 1; i < allDatesInMonth.length; i++) {
        const d1 = allDatesInMonth[i - 1];
        const d2 = allDatesInMonth[i];
        if (!newDatesSet.has(d1) && !newDatesSet.has(d2)) continue;

        const s1 = getSectionsOnDate(d1);
        const s2 = getSectionsOnDate(d2);
        const common = s1.filter(s => s2.includes(s));
        for (const s of common) {
            const isPart3 = violations.some(v => 
                v.ruleId === 'section_consecutive_3' && 
                v.message.includes(s) && 
                v.dates?.includes(d1) && 
                v.dates?.includes(d2)
            );
            if (!isPart3) {
                violations.push({
                    ruleId: 'section_consecutive_2',
                    level: 'soft',
                    message: `${s} 섹션이 2일 연속으로 당직을 섭니다.`,
                    dates: [d1, d2]
                });
            }
        }
    }

    // 9. 목표치 불일치
    for (const [name, target] of targetMap) {
        const mo = memberByName.get(name);
        if (!mo || !isEligibleLocal(mo)) continue;

        const newCnt = { weekday: 0, friSun: 0, sat: 0 };
        for (const a of bestAssignments) {
            if (a.memberName === name) {
                if (a.dutyType === 'weekday') newCnt.weekday++;
                else if (a.dutyType === 'friSun') newCnt.friSun++;
                else newCnt.sat++;
            }
        }
        const totalNew = newCnt.weekday + newCnt.friSun + newCnt.sat;
        const totalTarget = target.weekday + target.friSun + target.sat + target.free;

        const isLocked = !!target.isLocked;
        const isSatisfied = newCnt.weekday >= target.weekday &&
                            newCnt.friSun >= target.friSun &&
                            newCnt.sat >= target.sat &&
                            totalNew === totalTarget;
        const hasDiff = !isSatisfied;

        if (hasDiff) {
            const label = isLocked ? '고정' : '설정';
            const level = isLocked ? 'hard' : 'soft';
            violations.push({
                ruleId: isLocked ? 'locked_target_mismatch' : 'unlocked_target_mismatch',
                level,
                message: `${name} 대원의 ${label} 목표 당직 수치와 다르게 배정되었습니다. (목표: 평 ${target.weekday}/금일 ${target.friSun}/토 ${target.sat}/자유 ${target.free}, 실제 배정: 평 ${newCnt.weekday}/금일 ${newCnt.friSun}/토 ${newCnt.sat})`,
                memberName: name
            });
        }
    }

    return { assignments: bestAssignments, warnings, violations };
}
