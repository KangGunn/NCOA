/* eslint-disable @typescript-eslint/no-explicit-any */
import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import cors from "cors";
import axios from "axios";
import Papa from "papaparse";
import { google } from "googleapis";
import * as path from "path";

// Firebase Admin 초기화 (에뮬레이터 환경에서도 자동으로 동작)
admin.initializeApp();
const db = admin.firestore();

const corsHandler = cors({ origin: true });

setGlobalOptions({ maxInstances: 10, region: "asia-northeast3" });

// 한국 시간(KST) 문자열 생성 함수 (YYYY-MM-DD)
function getKSTDateStr(): string {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset);
    return kstDate.toISOString().split("T")[0];
}


// ── 계급 계산 로직 (rankUtils.ts에서 이관) ──────────────────────────────
function calculateRankFromEnlistment(enlistmentDate: Date, earlyPromotionMonths = 0): string {
    const now = new Date();
    const baseMonths = (now.getFullYear() - enlistmentDate.getFullYear()) * 12
        + now.getMonth() - enlistmentDate.getMonth();
    const m = baseMonths + earlyPromotionMonths;
    const isFirstDay = enlistmentDate.getDate() === 1;

    let tier = "이병";

    if (m <= 1) {
        tier = "이병";
    } else if (m === 2) {
        tier = isFirstDay ? "일병" : "이병";
    } else {
        const above = m - (isFirstDay ? 2 : 3);
        if (above < 6) tier = "일병";
        else if (above < 12) tier = "상병";
        else tier = "병장";
    }
    return tier;
}

function getMemberDisplayName(member: any): string {
    if (member.role !== "runner" && member.enlistmentDate) {
        const rank = calculateRankFromEnlistment(
            new Date(member.enlistmentDate),
            member.earlyPromotion || 0
        );
        return `${member.name} ${rank}`;
    }
    const cleanRank = member.role === "runner"
        ? (member.rank || "").split(" ")[0]
        : (member.rank || "");
    return `${member.name} ${cleanRank}`.trim();
}

// ── 구글 시트 CSV 파싱 ───────────────────────────────────────────────────
const SHEET_URLS = {
    test: "https://docs.google.com/spreadsheets/d/1eyiNzyvJ1BguGzzpkYDnVegi-4U-zuCacCvy9bOW8R8/export?format=csv&gid=1529486829",
    prod: "https://docs.google.com/spreadsheets/d/1WBJXIzLbbtRxt09KOaJeXKXtgbht-GDjX3N4DyDztOY/export?format=csv&gid=1529486829"
};

const SPREADSHEET_IDS = {
    test: "1eyiNzyvJ1BguGzzpkYDnVegi-4U-zuCacCvy9bOW8R8",
    prod: "1WBJXIzLbbtRxt09KOaJeXKXtgbht-GDjX3N4DyDztOY"
};

async function getSheetData(): Promise<any[]> {
    const docSnap = await db.collection("settings").doc("spreadsheet").get();
    const sheetMode = docSnap.exists ? docSnap.data()?.mode || "test" : "test";
    const sheetUrl = SHEET_URLS[sheetMode as keyof typeof SHEET_URLS] || SHEET_URLS.test;

    const csvRes = await axios.get(sheetUrl);

    return new Promise<any[]>((resolve) => {
        Papa.parse(csvRes.data, {
            complete: (results) => {
                const rows = results.data as string[][];
                if (rows.length < 2) { resolve([]); return; }

                const dateRow = rows[0];
                const result: any[] = [];

                for (let i = 2; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || !row[0]) continue;
                    const nameWithRank = row[0].trim();
                    const name = (nameWithRank.split(/\s+/)[1] || nameWithRank).trim();
                    const days: any[] = [];

                    for (let col = 1; col < row.length; col++) {
                        const rawDate = dateRow[col];
                        if (!rawDate) continue;
                        const parts = rawDate.split(".").map((p: string) => p.trim());
                        if (parts.length < 3) continue;
                        const mStr = parts[1].padStart(2, "0");
                        const dStr = parts[2].padStart(2, "0");
                        days.push({
                            dateStr: `${parts[0]}-${mStr}-${dStr}`,
                            m: Number(mStr),
                            d: Number(dStr),
                            cell: row[col] || "",
                        });
                    }
                    result.push({ name, days });
                }
                resolve(result);
            },
        });
    });
}

