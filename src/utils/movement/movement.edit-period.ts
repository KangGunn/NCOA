/**
 * 주간 출타 편집에서 "이번 기간이 가진 기록"을 정하고, 잔디 상태와 시트 셀 값을 계산하는 순수 함수.
 * (tests/movement.edit-period.test.ts)
 *
 * 기간 규칙
 * - 외박: 시작일이 이번 기간 핵심 구간(수~화, 7일) 안에 있으면 이번 기간 것.
 * - 휴가: 시작일이 핵심 구간 안에 있거나, 이번 기간 외박의 복귀일(또는 다음 날)에 출발하면(외휴연계) 이번 기간 것.
 * - 그 밖의 휴가(이전 기간에 시작해 이어지는 휴가, 다음 기간에 시작하는 휴가)는 이번 화면에서 바꾸거나 지우지 않는다.
 *
 * 날짜는 'YYYY-MM-DD', 시트/잔디 키는 'M.D'.
 */
import { addDaysIso } from './movement.edit-validation.ts';
import { composeSheetCell } from './movement.sheet-cell.ts';

export interface DateRange {
    start: string;
    end: string;
}

export interface PeriodWindow {
    /** 핵심 구간 시작 (수요일) */
    coreStart: string;
    /** 핵심 구간 끝 (다음 주 화요일) */
    coreEnd: string;
}

export function isoToMD(iso: string): string {
    const [, m, d] = iso.split('-').map(Number);
    return `${m}.${d}`;
}

/** start~end를 포함한 날짜 목록. 범위가 잘못되었거나 너무 길면(> maxDays) 빈 배열. */
export function eachIsoDate(start: string, end: string, maxDays = 120): string[] {
    if (!start || !end || start > end) return [];
    const out: string[] = [];
    let cur = start;
    while (cur && cur <= end && out.length < maxDays) {
        out.push(cur);
        cur = addDaysIso(cur, 1);
    }
    return out;
}

export function inRange(iso: string, range: DateRange | null | undefined): boolean {
    return !!range && iso >= range.start && iso <= range.end;
}

/** 외박이 차지하는 날: 출발일(시작 전날) ~ 복귀일 */
export function passOccupiedRange(pass: DateRange): DateRange {
    return { start: addDaysIso(pass.start, -1), end: pass.end };
}

/** 외휴연계: 외박 복귀일(또는 다음 날)에 휴가 출발 */
export function isPassToVacationLink(pass: DateRange, vac: DateRange): boolean {
    return vac.start === pass.end || vac.start === addDaysIso(pass.end, 1);
}

export function vacationBelongsToPeriod(vac: DateRange, window: PeriodWindow, periodPass: DateRange | null): boolean {
    if (periodPass && isPassToVacationLink(periodPass, vac)) return true;
    return vac.start >= window.coreStart && vac.start <= window.coreEnd;
}

export function passBelongsToPeriod(pass: DateRange, window: PeriodWindow): boolean {
    return pass.start >= window.coreStart && pass.start <= window.coreEnd;
}

export interface MovementDocLike {
    type: string;
    startDate: string;
    endDate: string;
}

/**
 * 대상자의 기록을 이번 기간이 가진 것(편집·저장 시 덮어쓰거나 지움)과 다른 기간 것(그대로 둠)으로 나눈다.
 * 휴가 소속은 편집 전 외박을 기준으로 정한다 — 외박 날짜를 옮겨도 다른 기간 휴가가 끌려오지 않는다.
 */
export function splitMemberDocs<T extends MovementDocLike>(docs: T[], window: PeriodWindow) {
    const ownPassDocs = docs
        .filter(d => (d.type === 'pass' || d.type === 'stay') && passBelongsToPeriod({ start: d.startDate, end: d.endDate }, window))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ownPass = ownPassDocs[0] || null;
    const ownPassRange = ownPass ? { start: ownPass.startDate, end: ownPass.endDate } : null;

    const ownVacDocs = docs
        .filter(d => d.type === 'vacation' && vacationBelongsToPeriod({ start: d.startDate, end: d.endDate }, window, ownPassRange))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ownVac = (ownPassRange && ownVacDocs.find(v => isPassToVacationLink(ownPassRange, { start: v.startDate, end: v.endDate })))
        || ownVacDocs[0]
        || null;

    const owned = new Set<T>([...ownPassDocs, ...ownVacDocs]);
    const retainedDocs = docs.filter(d => !owned.has(d));

    return { ownPass, ownPassDocs, ownVac, ownVacDocs, retainedDocs };
}

/**
 * isMember(iso)가 참인 날이 이어진 구간 중 iso를 포함하는 것을 찾는다 (앞뒤로 최대 maxDays일).
 */
