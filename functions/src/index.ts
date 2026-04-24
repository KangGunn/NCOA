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
async function getMonthData(y: number, m: number): Promise<any[]> {
    const GOOGLE_APPS_SCRIPT_URL =
        `https://script.google.com/macros/s/AKfycbzuiKVTi75LiuCtzguxCRTvRI8j54bNjCS3WqbU3zElNUO_bOjKOqfpVWZpF16TwH4/exec?year=${y}&month=${m}`;

    const scriptRes = await axios.get(GOOGLE_APPS_SCRIPT_URL);
    const csvUrl = scriptRes.data?.csvUrl;
    if (!csvUrl) return [];

    const csvRes = await axios.get(csvUrl);

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
                    const nameWithRank = row[0];
                    const name = nameWithRank.split(" ")[1] || nameWithRank;
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

            // 2. 구글 시트 3개월치 병렬 로딩
            const prevMonthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1);
            const nextMonthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);

            const [prevData, currData, nextData] = await Promise.all([
                getMonthData(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1),
                getMonthData(baseDate.getFullYear(), baseDate.getMonth() + 1),
                getMonthData(nextMonthDate.getFullYear(), nextMonthDate.getMonth() + 1),
            ]);

            // 3. 시트 이벤트 파싱
            const sheetEvents = parseSheetEvents(prevData, currData, nextData, todayStr, tomorrowStr);

            // 4. 당직/휴가/외박 분류
            const nonRunnerMembers = members.filter((m) => m.role !== "runner");
            const totalCount = nonRunnerMembers.length;

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

            const todayDutiesFiltered = todayDuties.filter((d) => members.find((m) => m.name === d.memo)?.role !== "runner");

            // 5. 인원 통계 계산
            const dutyCount = todayDutiesFiltered.length;
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
            res.json({
                status: "success",
                data: {
                    // 인원 통계
                    stats: { total: totalCount, present: presentCount, absent: offCount, dutyCount, vacationCount, passCount },
                    // 저녁점호용 데이터
                    evening: {
                        duties: todayDutiesFiltered.map((d) => getDisplayName(d.memo)),
                        recoveries: todayDutiesFiltered.map((d) => getDisplayName(d.memo)), // 당일 당직 = 익일 리커버리
                        tomorrowDuties: tomorrowDuties.filter((d) => members.find((m) => m.name === d.memo)?.role !== "runner").map((d) => getDisplayName(d.memo)),
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
                        duties: tomorrowDuties.filter((d) => members.find((m) => m.name === d.memo)?.role !== "runner").map((d) => getDisplayName(d.memo)),
                        recoveries: todayDuties.filter((d) => members.find((m) => m.name === d.memo)?.role !== "runner").map((d) => getDisplayName(d.memo)),
                        vacations: [
                            ...schedules.filter((e) => e.type === "vacation" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
                            ...sheetEvents.filter((e) => e.type === "vacation" && e.startDate === tomorrowStr && !e.isDepartDay),
                        ].filter((e) => members.find((m) => m.name === e.memo)?.role !== "runner").map((e) => getDisplayName(e.memo)),
                        passes: [
                            ...schedules.filter((e) => e.type === "pass" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
                            ...sheetEvents.filter((e) => e.type === "pass" && e.startDate === tomorrowStr && !e.isDepartDay),
                            ...sheetEvents.filter((e) => e.type === "vacation" && e.startDate === tomorrowStr && e.isDepartDay && e.isConsecutive),
                        ].filter((e) => members.find((m) => m.name === e.memo)?.role !== "runner").map((e) => getDisplayName(e.memo)),
                        // 아침점호 출석 인원 (열외 제외)
                        presentMembers: nonRunnerMembers
                            .sort((a, b) => (a.enlistmentDate || "").localeCompare(b.enlistmentDate || "") || a.name.localeCompare(b.name))
                            .map((m) => getMemberDisplayName(m)),
                    },
                    // 원시 sheetEvents (프런트엔드 UI 렌더링용)
                    sheetEvents,
                },
            });

        } catch (error: any) {
            logger.error("getRollCallData error:", error);
            res.status(500).json({ status: "error", message: error.message });
        }
    });
});