// ── 시트 이벤트 파싱 (휴가/외박 시작·종료일 계산) ────────────────────────
function parseSheetEvents(prevData: any[], currData: any[], nextData: any[], todayStr: string, tomorrowStr: string): any[] {
    const allNames = new Set([
        ...prevData.map((d) => d.name),
        ...currData.map((d) => d.name),
        ...nextData.map((d) => d.name),
    ]);

    const parsed: any[] = [];

    allNames.forEach((name) => {
        const pDays = prevData.find((d) => d.name === name)?.days || [];
        const cDays = currData.find((d) => d.name === name)?.days || [];
        const nDays = nextData.find((d) => d.name === name)?.days || [];

        const uniqueMap = new Map<string, any>();
        [...pDays, ...cDays, ...nDays].forEach((day) => {
            if (!uniqueMap.has(day.dateStr) || day.cell.trim() !== "") {
                uniqueMap.set(day.dateStr, day);
            }
        });

        const rowDays = Array.from(uniqueMap.values()).sort((a, b) =>
            a.dateStr.localeCompare(b.dateStr)
        );
        if (rowDays.length === 0) return;

        [todayStr, tomorrowStr].forEach((targetDate) => {
            const idx = rowDays.findIndex((d) => d.dateStr === targetDate);
            if (idx === -1) return;

            const day = rowDays[idx];
            const c = day.cell;
            if (!c || !c.includes("외박") && !c.includes("휴가") && !c.includes("연계")) return;

            const type = c.includes("휴가") ? "vacation" : "pass";

            let startIdx = idx;
            for (let k = idx; k >= 0 && k >= idx - 14; k--) {
                const pc = rowDays[k].cell;
                if (pc.includes("출발")) {
                    startIdx = type === "vacation" ? k : Math.min(k + 1, rowDays.length - 1);
                    break;
                }
                if (!pc.includes("외박") && !pc.includes("휴가") && !pc.includes("연계")) {
                    startIdx = k + 1; break;
                }
                if (k === 0) startIdx = 0;
            }

            let endIdx = idx;
            for (let k = idx; k < rowDays.length && k <= idx + 14; k++) {
                const nc = rowDays[k].cell;
                if (nc.includes("복귀") || (k > idx && nc.includes("출발"))) { endIdx = k; break; }
                if (!nc.includes("외박") && !nc.includes("휴가") && !nc.includes("연계")) { endIdx = k - 1; break; }
                if (k === rowDays.length - 1) endIdx = rowDays.length - 1;
            }

            const fi = startIdx > endIdx ? endIdx : startIdx;
            const s = rowDays[fi];
            const e = rowDays[endIdx];
            const dateText = s.m === e.m && s.d === e.d ? `${s.m}.${s.d}` : `${s.m}.${s.d}~${e.m}.${e.d}`;

            parsed.push({
                id: `sheet-${type}-${name}-${day.dateStr}`,
                type, memo: name,
                startDate: day.dateStr, endDate: day.dateStr,
                isReturnDay: c.includes("복귀"),
                isDepartDay: c.includes("출발"),
                isConsecutive: c.includes("연계"),
                dateText,
            });
        });
    });

    return parsed;
}

