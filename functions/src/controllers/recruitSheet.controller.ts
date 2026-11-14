import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { addRecruitToSheet } from "../services/recruitSheet.service";
import { needsSheetRow, recruitProfileChanged } from "../utils/recruitSheet.util";
import { getKSTDateStr } from "../utils/date.util";

/**
 * 전입 예정 신병의 이름·영문 이름·전화번호가 모두 채워지면 시트(NEW 탭) 인원 칸의 첫 빈 행에 추가하고,
 * 그동안 모아 둔 주간 출타를 시트에 반영한다.
 * 이름·영문 이름·전화번호·전입일·역할이 바뀐 쓰기에만 반응한다 (이 함수가 쓰는 필드로는 다시 돌지 않는다).
 */
export const addRecruitSheetRows = onDocumentWritten(
    { document: "members/{memberId}", timeoutSeconds: 120, memory: "256MiB" },
    async (event) => {
        const after = event.data?.after;
        if (!after?.exists) return;
        const afterData = after.data();
        const beforeData = event.data?.before?.exists ? event.data.before.data() : undefined;
        if (!recruitProfileChanged(beforeData, afterData)) return;
        if (!needsSheetRow(afterData, getKSTDateStr())) return;
        await addRecruitToSheet(after.id);
    }
);
