/* eslint-disable @typescript-eslint/no-explicit-any */
import * as logger from "firebase-functions/logger";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { db } from "../config/firebase.config";
import { syncMovements } from "./sheetSync.service";
import { planImportFirestore, type ImportMovement, type ExistingDoc } from "../utils/movementImport.util";
import { explainError } from "../utils/jobError.util";

/** 실패하면 이만큼 기다렸다가 다시 시도한다 (그 뒤에도 실패하면 'failed') */
const RETRY_DELAYS_MS = [2000, 6000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MovementImportJobData {
    movements: ImportMovement[];
    /** 엑셀의 기준 주말 'YYYY-MM-DD' — 월.일마다 이 날짜에서 가장 가까운 연도를 쓴다 */
    anchorIso?: string;
    /** 예전 요청 호환: 기준 주말이 없으면 이 연도를 쓴다 */
    year?: number;
    status: "pending" | "running" | "done" | "failed" | "ambiguous" | "warning" | "discarded";
    done?: { sheet?: boolean; firestore?: boolean };
    count?: number;
    ambiguousMembers?: any[];
    attempts?: number;
    lastError?: string;
}

async function claim(ref: DocumentReference): Promise<MovementImportJobData | null> {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as MovementImportJobData | undefined;
        if (!data || data.status !== "pending") return null;
        tx.update(ref, { status: "running", startedAt: FieldValue.serverTimestamp() });
        return data;
    });
}

/** Firestore 기록: 겹치는 기존 기록 삭제 + 새 기록 추가를 한 번의 일괄 쓰기로 (중간에 실패해도 반쪽이 남지 않는다) */
async function writeFirestore(job: MovementImportJobData) {
    const names = [...new Set(job.movements.map((m) => (m.name || "").replace(/^(병장|상병|일병|이병)\s*/, "")))];
    const existing: ExistingDoc[] = [];
    for (let i = 0; i < names.length; i += 30) {
        const snap = await db.collection("movements").where("name", "in", names.slice(i, i + 30)).get();
        snap.docs.forEach((d) => existing.push({ id: d.id, ...(d.data() as any) }));
    }
    const plan = planImportFirestore(job.movements, existing, job.anchorIso || job.year || new Date().getFullYear());
    const batch = db.batch();
    plan.deleteIds.forEach((id) => batch.delete(db.collection("movements").doc(id)));
    plan.adds.forEach((data) => batch.set(db.collection("movements").doc(), { ...data, createdAt: FieldValue.serverTimestamp() }));
    await batch.commit();
}

export async function processMovementImportJob(ref: DocumentReference) {
    const job = await claim(ref);
    if (!job) return;
    const done = { ...(job.done || {}) };
    let attempts = job.attempts || 0;
    let count = job.count || 0;
    logger.info(`movement import job ${ref.id}: ${job.movements.length} items`);

    for (let round = 0; ; round++) {
        try {
            if (!done.sheet) {
                const res: any = await syncMovements(job.movements as any[]);
                if (res.status === "ambiguous") {
                    // 동명이인: 아무것도 쓰지 않았다. 앱에서 골라서 다시 보내면 새 요청이 된다.
                    await ref.update({ status: "ambiguous", ambiguousMembers: res.ambiguousMembers || [] });
                    return;
                }
                if (res.status === "warning") {
                    // 시트에 없는 이름·날짜: 아무것도 쓰지 않았다. 앱의 검토 화면에 경고로 보여 주고 반영을 막는다.
                    await ref.update({ status: "warning", warnings: res.warnings || [], lastError: res.message || "" });
                    return;
                }
                if (res.status !== "success") throw new Error(res.message || "시트 반영에 실패했습니다.");
                count = res.count || 0;
                done.sheet = true;
                await ref.update({ "done.sheet": true, count });
            }
            if (!done.firestore) {
                await writeFirestore(job);
                done.firestore = true;
                await ref.update({ "done.firestore": true });
            }
            await ref.update({ status: "done", count, lastError: FieldValue.delete(), errorDetail: FieldValue.delete(), finishedAt: FieldValue.serverTimestamp() });
            return;
        } catch (err: any) {
            attempts += 1;
            const ex = explainError(err);
            logger.warn(`movement import job ${ref.id} failed (attempt ${attempts}): ${ex.detail}`);
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
