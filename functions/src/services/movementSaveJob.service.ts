/* eslint-disable @typescript-eslint/no-explicit-any */
import * as logger from "firebase-functions/logger";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { db } from "../config/firebase.config";
import { updateMemberScheduleInSheet } from "./sheetSync.service";
import { planMovementWrites, type MovementSaveJobData, type MovementDoc } from "../utils/movementSaveJob.util";

/** 한 번의 처리에서 실패하면 이만큼 기다렸다가 다시 시도한다 (그 뒤에도 실패하면 'failed') */
const RETRY_DELAYS_MS = [2000, 6000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describeError(err: any): string {
    return err?.response?.data?.message || err?.message || String(err);
}

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

export async function processMovementSaveJob(ref: DocumentReference) {
    const job = await claim(ref);
    if (!job) return;

    const done = { ...(job.done || {}) };
    let attempts = job.attempts || 0;
    logger.info(`movement save job ${ref.id}: ${job.memberName}`);

    for (let round = 0; ; round++) {
        try {
            if (!done.firestore) {
                await writeMovements(job);
                done.firestore = true;
                await ref.update({ "done.firestore": true });
            }
            if (!done.sheet) {
                await updateMemberScheduleInSheet(job.memberName, job.sheet?.dayStatuses || {}, job.sheet?.cellUpdates || {});
                done.sheet = true;
            }
            await ref.update({
                status: "done",
                "done.sheet": true,
                lastError: FieldValue.delete(),
                finishedAt: FieldValue.serverTimestamp(),
            });
            return;
        } catch (err: any) {
            attempts += 1;
            const message = describeError(err);
            logger.warn(`movement save job ${ref.id} failed (attempt ${attempts}): ${message}`);
            if (round < RETRY_DELAYS_MS.length) {
                await ref.update({ attempts, lastError: message });
                await sleep(RETRY_DELAYS_MS[round]);
                continue;
            }
            await ref.update({ status: "failed", attempts, lastError: message, finishedAt: FieldValue.serverTimestamp() });
            return;
        }
    }
}
