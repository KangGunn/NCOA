import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

// ── Types ─────────────────────────────────────────────────

export interface MemberDutyTarget {
    memberName: string;
    weekday: number | null;
    friSun: number | null;
    sat: number | null;
    free: number | null;
    isLocked?: boolean;
}

export interface ResolvedMemberDutyTarget {
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

export function isDateDuringKtaPeriod(dateStr: string, allEvents: CalendarEvent[]): boolean {
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

export function isDateDuringBlcPeriod(dateStr: string, allEvents: CalendarEvent[]): boolean {
    const blcDay0s = allEvents.filter(e => e.type === 'blc' && e.memo?.includes('Day 0'));
    const isHoliday = (ds: string) => allEvents.some(e => e.type === 'holiday' && ds >= e.startDate && ds <= e.endDate);
    return blcDay0s.some(day0 => {
        if (dateStr < day0.startDate) return false;
        const diffDays = getBlcActiveDay(day0.startDate, dateStr, isHoliday);
        return diffDays >= 0 && diffDays <= 22;
    });
}

export function getActiveSectionsFor(member: CalendarMember, dateStr: string, allEvents: CalendarEvent[]): Set<string> {
    const active = new Set<string>();
    if (!member.sections) return active;
    for (const s of member.sections) {
        if (s === 'S6') continue;
        if ((s === 'KTA' || s === 'MEDIC') && !isDateDuringKtaPeriod(dateStr, allEvents)) continue;
        if (s === 'BLC' && !isDateDuringBlcPeriod(dateStr, allEvents)) continue;
        active.add(s);
    }
    return active;
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
            if (cnt < 22) {
                const cs = toDateStr(cur);
                const isSunday = cur.getDay() === 0;
                if (!isSunday && !isHoliday(cs)) {
                    cnt++;
                }
            } else {
                cnt++;
            }
        }
        return cnt;
    }
    return Math.round((tgt.getTime() - start.getTime()) / 86400000);
}



// ── Counts type ───────────────────────────────────────────

type Counts = { weekday: number; friSun: number; sat: number };

function incrCounts(c: Counts, dt: DutyType): Counts {
    if (dt === 'weekday') return { ...c, weekday: c.weekday + 1 };
    if (dt === 'friSun') return { ...c, friSun: c.friSun + 1 };
    return { ...c, sat: c.sat + 1 };
}


// ── Main function ─────────────────────────────────────────

