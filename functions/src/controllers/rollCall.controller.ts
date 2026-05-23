import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { corsHandler } from "../config/firebase.config";
import { processRollCallData } from "../services/rollCall.service";

export const getRollCallData = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const { date } = req.query;
            if (!date || typeof date !== "string") {
                res.status(400).json({ status: "error", message: "date 파라미터가 필요합니다 (YYYY-MM-DD)" });
                return;
            }

            logger.info(`getRollCallData called for date: ${date}`);

            const responseData = await processRollCallData(date);

            return res.json({
                status: "success",
                data: responseData,
            });
        } catch (error: any) {
            logger.error("getRollCallData error:", error);
            return res.status(500).json({ status: "error", message: error.message });
        }
    });
});
