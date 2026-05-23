import { getAllMembers } from "../repositories/member.repository";
import { getAllSchedules } from "../repositories/schedule.repository";

export async function getKakaoRollCallStatus(todayStr: string) {
    const [members, schedules] = await Promise.all([
        getAllMembers(),
        getAllSchedules(),
    ]);

    const nonRunnerMembers = members.filter((m) => m.role !== "runner");
    const totalCount = nonRunnerMembers.length;

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

    return {
        version: "2.0",
        template: {
            outputs: [{
                simpleText: {
                    text: `📊 [${todayStr}] 점호 현황\n\n• 총원: ${totalCount}명\n• 열외: ${offCount}명\n• 현재원: ${presentCount}명\n\n상세 정보는 NCOA 앱에서 확인해주세요!`,
                },
            }],
        },
    };
}
