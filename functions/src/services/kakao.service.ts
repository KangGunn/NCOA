import { processRollCallData } from "./rollCall.service";
import { getTodayReturneesHelper } from "./telegram.service";

export async function getKakaoRollCallStatus(todayStr: string) {
    const rollCallData = await processRollCallData(todayStr);
    const { total, present, absent, dutyCount, vacationCount, passCount } = rollCallData.stats;

    const details: string[] = [];
    if (dutyCount > 0) details.push(`당직 ${dutyCount}명`);
    if (vacationCount > 0) details.push(`휴가 ${vacationCount}명`);
    if (passCount > 0) details.push(`외박 ${passCount}명`);

    const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";

    let text = `📊 [${todayStr}] 점호 현황\n\n`;
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

    const totalUnreturned = uv.length + up.length;
    let text = `🚨 [${todayStr}] 미복귀자 명단 (총 ${totalUnreturned}명)\n\n`;
    text += `• 외박 (${up.length}명)\n` + (up.length > 0 ? up.map((n: string) => `- ${n}`).join("\n") : `- 없음`) + "\n\n";
    text += `• 휴가 (${uv.length}명)\n` + (uv.length > 0 ? uv.map((n: string) => `- ${n}`).join("\n") : `- 없음`);

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

    const weekDates: { dateStr: string; label: string }[] = [];
    const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];

    for (let i = 0; i < 5; i++) {
        const cur = new Date(monday);
        cur.setDate(monday.getDate() + i);
        const yyyy = cur.getFullYear();
        const mm = String(cur.getMonth() + 1).padStart(2, "0");
        const dd = String(cur.getDate()).padStart(2, "0");
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const label = `${mm}.${dd}(${dayLabels[cur.getDay()]})`;
        weekDates.push({ dateStr, label });
    }

    const monLabel = weekDates[0].label;
    const friLabel = weekDates[4].label;

    // 병렬로 5일간 데이터 일괄 조회 (타임아웃 방지)
    const weekResults = await Promise.all(
        weekDates.map((w) => processRollCallData(w.dateStr))
    );

    let text = `📅 [${monLabel} ~ ${friLabel}] 이번 주 점호 현황\n\n`;

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