// ── 메인 Cloud Function ──────────────────────────────────────────────────
export const getRollCallData = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const { date } = req.query;
            if (!date || typeof date !== "string") {
                res.status(400).json({ status: "error", message: "date 파라미터가 필요합니다 (YYYY-MM-DD)" });
                return;
            }

            logger.info(`getRollCallData called for date: ${date}`);

            const baseDate = new Date(date);
            const tomorrow = new Date(baseDate);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const todayStr = date;
            const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

            // 1. Firestore에서 병사 명단 조회
            const [membersSnap, schedulesSnap] = await Promise.all([
                db.collection("members").get(),
                db.collection("schedules").get(),
            ]);

            const members = membersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any[];
            const schedules = schedulesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any[];

            // 2. 구글 시트 데이터 로딩 (단일 시트)
            const sheetData = await getSheetData();
            const prevData = sheetData;
            const currData = sheetData;
            const nextData = sheetData;

            // 3. 시트 이벤트 파싱
            const sheetEvents = parseSheetEvents(prevData, currData, nextData, todayStr, tomorrowStr);
            logger.info(`Sheet events parsed: ${sheetEvents.length}`);
            if (sheetEvents.length > 0) {
                logger.info(`First sheet event: ${JSON.stringify(sheetEvents[0])}`);
            }

            // 4. 당직/휴가/외박 분류
            const nonRunnerMembers = members.filter((m) => m.role !== "runner");
            const totalCount = nonRunnerMembers.length;
            logger.info(`Total members: ${members.length}, Non-runners: ${totalCount}`);
            logger.info(`Non-runner names: ${nonRunnerMembers.map(m => m.name).join(", ")}`);

            const todayDuties = schedules.filter((e) => e.type === "duty" && e.startDate === todayStr);
            const tomorrowDuties = schedules.filter((e) => e.type === "duty" && e.startDate === tomorrowStr);

            const todayVacations = [
                ...schedules.filter((e) => e.type === "vacation" && e.startDate <= todayStr && e.endDate >= todayStr),
                ...sheetEvents.filter((e) => e.type === "vacation" && e.startDate === todayStr && !e.isReturnDay),
            ].filter((e) => members.find((m) => m.name === e.memo)?.role !== "runner");

            const todayPasses = [
                ...schedules.filter((e) => e.type === "pass" && e.startDate <= todayStr && e.endDate >= todayStr),
                ...sheetEvents.filter((e) => e.type === "pass" && e.startDate === todayStr && !e.isReturnDay),
            ].filter((e) => members.find((m) => m.name === e.memo)?.role !== "runner");

            const todayDutiesFilteredForStats = todayDuties.filter((d) => members.find((m) => m.name === d.memo)?.role !== "runner");

            // 5. 인원 통계 계산 (러너 제외 실제 병력 기준)
            const dutyCount = todayDutiesFilteredForStats.length;
            const vacationCount = todayVacations.length;
            const passCount = todayPasses.length;
            const offCount = dutyCount + vacationCount + passCount;
            const presentCount = totalCount - offCount;

            // 6. 내일 출발자 (익일 특이사항용)
            const tomorrowDeparts = sheetEvents.filter(
                (e) => e.startDate === tomorrowStr && e.isDepartDay && e.type === "vacation"
            );

            // 7. 계급이 계산된 이름 목록 빌드
            const getDisplayName = (memoName: string) => {
                const member = members.find((m) => m.name === memoName);
                return member ? getMemberDisplayName(member) : memoName;
            };

            // 8. 응답 데이터 구성
            return res.json({
                status: "success",
                data: {
                    // 인원 통계
                    stats: { total: totalCount, present: presentCount, absent: offCount, dutyCount, vacationCount, passCount },
                    // 저녁점호용 데이터
                    evening: {
                        duties: todayDuties.map((d) => getDisplayName(d.memo)),
                        recoveries: todayDuties.map((d) => getDisplayName(d.memo)), // 당일 당직 = 익일 리커버리
                        tomorrowDuties: tomorrowDuties.map((d) => getDisplayName(d.memo)),
                        tomorrowDeparts: tomorrowDeparts.map((e) => getDisplayName(e.memo)),
                        vacations: todayVacations.map((e) => ({
                            name: getDisplayName(e.memo),
                            dateText: e.dateText || (() => {
                                const ps = e.startDate?.split("-"); const pe = e.endDate?.split("-");
                                if (!ps || !pe) return "";
                                return `${Number(ps[1])}.${Number(ps[2])}~${Number(pe[1])}.${Number(pe[2])}`;
                            })(),
                        })),
                        passes: todayPasses.map((e) => ({
                            name: getDisplayName(e.memo),
                            dateText: e.dateText || (() => {
                                const ps = e.startDate?.split("-"); const pe = e.endDate?.split("-");
                                if (!ps || !pe) return "";
                                return `${Number(ps[1])}.${Number(ps[2])}~${Number(pe[1])}.${Number(pe[2])}`;
                            })(),
                        })),
                    },
                    // 아침점호용 데이터 (내일 기준)
                    morning: {
                        tomorrowStr,
                        duties: tomorrowDuties.map((d) => getDisplayName(d.memo)),
                        recoveries: todayDuties.map((d) => getDisplayName(d.memo)),
                        vacations: [
                            ...schedules.filter((e: any) => e.type === "vacation" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
                            ...sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && !e.isDepartDay),
                        ].filter((e: any) => members.find((m) => m.name === e.memo)?.role !== "runner").map((e: any) => getDisplayName(e.memo)),
                        passes: [
                            ...schedules.filter((e: any) => e.type === "pass" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
                            ...sheetEvents.filter((e: any) => e.type === "pass" && e.startDate === tomorrowStr && !e.isDepartDay),
                            ...sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && e.isDepartDay && e.isConsecutive),
                        ].filter((e: any) => members.find((m) => m.name === e.memo)?.role !== "runner").map((e: any) => getDisplayName(e.memo)),
                        // 아침점호 출석 인원 (열외 제외)
                        presentMembers: nonRunnerMembers
                            .filter((m) => {
                                const name = m.name;
                                const isDuty = tomorrowDuties.some((d: any) => d.memo === name);
                                const isRecovery = todayDuties.some((d: any) => d.memo === name);
                                const isVacation = [
                                    ...schedules.filter((e: any) => e.type === "vacation" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
                                    ...sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && !e.isDepartDay),
                                ].some((e: any) => e.memo === name);
                                const isPass = [
                                    ...schedules.filter((e: any) => e.type === "pass" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
                                    ...sheetEvents.filter((e: any) => e.type === "pass" && e.startDate === tomorrowStr && !e.isDepartDay),
                                    ...sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && e.isDepartDay && e.isConsecutive),
                                ].some((e: any) => e.memo === name);
                                return !isDuty && !isRecovery && !isVacation && !isPass;
                            })
                            .sort((a, b) => (a.enlistmentDate || "").localeCompare(b.enlistmentDate || "") || a.name.localeCompare(b.name))
                            .map((m) => getMemberDisplayName(m)),
                    },
                    // 원시 sheetEvents (프런트엔드 UI 렌더링용)
                    sheetEvents,
                },
            });

        } catch (error: any) {
            logger.error("getRollCallData error:", error);
            return res.status(500).json({ status: "error", message: error.message });
        }
    });
});

