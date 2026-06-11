/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAllMembers } from "../repositories/member.repository";
import { getAllSchedules } from "../repositories/schedule.repository";
import { getSheetData } from "../repositories/sheet.repository";
import { parseSheetEvents } from "../utils/sheet.util";
import { getMemberDisplayName } from "../utils/rank.util";

export async function processRollCallData(dateStr: string) {
    const baseDate = new Date(dateStr);
    const tomorrow = new Date(baseDate);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayStr = dateStr;
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    const [members, schedules] = await Promise.all([
        getAllMembers(),
        getAllSchedules(),
    ]);

    const sheetData = await getSheetData();
    const sheetEvents = parseSheetEvents(sheetData, sheetData, sheetData, todayStr, tomorrowStr);

    // 기준일(todayStr) 기준으로 전입일(joinDate)이 미래인 신병들을 백엔드 레벨에서 제외
    const activeMembers = members.filter((m) => !m.joinDate || todayStr >= m.joinDate);

    const nonRunnerMembers = activeMembers.filter((m) => m.role !== "runner");
    const totalCount = nonRunnerMembers.length;

    const todayDuties = schedules.filter((e) => e.type === "duty" && e.startDate === todayStr);
    const tomorrowDuties = schedules.filter((e) => e.type === "duty" && e.startDate === tomorrowStr);

    const todayVacations = [
        ...schedules.filter((e) => e.type === "vacation" && e.startDate <= todayStr && e.endDate >= todayStr),
        ...sheetEvents.filter((e) => e.type === "vacation" && e.startDate === todayStr && !e.isReturnDay),
    ].filter((e) => activeMembers.find((m) => m.name === e.memo)?.role !== "runner");

    const todayPasses = [
        ...schedules.filter((e) => e.type === "pass" && e.startDate <= todayStr && e.endDate >= todayStr),
        ...sheetEvents.filter((e) => e.type === "pass" && e.startDate === todayStr && !e.isReturnDay),
    ].filter((e) => activeMembers.find((m) => m.name === e.memo)?.role !== "runner");

    const todayDutiesFilteredForStats = todayDuties.filter((d) => activeMembers.find((m) => m.name === d.memo)?.role !== "runner");

    const dutyCount = todayDutiesFilteredForStats.length;
    const vacationCount = todayVacations.length;
    const passCount = todayPasses.length;
    const offCount = dutyCount + vacationCount + passCount;
    const presentCount = totalCount - offCount;

    const tomorrowDeparts = sheetEvents.filter(
        (e) => e.startDate === tomorrowStr && e.isDepartDay && e.type === "vacation"
    );

    const getDisplayName = (memoName: string) => {
        const member = activeMembers.find((m) => m.name === memoName);
        return member ? getMemberDisplayName(member) : memoName;
    };

    return {
        stats: { total: totalCount, present: presentCount, absent: offCount, dutyCount, vacationCount, passCount },
        evening: {
            duties: todayDuties.map((d) => getDisplayName(d.memo)),
            recoveries: todayDuties.map((d) => getDisplayName(d.memo)),
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
        morning: {
            tomorrowStr,
            duties: tomorrowDuties.map((d) => getDisplayName(d.memo)),
            recoveries: todayDuties.map((d) => getDisplayName(d.memo)),
            vacations: [
                ...schedules.filter((e: any) => e.type === "vacation" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
                ...sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && !e.isDepartDay),
            ].filter((e: any) => activeMembers.find((m) => m.name === e.memo)?.role !== "runner").map((e: any) => getDisplayName(e.memo)),
            passes: [
                ...schedules.filter((e: any) => e.type === "pass" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
                ...sheetEvents.filter((e: any) => e.type === "pass" && e.startDate === tomorrowStr && !e.isDepartDay),
                ...sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && e.isDepartDay && e.isConsecutive),
            ].filter((e: any) => activeMembers.find((m) => m.name === e.memo)?.role !== "runner").map((e: any) => getDisplayName(e.memo)),
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
        sheetEvents,
    };
}
