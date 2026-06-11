import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

// ── Types ─────────────────────────────────────────────────

export interface MemberDutyTarget {
    memberName: string;
    weekday: number;
    friSun: number;
    sat: number;
    free: number;
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

export interface DistributeResult {
    assignments: AssignedDuty[];
    warnings: DistributeWarning[];
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
    fixedAssignments: { dateStr: string; memberName: string; dutyType: DutyType }[];
}): DistributeResult {
    const {
        year, month, members, allDuties, allEvents,
        personalRestrictions, dutyHolidays,
        targets, restrictions, blcRestrictions,
        ktaSections, blcSections, fixedAssignments
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
                    if (other?.sections?.some(s => m.sections!.includes(s))) {
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
        if (t.weekday > 0 || t.friSun > 0 || t.sat > 0 || t.free > 0) {
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
    const fixedDates = new Set<string>(fixedAssignments.map(fa => fa.dateStr));
    const fixedArr: AssignedDuty[] = fixedAssignments.map(fa => ({ ...fa }));

    const pendingDates = allDatesInMonth.filter(d => !preAssigned.has(d) && !fixedDates.has(d));

    // Initial counts (existing + fixed)
    const initialCounts = new Map<string, Counts>();
    for (const [name, cnt] of existingCountsBase) initialCounts.set(name, { ...cnt });
    for (const fa of fixedAssignments) {
        const cnt = initialCounts.get(fa.memberName) || { weekday: 0, friSun: 0, sat: 0 };
        initialCounts.set(fa.memberName, incrCounts(cnt, fa.dutyType));
    }

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
            const diff = diffDays(na.dateStr, dateStr);
            if ((diff === 1 || diff === -1) && ms.length > 0) {
                const other = memberByName.get(na.memberName);
                if (other?.sections?.some(s => ms.includes(s))) return true;
            }
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
        const target = targetMap.get(name);
        if (!target) return false;
        const cnt = counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
        const total = cnt.weekday + cnt.friSun + cnt.sat;
        const totalTarget = target.weekday + target.friSun + target.sat + target.free;
        if (total >= totalTarget) return false;
        const freeUsed = Math.max(0, cnt.weekday - target.weekday)
            + Math.max(0, cnt.friSun - target.friSun)
            + Math.max(0, cnt.sat - target.sat);
        const freeLeft = target.free - freeUsed;
        if (dt === 'weekday' && cnt.weekday >= target.weekday && freeLeft <= 0) return false;
        if (dt === 'friSun' && cnt.friSun >= target.friSun && freeLeft <= 0) return false;
        if (dt === 'sat' && cnt.sat >= target.sat && freeLeft <= 0) return false;
        return true;
    }

    // ── getCandidates ─────────────────────────────────────
    function getCandidates(dateStr: string, assignments: AssignedDuty[], counts: Map<string, Counts>): CalendarMember[] {
        const result: CalendarMember[] = [];
        for (const m of members) {
            if (!targetMap.has(m.name)) continue;
            if (isRestricted(m, dateStr, assignments)) continue;
            if (!hasCapacity(m.name, getDT(dateStr, m), counts)) continue;
            result.push(m);
        }
        return result;
    }

    // ── computeCost ───────────────────────────────────────
    function computeCost(counts: Map<string, Counts>, unassignedCount: number): number {
        let cost = unassignedCount * 1000;
        for (const [name, target] of targetMap) {
            const cnt = counts.get(name) || { weekday: 0, friSun: 0, sat: 0 };
            const total = cnt.weekday + cnt.friSun + cnt.sat;
            const totalTarget = target.weekday + target.friSun + target.sat + target.free;
            cost += Math.max(0, target.weekday - cnt.weekday) * 100;
            cost += Math.max(0, target.friSun - cnt.friSun) * 100;
            cost += Math.max(0, target.sat - cnt.sat) * 100;
            cost += Math.max(0, totalTarget - total) * 10;
            cost += Math.max(0, total - totalTarget) * 50;
        }
        return cost;
    }

    // ── scoreMember: 부족분 클수록 우선 ───────────────────
    function scoreMember(m: CalendarMember, dateStr: string, counts: Map<string, Counts>): number {
        const target = targetMap.get(m.name)!;
        const cnt = counts.get(m.name) || { weekday: 0, friSun: 0, sat: 0 };
        const dt = getDT(dateStr, m);
        const typeShort = dt === 'weekday' ? target.weekday - cnt.weekday
            : dt === 'friSun' ? target.friSun - cnt.friSun
            : target.sat - cnt.sat;
        const totalShort = (target.weekday + target.friSun + target.sat + target.free)
            - (cnt.weekday + cnt.friSun + cnt.sat);
        return typeShort * 100 + totalShort;
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
    let bestAssignments: AssignedDuty[] = [...fixedArr];
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

        if (prop.pending.length === 0) {
            const cost = computeCost(prop.counts, prop.unassigned.length);
            if (cost < bestCost) {
                bestCost = cost;
                bestAssignments = [...prop.assignments];
                bestUnassigned = [...prop.unassigned];
            }
            return;
        }

        // 현재 상태 비용 하한선 pruning
        const lb = computeCost(prop.counts, prop.unassigned.length);
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
            assignments: [...fixedArr],
            counts: copyCountsMap(initialCounts),
            pending: [...pendingDates],
            unassigned: []
        });

        let { assignments, counts, pending, unassigned } = initState;
        for (const dateStr of [...pending]) {
            const cands = getCandidates(dateStr, assignments, counts);
            if (cands.length === 0) {
                unassigned = [...unassigned, dateStr];
            } else {
                const best = cands.reduce((prev, cur) =>
                    scoreMember(cur, dateStr, counts) > scoreMember(prev, dateStr, counts) ? cur : prev
                );
                const dt = getDT(dateStr, best);
                const newCounts = copyCountsMap(counts);
                newCounts.set(best.name, incrCounts(newCounts.get(best.name)!, dt));
                assignments = [...assignments, { dateStr, memberName: best.name, dutyType: dt }];
                counts = newCounts;
            }
        }
        bestCost = computeCost(counts, unassigned.length);
        bestAssignments = assignments;
        bestUnassigned = unassigned;
    }

    // ── Backtracking 실행 ─────────────────────────────────
    backtrack({
        assignments: [...fixedArr],
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
        const ex = existingCountsBase.get(name) || { weekday: 0, friSun: 0, sat: 0 };
        const tW = ex.weekday + newCnt.weekday;
        const tF = ex.friSun + newCnt.friSun;
        const tS = ex.sat + newCnt.sat;
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

    return { assignments: bestAssignments, warnings };
}
