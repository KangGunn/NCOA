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
        ...sheetEvents.filter((e) => e.type === "vacation" && e.startDate === todayStr && !e.isReturnDay),
        ...schedules.filter((e) => e.type === "vacation" && e.startDate <= todayStr && e.endDate >= todayStr),
    ].filter((e) => activeMembers.find((m) => m.name === e.memo)?.role !== "runner");

    const todayPasses = [
        ...sheetEvents.filter((e) => e.type === "pass" && e.startDate === todayStr && !e.isReturnDay),
        ...schedules.filter((e) => {
            if (e.type !== "pass") return false;
            // 일반 대원 외박: 오늘이 시작일~종료일 사이
            if (e.startDate <= todayStr && e.endDate >= todayStr) return true;
            // 유급생(holdover) 외박: 외박 시작일 전날 저녁 점호에도 외박 처리 (전날 외박 출발)
            const member = activeMembers.find((m) => m.name === e.memo);
            if (member?.role === "holdover" && e.startDate === tomorrowStr) return true;
            return false;
        }),
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

    const compareMembers = (nameA: string, nameB: string) => {
        const mA = activeMembers.find((m) => m.name === nameA);
        const mB = activeMembers.find((m) => m.name === nameB);
        const isHoldoverA = mA?.role === "holdover" ? 1 : 0;
        const isHoldoverB = mB?.role === "holdover" ? 1 : 0;
        // 유급생은 무조건 기간병보다 아래 (holdover = 1, regular = 0)
        if (isHoldoverA !== isHoldoverB) return isHoldoverA - isHoldoverB;
        // 기간병끼리는 짬순 (입대일 오름차순: 빠른 입대일 = 선임이 먼저)
        const enlistA = mA?.enlistmentDate || "";
        const enlistB = mB?.enlistmentDate || "";
        if (enlistA !== enlistB) return enlistA.localeCompare(enlistB);
        return nameA.localeCompare(nameB);
    };

    const getEveningDisplayName = (memoName: string) => {
        const member = activeMembers.find((m) => m.name === memoName);
        return member ? getMemberDisplayName(member, baseDate) : memoName;
    };

    const getMorningDisplayName = (memoName: string) => {
        const member = activeMembers.find((m) => m.name === memoName);
        return member ? getMemberDisplayName(member, tomorrow) : memoName;
    };

    return {
        stats: { total: totalCount, present: presentCount, absent: offCount, dutyCount, vacationCount, passCount },
        evening: {
            duties: [...todayDuties].sort((a, b) => compareMembers(a.memo, b.memo)).map((d) => getEveningDisplayName(d.memo)),
            recoveries: [...todayDuties].sort((a, b) => compareMembers(a.memo, b.memo)).map((d) => getEveningDisplayName(d.memo)),
            tomorrowDuties: [...tomorrowDuties].sort((a, b) => compareMembers(a.memo, b.memo)).map((d) => getEveningDisplayName(d.memo)),
            tomorrowDeparts: [...tomorrowDeparts].sort((a, b) => compareMembers(a.memo, b.memo)).map((e) => getEveningDisplayName(e.memo)),
            vacations: [...todayVacations].sort((a, b) => compareMembers(a.memo, b.memo)).map((e) => ({
                name: getEveningDisplayName(e.memo),
                dateText: e.dateText || (() => {
                    const ps = e.startDate?.split("-"); const pe = e.endDate?.split("-");
                    if (!ps || !pe) return "";
                    return `${Number(ps[1])}.${Number(ps[2])}~${Number(pe[1])}.${Number(pe[2])}`;
                })(),
            })),
            passes: [...todayPasses].sort((a, b) => compareMembers(a.memo, b.memo)).map((e) => ({
                name: getEveningDisplayName(e.memo),
                dateText: e.dateText || (() => {
                    const ps = e.startDate?.split("-"); const pe = e.endDate?.split("-");
                    if (!ps || !pe) return "";
                    return `${Number(ps[1])}.${Number(ps[2])}~${Number(pe[1])}.${Number(pe[2])}`;
                })(),
            })),
        },
        morning: {
            tomorrowStr,
            duties: [...tomorrowDuties].sort((a, b) => compareMembers(a.memo, b.memo)).map((d) => getMorningDisplayName(d.memo)),
            recoveries: [...todayDuties].sort((a, b) => compareMembers(a.memo, b.memo)).map((d) => getMorningDisplayName(d.memo)),
            vacations: [
                ...sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && !e.isDepartDay),
                ...schedules.filter((e: any) => e.type === "vacation" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
            ]
                .filter((e: any) => activeMembers.find((m) => m.name === e.memo)?.role !== "runner")
                .sort((a: any, b: any) => compareMembers(a.memo, b.memo))
                .map((e: any) => getMorningDisplayName(e.memo)),
            passes: [
                ...sheetEvents.filter((e: any) => e.type === "pass" && e.startDate === tomorrowStr && !e.isDepartDay),
                ...sheetEvents.filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && e.isDepartDay && e.isConsecutive),
                ...schedules.filter((e: any) => e.type === "pass" && e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
            ]
                .filter((e: any) => activeMembers.find((m) => m.name === e.memo)?.role !== "runner")
                .sort((a: any, b: any) => compareMembers(a.memo, b.memo))
                .map((e: any) => getMorningDisplayName(e.memo)),
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
                .sort((a, b) => compareMembers(a.name, b.name))
                .map((m) => getMemberDisplayName(m, tomorrow)),
        },
        sheetEvents,
    };
}