// ── 일일 복귀자 캐싱 헬퍼 ────────────────────────────────────────────────
async function getTodayReturnees(todayStr: string) {
    const docRef = db.collection("dailyReturns").doc(todayStr);
    const docSnap = await docRef.get();

    const settingsSnap = await db.collection("settings").doc("spreadsheet").get();
    const sheetUpdatedAt = settingsSnap.exists ? settingsSnap.data()?.updatedAt?.toMillis() || 0 : 0;
    const cacheUpdatedAt = docSnap.exists ? docSnap.data()?.updatedAt?.toMillis() || 0 : 0;

    let data: any = docSnap.exists ? docSnap.data() : {
        expectedVacation: [], expectedPass: [],
        returnedVacation: [], returnedPass: []
    };

    // 캐시가 없거나, 시트가 더 최근에 업데이트된 경우 새로 갱신
    if (!docSnap.exists || cacheUpdatedAt < sheetUpdatedAt) {
        const baseDate = new Date(todayStr);
        const tomorrow = new Date(baseDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

        const sheetData = await getSheetData();
        const sheetEvents = parseSheetEvents(sheetData, sheetData, sheetData, todayStr, tomorrowStr);

        const vacationReturns = sheetEvents.filter(e => e.type === "vacation" && e.startDate === todayStr && e.isReturnDay).map(e => e.memo);
        const passReturns = sheetEvents.filter(e => e.type === "pass" && e.startDate === todayStr && e.isReturnDay).map(e => e.memo);

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

// ── 카카오톡 챗봇 엔드포인트 ──────────────────────────────────────────────
export const kakaoBot = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const body = req.body;
            const utterance = body.userRequest?.utterance || "";
            const todayStr = getKSTDateStr();

            // "현황" 혹은 "점호" 키워드가 포함된 경우
            if (utterance.includes("현황") || utterance.includes("점호")) {
                // 1. 데이터 조회 (Firestore)
                const [membersSnap, schedulesSnap] = await Promise.all([
                    db.collection("members").get(),
                    db.collection("schedules").get(),
                ]);
                const members = membersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any[];
                const schedules = schedulesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any[];

                const nonRunnerMembers = members.filter((m) => m.role !== "runner");
                const totalCount = nonRunnerMembers.length;

                // 오늘 열외 인원 계산 (단순화된 로직: 오늘 날짜가 포함된 모든 스케줄)
                const todayOffSet = new Set();
                schedules.forEach((e) => {
                    if ((e.type === "vacation" || e.type === "pass" || e.type === "duty") &&
                        e.startDate <= todayStr && e.endDate >= todayStr) {
                        const m = members.find((member) => member.name === e.memo);
                        if (m && m.role !== "runner") {
                            todayOffSet.add(m.name);
                        }
                    }
                });

                const offCount = todayOffSet.size;
                const presentCount = totalCount - offCount;

                return res.json({
                    version: "2.0",
                    template: {
                        outputs: [{
                            simpleText: {
                                text: `📊 [${todayStr}] 점호 현황\n\n• 총원: ${totalCount}명\n• 열외: ${offCount}명\n• 현재원: ${presentCount}명\n\n상세 정보는 NCOA 앱에서 확인해주세요!`,
                            },
                        }],
                    },
                });
            }

            // 기본 응답 (메인 메뉴)
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

// ── 텔레그램 챗봇 엔드포인트 ──────────────────────────────────────────────
export const telegramBot = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const TELEGRAM_TOKEN = "8760934378:AAFl26uGt5sj6fhlz2peBYkr0kJcqwCtxgI";
            const body = req.body;

            // 텔레그램에서 보낸 메시지 데이터 추출
            if (!body.message) return res.sendStatus(200);

            const chatId = body.message.chat.id;
            const text = (body.message.text || "").trim();
            const from = body.message.from;
            if (!from) return res.sendStatus(200);

            const userId = from.id;
            const firstName = from.first_name || "";
            const lastName = from.last_name || "";
            const telegramCombinedName = (lastName + firstName).trim();

            // ── 디버깅용 날짜 설정 조회 ──────────────────────────────────────
            let todayStr = getKSTDateStr();
            const debugSnap = await db.collection("settings").doc("debug").get();
            if (debugSnap.exists && debugSnap.data()?.todayStr) {
                todayStr = debugSnap.data()?.todayStr;
            }

            logger.info("Incoming Telegram message", {
                chatId,
                text,
                userId,
                username: from.username,
                entities: body.message.entities
            });

            // ── 사용자 식별 로직 ───────────────────────────────────────────
            let currentMember: any = null;

            // 1. 텔레그램 ID로 조회
            const memberSnapById = await db.collection("members").where("telegramId", "==", userId).get();
            if (!memberSnapById.empty) {
                currentMember = { id: memberSnapById.docs[0].id, ...memberSnapById.docs[0].data() };
            } else {
                // 2. 이름 합쳐서(성+이름) 조회
                if (telegramCombinedName) {
                    const memberSnapByName = await db.collection("members").where("name", "==", telegramCombinedName).get();
                    if (!memberSnapByName.empty) {
                        const doc = memberSnapByName.docs[0];
                        await doc.ref.update({ telegramId: userId });
                        currentMember = { id: doc.id, ...doc.data() };
                    }
                }
            }

            // ── 명령어 처리 ───────────────────────────────────────────────

            // ── 명령어 처리 ───────────────────────────────────────────────
            try {
                // 텔레그램 엔티티에서 명령어(bot_command) 추출
                const entities = body.message.entities || [];
                const botCmd = entities.find((e: any) => e.type === "bot_command");
                let cmdName = "";
                if (botCmd) {
                    const rawCmd = text.substring(botCmd.offset, botCmd.offset + botCmd.length);
                    cmdName = rawCmd.split("@")[0].toLowerCase();
                }

                // ── 디버그 명령어: /date ──────────────────────────────────────
                if (cmdName === "/date") {
                    const input = text.replace(/\/date(@\w+)?/, "").trim();
                    if (input === "reset") {
                        await db.collection("settings").doc("debug").set({ todayStr: null }, { merge: true });
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "✅ 날짜가 정상화되었습니다." });
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
                        await db.collection("settings").doc("debug").set({ todayStr: input }, { merge: true });
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `✅ 오늘 날짜가 [${input}]으로 설정되었습니다.` });
                    } else {
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "⚠️ 사용법: `/date YYYY-MM-DD` 또는 `/date reset`" });
                    }
                    return res.sendStatus(200);
                }

                // ── 시카(Senior) 명령어 ────────────────────────────────────────
                if (cmdName === "/senior") {
                    const seniorSnap = await db.collection("settings").doc("senior").get();
                    if (seniorSnap.exists && seniorSnap.data()?.name) {
                        const name = seniorSnap.data()?.name;
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
                    return res.sendStatus(200);
                }

                if (cmdName === "/changesenior") {
                    const entities = body.message.entities || [];
                    let targetName = "";

                    // 1. 멘션(텍스트 멘션 포함)에서 이름 추출 시도
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
                        await db.collection("settings").doc("senior").set({ name: targetName }, { merge: true });
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
                    return res.sendStatus(200);
                }

                // ── 시트 모드 변경 명령어: /sheet ────────────────────────────────────
                if (cmdName === "/sheet") {
                    const inputMode = text.replace(/\/sheet(@\w+)?/, "").trim().toLowerCase();
                    if (inputMode === "test" || inputMode === "prod") {
                        await db.collection("settings").doc("spreadsheet").set({ 
                            mode: inputMode,
                            updatedAt: FieldValue.serverTimestamp()
                        }, { merge: true });
                        // 오늘의 복귀 데이터 초기화 (시트 변경 시 자동)
                        await db.collection("dailyReturns").doc(todayStr).delete();
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `✅ 연동된 시트가 [${inputMode.toUpperCase()}] 모드로 변경되었습니다.` });
                    } else if (inputMode === "") {
                        const docSnap = await db.collection("settings").doc("spreadsheet").get();
                        const currentMode = docSnap.exists ? docSnap.data()?.mode || "test" : "test";
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `ℹ️ 현재 연동된 시트 모드는 [${currentMode.toUpperCase()}] 입니다.\n변경하려면 \`/sheet test\` 또는 \`/sheet prod\` 를 입력하세요.` });
                    } else {
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "⚠️ 사용법: `/sheet test` 또는 `/sheet prod`" });
                    }
                    return res.sendStatus(200);
                }

                // 0. /auth (실명 인증)
                if (cmdName === "/auth" || text.startsWith("/auth")) {
                    const inputName = text.replace(/\/auth(@\w+)?/, "").trim();
                    if (!inputName) {
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "⚠️ 사용법: `/auth [실명]`" });
                        return res.sendStatus(200);
                    }
                    const memberSnap = await db.collection("members").where("name", "==", inputName).get();
                    if (!memberSnap.empty) {
                        await memberSnap.docs[0].ref.update({ telegramId: userId });
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `✅ *${inputName}* 님, 인증이 완료되었습니다!` });
                    } else {
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `❌ *${inputName}* 님을 명단에서 찾을 수 없습니다.` });
                    }
                    return res.sendStatus(200);
                }

                // 명령어 유형 판별
                const isReturnCmd = text.startsWith("ㅂㄱ") || text.startsWith("복귀취소") || text === "미복귀" || cmdName === "/reset" || text.includes("금일 복귀 인원 리스트");
                const isStartCmd = cmdName === "/start";

                if (isStartCmd) {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "NCOA 복귀 알림 봇입니다. 🫡" });
                    return res.sendStatus(200);
                }

                if (isReturnCmd) {
                    const { data: returnsData, docRef } = await getTodayReturnees(todayStr);

                    // (/edit 및 /cancel 기능은 상태 기반 복귀취소 로직으로 대체되어 삭제됨)

                    // 2. /reset (Initialize / Force Refresh)
                    if (cmdName === "/reset") {
                        await docRef.delete();
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "✅ 오늘의 복귀 보고 문자가 초기화되었습니다." });
                        return res.sendStatus(200);
                    }

                    // 3. 미복귀 (Check unreturned personnel)
                    if (text === "미복귀") {
                        const rv = returnsData.returnedVacation || [];
                        const rp = returnsData.returnedPass || [];
                        const uv = returnsData.expectedVacation.filter((n: string) => !rv.includes(n));
                        const up = returnsData.expectedPass.filter((n: string) => !rp.includes(n));

                        let msg = `*미복귀자 명단*\n\n`;
                        msg += `*휴가 (${uv.length}명)*\n` + (uv.length > 0 ? uv.map((n: string) => `- ${n}`).join("\n") : `- 없음`) + "\n\n";
                        msg += `*외박 (${up.length}명)*\n` + (up.length > 0 ? up.map((n: string) => `- ${n}`).join("\n") : `- 없음`);

                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: msg, parse_mode: "Markdown" });
                        return res.sendStatus(200);
                    }


                    // ── 공통 헬퍼: 타겟 이름 추출 ─────────────────────────────────
                    const extractTargets = async () => {
                        const entities = body.message.entities || [];
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

                    // ── 공통 헬퍼: 현재 복귀 상태 메시지 생성 및 전송 ──────────────────
                    const sendReturnStatusMessage = async () => {
                        const updatedSnap = await docRef.get();
                        const updatedData = updatedSnap.data() || {};
                        const returnedVacation = updatedData.returnedVacation || [];
                        const returnedPass = updatedData.returnedPass || [];

                        const membersSnap = await db.collection("members").get();
                        const membersList = membersSnap.docs.map(doc => doc.data());

                        const sortMembers = (names: string[], allMembers: any[]) => {
                            return names.map(n => {
                                const m = allMembers.find(mem => mem.name === n);
                                return m ? m : { name: n, enlistmentDate: "9999-99-99" };
                            }).sort((a, b) => {
                                const dateA = a.enlistmentDate || "9999-99-99";
                                const dateB = b.enlistmentDate || "9999-99-99";
                                if (dateA !== dateB) return dateA.localeCompare(dateB);
                                return a.name.localeCompare(b.name);
                            }).map(m => {
                                const fullMember = allMembers.find(mem => mem.name === m.name);
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
                            const seniorSnap = await db.collection("settings").doc("senior").get();
                            if (seniorSnap.exists && seniorSnap.data()?.name) {
                                const sName = seniorSnap.data()?.name;
                                const sMemberSnap = await db.collection("members").where("name", "==", sName).get();
                                let mention = sName;
                                if (!sMemberSnap.empty) {
                                    const sData = sMemberSnap.docs[0].data();
                                    if (sData.telegramId) {
                                        mention = `[${sName}](tg://user?id=${sData.telegramId})`;
                                    }
                                }
                                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                                    chat_id: chatId,
                                    text: `전원 복귀 완료 @${mention}`,
                                    parse_mode: "Markdown"
                                });
                            }
                        }
                    };

                    // 4. 복귀취소 키워드 처리
                    if (text.startsWith("복귀취소")) {
                        const targetNames = await extractTargets();
                        if (targetNames.length === 0) {
                            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: "⚠️ 취소할 인원을 확인할 수 없습니다." });
                            return res.sendStatus(200);
                        }

                        const removedVacations: string[] = [];
                        const removedPasses: string[] = [];

                        for (const name of targetNames) {
                            if ((returnsData.returnedVacation || []).includes(name)) removedVacations.push(name);
                            if ((returnsData.returnedPass || []).includes(name)) removedPasses.push(name);
                        }

                        if (removedVacations.length > 0 || removedPasses.length > 0) {
                            const updates: any = {};
                            if (removedVacations.length > 0) updates.returnedVacation = FieldValue.arrayRemove(...removedVacations);
                            if (removedPasses.length > 0) updates.returnedPass = FieldValue.arrayRemove(...removedPasses);
                            await docRef.update(updates);

                            const allRemoved = [...removedVacations, ...removedPasses];
                            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                                chat_id: chatId,
                                text: `✅ ${allRemoved.join(", ")} 님의 복귀 처리가 취소되었습니다.`
                            });
                            await sendReturnStatusMessage();
                        } else {
                            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                                chat_id: chatId,
                                text: `⚠️ 해당 인원들은 아직 복귀 완료 처리되지 않았습니다.`
                            });
                        }
                        return res.sendStatus(200);
                    }

                    // 5. "ㅂㄱ" 키워드 처리
                    if (text.startsWith("ㅂㄱ")) {
                        if (!currentMember && !(text.match(/@([^\s@]+)/g))) {
                            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                                chat_id: chatId,
                                text: `⚠️ 누구신지 아직 모르겠어요! 🫡\n\n1. 텔레그램 프로필 이름을 *실명*으로 수정하시거나\n2. \`/인증 [실명]\` 명령어를 입력해 주세요.`,
                                parse_mode: "Markdown"
                            });
                            return res.sendStatus(200);
                        }

                        const targetNames = await extractTargets();
                        const addedVacations: string[] = [];
                        const addedPasses: string[] = [];
                        const notFoundNames: string[] = [];

                        for (const name of targetNames) {
                            const isVacation = returnsData.expectedVacation.includes(name);
                            const isPass = returnsData.expectedPass.includes(name);

                            if (isVacation) addedVacations.push(name);
                            else if (isPass) addedPasses.push(name);
                            else notFoundNames.push(name);
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
                            await docRef.update(updates);

                            await sendReturnStatusMessage();
                        }
                        return res.sendStatus(200);
                    }
                    // 2. "금일 복귀 인원 리스트" 키워드 처리
                    else if (text.includes("금일 복귀 인원 리스트")) {
                        const tomorrowDate = new Date(new Date(todayStr).getTime() + 24 * 60 * 60 * 1000);
                        const tomorrowStr = tomorrowDate.toISOString().split("T")[0];

                        // 스프레드 시트 데이터 가져오기 및 파싱
                        const sheetData = await getSheetData();
                        const sheetEvents = parseSheetEvents(sheetData, sheetData, sheetData, todayStr, tomorrowStr);

                        // 오늘 복귀자 필터링 (isReturnDay 가 true이고 날짜가 오늘인 경우)
                        const vacationReturns = sheetEvents.filter(e => e.type === "vacation" && e.startDate === todayStr && e.isReturnDay);
                        const passReturns = sheetEvents.filter(e => e.type === "pass" && e.startDate === todayStr && e.isReturnDay);

                        let responseMsg = `📅 *[${todayStr}] 복귀 예정 인원*\n\n`;

                        responseMsg += `🏠 *휴가 복귀 (${vacationReturns.length}명)*\n`;
                        if (vacationReturns.length > 0) {
                            responseMsg += vacationReturns.map(e => `• ${e.memo}`).join("\n");
                        } else {
                            responseMsg += `• 없음`;
                        }

                        responseMsg += `\n\n🚶 *외박 복귀 (${passReturns.length}명)*\n`;
                        if (passReturns.length > 0) {
                            responseMsg += passReturns.map(e => `• ${e.memo}`).join("\n");
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
                    else if (text === "/start") {
                        const welcomeMessage = "안녕하세요! NCOA 복귀 알림 봇입니다. 🫡\n\n'ㅂㄱ'라고 입력하시면 복귀 완료 메시지를 보내드립니다.";
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                            chat_id: chatId,
                            text: welcomeMessage
                        });
                    }

                }

                return res.status(200).send("OK");
            } catch (error: any) {
                logger.error("telegramBot error:", error);
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: `🚨 에러 발생: ${error.message}`
                });
                return res.sendStatus(200); // Telegram webhooks should return 2xx to stop retries
            }
        } catch (globalError: any) {
            logger.error("Global telegramBot error:", globalError);
            return res.sendStatus(200);
        }
    });
});
export const notifySpreadsheetUpdate = onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            await db.collection("settings").doc("spreadsheet").set({
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            res.status(200).send({ status: "success" });
        } catch (error) {
            logger.error("notifySpreadsheetUpdate error", error);
            res.status(500).send({ status: "error", message: "Internal Server Error" });
        }
    });
});

