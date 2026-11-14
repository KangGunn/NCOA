/**
 * 주간 출타 저장 요청(movement_save_jobs) 처리에 쓰는 순수 함수.
 * 외부 의존성이 없어 앱 쪽 단위 테스트(tests/movement.save-job.test.ts)에서 바로 불러 쓴다.
 *
 * 기간 규칙은 앱의 src/utils/movement/movement.edit-period.ts와 같다.
 * - 외박(잔류): 시작일이 이번 기간 핵심 구간(수~화) 안에 있으면 이번 기간 것.
 * - 휴가: 시작일이 핵심 구간 안에 있거나, 이번 기간 외박의 복귀일(또는 다음 날)에 출발하면 이번 기간 것.
 */

export interface PeriodWindow {
    coreStart: string;
    coreEnd: string;
}

export interface PassRecordInput {
    type: "pass" | "stay";
    startDate: string;
    endDate: string;
    reason: string;
}

export interface VacationRecordInput {
    startDate: string;
    endDate: string;
    reason: string;
}

/** 앱이 movement_save_jobs에 쓰는 요청 내용 */
export interface MovementSaveJobData {
    memberName: string;
    label?: string;
    periodWindow: PeriodWindow;
    /** null이면 이번 기간 외박(잔류) 기록을 지운다 */
    pass: PassRecordInput | null;
    /** null이면 이번 기간 휴가 기록을 지운다 */
    vacation: VacationRecordInput | null;
    sheet: {
        dayStatuses: Record<string, string>;
        cellUpdates: Record<string, string>;
    };
    /** 시트에 행이 아직 없는 신병의 인원 id (deferSheet와 함께) */
    memberId?: string;
    /** true면 시트에 쓰지 않고 인원 문서에 모아 둔다 (신병 정보가 채워지면 시트에 반영) */
    deferSheet?: boolean;
    status: "pending" | "running" | "done" | "failed";
    done?: { firestore?: boolean; sheet?: boolean };
    attempts?: number;
}

export interface MovementDoc {
    id: string;
    type: string;
    startDate: string;
    endDate: string;
}

export function addDaysIso(iso: string, days: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
}

function isPassToVacationLink(pass: { start: string; end: string }, vacStart: string): boolean {
    return vacStart === pass.end || vacStart === addDaysIso(pass.end, 1);
}

/** 대상자의 기록 중 이번 기간이 가진 외박(잔류)·휴가 문서 (앱의 splitMemberDocs와 같은 규칙) */
export function splitPeriodDocs(docs: MovementDoc[], window: PeriodWindow) {
    const inCore = (iso: string) => iso >= window.coreStart && iso <= window.coreEnd;
    const ownPassDocs = docs
        .filter((d) => (d.type === "pass" || d.type === "stay") && inCore(d.startDate))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ownPass = ownPassDocs[0] || null;
    const passRange = ownPass ? { start: ownPass.startDate, end: ownPass.endDate } : null;

    const ownVacDocs = docs
        .filter((d) => d.type === "vacation" && ((passRange && isPassToVacationLink(passRange, d.startDate)) || inCore(d.startDate)))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ownVac = (passRange && ownVacDocs.find((v) => isPassToVacationLink(passRange, v.startDate))) || ownVacDocs[0] || null;

    return { ownPass, ownPassDocs, ownVac, ownVacDocs };
}

export interface MovementWritePlan {
    updates: { id: string; data: Record<string, unknown> }[];
    creates: Record<string, unknown>[];
    deletes: string[];
}

/**
 * 요청대로 이번 기간 문서를 맞추려면 무엇을 고치고/만들고/지울지.
 * 같은 요청을 두 번 처리해도 결과가 같다 (처음에 만든 문서를 두 번째에는 고친다).
 */
export function planMovementWrites(existing: MovementDoc[], job: Pick<MovementSaveJobData, "memberName" | "periodWindow" | "pass" | "vacation">): MovementWritePlan {
    const split = splitPeriodDocs(existing, job.periodWindow);
    const plan: MovementWritePlan = { updates: [], creates: [], deletes: [] };

    if (job.pass) {
        const data = { type: job.pass.type, startDate: job.pass.startDate, endDate: job.pass.endDate, reason: job.pass.reason };
        if (split.ownPass) plan.updates.push({ id: split.ownPass.id, data });
        else plan.creates.push({ name: job.memberName, ...data });
        split.ownPassDocs.forEach((d) => { if (!split.ownPass || d.id !== split.ownPass.id) plan.deletes.push(d.id); });
    } else {
        split.ownPassDocs.forEach((d) => plan.deletes.push(d.id));
    }

    if (job.vacation) {
        const data = { startDate: job.vacation.startDate, endDate: job.vacation.endDate, reason: job.vacation.reason };
        if (split.ownVac) plan.updates.push({ id: split.ownVac.id, data });
        else plan.creates.push({ name: job.memberName, type: "vacation", ...data });
        split.ownVacDocs.forEach((d) => { if (!split.ownVac || d.id !== split.ownVac.id) plan.deletes.push(d.id); });
    } else {
        split.ownVacDocs.forEach((d) => plan.deletes.push(d.id));
    }

    return plan;
}
