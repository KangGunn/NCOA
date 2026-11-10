/* eslint-disable @typescript-eslint/no-explicit-any */
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { corsHandler } from "../config/firebase.config";
import { syncMemberRanksInAllSheets } from "../services/rankSync.service";

/**
 * 매월 1일 00:05 (한국 시간)에 시트의 관등성명을 그날 기준 계급으로 갱신한다.
 * 계급은 입대일·조기진급 개월로 달 단위로 계산되므로 달이 바뀔 때만 달라진다.
 */
export const syncSheetRanksMonthly = onSchedule(
    { schedule: "5 0 1 * *", timeZone: "Asia/Seoul" },
    async () => {
        const results = await syncMemberRanksInAllSheets();
        logger.info("syncSheetRanksMonthly done", { results });
    }
);

/** 수동 실행용 (배포 직후 한 번, 또는 인원 정보를 고친 뒤). 항상 실제 오늘 날짜 기준. */
export const syncSheetRanks = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        if (req.method !== "POST") {
            return res.status(405).json({ status: "error", message: "POST로 호출하세요." });
        }
        try {
            const results = await syncMemberRanksInAllSheets();
            return res.json({ status: "success", results });
        } catch (error: any) {
            logger.error("syncSheetRanks error:", error);
            return res.status(500).json({ status: "error", message: error.message });
        }
    });
});