// ── 구글 시트 동기화 (외특 엑셀 업로드용) ──────────────────────────────
export const syncMovementToSheet = onRequest((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const { movements } = req.body; // MovementTab에서 전송한 분석 결과
            if (!movements || !Array.isArray(movements)) {
                return res.status(400).json({ status: "error", message: "movements 데이터가 필요합니다." });
            }

            logger.info(`syncMovementToSheet called with ${movements.length} items`);

            // 1. 서비스 계정 인증
            const auth = new google.auth.GoogleAuth({
                keyFile: path.join(__dirname, "../service-account.json"),
                scopes: ["https://www.googleapis.com/auth/spreadsheets"],
            });
            const sheets = google.sheets({ version: "v4", auth });
            
            // 1.5 시트 모드 확인
            const docSnap = await db.collection("settings").doc("spreadsheet").get();
            const sheetMode = (docSnap.exists ? docSnap.data()?.mode || "test" : "test") as "test" | "prod";
            const spreadsheetId = SPREADSHEET_IDS[sheetMode] || SPREADSHEET_IDS.test;

            logger.info(`syncMovementToSheet: using ${sheetMode} mode (${spreadsheetId})`);
            const sheetName = "NEW";
            const range = `'${sheetName}'!A1:AZ200`;

            // 2. 현재 시트 데이터 가져오기
            const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
            const rows = response.data.values;
            if (!rows || rows.length === 0) {
                return res.status(500).json({ status: "error", message: "시트 데이터를 읽을 수 없습니다." });
            }

            const dateRow = rows[0]; // 1행 (날짜)
            const nameColumn = rows.map(r => r[0]); // A열 (이름)

            const updateData: any[] = [];

            // 열 인덱스를 구글 시트 주소(A, B, ..., AA, AB)로 변환하는 함수
            const getA1Address = (colIdx: number, rowIdx: number) => {
                let temp = colIdx;
                let letter = "";
                while (temp >= 0) {
                    letter = String.fromCharCode((temp % 26) + 65) + letter;
                    temp = Math.floor(temp / 26) - 1;
                }
                return `'${sheetName}'!${letter}${rowIdx + 1}`;
            };

            // 3. 인원별/날짜별 업데이트 값 계산
            const ambiguousMembers: any[] = [];

            movements.forEach((m: any) => {
                // 엑셀 데이터에서 계급과 이름 분리 (예: "상병 김대호" -> "김대호")
                const excelNameOnly = m.name.split(/\s+/).pop();
                
                // 시트에서 해당 이름을 가진 모든 행 찾기
                const matchingRows = nameColumn.map((name, idx) => ({ name, idx }))
                    .filter(item => {
                        if (!item.name) return false;
                        const sheetNameOnly = item.name.split(/\s+/).pop();
                        return sheetNameOnly === excelNameOnly;
                    });

                if (matchingRows.length === 0) {
                    logger.warn(`Member not found in sheet: ${m.name}`);
                    return;
                }

                let targetRowIdx = -1;
                
                if (matchingRows.length > 1) {
                    // 동명이인 발생! (계급까지 정확히 일치하는 사람이 있는지 먼저 확인)
                    const exactMatch = matchingRows.find(item => item.name === m.name);
                    if (exactMatch) {
                        targetRowIdx = exactMatch.idx;
                    } else {
                        // 계급까지 일치하는 사람이 없으면 사용자 선택 필요
                        ambiguousMembers.push({
                            excelName: m.name,
                            options: matchingRows.map(r => r.name)
                        });
                        return;
                    }
                } else {
                    // 동명이인이 없으면 계급이 달라도 동일인으로 간주
                    targetRowIdx = matchingRows[0].idx;
                }

                const rowIdx = targetRowIdx;
                const setStatus = (dateStr: string, status: string) => {
                    const colIdx = dateRow.findIndex(d => d && d.replace(/\s/g, "").includes(dateStr));
                    if (colIdx !== -1) {
                        updateData.push({
                            range: getA1Address(colIdx, rowIdx),
                            values: [[status]]
                        });
                    }
                };

                if (m.depart) setStatus(m.depart, "외박출발");
                
                // 외박 복귀 처리 (휴가 연계가 아닐 때만 외박복귀 기입)
                const isLinked = m.vacation && m.vacation.isLinked;
                if (m.return && !isLinked) {
                    setStatus(m.return, "외박복귀");
                }

                if (m.stayDays) {
                    m.stayDays.forEach((d: string) => {
                        // 출발일과 복귀일(연계일 포함)은 제외하고 '외박' 기입
                        if (d !== m.depart && d !== m.return) {
                            setStatus(d, "외박");
                        }
                    });
                }

                // 휴가 처리
                if (m.vacation) {
                    const v = m.vacation;
                    if (v.depart) {
                        setStatus(v.depart, v.isLinked ? "휴가출발(연계)" : "휴가출발");
                    }
                    if (v.return) {
                        setStatus(v.return, "휴가복귀");
                    }
                    if (v.stayDays) {
                        v.stayDays.forEach((d: string) => {
                            // 휴가 출발일과 복귀일은 제외하고 '휴가' 기입
                            if (d !== v.depart && d !== v.return) {
                                setStatus(d, "휴가");
                            }
                        });
                    }
                }

                // 당직 처리
                if (m.type === "당직" && m.date) {
                    setStatus(m.date, "당직");
                }
            });

            // 4. 동명이인 확인 필요 시 중단
            if (ambiguousMembers.length > 0) {
                return res.json({ 
                    status: "ambiguous", 
                    ambiguousMembers 
                });
            }

            // 5. 구글 시트 일괄 업데이트
            if (updateData.length > 0) {
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        valueInputOption: "RAW",
                        data: updateData,
                    },
                });
                
                // Firestore 업데이트 시간 갱신 (앱에서 데이터 리로딩 유도)
                await db.collection("settings").doc("spreadsheet").set({
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });

                return res.json({ status: "success", count: updateData.length });
            }

            return res.json({ status: "success", message: "업데이트할 항목이 없습니다." });

        } catch (error: any) {
            logger.error("syncMovementToSheet error:", error);
            return res.status(500).json({ status: "error", message: error.message });
        }
    });
});
