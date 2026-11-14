/* eslint-disable @typescript-eslint/no-explicit-any */
import * as logger from "firebase-functions/logger";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase.config";
import { addMemberRowToSheet, updateMemberScheduleInSheet } from "./sheetSync.service";
import { getKSTToday } from "./rankSync.service";
import { getKSTDateStr } from "../utils/date.util";
import { calculateRankFromEnlistment } from "../utils/rank.util";
import { dateFromIso } from "../utils/rankSync.util";
import { explainError } from "../utils/jobError.util";
import { mergeDeferredSheet, needsSheetRow, pendingRecruitKey, type DeferredSheet } from "../utils/recruitSheet.util";

/** 시트에 행이 생기기 전 신병의 저장분(시트 칸)을 인원 문서에 덧씌워 모아 둔다. 이미 행이 있으면 그 이름을 돌려준다. */
export async function deferRecruitSheet(memberId: string, sheet: Partial<DeferredSheet> | undefined): Promise<{ sheetRowName: string | null; member: any }> {
    const ref = db.collection("members").doc(memberId);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error(`인원 문서(${memberId})를 찾을 수 없습니다.`);
        const member: any = { id: snap.id, ...snap.data() };
        if (member.sheetRowName) return { sheetRowName: member.sheetRowName as string, member };
        const merged = mergeDeferredSheet(
            { dayStatuses: member.pendingDayStatuses, cellUpdates: member.pendingCellUpdates },
            sheet
        );
        // 날짜 키('11.29')에 점이 있어 필드 경로로 쓸 수 없으므로 지도 전체를 바꾼다
        tx.update(ref, { pendingDayStatuses: merged.dayStatuses, pendingCellUpdates: merged.cellUpdates });
        return { sheetRowName: null, member: { ...member, pendingDayStatuses: merged.dayStatuses, pendingCellUpdates: merged.cellUpdates } };
    });
}

/**
 * 신병 정보(이름·영문 이름·전화번호)가 모두 채워졌으면 시트에 행을 추가한다.
 * 1) 시트 인원 칸 첫 빈 행에 '계급 이름'  2) '신병#<id>' 출타 기록을 실제 이름으로  3) 모아 둔 칸을 시트에 반영
 * 실패하면 인원 문서에 sheetRowError를 남긴다 (트리거는 이 필드 변경으로 다시 돌지 않는다).
 */
export async function addRecruitToSheet(memberId: string): Promise<void> {
    const ref = db.collection("members").doc(memberId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const member: any = { id: snap.id, ...snap.data() };
    if (!needsSheetRow(member, getKSTDateStr())) return;

    const pureName = (member.name || "").trim();
    try {
        const enlistment = dateFromIso(member.enlistmentDate || "");
        const rank = enlistment
            ? calculateRankFromEnlistment(enlistment, member.earlyPromotion || 0, getKSTToday())
            : (member.rank || "").split(" ")[0];
        const rowLabel = rank ? `${rank} ${pureName}` : pureName;

        await addMemberRowToSheet(rowLabel);

        // 출타 기록 이름을 실제 이름으로
        const pending = await db.collection("movements").where("name", "==", pendingRecruitKey(memberId)).get();
        if (!pending.empty) {
            const batch = db.batch();
            pending.docs.forEach((d) => batch.update(d.ref, { name: pureName, updatedAt: FieldValue.serverTimestamp() }));
            await batch.commit();
        }

        // 모아 둔 칸을 시트에 반영 (시트 범위를 벗어난 지난 날짜는 건너뛴다)
        const dayStatuses = member.pendingDayStatuses || {};
        const cellUpdates = member.pendingCellUpdates || {};
        if (Object.keys(dayStatuses).length > 0 || Object.keys(cellUpdates).length > 0) {
            await updateMemberScheduleInSheet(pureName, dayStatuses, cellUpdates, { ignoreMissingDates: true });
        }

        await ref.update({
            sheetRowName: rowLabel,
            sheetRowAddedAt: FieldValue.serverTimestamp(),
            pendingDayStatuses: FieldValue.delete(),
            pendingCellUpdates: FieldValue.delete(),
            sheetRowError: FieldValue.delete(),
        });
        logger.info(`addRecruitToSheet: ${rowLabel} (${memberId}) added, ${pending.size} movements renamed`);
    } catch (err: any) {
        const ex = explainError(err);
        logger.error(`addRecruitToSheet failed for ${memberId}: ${ex.detail}`);
        await ref.update({ sheetRowError: ex.message });
    }
}
