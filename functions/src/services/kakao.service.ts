import { processRollCallData } from "./rollCall.service";
import { getTodayReturneesHelper } from "./telegram.service";

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

    const rollCallData = await processRollCallData(previousDateStr);
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
        const prevDayLabel = `${dayLabels[prev.getDay()]}저`;

        weekDates.push({ displayDateStr, queryDateStr, label, prevDayLabel });
    }

    const monLabel = weekDates[0].label;
    const friLabel = weekDates[4].label;

    // 병렬로 5일간 데이터 일괄 조회 (전날 저녁 점호 기준)
    const weekResults = await Promise.all(
        weekDates.map((w) => processRollCallData(w.queryDateStr))
    );

    let text = `📅 [${monLabel} ~ ${friLabel}] 이번 주 점호 현황\n\n`;

    weekDates.forEach(({ label, prevDayLabel }, idx) => {
        const rollCallData = weekResults[idx];
        const { total, present, absent, dutyCount, vacationCount, passCount } = rollCallData.stats;

        const details: string[] = [];
        if (dutyCount > 0) details.push(`당직 ${dutyCount}명`);
        if (vacationCount > 0) details.push(`휴가 ${vacationCount}명`);
        if (passCount > 0) details.push(`외박 ${passCount}명`);

        const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";

        text += `• ${label} (${prevDayLabel} 기준)\n`;
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

