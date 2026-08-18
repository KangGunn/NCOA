/* eslint-disable @typescript-eslint/no-explicit-any */
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import axios from "axios";
import { corsHandler, db } from "../config/firebase.config";
import { getKakaoRollCallStatus, getKakaoUnreturnedStatus, getKakaoWeeklyRollCallStatus } from "../services/kakao.service";
import { parseAndSaveDayPass, getDayPassReport, clearDayPassReport } from "../services/daypass.service";
import { processTelegramMessage } from "../services/telegram.service";
import { getKSTDateStr } from "../utils/date.util";

export const kakaoBot = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const body = req.body;
            const utterance = (body.userRequest?.utterance || "").trim();
            const todayStr = getKSTDateStr();

            if (utterance.includes("명령어") || utterance.includes("도움말")) {
                const helpText = `🫡 NCOA 카카오톡 챗봇 명령어 안내\n\n` +
                    `• 인원 : 오늘 점호 현황 (총원, 열외, 현재원)\n` +
                    `• 이번주 인원 : 이번 주(월~금) 점호 현황\n` +
                    `• 미복귀 : 금일 외박/휴가 미복귀자 명단\n` +
                    `• 외출 : 금일 외출 기록 보고서 출력\n` +
                    `• 외출 리셋 : 금일 외출 기록 전체 초기화\n` +
                    `• [이름...] [사유] [출발] [복귀] : 외출 기록 추가\n  (예: 송태성 윤하늘 저녁 식사 1725 1847)`;

                return res.json({
                    version: "2.0",
                    template: {
                        outputs: [{ simpleText: { text: helpText } }],
                        quickReplies: [
                            { label: "오늘 인원", action: "message", messageText: "인원" },
                            { label: "이번주 인원", action: "message", messageText: "이번주 인원" },
                            { label: "외출 보고서", action: "message", messageText: "외출" },
                            { label: "미복귀자 확인", action: "message", messageText: "미복귀" },
                        ],
                    },
                });
            }

            if (utterance === "외출 리셋") {
                const text = await clearDayPassReport(todayStr);
                return res.json({ version: "2.0", template: { outputs: [{ simpleText: { text } }] } });
            }

            if (utterance === "외출") {
                const text = await getDayPassReport(todayStr);
                return res.json({ version: "2.0", template: { outputs: [{ simpleText: { text } }] } });
            }

            // 외출 정보 패턴 매칭 (예: "송태성 윤하늘 저녁 식사 1725 1847")
            const dayPassResult = await parseAndSaveDayPass(utterance, todayStr);
            if (dayPassResult) {
                const text = `✅ 외출 기록이 추가되었습니다.\n\n• 대상: ${dayPassResult.matchedNames.join(", ")}\n• 사유: ${dayPassResult.reason}\n• 시간: ${dayPassResult.departTime} ~ ${dayPassResult.returnTime}`;
                return res.json({ version: "2.0", template: { outputs: [{ simpleText: { text } }] } });
            }

            if (utterance.includes("이번주") || utterance.includes("주간")) {
                const response = await getKakaoWeeklyRollCallStatus(todayStr);
                return res.json(response);
            }

            if (utterance.includes("미복귀")) {
                const response = await getKakaoUnreturnedStatus(todayStr);
                return res.json(response);
            }

            if (utterance.includes("인원")) {
                const response = await getKakaoRollCallStatus(todayStr);
                return res.json(response);
            }

            return res.json({
                version: "2.0",
                template: {
                    outputs: [{
                        simpleText: {
                            text: "안녕하세요! NCOA 알림이입니다. 😊\n\n- '인원': 오늘 점호 현황 확인\n- '이번주 인원': 이번 주(월~금) 점호 현황 확인\n- '미복귀': 금일 미복귀자 명단 확인\n- '외출': 금일 외출 기록 보고서 출력\n- '외출 리셋': 금일 외출 기록 초기화",
                        },
                    }],
                    quickReplies: [
                        { label: "오늘 인원", action: "message", messageText: "인원" },
                        { label: "이번주 인원", action: "message", messageText: "이번주 인원" },
                        { label: "외출 보고서", action: "message", messageText: "외출" },
                        { label: "미복귀자 확인", action: "message", messageText: "미복귀" },
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
