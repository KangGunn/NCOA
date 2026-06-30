/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { getKSTDateStr, getKSTTimeStr } from "../utils/date.util";
import { getMemberDisplayName } from "../utils/rank.util";
import { parseSheetEvents } from "../utils/sheet.util";
import { deleteDailyReturns } from "../repositories/return.repository";
import { getDebugSetting, updateDebugSetting, getSeniorSetting, updateSeniorSetting, getSpreadsheetSetting, updateSpreadsheetSetting } from "../repositories/setting.repository";
import { getSheetData } from "../repositories/sheet.repository";
import { db } from "../config/firebase.config";

const TELEGRAM_TOKEN = "8760934378:AAFl26uGt5sj6fhlz2peBYkr0kJcqwCtxgI";

export async function getTodayReturneesHelper(todayStr: string) {
    const docRef = db.collection("dailyReturns").doc(todayStr);
    const docSnap = await docRef.get();

    const settingsSnap = await db.collection("settings").doc("spreadsheet").get();
    const sheetUpdatedAt = settingsSnap.exists ? settingsSnap.data()?.updatedAt?.toMillis() || 0 : 0;
    const cacheUpdatedAt = docSnap.exists ? docSnap.data()?.updatedAt?.toMillis() || 0 : 0;

    let data: any = docSnap.exists ? docSnap.data() : {
        expectedVacation: [], expectedPass: [],
        returnedVacation: [], returnedPass: []
    };

    if (!docSnap.exists || cacheUpdatedAt < sheetUpdatedAt) {
        const baseDate = new Date(todayStr);
        const tomorrow = new Date(baseDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

        const sheetData = await getSheetData();
        const sheetEvents = parseSheetEvents(sheetData, sheetData, sheetData, todayStr, tomorrowStr);

        const vacationReturns = sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === todayStr && e.isReturnDay).map((e: any) => e.memo);
        const passReturns = sheetEvents.filter((e: any) => e.type === "pass" && e.startDate === todayStr && e.isReturnDay).map((e: any) => e.memo);

        data = {
            ...data,
            expectedVacation: vacationReturns,
            expectedPass: passReturns,
            updatedAt: FieldValue.serverTimestamp()
        };
        await docRef.set(data, { merge: true });
    }

    return { data, docRef };
}

