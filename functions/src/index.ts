/* eslint-disable @typescript-eslint/no-explicit-any */
import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import cors from "cors";
import axios from "axios";
import Papa from "papaparse";

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
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1WBJXIzLbbtRxt09KOaJeXKXtgbht-GDjX3N4DyDztOY/export?format=csv&gid=1529486829";

async function getSheetData(): Promise<any[]> {
    const csvRes = await axios.get(SHEET_CSV_URL);

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
