/* eslint-disable @typescript-eslint/no-explicit-any */
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "firebase-admin/firestore";
import { corsHandler, db } from "../config/firebase.config";
import { syncMovements } from "../services/sheetSync.service";

export const syncMovementToSheet = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const { movements } = req.body;
            if (!movements || !Array.isArray(movements)) {
                return res.status(400).json({ status: "error", message: "movements 데이터가 필요합니다." });
            }

            logger.info(`syncMovementToSheet called with ${movements.length} items`);

            const result = await syncMovements(movements);

            if (result.status === "ambiguous") {
                return res.json(result);
            }

            return res.json(result);
        } catch (error: any) {
            logger.error("syncMovementToSheet error:", error);
            return res.status(500).json({ status: "error", message: error.message });
        }
    });
});

export const notifySpreadsheetUpdate = onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            await db.collection("settings").doc("spreadsheet").set({
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            res.status(200).send({ status: "success" });
        } catch (error) {
            logger.error("notifySpreadsheetUpdate error", error);
            res.status(500).send({ status: "error", message: "Internal Server Error" });
        }
    });
});

export const notifySheetUpdated = onRequest((req, res) => {
    corsHandler(req, res, async () => {
        try {
            const mode = req.query.mode === "prod" ? "prod" : "test";
            const updateKey = mode === "prod" ? "prodUpdatedAt" : "testUpdatedAt";
            
            await db.collection("settings").doc("spreadsheet").set({
                [updateKey]: FieldValue.serverTimestamp()
            }, { merge: true });
            
            return res.json({ status: "success", message: `${mode} updatedAt timestamp refreshed.` });
        } catch (err: any) {
            logger.error("notifySheetUpdated error:", err);
            return res.status(500).json({ status: "error", message: err.message });
        }
    });
});