export function findRun(iso: string, isMember: (iso: string) => boolean, maxDays = 60): DateRange | null {
    if (!isMember(iso)) return null;
    let start = iso;
    let end = iso;
    for (let i = 0; i < maxDays; i++) {
        const prev = addDaysIso(start, -1);
        if (!isMember(prev)) break;
        start = prev;
    }
    for (let i = 0; i < maxDays; i++) {
        const next = addDaysIso(end, 1);
        if (!isMember(next)) break;
        end = next;
    }
    return { start, end };
}

/** 핵심 구간 안에서 시작하는 첫 번째 구간 (구간 시작이 핵심 구간 앞이면 이번 기간 것이 아님) */
export function findRunStartingInWindow(window: PeriodWindow, isMember: (iso: string) => boolean): DateRange | null {
    for (const iso of eachIsoDate(window.coreStart, window.coreEnd)) {
        if (!isMember(iso)) continue;
        const run = findRun(iso, isMember);
        if (run && run.start >= window.coreStart) return run;
    }
    return null;
}

export interface EditedState {
    hasPass: boolean;
    passStart: string;
    passEnd: string;
    hasVacation: boolean;
    vacationStart: string;
    vacationEnd: string;
}

function editedPass(s: EditedState): DateRange | null {
    return s.hasPass && s.passStart && s.passEnd && s.passStart <= s.passEnd ? { start: s.passStart, end: s.passEnd } : null;
}

function editedVacation(s: EditedState): DateRange | null {
    return s.hasVacation && s.vacationStart && s.vacationEnd && s.vacationStart <= s.vacationEnd
        ? { start: s.vacationStart, end: s.vacationEnd }
        : null;
}

export interface StatusContext extends EditedState {
    /** 편집 전 이번 기간 기록이 차지하던 날 (외박 출발일 포함). 새 값이 덮지 않으면 비운다. */
    ownedOriginalDates: string[];
    /** 다른 기간의 휴가 (그대로 둔다) */
    retainedVacations: DateRange[];
    /** 다른 기간의 외박 (그대로 둔다) */
    retainedPasses: DateRange[];
    isDutyOn: (iso: string) => boolean;
}

/**
 * 타임라인 각 날짜의 잔디 상태.
 * timeline: [{ md: '11.11', iso: '2026-11-11' }, ...], initial: 편집 전 상태 (키 'M.D')
 */
export function computeEditedDayStatuses(
    timeline: { md: string; iso: string }[],
    initial: Record<string, string>,
    ctx: StatusContext
): Record<string, string> {
    const out: Record<string, string> = { ...initial };
    const pass = editedPass(ctx);
    const vac = editedVacation(ctx);
    const passDepart = pass ? addDaysIso(pass.start, -1) : '';
    const isLinked = !!(pass && vac && pass.end === vac.start);
    const owned = new Set(ctx.ownedOriginalDates);
    const vacationReturnDays = new Set<string>([
        ...(vac ? [vac.end] : []),
        ...ctx.retainedVacations.map(v => v.end)
    ]);

    for (const { md, iso } of timeline) {
        const initialStatus = initial[md] || 'none';
        const isPassDay = inRange(iso, pass);
        const isDepartDay = !!pass && iso === passDepart;
        const isVacDay = inRange(iso, vac);
        // 당직과 리커버리는 외박·휴가 입력과 상관없이 항상 잔디에 보인다 (당직과 겹치는 입력은 저장 시 검사로 막는다)
        const isDutyDay = initialStatus === 'duty' || ctx.isDutyOn(iso);
        const isRecoveryDay = !isDutyDay && (
            initialStatus === 'recovery' || initialStatus === 'recovery-pass-depart' || ctx.isDutyOn(addDaysIso(iso, -1))
        );

        if (isDutyDay) {
            out[md] = 'duty';
        } else if (isRecoveryDay) {
            // 리커버리 날이 외박 출발일이면 반반 잔디 (외특 탭 카드와 같은 규칙)
            out[md] = isDepartDay ? 'recovery-pass-depart' : 'recovery';
        } else if (isLinked && iso === vac!.start) {
            out[md] = 'linked';
        } else if (vacationReturnDays.has(iso) && (isDepartDay || (isPassDay && iso === pass!.start))) {
            out[md] = 'vacation-pass-depart';
        } else if (isVacDay) {
            out[md] = 'vacation';
        } else if (isPassDay) {
            out[md] = 'pass';
        } else if (isDepartDay) {
            out[md] = 'pass-depart';
        } else if (owned.has(iso)) {
            // 원래 이번 기간 기록이었는데 이제 덮이지 않는 날: 다른 기간 기록에 속하면 그 상태로, 아니면 비움
            if (ctx.retainedVacations.some(v => inRange(iso, v))) out[md] = 'vacation';
            else if (ctx.retainedPasses.some(p => inRange(iso, p))) out[md] = 'pass';
            else if (ctx.retainedPasses.some(p => iso === addDaysIso(p.start, -1))) out[md] = 'pass-depart';
            else out[md] = 'none';
        } else {
            out[md] = initialStatus;
        }
    }
    return out;
}

