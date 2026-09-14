/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseSheetEvents(prevData: any[], currData: any[], nextData: any[], todayStr: string, tomorrowStr: string): any[] {
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

/**
 * schedules (유급생 및 캘린더 일정) 데이터를 sheetEvents와 100% 동일한 형식의 일일 이벤트로 변환합니다.
 * - 외박: 시작일 전날(departDay) 저녁 출발 ~ 복귀일(returnDay) 저녁 복귀
 * - 휴가: 시작일 당일(departDay) 출발 ~ 복귀일(returnDay) 저녁 복귀
 */
export function parseScheduleEvents(schedules: any[], targetDates: string[]): any[] {
    const parsed: any[] = [];

    schedules.forEach((s) => {
        if (s.type !== "vacation" && s.type !== "pass") return;

        const start = s.startDate; // YYYY-MM-DD
        const end = s.endDate || s.startDate; // YYYY-MM-DD

        // dateText 생성 (예: 9.12~9.15 또는 9.12)
        const ps = start.split("-");
        const pe = end.split("-");
        const dateText = start === end
            ? `${Number(ps[1])}.${Number(ps[2])}`
            : `${Number(ps[1])}.${Number(ps[2])}~${Number(pe[1])}.${Number(pe[2])}`;

        // 외박 출발일: 시작일 전날
        // 휴가 출발일: 시작일 당일
        let departDateStr = start;
        if (s.type === "pass") {
            const d = new Date(start);
            d.setDate(d.getDate() - 1);
            departDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
        const returnDateStr = end;

        targetDates.forEach((targetDate) => {
            // 해당 targetDate가 이 일정의 활동 범위에 포함되는지 확인
            // 활동 범위: [departDateStr, returnDateStr]
            if (targetDate < departDateStr || targetDate > returnDateStr) return;

            const isDepartDay = (targetDate === departDateStr);
            const isReturnDay = (targetDate === returnDateStr);

            parsed.push({
                id: `schedule-${s.type}-${s.memo}-${targetDate}`,
                type: s.type,
                memo: s.memo,
                startDate: targetDate,
                endDate: targetDate,
                isDepartDay,
                isReturnDay,
                isConsecutive: false,
                dateText,
            });
        });
    });

    return parsed;
}

export function getA1Address(colIdx: number, rowIdx: number, sheetName: string = "NEW") {
    let temp = colIdx;
    let letter = "";
    while (temp >= 0) {
        letter = String.fromCharCode((temp % 26) + 65) + letter;
        temp = Math.floor(temp / 26) - 1;
    }
    return `'${sheetName}'!${letter}${rowIdx + 1}`;
}
