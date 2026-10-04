import { processRollCallData } from "./rollCall.service";
import { getTodayReturneesHelper } from "./telegram.service";
import { getAllMembers } from "../repositories/member.repository";
import { compareMembersByHobong, getMemberDisplayName } from "../utils/rank.util";

function getPreviousDateStr(dateStr: string): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

export async function getKakaoRollCallStatus(todayStr: string) {
    const targetDate = new Date(todayStr);
    const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
    const targetDayLabel = dayLabels[targetDate.getDay()];

    // 전날 저녁 점호 기준 데이터 조회
    const previousDateStr = getPreviousDateStr(todayStr);
    const prevDate = new Date(previousDateStr);
    const prevDayLabel = dayLabels[prevDate.getDay()];

    const rollCallData = await processRollCallData(previousDateStr, { excludeHoldover: true });
    const { total, present, absent, dutyCount, vacationCount, passCount } = rollCallData.stats;

    const details: string[] = [];
    if (dutyCount > 0) details.push(`당직 ${dutyCount}명`);
    if (vacationCount > 0) details.push(`휴가 ${vacationCount}명`);
    if (passCount > 0) details.push(`외박 ${passCount}명`);

    const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";

    let text = `📊 [${todayStr}(${targetDayLabel})] 점호 현황\n(${prevDayLabel}요일 저녁 점호 기준)\n\n`;
    text += `• 총원: ${total}명\n`;
    text += `• 열외: ${absent}명${detailText}\n`;
    text += `• 현재원: ${present}명`;

    return {
        version: "2.0",
        template: {
            outputs: [{
                simpleText: {
                    text: text.trim(),
                },
            }],
        },
    };
}

export async function getKakaoUnreturnedStatus(todayStr: string) {
    const { data: returnsData } = await getTodayReturneesHelper(todayStr);

    const rv = returnsData.returnedVacation || [];
    const rp = returnsData.returnedPass || [];
    const uv = (returnsData.expectedVacation || []).filter((n: string) => !rv.includes(n));
    const up = (returnsData.expectedPass || []).filter((n: string) => !rp.includes(n));

    const members = await getAllMembers();
    const asOfDate = new Date(todayStr);
    const sortMembers = (names: string[]) => {
        return names.map((n: string) => {
            const m = members.find((mem) => mem.name === n);
            return m ? m : { name: n, enlistmentDate: "9999-99-99" };
        }).sort((a, b) => compareMembersByHobong(a, b, asOfDate)).map((m) => {
            const fullMember = members.find((mem) => mem.name === m.name);
            return fullMember ? getMemberDisplayName(fullMember, asOfDate) : m.name;
        });
    };

    const sortedUp = sortMembers(up);
    const sortedUv = sortMembers(uv);

    const totalUnreturned = sortedUv.length + sortedUp.length;
    let text = `🚨 [${todayStr}] 미복귀자 명단 (총 ${totalUnreturned}명)\n\n`;
    text += `• 외박 (${sortedUp.length}명)\n` + (sortedUp.length > 0 ? sortedUp.map((n: string) => `- ${n}`).join("\n") : `- 없음`) + "\n\n";
    text += `• 휴가 (${sortedUv.length}명)\n` + (sortedUv.length > 0 ? sortedUv.map((n: string) => `- ${n}`).join("\n") : `- 없음`);

    return {
        version: "2.0",
        template: {
            outputs: [{
                simpleText: {
                    text: text.trim(),
                },
            }],
        },
    };
}

export async function getKakaoWeeklyRollCallStatus(todayStr: string) {
    const d = new Date(todayStr);
    const day = d.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;

    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMon);

    const weekDates: { displayDateStr: string; queryDateStr: string; label: string; prevDayLabel: string }[] = [];
    const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];

    for (let i = 0; i < 5; i++) {
        const cur = new Date(monday);
        cur.setDate(monday.getDate() + i);
        const yyyy = cur.getFullYear();
        const mm = String(cur.getMonth() + 1).padStart(2, "0");
        const dd = String(cur.getDate()).padStart(2, "0");
        const displayDateStr = `${yyyy}-${mm}-${dd}`;
        const label = `${mm}.${dd}(${dayLabels[cur.getDay()]})`;

        // 전날(일요일~목요일) 저녁 점호 기준 날짜
        const prev = new Date(cur);
        prev.setDate(cur.getDate() - 1);
        const prevYyyy = prev.getFullYear();
        const prevMm = String(prev.getMonth() + 1).padStart(2, "0");
        const prevDd = String(prev.getDate()).padStart(2, "0");
        const queryDateStr = `${prevYyyy}-${prevMm}-${prevDd}`;
        const prevDayLabel = `${dayLabels[prev.getDay()]}요일 저녁`;

        weekDates.push({ displayDateStr, queryDateStr, label, prevDayLabel });
    }

    const monLabel = weekDates[0].label;
    const friLabel = weekDates[4].label;

    // 병렬로 5일간 데이터 일괄 조회 (전날 저녁 점호 기준, 유급생 제외)
    const weekResults = await Promise.all(
        weekDates.map((w) => processRollCallData(w.queryDateStr, { excludeHoldover: true }))
    );

    let text = `📅 [${monLabel} ~ ${friLabel}] 이번 주 점호 현황 (전날 저녁 점호 기준)\n\n`;

    weekDates.forEach(({ label }, idx) => {
        const rollCallData = weekResults[idx];
        const { total, present, absent, dutyCount, vacationCount, passCount } = rollCallData.stats;

        const details: string[] = [];
        if (dutyCount > 0) details.push(`당직 ${dutyCount}명`);
        if (vacationCount > 0) details.push(`휴가 ${vacationCount}명`);
        if (passCount > 0) details.push(`외박 ${passCount}명`);

        const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";

        text += `• ${label}\n`;
        text += `  - 총원: ${total}명 / 현재원: ${present}명\n`;
        text += `  - 열외: ${absent}명${detailText}\n\n`;
    });

    return {
        version: "2.0",
        template: {
            outputs: [{
                simpleText: {
                    text: text.trim(),
                },
            }],
        },
    };
}

