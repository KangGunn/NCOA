/* eslint-disable @typescript-eslint/no-explicit-any */
import * as logger from "firebase-functions/logger";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { db } from "../config/firebase.config";
import { updateMemberScheduleInSheet } from "./sheetSync.service";
import { planMovementWrites, type MovementSaveJobData, type MovementDoc } from "../utils/movementSaveJob.util";
import { explainError } from "../utils/jobError.util";
import { getKSTDateStr } from "../utils/date.util";
import { needsSheetRow } from "../utils/recruitSheet.util";
import { addRecruitToSheet, deferRecruitSheet } from "./recruitSheet.service";

/** 한 번의 처리에서 실패하면 이만큼 기다렸다가 다시 시도한다 (그 뒤에도 실패하면 'failed') */
const RETRY_DELAYS_MS = [2000, 6000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 이번 기간의 외박(잔류)·휴가 문서를 요청 값으로 맞춘다 */
async function writeMovements(job: MovementSaveJobData) {
    const snap = await db.collection("movements").where("name", "==", job.memberName).get();
    const existing: MovementDoc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const plan = planMovementWrites(existing, job);

    const batch = db.batch();
    plan.updates.forEach((u) => batch.update(db.collection("movements").doc(u.id), { ...u.data, updatedAt: FieldValue.serverTimestamp() }));
    plan.creates.forEach((c) => batch.set(db.collection("movements").doc(), { ...c, createdAt: FieldValue.serverTimestamp() }));
    plan.deletes.forEach((id) => batch.delete(db.collection("movements").doc(id)));
    await batch.commit();
}

/** 대기 중인 요청을 '처리 중'으로 바꾼다. 이미 다른 실행이 가져갔으면 false (트리거가 두 번 와도 한 번만 처리) */
async function claim(ref: DocumentReference): Promise<MovementSaveJobData | null> {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as MovementSaveJobData | undefined;
        if (!data || data.status !== "pending") return null;
        tx.update(ref, { status: "running", startedAt: FieldValue.serverTimestamp() });
        return data;
    });
}

/**
 * 시트에 행이 아직 없는 신병: 출타 기록은 '신병#<id>' 이름으로 Firestore에 쓰고, 시트 칸은 인원 문서에 모아 둔다.
 * 그 사이 행이 이미 추가됐으면(실제 이름이 생김) 일반 저장처럼 실제 이름으로 처리하도록 바꾼 요청을 돌려준다.
 */
async function resolveDeferredJob(job: MovementSaveJobData): Promise<MovementSaveJobData> {
    if (!job.deferSheet || !job.memberId) return job;
    const snap = await db.collection("members").doc(job.memberId).get();
    const member: any = snap.data();
    if (member?.sheetRowName && member?.name) {
        return { ...job, memberName: String(member.name).trim(), deferSheet: false };
    }
    return job;
}

export async function processMovementSaveJob(ref: DocumentReference) {
    const claimed = await claim(ref);
    if (!claimed) return;
    const job = await resolveDeferredJob(claimed);

    const done = { ...(job.done || {}) };
    let attempts = job.attempts || 0;
    logger.info(`movement save job ${ref.id}: ${job.memberName}`);

    for (let round = 0; ; round++) {
        try {
            if (job.deferSheet && job.memberId) {
                // 시트에 행이 없는 신병: 기록 먼저, 시트 칸은 인원 문서에 모아 둔다
                if (!done.firestore) {
                    await writeMovements(job);
                    done.firestore = true;
                    await ref.update({ "done.firestore": true });
                }
                if (!done.sheet) {
                    const deferred = await deferRecruitSheet(job.memberId, job.sheet);
                    done.sheet = true;
                    await ref.update({ "done.sheet": true, sheetDeferred: true });
                    // 정보가 이미 다 채워졌는데 행 추가가 아직이면(예: 전에 실패) 지금 추가한다
                    if (!deferred.sheetRowName && needsSheetRow(deferred.member, getKSTDateStr())) {
                        await addRecruitToSheet(job.memberId);
                    }
                }
            }
            // 시트를 먼저 쓴다: 시트에 없는 이름·날짜면 여기서 멈추므로 기록만 따로 남지 않는다
            if (!done.sheet) {
                await updateMemberScheduleInSheet(job.memberName, job.sheet?.dayStatuses || {}, job.sheet?.cellUpdates || {});
                done.sheet = true;
                await ref.update({ "done.sheet": true });
            }
            if (!done.firestore) {
                await writeMovements(job);
                done.firestore = true;
            }
            await ref.update({
                status: "done",
                "done.firestore": true,
                lastError: FieldValue.delete(),
                errorDetail: FieldValue.delete(),
                finishedAt: FieldValue.serverTimestamp(),
            });
            return;
        } catch (err: any) {
            attempts += 1;
            const ex = explainError(err);
            logger.warn(`movement save job ${ref.id} failed (attempt ${attempts}): ${ex.detail}`);
            // 일시 오류만 다시 시도한다. 사람이 고쳐야 하는 오류는 바로 실패로 두고 이유를 남긴다.
            if (!ex.permanent && round < RETRY_DELAYS_MS.length) {
                await ref.update({ attempts, lastError: ex.message, errorDetail: ex.detail });
                await sleep(RETRY_DELAYS_MS[round]);
                continue;
            }
            await ref.update({ status: "failed", attempts, lastError: ex.message, errorDetail: ex.detail, finishedAt: FieldValue.serverTimestamp() });
            return;
        }
    }
}