export async function runAutoDistribute(params: {
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
    onProgress?: (info: { 
        progress: number; 
        message: string; 
        costBreakdown?: { label: string; cost: number }[];
    }) => void;
    cancelToken?: { isCancelled: boolean };
}): Promise<DistributeResult> {
    const {
        year, month, members, allDuties, allEvents,
        personalRestrictions, dutyHolidays,
        targets, restrictions, blcRestrictions,
        ktaSections, blcSections, dutyStats, currentDate, criteria,
        onProgress, cancelToken
    } = params;

    const TIME_LIMIT_MS = 150_000;
    const startTime = Date.now();

    // All dates in month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const allDatesInMonth: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
        allDatesInMonth.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }

    const isHoliday = (ds: string) =>
        allEvents.some(e => e.type === 'holiday' && e.holidayType !== 'duty' && ds >= e.startDate && ds <= e.endDate);

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
                    if (!other) continue;

                    const otherActiveOnDuty = getActiveSectionsFor(other, eDate, allEvents);
                    if (otherActiveOnDuty.size === 0) continue;

                    for (const offset of [-1, 1]) {
                        const candDate = addDaysStr(eDate, offset);
                        const mActiveOnCand = getActiveSectionsFor(m, candDate, allEvents);
                        const hasIntersection = Array.from(mActiveOnCand).some(s => otherActiveOnDuty.has(s));
                        if (hasIntersection) {
                            baseRestrictions.add(`${m.name}:${candDate}`);
                        }
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

    // Target map (Automatically adjust targets to be at least the pre-assigned count)
    const targetMap = new Map<string, ResolvedMemberDutyTarget>();
    for (const t of targets) {
        const ext = existingCountsBase.get(t.memberName) || { weekday: 0, friSun: 0, sat: 0 };
        const adjWeekday = Math.max(t.weekday || 0, ext.weekday);
        const adjFriSun = Math.max(t.friSun || 0, ext.friSun);
        const adjSat = Math.max(t.sat || 0, ext.sat);
        const adjFree = t.free || 0;
        if (adjWeekday > 0 || adjFriSun > 0 || adjSat > 0 || adjFree > 0 || t.isLocked) {
            targetMap.set(t.memberName, {
                memberName: t.memberName,
                weekday: adjWeekday,
                friSun: adjFriSun,
                sat: adjSat,
                free: adjFree,
                isLocked: t.isLocked
            });
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
                if (diff > 0 && diff <= 2) {
                    return true;
                }
            }
        }

        // Also check existing (pre-assigned) duties for same-person 2-day gap
        for (const offset of [-2, -1, 1, 2]) {
            const adjDate = addDaysStr(dateStr, offset);
            const existingNames = existingByDate.get(adjDate);
            if (existingNames && existingNames.includes(member.name)) {
                return true;
            }
        }

        const memberActiveOnDate = getActiveSectionsFor(member, dateStr, allEvents);

        if (memberActiveOnDate.size > 0) {
            const getActiveSectionsForAssignedOn = (dStr: string): Set<string> => {
                const names = existingByDate.get(dStr) || [];
                const newAssigns = newAssignments.filter(a => a.dateStr === dStr).map(a => a.memberName);
                const allNames = [...names, ...newAssigns];
                const activeSecs = new Set<string>();
                for (const name of allNames) {
                    const other = memberByName.get(name);
                    if (other) {
                        getActiveSectionsFor(other, dStr, allEvents).forEach(s => activeSecs.add(s));
                    }
                }
                return activeSecs;
            };

            const hasIntersection = (setA: Set<string>, setB: Set<string>) => {
                return Array.from(setA).some(s => setB.has(s));
            };

            const sMinus1 = getActiveSectionsForAssignedOn(addDaysStr(dateStr, -1));
            const sPlus1 = getActiveSectionsForAssignedOn(addDaysStr(dateStr, 1));

            if (hasIntersection(memberActiveOnDate, sMinus1)) return true;
            if (hasIntersection(memberActiveOnDate, sPlus1)) return true;
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
            if (expected && isEligibleLocal(m)) {
                const stats = dutyStats[name] || { weekday: 0, friSun: 0, sat: 0 };
                const tW = stats.weekday + cnt.weekday;
                const tF = stats.friSun + cnt.friSun;
                const tS = stats.sat + cnt.sat;
                const tAll = tW + tF + tS;

                cost += Math.pow(tW - expected.weekday, 2) * 2000;
                cost += Math.pow(tF - expected.friSun, 2) * 2000;
                cost += Math.pow(tS - expected.sat, 2) * 2000;
                cost += Math.pow(tAll - expected.total, 2) * 1000;
            }

            const target = targetMap.get(name);
            if (target) {
                if (!target.isLocked) {
                    const tW = target.weekday;
                    const tF = target.friSun;
                    const tS = target.sat;
                    const tFree = target.free;
                    const totalTarget = tW + tF + tS + tFree;

                    if (tW > 0) cost += Math.pow(Math.max(0, tW - (cnt.weekday + existing.weekday)), 2) * 200000;
                    if (tF > 0) cost += Math.pow(Math.max(0, tF - (cnt.friSun + existing.friSun)), 2) * 200000;
                    if (tS > 0) cost += Math.pow(Math.max(0, tS - (cnt.sat + existing.sat)), 2) * 200000;
                    
                    if (tFree > 0) {
                        cost += Math.pow(totalTarget - monthlyTotal, 2) * 200000;
                    } else if (totalTarget > 0) {
                        cost += Math.pow(Math.max(0, totalTarget - monthlyTotal), 2) * 200000;
                    }
                }
            } else if (isEligibleLocal(m)) {
                const ext = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                const existingTotal = ext.weekday + ext.friSun + ext.sat;
                const totalThisMonth = cnt.weekday + cnt.friSun + cnt.sat + existingTotal;
                cost += Math.pow(2 - totalThisMonth, 2) * 30000;
            }
        }

        const getSectionsOnDateLocal = (dStr: string): string[] => {
            const names = existingByDate.get(dStr) || [];
            const newAssigns = assignments.filter(a => a.dateStr === dStr).map(a => a.memberName);
            const allNames = [...names, ...newAssigns];
            const secs: string[] = [];
            for (const n of allNames) {
                const other = memberByName.get(n);
                if (other) {
                    getActiveSectionsFor(other, dStr, allEvents).forEach(s => secs.push(s));
                }
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

    // ── evaluateAssignments (전체 스케줄 비용 평가) ────────
    function evaluateAssignments(assignments: AssignedDuty[]): number {
        let cost = 0;
        const counts = new Map<string, Counts>();
        for (const m of members) counts.set(m.name, { weekday: 0, friSun: 0, sat: 0 });

        for (const a of assignments) {
            const m = memberByName.get(a.memberName);
            if (m) {
                if (isRestricted(m, a.dateStr, assignments)) {
                    cost += 1000000000; // 1 billion penalty for hard constraints
                }
                const cnt = counts.get(a.memberName)!;
                counts.set(a.memberName, incrCounts(cnt, a.dutyType));
            }
        }

        cost += computeCost(counts, 0, assignments);

        for (const [name, target] of targetMap) {
            if (target.isLocked) {
                const cnt = counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                const ext = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                
                const tW = cnt.weekday + ext.weekday;
                const tF = cnt.friSun + ext.friSun;
                const tS = cnt.sat + ext.sat;
                const totalThisMonth = tW + tF + tS;
                const totalTarget = target.weekday + target.friSun + target.sat + target.free;

                const wDiff = Math.max(0, target.weekday - tW);
                const fDiff = Math.max(0, target.friSun - tF);
                const sDiff = Math.max(0, target.sat - tS);
                const totalDiff = Math.abs(totalThisMonth - totalTarget);
                
                const totalMismatch = wDiff + fDiff + sDiff + totalDiff;
                if (totalMismatch > 0) {
                    cost += totalMismatch * 100000000; // 100 million penalty for locked target mismatch
                }
            }
        }

        for (const m of members) {
            if (!isEligibleLocal(m)) continue;

            const cnt = counts.get(m.name)!;
            const ext = existingCountsBase.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
            const total = cnt.weekday + cnt.friSun + cnt.sat + ext.weekday + ext.friSun + ext.sat;
            if (total < 1) {
                cost += 500000;
            }
        }
        return cost;
    }

    // ── Min-Conflicts Local Search 실행 ───────────────────
    let bestCost = Infinity;
    let bestAssignments: AssignedDuty[] = [];
    const bestUnassigned: string[] = []; // Local Search에서는 항상 모든 날짜를 채움
    let lastYieldTime = Date.now();

    let currentAssignments: AssignedDuty[] = [];
    const validMembers = members.filter(m => isEligibleLocal(m));

    // Initial assignment: 무작위 배정 (목표치가 있는 인원 우선 배치)
    const memberPool: string[] = [];
    for (const [name, target] of targetMap) {
        if (target.isLocked) {
            const ext = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
            const needed = (target.weekday + target.friSun + target.sat) - (ext.weekday + ext.friSun + ext.sat);
            for (let i = 0; i < needed; i++) memberPool.push(name);
        }
    }
    function generateInitialAssignments(): AssignedDuty[] {
        const assignments: AssignedDuty[] = [];
        const pool = [...memberPool];
        for (const dateStr of pendingDates) {
            let mName = '';
            if (pool.length > 0) {
                const rIdx = Math.floor(Math.random() * pool.length);
                mName = pool.splice(rIdx, 1)[0];
            } else {
                mName = validMembers[Math.floor(Math.random() * validMembers.length)].name;
            }
            const m = memberByName.get(mName)!;
            assignments.push({ dateStr, memberName: m.name, dutyType: getDT(dateStr, m) });
        }
        return assignments;
    }

    function getCostBreakdown(assignments: AssignedDuty[]): { label: string; cost: number }[] {
        function getRestrictionReason(member: CalendarMember, dateStr: string, newAssignments: AssignedDuty[]): string {
            if (member.role === 'runner') return '러너';
            if (member.dutyCompleted) return '당직 완료 상태';
            if (member.sections?.includes('SK')) return 'SK 섹션';
            if (member.joinDate) {
                const diff = diffDays(member.joinDate, dateStr);
                if (diff >= 0 && diff < 15) return `신병 보호기간`;
                if (diffDays(dateStr, member.joinDate) > 0) return `전입일 이전`;
            }
            if (personalRestrictions[dateStr]?.includes(member.name)) return '개인 사정';
            if (baseRestrictions.has(`${member.name}:${dateStr}`)) return '지정 제한(X)';

            const ms = member.sections || [];
            for (const na of newAssignments) {
                if (na.memberName === member.name && na.dateStr !== dateStr) {
                    const diff = Math.abs(diffDays(na.dateStr, dateStr));
                    if (diff > 0 && diff <= 2) {
                        return `이틀 이내 재배정 (${na.dateStr})`;
                    }
                }
            }

            for (const offset of [-2, -1, 1, 2]) {
                const adjDate = addDaysStr(dateStr, offset);
                const existingNames = existingByDate.get(adjDate);
                if (existingNames && existingNames.includes(member.name)) {
                    return `이틀 이내 재배정 (${adjDate})`;
                }
            }

            const memberActiveOnDate = getActiveSectionsFor(member, dateStr, allEvents);
            if (memberActiveOnDate.size > 0) {
                const getActiveSectionsForAssignedOn = (dStr: string): Set<string> => {
                    const names = existingByDate.get(dStr) || [];
                    const newAssigns = newAssignments.filter(a => a.dateStr === dStr && a.memberName !== member.name).map(a => a.memberName);
                    const allNames = [...names, ...newAssigns];
                    const activeSecs = new Set<string>();
                    for (const name of allNames) {
                        const other = memberByName.get(name);
                        if (other) {
                            getActiveSectionsFor(other, dStr, allEvents).forEach(s => activeSecs.add(s));
                        }
                    }
                    return activeSecs;
                };

                const hasIntersection = (setA: Set<string>, setB: Set<string>) => {
                    return Array.from(setA).some(s => setB.has(s));
                };

                const sMinus1 = getActiveSectionsForAssignedOn(addDaysStr(dateStr, -1));
                const sPlus1 = getActiveSectionsForAssignedOn(addDaysStr(dateStr, 1));

                if (hasIntersection(memberActiveOnDate, sMinus1)) {
                    const common = Array.from(memberActiveOnDate).filter(s => sMinus1.has(s));
                    return `연속근무 (전날 ${addDaysStr(dateStr, -1)}과 ${common.join(',')} 중복)`;
                }
                if (hasIntersection(memberActiveOnDate, sPlus1)) {
                    const common = Array.from(memberActiveOnDate).filter(s => sPlus1.has(s));
                    return `연속근무 (다음날 ${addDaysStr(dateStr, 1)}과 ${common.join(',')} 중복)`;
                }
            }

            const mKta = ms.filter(s => ktaSections.includes(s));
            if (mKta.length > 0) {
                for (const ev of ktaDay0Events) {
                    const diff = diffDays(ev.startDate, dateStr);
                    if (diff >= -3 && diff <= 24) {
                        const r = restrictions[diff];
                        if (r && (mKta.some(s => r[s]) || (mKta.includes('KTA') && r['kta']) ||
                            (mKta.includes('MEDIC') && r['medic']) || (mKta.includes('PAO') && r['pao']))) {
                            return `KTA 일정 제한 (Day ${diff})`;
                        }
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
                            (mBlc.includes('S3') && r['s3']) || (mBlc.includes('PAO') && r['pao']))) {
                            return `BLC 일정 제한 (Day ${diff})`;
                        }
                    }
                }
            }

            return '알 수 없는 제한';
        }

        const breakdown: { label: string; cost: number }[] = [];
        const counts = new Map<string, Counts>();
        for (const m of members) counts.set(m.name, { weekday: 0, friSun: 0, sat: 0 });

        for (const a of assignments) {
            const m = memberByName.get(a.memberName);
            if (m) {
                if (isRestricted(m, a.dateStr, assignments)) {
                    const reason = getRestrictionReason(m, a.dateStr, assignments);
                    breakdown.push({
                        label: `[필수제한 위반] ${m.name} (${a.dateStr} - ${reason})`,
                        cost: 1000000000
                    });
                }
                const cnt = counts.get(a.memberName)!;
                counts.set(a.memberName, incrCounts(cnt, a.dutyType));
            }
        }

        for (const [name, target] of targetMap) {
            if (target.isLocked) {
                const cnt = counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                const ext = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                
                const tW = cnt.weekday + ext.weekday;
                const tF = cnt.friSun + ext.friSun;
                const tS = cnt.sat + ext.sat;
                const totalThisMonth = tW + tF + tS;
                const totalTarget = target.weekday + target.friSun + target.sat + target.free;

                const wDiff = Math.max(0, target.weekday - tW);
                const fDiff = Math.max(0, target.friSun - tF);
                const sDiff = Math.max(0, target.sat - tS);
                const totalDiff = Math.abs(totalThisMonth - totalTarget);
                
                const totalMismatch = wDiff + fDiff + sDiff + totalDiff;
                if (totalMismatch > 0) {
                    breakdown.push({
                        label: `[고정 목표치 불일치] ${name} (목표: 평${target.weekday}/금일${target.friSun}/토${target.sat}/자유${target.free}, 실제: 평${tW}/금일${tF}/토${tS})`,
                        cost: totalMismatch * 100000000
                    });
                }
            }
        }

        for (const m of members) {
            if (!isEligibleLocal(m)) continue;
            const cnt = counts.get(m.name)!;
            const ext = existingCountsBase.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
            const total = cnt.weekday + cnt.friSun + cnt.sat + ext.weekday + ext.friSun + ext.sat;
            if (total < 1) {
                breakdown.push({
                    label: `[최소 1회 미배정] ${m.name} (한 번도 배정 안 됨)`,
                    cost: 500000
                });
            }
        }

        for (const m of members) {
            const name = m.name;
            const cnt = counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
            const existing = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
            const monthlyTotal = (cnt.weekday + cnt.friSun + cnt.sat) + (existing.weekday + existing.friSun + existing.sat);

            const expected = getPacingExpected(m);
            if (expected && isEligibleLocal(m)) {
                const stats = dutyStats[name] || { weekday: 0, friSun: 0, sat: 0 };
                const tW = stats.weekday + cnt.weekday;
                const tF = stats.friSun + cnt.friSun;
                const tS = stats.sat + cnt.sat;
                const tAll = tW + tF + tS;

                const pacingCost = Math.round(
                    Math.pow(tW - expected.weekday, 2) * 2000 +
                    Math.pow(tF - expected.friSun, 2) * 2000 +
                    Math.pow(tS - expected.sat, 2) * 2000 +
                    Math.pow(tAll - expected.total, 2) * 1000
                );
                if (pacingCost > 0) {
                    breakdown.push({
                        label: `[페이스 조율 편차] ${name} (실제 평${tW}/금일${tF}/토${tS}, 기대 평${expected.weekday.toFixed(1)}/금일${expected.friSun.toFixed(1)}/토${expected.sat.toFixed(1)})`,
                        cost: pacingCost
                    });
                }
            }

            const target = targetMap.get(name);
            if (target) {
                if (!target.isLocked) {
                    const tW = target.weekday;
                    const tF = target.friSun;
                    const tS = target.sat;
                    const tFree = target.free;
                    const totalTarget = tW + tF + tS + tFree;

                    let unlockedCost = 0;
                    if (tW > 0) unlockedCost += Math.pow(Math.max(0, tW - (cnt.weekday + existing.weekday)), 2) * 200000;
                    if (tF > 0) unlockedCost += Math.pow(Math.max(0, tF - (cnt.friSun + existing.friSun)), 2) * 200000;
                    if (tS > 0) unlockedCost += Math.pow(Math.max(0, tS - (cnt.sat + existing.sat)), 2) * 200000;
                    
                    if (tFree > 0) {
                        unlockedCost += Math.pow(totalTarget - monthlyTotal, 2) * 200000;
                    } else if (totalTarget > 0) {
                        unlockedCost += Math.pow(Math.max(0, totalTarget - monthlyTotal), 2) * 200000;
                    }

                    if (unlockedCost > 0) {
                        breakdown.push({
                            label: `[설정 목표치 편차] ${name} (목표 평${target.weekday}/금일${target.friSun}/토${target.sat}/자유${target.free}, 실제 평${cnt.weekday + existing.weekday}/금일${cnt.friSun + existing.friSun}/토${cnt.sat + existing.sat})`,
                            cost: Math.round(unlockedCost)
                        });
                    }
                }
            } else if (isEligibleLocal(m)) {
                const ext = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
                const existingTotal = ext.weekday + ext.friSun + ext.sat;
                const totalThisMonth = cnt.weekday + cnt.friSun + cnt.sat + existingTotal;
                const softTargetCost = Math.round(Math.pow(2 - totalThisMonth, 2) * 30000);
                if (softTargetCost > 0) {
                    breakdown.push({
                        label: `[월 2회 목표 편차] ${name} (실제 ${totalThisMonth}회 / 기대 2회)`,
                        cost: softTargetCost
                    });
                }
            }
        }

        const getSectionsOnDateLocal = (dStr: string): string[] => {
            const names = existingByDate.get(dStr) || [];
            const newAssigns = assignments.filter(a => a.dateStr === dStr).map(a => a.memberName);
            const allNames = [...names, ...newAssigns];
            const secs: string[] = [];
            for (const n of allNames) {
                const other = memberByName.get(n);
                if (other) {
                    getActiveSectionsFor(other, dStr, allEvents).forEach(s => secs.push(s));
                }
            }
            return secs;
        };

        let overlapCount = 0;
        for (let i = 1; i < allDatesInMonth.length; i++) {
            const d1 = allDatesInMonth[i - 1];
            const d2 = allDatesInMonth[i];
            const s1 = getSectionsOnDateLocal(d1);
            const s2 = getSectionsOnDateLocal(d2);
            overlapCount += s1.filter(s => s2.includes(s)).length;
        }
        if (overlapCount > 0) {
            breakdown.push({
                label: `[동일 섹션 연속 당직 편차]`,
                cost: overlapCount * 1000
            });
        }

        return breakdown.sort((a, b) => b.cost - a.cost);
    }

    currentAssignments = generateInitialAssignments();
    let currentCost = evaluateAssignments(currentAssignments);
    bestCost = currentCost;
    bestAssignments = [...currentAssignments];

    const MAX_STEPS = 50000;
    let step = 0;
    let temperature = 100000;
    let stepsSinceLastImprovement = 0;

    while (step < MAX_STEPS && bestCost > 0 && Date.now() - startTime < TIME_LIMIT_MS) {
        step++;

        const now = Date.now();
        if (now - lastYieldTime > 30) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (cancelToken?.isCancelled) {
                break;
            }
            lastYieldTime = Date.now();
            if (onProgress) {
                const progress = Math.min(99, Math.round((step / MAX_STEPS) * 100));
                const breakdown = getCostBreakdown(bestAssignments);
                onProgress({
                    progress,
                    message: `최소 충돌 알고리즘 최적화 중... (Step ${step.toLocaleString()}, 현재 잔여 오류치: ${Math.round(bestCost).toLocaleString()})`,
                    costBreakdown: breakdown
                });
            }
        }

        const op = Math.random();
        let nextAssignments = [...currentAssignments];

        if (op < 0.3) {
            // Min-Conflicts: 임의의 날짜를 골라 모든 후보군 중 가장 비용을 많이 줄이는 사람으로 교체
            const idx = Math.floor(Math.random() * pendingDates.length);
            const dateStr = pendingDates[idx];

            let bestM = validMembers[0];
            let minNextCost = Infinity;

            for (const m of validMembers) {
                nextAssignments[idx] = { dateStr, memberName: m.name, dutyType: getDT(dateStr, m) };
                const c = evaluateAssignments(nextAssignments);
                if (c < minNextCost) {
                    minNextCost = c;
                    bestM = m;
                }
            }
            nextAssignments[idx] = { dateStr, memberName: bestM.name, dutyType: getDT(dateStr, bestM) };
        } else if (op < 0.8 && pendingDates.length > 1) {
            // Swap: 두 날짜의 근무자를 서로 교환 (목표치 균형 유지에 유리)
            const idx1 = Math.floor(Math.random() * pendingDates.length);
            let idx2 = Math.floor(Math.random() * pendingDates.length);
            while (idx1 === idx2) {
                idx2 = Math.floor(Math.random() * pendingDates.length);
            }
            const a1 = nextAssignments[idx1];
            const a2 = nextAssignments[idx2];

            const m1 = memberByName.get(a1.memberName)!;
            const m2 = memberByName.get(a2.memberName)!;

            nextAssignments[idx1] = { dateStr: a1.dateStr, memberName: m2.name, dutyType: getDT(a1.dateStr, m2) };
            nextAssignments[idx2] = { dateStr: a2.dateStr, memberName: m1.name, dutyType: getDT(a2.dateStr, m1) };
        } else {
            // Random change: Local minima 탈출을 위한 무작위 교체
            const idx = Math.floor(Math.random() * pendingDates.length);
            const dateStr = pendingDates[idx];
            const m = validMembers[Math.floor(Math.random() * validMembers.length)];
            nextAssignments[idx] = { dateStr, memberName: m.name, dutyType: getDT(dateStr, m) };
        }

        const nextCost = evaluateAssignments(nextAssignments);

        // Simulated Annealing (가끔은 비용이 증가해도 수용하여 늪에서 빠져나옴)
        if (nextCost < currentCost) {
            currentAssignments = nextAssignments;
            currentCost = nextCost;
            if (currentCost < bestCost) {
                bestCost = currentCost;
                bestAssignments = [...currentAssignments];
                stepsSinceLastImprovement = 0;
            }
        } else {
            const acceptanceProbability = Math.exp((currentCost - nextCost) / temperature);
            if (Math.random() < acceptanceProbability) {
                currentAssignments = nextAssignments;
                currentCost = nextCost;
            }
        }

        stepsSinceLastImprovement++;
        temperature *= 0.9995;

        // 2,000 스텝 동안 개선이 없으면 다른 지역 탐색을 위해 무작위 재시작 (Random Restart)
        if (stepsSinceLastImprovement > 2000 && bestCost > 0) {
            currentAssignments = generateInitialAssignments();
            currentCost = evaluateAssignments(currentAssignments);
            temperature = 100000;
            stepsSinceLastImprovement = 0;
        }
    }

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
        const ext = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
        const tW = newCnt.weekday + ext.weekday;
        const tF = newCnt.friSun + ext.friSun;
        const tS = newCnt.sat + ext.sat;
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
        const target = targetMap.get(m.name);
        const totalTarget = target ? (target.weekday + target.friSun + target.sat + target.free) : 0;
        const newCnt = bestAssignments.filter(a => a.memberName === m.name).length;
        const ext = existingCountsBase.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
        const existing = ext.weekday + ext.friSun + ext.sat;
        const total = newCnt + existing;
        if (total > 3) {
            if (target && totalTarget > 3 && total <= totalTarget) {
                continue;
            }
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
        const target = targetMap.get(m.name);
        if (target) {
            const totalTarget = target.weekday + target.friSun + target.sat + target.free;
            if (totalTarget === 0) continue;
        }
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
            if (other) {
                getActiveSectionsFor(other, dStr, allEvents).forEach(s => secs.push(s));
            }
        }
        return secs;
    };

    // 7. 동일 섹션 연속 당직 제한 (필수 규칙)
    const newDatesSet = new Set(bestAssignments.map(a => a.dateStr));
    for (let i = 1; i < allDatesInMonth.length; i++) {
        const d1 = allDatesInMonth[i - 1];
        const d2 = allDatesInMonth[i];
        if (!newDatesSet.has(d1) && !newDatesSet.has(d2)) continue;

        const s1 = getSectionsOnDate(d1);
        const s2 = getSectionsOnDate(d2);
        const common = s1.filter(s => s2.includes(s));
        for (const s of common) {
            violations.push({
                ruleId: 'section_consecutive_2',
                level: 'hard',
                message: `${s} 섹션이 2일 연속으로 당직을 섭니다.`,
                dates: [d1, d2]
            });
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
        const ext = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
        const tW = newCnt.weekday + ext.weekday;
        const tF = newCnt.friSun + ext.friSun;
        const tS = newCnt.sat + ext.sat;
        const totalThisMonth = tW + tF + tS;
        const totalTarget = target.weekday + target.friSun + target.sat + target.free;

        const isLocked = !!target.isLocked;
        const isSatisfied = isLocked 
            ? (tW >= target.weekday && tF >= target.friSun && tS >= target.sat && totalThisMonth === totalTarget)
            : (tW >= target.weekday && tF >= target.friSun && tS >= target.sat && 
               (target.free > 0 ? totalThisMonth === totalTarget : totalThisMonth >= totalTarget));
        const hasDiff = !isSatisfied;

        if (hasDiff) {
            const label = isLocked ? '고정' : '설정';
            const level = isLocked ? 'hard' : 'soft';
            violations.push({
                ruleId: isLocked ? 'locked_target_mismatch' : 'unlocked_target_mismatch',
                level,
                message: `${name} 대원의 ${label} 목표 당직 수치와 다르게 배정되었습니다. (목표: 평 ${target.weekday}/금일 ${target.friSun}/토 ${target.sat}/자유 ${target.free}, 실제 배정: 평 ${tW}/금일 ${tF}/토 ${tS})`,
                memberName: name
            });
        }
    }

    return { assignments: bestAssignments, warnings, violations };
}
