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

export function getA1Address(colIdx: number, rowIdx: number, sheetName: string = "NEW") {
    let temp = colIdx;
    let letter = "";
    while (temp >= 0) {
        letter = String.fromCharCode((temp % 26) + 65) + letter;
        temp = Math.floor(temp / 26) - 1;
    }
    return `'${sheetName}'!${letter}${rowIdx + 1}`;
}
