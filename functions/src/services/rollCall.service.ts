/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAllMembers } from "../repositories/member.repository";
import { getAllSchedules } from "../repositories/schedule.repository";
import { getSheetData } from "../repositories/sheet.repository";
import { parseSheetEvents, parseScheduleEvents } from "../utils/sheet.util";
import { getMemberDisplayName } from "../utils/rank.util";

export async function processRollCallData(dateStr: string, options: { excludeHoldover?: boolean } = {}) {
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
    // schedules (유급생 등) 데이터를 sheetEvents와 100% 동일한 규격의 일일 이벤트로 변환
    const scheduleEvents = parseScheduleEvents(schedules, [todayStr, tomorrowStr]);

    // 부대원(시트)과 유급생(캘린더) 데이터를 완전 일치된 단일 이벤트 배열로 통합
    const allMovementEvents = [...sheetEvents, ...scheduleEvents];

    // 기준일(todayStr) 기준으로 전입일(joinDate)이 미래인 신병들을 백엔드 레벨에서 제외
    let activeMembers = members.filter((m) => !m.joinDate || todayStr >= m.joinDate);
    if (options.excludeHoldover) {
        activeMembers = activeMembers.filter((m) => m.role !== "holdover");
    }

    const nonRunnerMembers = activeMembers.filter((m) => m.role !== "runner");
    const totalCount = nonRunnerMembers.length;

    const todayDuties = schedules.filter((e) => e.type === "duty" && e.startDate === todayStr);
    const tomorrowDuties = schedules.filter((e) => e.type === "duty" && e.startDate === tomorrowStr);

    // 부대원과 유급생 모두 100% 동일한 단일 점호 로직 적용
    const todayVacations = allMovementEvents
        .filter((e) => e.type === "vacation" && e.startDate === todayStr && !e.isReturnDay)
        .filter((e) => {
            const m = activeMembers.find((member) => member.name === e.memo);
            return m && m.role !== "runner";
        });

    const todayPasses = allMovementEvents
        .filter((e) => e.type === "pass" && e.startDate === todayStr && !e.isReturnDay)
        .filter((e) => {
            const m = activeMembers.find((member) => member.name === e.memo);
            return m && m.role !== "runner";
        });

    const todayDutiesFilteredForStats = todayDuties.filter((d) => {
        const m = activeMembers.find((member) => member.name === d.memo);
        return m && m.role !== "runner";
    });

    const dutyCount = todayDutiesFilteredForStats.length;
    const vacationCount = todayVacations.length;
    const passCount = todayPasses.length;
    const offCount = dutyCount + vacationCount + passCount;
    const presentCount = totalCount - offCount;

    const tomorrowDeparts = allMovementEvents.filter(
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
            vacations: allMovementEvents
                .filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && !e.isDepartDay)
                .filter((e: any) => activeMembers.find((m) => m.name === e.memo)?.role !== "runner")
                .sort((a: any, b: any) => compareMembers(a.memo, b.memo))
                .map((e: any) => getMorningDisplayName(e.memo)),
            passes: [
                ...allMovementEvents.filter((e: any) => e.type === "pass" && e.startDate === tomorrowStr && !e.isDepartDay),
                ...allMovementEvents.filter((e: any) => e.type === "vacation" && e.startDate === tomorrowStr && e.isDepartDay && e.isConsecutive),
            ]
                .filter((e: any) => activeMembers.find((m) => m.name === e.memo)?.role !== "runner")
                .sort((a: any, b: any) => compareMembers(a.memo, b.memo))
                .map((e: any) => getMorningDisplayName(e.memo)),
            presentMembers: nonRunnerMembers
                .filter((m) => {
                    const name = m.name;
                    const isDuty = tomorrowDuties.some((d: any) => d.memo === name);
                    const isRecovery = todayDuties.some((d: any) => d.memo === name);
                    const isVacation = allMovementEvents.some(
                        (e: any) => e.type === "vacation" && e.startDate === tomorrowStr && !e.isDepartDay && e.memo === name
                    );
                    const isPass = allMovementEvents.some(
                        (e: any) => (
                            (e.type === "pass" && e.startDate === tomorrowStr && !e.isDepartDay) ||
                            (e.type === "vacation" && e.startDate === tomorrowStr && e.isDepartDay && e.isConsecutive)
                        ) && e.memo === name
                    );
                    return !isDuty && !isRecovery && !isVacation && !isPass;
                })
                .sort((a, b) => compareMembers(a.name, b.name))
                .map((m) => getMemberDisplayName(m, tomorrow)),
        },
        sheetEvents: allMovementEvents,
    };
}
