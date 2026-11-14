import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { processMovementImportJob } from "../services/movementImport.service";

/**
 * 앱이 엑셀 반영 요청(movement_import_jobs)을 쓰면 서버가 시트와 Firestore 기록을 처리한다.
 * 앱을 닫아도 계속된다. 'pending'일 때만 처리한다.
 */
export const processMovementImportJobs = onDocumentWritten(
    { document: "movement_import_jobs/{jobId}", timeoutSeconds: 300, memory: "512MiB" },
    async (event) => {
        const after = event.data?.after;
        if (!after?.exists) return;
        if (after.data()?.status !== "pending") return;
        await processMovementImportJob(after.ref);
    }
);
