/* eslint-disable @typescript-eslint/no-explicit-any */
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import axios from "axios";
import { corsHandler, db } from "../config/firebase.config";
import { getKakaoRollCallStatus } from "../services/kakao.service";
import { processTelegramMessage } from "../services/telegram.service";
import { getKSTDateStr } from "../utils/date.util";

export const kakaoBot = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const body = req.body;
            const utterance = body.userRequest?.utterance || "";
            const todayStr = getKSTDateStr();

            if (utterance.includes("현황") || utterance.includes("점호")) {
                const response = await getKakaoRollCallStatus(todayStr);
                return res.json(response);
            }

            return res.json({
                version: "2.0",
                template: {
                    outputs: [{
                        simpleText: {
                            text: "안녕하세요! NCOA 알림이입니다. 😊\n\n'현황'이라고 입력하시면 현재 점호 인원을 알려드려요.",
                        },
                    }],
                    quickReplies: [
                        { label: "현재 현황 확인", action: "message", messageText: "현황 알려줘" },
                    ],
                },
            });

        } catch (error: any) {
            logger.error("kakaoBot error:", error);
            return res.json({
                version: "2.0",
                template: {
                    outputs: [{ simpleText: { text: "데이터를 가져오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." } }],
                },
            });
        }
    });
});

export const telegramBot = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";

            // If running on production, check if local dev forwarding is active
            if (!isEmulator) {
                const devSettingSnap = await db.collection("settings").doc("telegramDev").get();
                if (devSettingSnap.exists) {
                    const devData = devSettingSnap.data();
                    if (devData && devData.enabled && devData.tunnelUrl) {
                        try {
                            logger.info("Forwarding Telegram request to local tunnel", { url: devData.tunnelUrl });
                            const response = await axios.post(devData.tunnelUrl, req.body, { 
                                timeout: 10000,
                                headers: {
                                    "Bypass-Tunnel-Reminder": "true"
                                }
                            });
                            return res.status(response.status).send(response.data);
                        } catch (forwardError: any) {
                            logger.warn("Failed to forward to local tunnel, falling back to production", { error: forwardError.message });
                        }
                    }
                }
            }

            await processTelegramMessage(req.body);
            return res.status(200).send("OK");
        } catch (globalError: any) {
            logger.error("Global telegramBot error:", globalError);
            return res.sendStatus(200);
        }
    });
});
