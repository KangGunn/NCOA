import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { processMovementSaveJob } from "../services/movementSaveJob.service";

/**
 * 앱이 주간 출타 저장 요청(movement_save_jobs)을 쓰면 서버가 Firestore 기록과 시트 반영을 처리한다.
 * 앱을 닫아도 계속된다. 상태가 'pending'일 때만 처리한다 — 새 요청, 또는 앱에서 [다시 시도]로 되돌린 요청.
 */
export const processMovementSaveJobs = onDocumentWritten(
    { document: "movement_save_jobs/{jobId}", timeoutSeconds: 120, memory: "256MiB" },
    async (event) => {
        const after = event.data?.after;
        if (!after?.exists) return;
        if (after.data()?.status !== "pending") return;
        await processMovementSaveJob(after.ref);
    }
);