export async function processTelegramMessage(body: any) {
    if (!body.message) return;

    const chatId = body.message.chat.id;
    const text = (body.message.text || "").trim();
    const from = body.message.from;
    if (!from) return;

    const userId = from.id;
    const firstName = from.first_name || "";
    const lastName = from.last_name || "";
    const telegramCombinedName = (lastName + firstName).trim();

    let todayStr = getKSTDateStr();
    const debugSetting = await getDebugSetting();
    if (debugSetting?.todayStr) {
        todayStr = debugSetting.todayStr;
    }

    logger.info("Incoming Telegram message", {
        chatId,
        text,
        userId,
        username: from.username,
        entities: body.message.entities
    });

    let currentMember: any = null;
    const memberSnapById = await db.collection("members").where("telegramId", "==", userId).get();
    if (!memberSnapById.empty) {
        currentMember = { id: memberSnapById.docs[0].id, ...memberSnapById.docs[0].data() };
    } else {
        if (telegramCombinedName) {
            const memberSnapByName = await db.collection("members").where("name", "==", telegramCombinedName).get();
            if (!memberSnapByName.empty) {
                const doc = memberSnapByName.docs[0];
                await doc.ref.update({ telegramId: userId });
                currentMember = { id: doc.id, ...doc.data() };
            }
        }
    }

    try {
        const entities = body.message.entities || [];
        const botCmd = entities.find((e: any) => e.type === "bot_command");
        let cmdName = "";
        if (botCmd) {
            const rawCmd = text.substring(botCmd.offset, botCmd.offset + botCmd.length);
            cmdName = rawCmd.split("@")[0].toLowerCase();
        }

        if (cmdName === "/dev") {
            const input = text.replace(/\/dev(@\w+)?/, "").trim();
            if (input === "off") {
                await db.collection("settings").doc("telegramDev").set({ enabled: false }, { merge: true });
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "🔌 로컬 터널 포워딩이 비활성화되었습니다. (운영 서버가 정상 처리합니다.)" });
            } else if (input.startsWith("http://") || input.startsWith("https://")) {
                let tunnelUrl = input;
                try {
                    const urlObj = new URL(input);
                    if (urlObj.pathname === "/" || urlObj.pathname === "") {
                        tunnelUrl = `${urlObj.origin}/seniorkatusa-aa594/asia-northeast3/telegramBot`;
                    }
                } catch (e) {
                    // fall back to raw input
                }

                await db.collection("settings").doc("telegramDev").set({
                    enabled: true,
                    tunnelUrl: tunnelUrl,
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `🔌 로컬 터널 포워딩이 활성화되었습니다!\n\n목적지 URL:\n\`${tunnelUrl}\``, parse_mode: "Markdown" });
            } else {
                const docSnap = await db.collection("settings").doc("telegramDev").get();
                const devData = docSnap.exists ? docSnap.data() : null;
                const status = devData?.enabled ? `🟢 활성화됨 (\`${devData.tunnelUrl}\`)` : "🔴 비활성화됨";
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: `ℹ️ 현재 로컬 포워딩 상태: ${status}\n\n*사용법:*\n- 활성화: \`/dev [터널 주소]\` (예: \`/dev https://xxx.loca.lt\`)\n- 비활성화: \`/dev off\``,
                    parse_mode: "Markdown"
                });
            }
            return;
        }

        if (cmdName === "/date") {
            const input = text.replace(/\/date(@\w+)?/, "").trim();
            if (input === "reset") {
                await updateDebugSetting({ todayStr: null });
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "✅ 날짜가 정상화되었습니다." });
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
                await updateDebugSetting({ todayStr: input });
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `✅ 오늘 날짜가 [${input}]으로 설정되었습니다.` });
            } else {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "⚠️ 사용법: `/date YYYY-MM-DD` 또는 `/date reset`" });
            }
            return;
        }

        if (cmdName === "/senior") {
            const seniorSetting = await getSeniorSetting();
            if (seniorSetting?.name) {
                const name = seniorSetting.name;
                const memberSnap = await db.collection("members").where("name", "==", name).get();
                let mention = `*${name}*`;
                if (!memberSnap.empty) {
                    const mData = memberSnap.docs[0].data();
                    if (mData.telegramId) {
                        mention = `[${name}](tg://user?id=${mData.telegramId})`;
                    } else {
                        mention = `*${getMemberDisplayName({ id: memberSnap.docs[0].id, ...mData })}*`;
                    }
                }
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: `현재 시카는 ${mention} 입니다.`,
                    parse_mode: "Markdown"
                });
            } else {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "설정된 시카가 없습니다. `/changesenior` 명령어로 설정해주세요." });
            }
            return;
        }

        if (cmdName === "/changesenior") {
            let targetName = "";
            for (const entity of entities) {
                if (entity.type === "text_mention" && entity.user) {
                    const snap = await db.collection("members").where("telegramId", "==", entity.user.id).get();
                    if (!snap.empty) targetName = snap.docs[0].data().name;
                } else if (entity.type === "mention") {
                    const mName = text.substring(entity.offset + 1, entity.offset + entity.length);
                    const snap = await db.collection("members").where("name", "==", mName).get();
                    if (!snap.empty) targetName = snap.docs[0].data().name;
                    else targetName = mName;
                }
            }

            if (targetName) {
                await updateSeniorSetting(targetName);
                const memberSnap = await db.collection("members").where("name", "==", targetName).get();
                let mention = `*${targetName}*`;
                if (!memberSnap.empty) {
                    const mData = memberSnap.docs[0].data();
                    if (mData.telegramId) {
                        mention = `[${targetName}](tg://user?id=${mData.telegramId})`;
                    }
                }
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: `✅ 시카가 ${mention} 으로 변경되었습니다.`,
                    parse_mode: "Markdown"
                });
            } else {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: "⚠️ 변경할 인원을 반드시 **멘션(@)** 해주세요.\n(예: `/changesenior @홍길동`)"
                });
            }
            return;
        }

        if (cmdName === "/sheet") {
            const inputMode = text.replace(/\/sheet(@\w+)?/, "").trim().toLowerCase();
            if (inputMode === "test" || inputMode === "prod") {
                await updateSpreadsheetSetting({
                    mode: inputMode,
                    updatedAt: FieldValue.serverTimestamp()
                });
                await deleteDailyReturns(todayStr);
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `✅ 연동된 시트가 [${inputMode.toUpperCase()}] 모드로 변경되었습니다.` });
            } else if (inputMode === "") {
                const setting = await getSpreadsheetSetting();
                const currentMode = setting?.mode || "test";
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `ℹ️ 현재 연동된 시트 모드는 [${currentMode.toUpperCase()}] 입니다.\n변경하려면 \`/sheet test\` 또는 \`/sheet prod\` 를 입력하세요.` });
            } else {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "⚠️ 사용법: `/sheet test` 또는 `/sheet prod`" });
            }
            return;
        }

        if (cmdName === "/auth" || text.startsWith("/auth")) {
            const inputName = text.replace(/\/auth(@\w+)?/, "").trim();
            if (!inputName) {
                const membersSnap = await db.collection("members").get();
                const verifiedList = membersSnap.docs
                    .map(doc => ({ id: doc.id, ...doc.data() } as any))
                    .filter((m: any) => m.telegramId && m.name)
                    .sort((a: any, b: any) => {
                        const dateA = a.enlistmentDate || "9999-99-99";
                        const dateB = b.enlistmentDate || "9999-99-99";
                        if (dateA !== dateB) return dateA.localeCompare(dateB);
                        return a.name.localeCompare(b.name);
                    })
                    .map((m: any) => {
                        const displayName = getMemberDisplayName(m);
                        return `- [${displayName}](tg://user?id=${m.telegramId})`;
                    });

                if (verifiedList.length === 0) {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: "ℹ️ 현재 인증 완료된 대원이 없습니다.\n\n*인증 방법:* `/auth [실명]`",
                        parse_mode: "Markdown"
                    });
                } else {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: `👥 *현재 인증 완료된 대원 목록 (${verifiedList.length}명)*\n\n${verifiedList.join("\n")}`,
                        parse_mode: "Markdown"
                    });
                }
                return;
            }
            let targetTelegramId = userId;
            const replyTo = body.message.reply_to_message;
            if (replyTo) {
                if (replyTo.contact && replyTo.contact.user_id) {
                    targetTelegramId = replyTo.contact.user_id;
                } else if (replyTo.from && replyTo.from.id) {
                    targetTelegramId = replyTo.from.id;
                }
            }

            const memberSnap = await db.collection("members").where("name", "==", inputName).get();
            if (!memberSnap.empty) {
                await memberSnap.docs[0].ref.update({ telegramId: targetTelegramId });
                const successMsg = replyTo
                    ? `✅ *${inputName}* 대원의 텔레그램 ID(\`${targetTelegramId}\`)가 강제 연동되었습니다!`
                    : `✅ *${inputName}* 님, 인증이 완료되었습니다!`;
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: successMsg,
                    parse_mode: "Markdown"
                });
            } else {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `❌ *${inputName}* 님을 명단에서 찾을 수 없습니다.` });
            }
            return;
        }

        const isReturnCmd = text.startsWith("ㅂㄱ") || text.startsWith("복귀취소") || text === "미복귀" || cmdName === "/reset" || text === "복귀 리스트";
        const isStartCmd = cmdName === "/start";
        const isHelpCmd = cmdName === "/help";

        if (isStartCmd) {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "NCOA 복귀 알림 봇입니다. 🫡\n명령어 안내를 보려면 /help 를 입력해 주세요." });
            return;
        }

        if (isHelpCmd) {
            let helpMsg = `🫡 *NCOA 복귀 알림 봇 명령어 안내*\n\n`;
            helpMsg += `*1. 복귀 관련 명령어 (자연어)*\n`;
            helpMsg += `- \`ㅂㄱ\` : 본인 복귀 처리\n`;
            helpMsg += `- \`ㅂㄱ @[이름]\` : (본인 포함) 지정한 인원 복귀 처리\n`;
            helpMsg += `- \`복귀취소\` : 본인 복귀 완료 상태 취소\n`;
            helpMsg += `- \`복귀취소 @[이름]\` : (본인 제외) 지정한 인원 복귀 완료 상태 취소\n`;
            helpMsg += `- \`복귀 리스트\` : 오늘 복귀 예정 인원 명단 확인\n`;
            helpMsg += `- \`미복귀\` : 오늘 복귀 예정 인원 중 미복귀 인원 확인\n\n`;
            helpMsg += `*2. 대원 연동 관련*\n`;
            helpMsg += `- \`/auth [실명]\` : 텔레그램 계정과 실명 매칭\n`;
            helpMsg += `- \`/auth\` : 현재 연동 완료된 인원 목록 조회\n`;
            helpMsg += `- *강제 연동:* 다른 사용자의 연락처 카드(Contact)나 메시지에 *답장(Reply)*으로 \`/auth [실명]\`을 입력하면 해당 사용자를 지정 실명으로 등록합니다.\n\n`;
            helpMsg += `*3. 행정 및 설정*\n`;
            helpMsg += `- \`/senior\` : 현재 시카(Senior) 확인\n`;
            helpMsg += `- \`/changesenior @[이름]\` : 새로운 시카 지정\n`;
            helpMsg += `- \`/sheet\` : 현재 구글 시트 연동 모드 조회\n`;
            helpMsg += `- \`/sheet test\` 또는 \`prod\` : 연동 모드 변경\n`;
            helpMsg += `- \`/reset\` : 금일 복귀 완료 현황 전체 초기화\n`;
            helpMsg += `- \`/dev [터널주소]\` 또는 \`off\` : (개발자용) 로컬 터널 포워딩 설정\n`;
            helpMsg += `- \`/date YYYY-MM-DD\` 또는 \`reset\` : (디버그용) 기준 일자 강제 지정`;

            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                chat_id: chatId,
                text: helpMsg,
                parse_mode: "Markdown"
            });
            return;
        }

        if (isReturnCmd) {
            const { data: returnsData, docRef } = await getTodayReturneesHelper(todayStr);

            if (cmdName === "/reset") {
                await docRef.delete();
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "✅ 오늘의 복귀 보고 문자가 초기화되었습니다." });
                return;
            }

            if (text === "미복귀") {
                const rv = returnsData.returnedVacation || [];
                const rp = returnsData.returnedPass || [];
                const uv = returnsData.expectedVacation.filter((n: string) => !rv.includes(n));
                const up = returnsData.expectedPass.filter((n: string) => !rp.includes(n));

                let msg = `*미복귀자 명단*\n\n`;
                msg += `*외박 (${up.length}명)*\n` + (up.length > 0 ? up.map((n: string) => `- ${n}`).join("\n") : `- 없음`) + "\n\n";
                msg += `*휴가 (${uv.length}명)*\n` + (uv.length > 0 ? uv.map((n: string) => `- ${n}`).join("\n") : `- 없음`);

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: msg, parse_mode: "Markdown" });
                return;
            }

            const extractTargets = async () => {
                const mentionNames: string[] = [];
                for (const entity of entities) {
                    if (entity.type === "text_mention" && entity.user) {
                        const snap = await db.collection("members").where("telegramId", "==", entity.user.id).get();
                        if (!snap.empty) mentionNames.push(snap.docs[0].data().name);
                        else mentionNames.push(entity.user.first_name || "");
                    } else if (entity.type === "mention") {
                        const mName = text.substring(entity.offset + 1, entity.offset + entity.length);
                        const snap = await db.collection("members").where("name", "==", mName).get();
                        if (!snap.empty) mentionNames.push(snap.docs[0].data().name);
                        else mentionNames.push(mName);
                    }
                }
                const regexMentions = (text.match(/@([^\s@]+)/g) || []).map((s: string) => s.slice(1));
                let targetNames = Array.from(new Set([...mentionNames, ...regexMentions]));
                if (targetNames.length === 0 && currentMember) {
                    targetNames = [currentMember.name];
                }
                return targetNames;
            };

            const sendReturnStatusMessage = async () => {
                const updatedSnap = await docRef.get();
                const updatedData = updatedSnap.data() || {};
                const returnedVacation = updatedData.returnedVacation || [];
                const returnedPass = updatedData.returnedPass || [];

                const membersSnap = await db.collection("members").get();
                const membersList = membersSnap.docs.map((doc: any) => doc.data());

                const sortMembers = (names: string[], allMembers: any[]) => {
                    return names.map((n: string) => {
                        const m = allMembers.find((mem: any) => mem.name === n);
                        return m ? m : { name: n, enlistmentDate: "9999-99-99" };
                    }).sort((a: any, b: any) => {
                        const dateA = a.enlistmentDate || "9999-99-99";
                        const dateB = b.enlistmentDate || "9999-99-99";
                        if (dateA !== dateB) return dateA.localeCompare(dateB);
                        return a.name.localeCompare(b.name);
                    }).map((m: any) => {
                        const fullMember = allMembers.find((mem: any) => mem.name === m.name);
                        return fullMember ? getMemberDisplayName(fullMember) : m.name;
                    });
                };

                const sortedVacation = sortMembers(returnedVacation, membersList);
                const sortedPass = sortMembers(returnedPass, membersList);

                let msg = `대장님, `;
                if (sortedPass.length > 0 && sortedVacation.length > 0) {
                    msg += `금일 외박 복귀 인원인\n\n`;
                    msg += sortedPass.map((n: string) => `- ${n}`).join("\n") + "\n\n";
                    msg += `휴가 복귀 인원인\n\n`;
                    msg += sortedVacation.map((n: string) => `- ${n}`).join("\n") + "\n\n";
                    msg += `복귀 완료하였습니다.`;
                } else if (sortedPass.length > 0) {
                    msg += `금일 외박 복귀 인원인\n\n`;
                    msg += sortedPass.map((n: string) => `- ${n}`).join("\n") + "\n\n";
                    msg += `복귀 완료하였습니다.`;
                } else if (sortedVacation.length > 0) {
                    msg += `금일 휴가 복귀 인원인\n\n`;
                    msg += sortedVacation.map((n: string) => `- ${n}`).join("\n") + "\n\n";
                    msg += `복귀 완료하였습니다.`;
                } else {
                    msg = "현재 복귀 완료된 인원이 없습니다.";
                }

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: msg
                });

                const ev = updatedData.expectedVacation || [];
                const ep = updatedData.expectedPass || [];
                const totalExpected = ev.length + ep.length;
                const isAllReturned = totalExpected > 0 &&
                    ev.every((n: string) => returnedVacation.includes(n)) &&
                    ep.every((n: string) => returnedPass.includes(n));

                if (isAllReturned) {
                    const seniorSetting = await getSeniorSetting();
                    if (seniorSetting?.name) {
                        const sName = seniorSetting.name;
                        const sMemberSnap = await db.collection("members").where("name", "==", sName).get();
                        let mention = sName;
                        if (!sMemberSnap.empty) {
                            const sData = sMemberSnap.docs[0].data();
                            if (sData.telegramId) {
                                mention = `[${sName}](tg://user?id=${sData.telegramId})`;
                            }
                        }

                        const returnTimes = updatedData.returnTimes || {};
                        let allReportTimesMsg = `*전원 복귀 완료* @${mention}\n\n`;

                        const sortAndFormatWithTime = (names: string[], allMembers: any[]) => {
                            return names.map((n: string) => {
                                const m = allMembers.find((mem: any) => mem.name === n);
                                return m ? m : { name: n, enlistmentDate: "9999-99-99" };
                            }).sort((a: any, b: any) => {
                                const dateA = a.enlistmentDate || "9999-99-99";
                                const dateB = b.enlistmentDate || "9999-99-99";
                                if (dateA !== dateB) return dateA.localeCompare(dateB);
                                return a.name.localeCompare(b.name);
                            }).map((m: any) => {
                                const fullMember = allMembers.find((mem: any) => mem.name === m.name);
                                const displayName = fullMember ? getMemberDisplayName(fullMember) : m.name;
                                const reportTime = returnTimes[m.name] || "-";
                                return `- ${displayName} (${reportTime})`;
                            });
                        };

                        const pTimes = sortAndFormatWithTime(returnedPass, membersList);
                        const vTimes = sortAndFormatWithTime(returnedVacation, membersList);

                        if (pTimes.length > 0) {
                            allReportTimesMsg += `*외박 복귀*\n${pTimes.join("\n")}\n\n`;
                        }
                        if (vTimes.length > 0) {
                            allReportTimesMsg += `*휴가 복귀*\n${vTimes.join("\n")}\n\n`;
                        }

                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                            chat_id: chatId,
                            text: allReportTimesMsg.trim(),
                            parse_mode: "Markdown"
                        });
                    }
                }
            };

            if (text.startsWith("복귀취소")) {
                const targetNames = await extractTargets();
                if (targetNames.length === 0) {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "⚠️ 취소할 인원을 확인할 수 없습니다." });
                    return;
                }

                const removedVacations: string[] = [];
                const removedPasses: string[] = [];
                const notFoundNames: string[] = [];

                for (const name of targetNames) {
                    const isExpected = (returnsData.expectedVacation || []).includes(name) || (returnsData.expectedPass || []).includes(name);
                    if (!isExpected) {
                        notFoundNames.push(name);
                        continue;
                    }

                    if ((returnsData.returnedVacation || []).includes(name)) removedVacations.push(name);
                    if ((returnsData.returnedPass || []).includes(name)) removedPasses.push(name);
                }

                if (notFoundNames.length > 0) {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: `⚠️ 금일 복귀 예정자 명단에 없음: ${notFoundNames.join(", ")}`
                    });
                }

                if (removedVacations.length > 0 || removedPasses.length > 0) {
                    const updates: any = {};
                    if (removedVacations.length > 0) updates.returnedVacation = FieldValue.arrayRemove(...removedVacations);
                    if (removedPasses.length > 0) updates.returnedPass = FieldValue.arrayRemove(...removedPasses);

                    const allRemoved = [...removedVacations, ...removedPasses];
                    for (const name of allRemoved) {
                        updates[`returnTimes.${name}`] = FieldValue.delete();
                    }

                    await docRef.update(updates);

                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: `✅ ${allRemoved.join(", ")} 님의 복귀 처리가 취소되었습니다.`
                    });
                    await sendReturnStatusMessage();
                } else if (notFoundNames.length === 0 || targetNames.some(name => !notFoundNames.includes(name))) {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: `⚠️ 해당 인원들은 아직 복귀 완료 처리되지 않았습니다.`
                    });
                }
                return;
            }

            if (text.startsWith("ㅂㄱ")) {
                if (!currentMember && !(text.match(/@([^\s@]+)/g))) {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: `⚠️ 누구신지 아직 모르겠어요! 🫡\n\n1. 텔레그램 프로필 이름을 *실명*으로 수정하시거나\n2. \`/auth [실명]\` 명령어를 입력해 주세요.`,
                        parse_mode: "Markdown"
                    });
                    return;
                }

                let targetNames = await extractTargets();
                const hasMentions = targetNames.length > 0;
                if (currentMember && !targetNames.includes(currentMember.name)) {
                    const isSenderExpected = returnsData.expectedVacation.includes(currentMember.name) || returnsData.expectedPass.includes(currentMember.name);
                    if (!hasMentions || isSenderExpected) {
                        targetNames.push(currentMember.name);
                    }
                }

                const addedVacations: string[] = [];
                const addedPasses: string[] = [];
                const notFoundNames: string[] = [];
                const newlyReturnedNames: string[] = [];

                const alreadyReturnedVacation = returnsData.returnedVacation || [];
                const alreadyReturnedPass = returnsData.returnedPass || [];

                for (const name of targetNames) {
                    const isVacation = returnsData.expectedVacation.includes(name);
                    const isPass = returnsData.expectedPass.includes(name);

                    if (isVacation) {
                        addedVacations.push(name);
                        if (!alreadyReturnedVacation.includes(name)) {
                            newlyReturnedNames.push(name);
                        }
                    } else if (isPass) {
                        addedPasses.push(name);
                        if (!alreadyReturnedPass.includes(name)) {
                            newlyReturnedNames.push(name);
                        }
                    } else {
                        notFoundNames.push(name);
                    }
                }

                if (notFoundNames.length > 0) {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: `⚠️ 금일 복귀 예정자 명단에 없음: ${notFoundNames.join(", ")}`
                    });
                }

                if (addedVacations.length > 0 || addedPasses.length > 0) {
                    const updates: any = {};
                    if (addedVacations.length > 0) updates.returnedVacation = FieldValue.arrayUnion(...addedVacations);
                    if (addedPasses.length > 0) updates.returnedPass = FieldValue.arrayUnion(...addedPasses);

                    const timeStr = getKSTTimeStr();
                    for (const name of newlyReturnedNames) {
                        updates[`returnTimes.${name}`] = timeStr;
                    }

                    await docRef.update(updates);

                    await sendReturnStatusMessage();
                }
                return;
            }

            if (text === "복귀 리스트") {
                const tomorrowDate = new Date(new Date(todayStr).getTime() + 24 * 60 * 60 * 1000);
                const tomorrowStr = tomorrowDate.toISOString().split("T")[0];

                const sheetData = await getSheetData();
                const sheetEvents = parseSheetEvents(sheetData, sheetData, sheetData, todayStr, tomorrowStr);

                const vacationReturns = sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === todayStr && e.isReturnDay);
                const passReturns = sheetEvents.filter((e: any) => e.type === "pass" && e.startDate === todayStr && e.isReturnDay);

                let responseMsg = `📅 *[${todayStr}] 복귀 예정 인원*\n\n`;

                responseMsg += `🚶 *외박 복귀 (${passReturns.length}명)*\n`;
                if (passReturns.length > 0) {
                    responseMsg += passReturns.map((e: any) => `• ${e.memo}`).join("\n");
                } else {
                    responseMsg += `• 없음`;
                }

                responseMsg += `\n\n🏠 *휴가 복귀 (${vacationReturns.length}명)*\n`;
                if (vacationReturns.length > 0) {
                    responseMsg += vacationReturns.map((e: any) => `• ${e.memo}`).join("\n");
                } else {
                    responseMsg += `• 없음`;
                }

                responseMsg += `\n\n상세 정보는 NCOA 앱에서 확인해주세요!`;

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: responseMsg,
                    parse_mode: "Markdown"
                });
            }
        }
    } catch (error: any) {
        logger.error("telegramBot processing error:", error);
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: `🚨 에러 발생: ${error.message}`
        });
    }
}