export interface CellUpdateContext extends StatusContext {
    allowVacationPassLink: boolean;
}

function vacationCellValue(iso: string, v: DateRange, linkedStart: boolean): string {
    // 출발일: 외휴연계면 '외박복귀/휴가출발', 당일 휴가면 '휴가출발/휴가복귀' (둘 다면 '외박복귀/휴가출발/휴가복귀')
    if (iso === v.start) return composeSheetCell({ passReturn: linkedStart, vacationDepart: true, vacationReturn: v.start === v.end }, false);
    if (iso === v.end) return '휴가복귀';
    return '휴가';
}

/**
 * 시트에 쓸 셀 값 (키 'M.D'). 백엔드는 이 키에 해당하는 날짜 열만 고친다.
 * 원래 이번 기간 기록이 차지하던 날은 핵심 구간 밖(타임라인 뒤쪽, 다음 주)이라도 새 값이 없으면 비운다.
 */
export function buildCellUpdates(ctx: CellUpdateContext): Record<string, string> {
    const cells: Record<string, string> = {};
    const pass = editedPass(ctx);
    const vac = editedVacation(ctx);
    const isLinked = !!(pass && vac && pass.end === vac.start);
    const passDepart = pass ? addDaysIso(pass.start, -1) : '';

    // 1. 원래 차지하던 날 중 새 값이 덮지 않는 날 비우기 (다른 기간 기록에 속하면 그 값으로 되돌림)
    for (const iso of ctx.ownedOriginalDates) {
        const coveredByPass = !!pass && inRange(iso, passOccupiedRange(pass));
        const coveredByVac = inRange(iso, vac);
        if (coveredByPass || coveredByVac) continue;

        const md = isoToMD(iso);
        const retainedVac = ctx.retainedVacations.find(v => inRange(iso, v));
        const retainedPass = ctx.retainedPasses.find(p => inRange(iso, passOccupiedRange(p)));
        if (retainedVac) {
            cells[md] = vacationCellValue(iso, retainedVac, ctx.retainedPasses.some(p => p.end === retainedVac.start));
        } else if (retainedPass) {
            cells[md] = iso === addDaysIso(retainedPass.start, -1) ? '외박출발' : iso === retainedPass.end ? '외박복귀' : '외박';
        } else if (ctx.isDutyOn(iso)) {
            cells[md] = '당직';
        } else {
            cells[md] = '';
        }
    }

    // 2. 새 외박
    if (pass) {
        // 시작 전날이 당직이면 리커버리 날(외박 첫날)에 바로 출발한다. 당직 칸에 '외박출발'을 쓰지 않는다.
        // 다른 기간 외박이 출발일에 복귀하면 '외박복귀/외박출발'
        cells[isoToMD(passDepart)] = composeSheetCell({ passReturn: ctx.retainedPasses.some(p => p.end === passDepart), passDepart: true }, false);
        for (const iso of eachIsoDate(pass.start, pass.end)) {
            if (iso !== pass.end) {
                cells[isoToMD(iso)] = '외박';
                continue;
            }
            // 복귀일: 외휴연계면 휴가출발까지(당일 휴가면 휴가복귀까지), 다음 외박이 그날 출발하면 외박출발까지 함께 적는다
            cells[isoToMD(iso)] = composeSheetCell({
                passReturn: true,
                vacationDepart: isLinked,
                vacationReturn: isLinked && vac!.start === vac!.end,
                passDepart: !isLinked && ctx.retainedPasses.some(p => addDaysIso(p.start, -1) === iso),
            }, false);
        }
    }

    // 3. 새 휴가
    if (vac) {
        for (const iso of eachIsoDate(vac.start, vac.end)) {
            if (iso === vac.start && isLinked) continue; // 외박 복귀일 칸('외박복귀/휴가출발')을 그대로 둔다
            cells[isoToMD(iso)] = vacationCellValue(iso, vac, false);
        }
    }

    // 4. 휴외연계: 휴가 복귀일에 외박 출발 (이번 기간 휴가 또는 다른 기간 휴가)
    if (pass) {
        const vacations = [...(vac ? [vac] : []), ...ctx.retainedVacations];
        const returning = vacations.find(v => v.end === pass.start) || vacations.find(v => v.end === passDepart);
        if (returning) {
            const departCell = returning.end;
            // 휴가복귀/외박출발 (허용이면 '휴가복귀(연계)/외박출발'), 당일 휴가면 '휴가출발/휴가복귀/외박출발'
            cells[isoToMD(departCell)] = composeSheetCell(
                { vacationDepart: returning.start === returning.end, vacationReturn: true, passDepart: true },
                ctx.allowVacationPassLink,
            );
        }
    }

    return cells;
}
