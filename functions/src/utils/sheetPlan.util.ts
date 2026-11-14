/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 시트에 어느 칸에 무엇을 쓸지 계산하는 순수 함수 (시트 읽기·쓰기는 sheetSync.service).
 * 예전에는 시트에 없는 이름·날짜를 조용히 건너뛰었다. 이제는 경고로 모아 돌려주고, 경고가 있으면 쓰지 않는다.
 * 외부 의존성 없음 — tests/movement.sheet-plan.test.ts
 */

/* ---- 셀 값 규칙 (앱의 src/utils/movement/movement.sheet-cell.ts와 같은 내용) ----
 * 셀 값은 그날 일어난 일(외박복귀 → 휴가출발 → 휴가복귀 → 외박출발 순)을 '/'로 잇는다.
 * 마지막 항목이 그날 밤 상태다. 휴외연계도 '휴가복귀/외박출발'(연계 표기 없음).
 */
export const SHEET_CELL_VALUES = [
    "외박", "외박출발", "외박복귀",
    "휴가", "휴가출발", "휴가복귀",
    "외박복귀/휴가출발",
    "휴가복귀/외박출발",
    "휴가출발/휴가복귀", "휴가출발/휴가복귀/외박출발",
    "외박복귀/외박출발",
    "외출", "당직",
];

export interface DayEvents {
    passReturn?: boolean;
    vacationDepart?: boolean;
    vacationReturn?: boolean;
    passDepart?: boolean;
    passStay?: boolean;
    vacationStay?: boolean;
}

export function composeSheetCell(e: DayEvents, _allowVacationPassLink: boolean): string {
    const tokens: string[] = [];
    if (e.passReturn) tokens.push("외박복귀");
    if (e.vacationDepart) tokens.push("휴가출발");
    if (e.vacationReturn) tokens.push("휴가복귀");
    if (e.passDepart) tokens.push("외박출발");
    if (tokens.length > 0) {
        // 연계 여부는 시트에 적지 않는다
        return tokens.join("/");
    }
    if (e.passStay) return "외박";
    if (e.vacationStay) return "휴가";
    return "";
}

export interface CellWrite { range: string; values: string[][] }
export interface SheetWarning { name: string; message: string }

export function a1(colIdx: number, rowIdx: number, sheetName = "NEW") {
    let temp = colIdx;
    let letter = "";
    while (temp >= 0) {
        letter = String.fromCharCode((temp % 26) + 65) + letter;
        temp = Math.floor(temp / 26) - 1;
    }
    return `'${sheetName}'!${letter}${rowIdx + 1}`;
}

export const nameOnly = (name: string) => (name || "").replace(/\s*(병장|상병|일병|이병)/g, "").trim().split(/\s+/).pop() || "";

/** 1행 날짜 헤더('2026. 11. 14' 같은 형식)에서 'M.D'의 열 번호. 없으면 -1 */
export function findDateColumn(dateRow: string[], md: string): number {
    const [tm, td] = md.split(".").map(Number);
    return dateRow.findIndex((d) => {
        if (!d) return false;
        const parts = d.replace(/\s/g, "").split(".").filter((p) => p !== "");
        return parts.length >= 3 && parseInt(parts[1]) === tm && parseInt(parts[2]) === td;
    });
}

/** 엑셀 반영: 대원별 칸 계산. 동명이인은 ambiguousMembers, 시트에 없는 이름·날짜는 warnings */
export function planMovementCells(dateRow: string[], nameColumn: string[], movements: any[], allowVacationPassLink: boolean, sheetName = "NEW") {
    const updateData: CellWrite[] = [];
    const ambiguousMembers: any[] = [];
    const warnings: SheetWarning[] = [];
    // 같은 대원·같은 날의 일을 모아 한 칸에 조합한다 (외휴연계, 당일 휴가, 연속 외박 등)
    const cells = new Map<string, { name: string; col: number; rowIdx: number; events: DayEvents; duty: boolean }>();

    movements.forEach((m: any) => {
        const target = nameOnly(m.name);
        const matching = nameColumn
            .map((name, idx) => ({ name, idx }))
            .filter((item) => item.name && nameOnly(item.name) === target);

        if (matching.length === 0) {
            if (!warnings.some((w) => w.name === m.name && w.message.includes("찾을 수 없습니다"))) {
                warnings.push({ name: m.name, message: `시트에서 '${m.name}' 대원을 찾을 수 없습니다. 이름을 확인하세요.` });
            }
            return;
        }
        let rowIdx = matching[0].idx;
        if (matching.length > 1) {
            const exact = matching.find((item) => item.name === m.name);
            if (!exact) {
                ambiguousMembers.push({ excelName: m.name, options: matching.map((r) => r.name) });
                return;
            }
            rowIdx = exact.idx;
        }

        const missing: string[] = [];
        const mark = (md: string, apply: (c: { events: DayEvents; duty: boolean }) => void) => {
            const col = findDateColumn(dateRow, md);
            if (col === -1) {
                if (!missing.includes(md)) missing.push(md);
                return;
            }
            const key = `${rowIdx}|${col}`;
            if (!cells.has(key)) cells.set(key, { name: m.name, col, rowIdx, events: {}, duty: false });
            apply(cells.get(key)!);
        };

        if (m.depart) mark(m.depart, (c) => { c.events.passDepart = true; });
        // 휴가만 있는 항목도 return에 휴가 복귀일이 들어 있으므로, 외박이 있는 항목(출발일이나 기간이 있음)만 외박 복귀로 센다
        if (m.return && (m.depart || m.period)) mark(m.return, (c) => { c.events.passReturn = true; });
        (m.stayDays || []).forEach((d: string) => { if (d !== m.depart && d !== m.return) mark(d, (c) => { c.events.passStay = true; }); });
        if (m.vacation) {
            const v = m.vacation;
            if (v.depart) mark(v.depart, (c) => { c.events.vacationDepart = true; });
            if (v.return) mark(v.return, (c) => { c.events.vacationReturn = true; });
            (v.stayDays || []).forEach((d: string) => { if (d !== v.depart && d !== v.return) mark(d, (c) => { c.events.vacationStay = true; }); });
        }
        if (m.type === "당직" && m.date) mark(m.date, (c) => { c.duty = true; });

        if (missing.length > 0) {
            warnings.push({ name: m.name, message: `시트에 ${missing.join(", ")} 날짜 칸이 없습니다. 시트의 날짜 범위를 확인하세요.` });
        }
    });

    cells.forEach((c) => {
        const value = composeSheetCell(c.events, allowVacationPassLink) || (c.duty ? "당직" : "");
        if (c.duty && value !== "당직") {
            warnings.push({ name: c.name, message: `${dateRow[c.col]} 당직인 날에 출타가 겹칩니다(${value}). 날짜를 확인하세요.` });
            return;
        }
        if (value && !SHEET_CELL_VALUES.includes(value)) {
            warnings.push({ name: c.name, message: `${dateRow[c.col]} '${value}'는 시트에서 쓸 수 없는 조합입니다. 날짜를 확인하세요.` });
            return;
        }
        updateData.push({ range: a1(c.col, c.rowIdx, sheetName), values: [[value]] });
    });

    return { updateData, ambiguousMembers, warnings };
}

/** 주간 편집 저장: 한 대원의 칸 계산. 시트에 없는 이름은 notFound, 없는 날짜는 missingDates */
export function planMemberCells(
    dateRow: string[], nameColumn: string[], memberName: string,
    dayStatuses: Record<string, string>, cellUpdates: Record<string, string> | undefined,
    allowVacationPassLink: boolean, sheetName = "NEW",
) {
    const target = nameOnly(memberName);
    const matching = nameColumn.map((name, idx) => ({ name, idx })).filter((item) => item.name && nameOnly(item.name) === target);
    if (matching.length === 0) return { notFound: true, missingDates: [] as string[], updateData: [] as CellWrite[] };
    let rowIdx = matching[0].idx;
    if (matching.length > 1) {
        const exact = matching.find((item) => item.name.includes(target));
        if (exact) rowIdx = exact.idx;
    }

    const passDates = Object.entries(dayStatuses).filter(([, s]) => s === "pass").map(([d]) => d);
    const lastPassDate = passDates[passDates.length - 1];
    const vacDates = Object.entries(dayStatuses).filter(([, s]) => s === "vacation" || s === "linked").map(([d]) => d);
    const firstVacDate = vacDates[0];
    const lastVacDate = vacDates[vacDates.length - 1];

    const updateData: CellWrite[] = [];
    const missingDates: string[] = [];
    const dates = cellUpdates ? Object.keys(cellUpdates) : Object.keys(dayStatuses);
    dates.forEach((md) => {
        let value = "";
        if (cellUpdates && cellUpdates[md] !== undefined) {
            value = cellUpdates[md];
        } else {
            const status = dayStatuses[md];
            if (status === "pass") value = md === lastPassDate ? "외박복귀" : "외박";
            else if (status === "pass-depart" || status === "recovery-pass-depart") value = "외박출발";
            else if (status === "vacation-pass-depart") value = composeSheetCell({ vacationReturn: true, passDepart: true }, allowVacationPassLink);
            else if (status === "vacation") value = md === firstVacDate && md === lastVacDate ? "휴가출발/휴가복귀" : md === firstVacDate ? "휴가출발" : md === lastVacDate ? "휴가복귀" : "휴가";
            else if (status === "linked") value = "외박복귀/휴가출발";
            else if (status === "duty") value = "당직";
            else if (status === "recovery" || status === "none") value = "";
            else value = status || "";
        }
        const col = findDateColumn(dateRow, md);
        if (col === -1) {
            // 시트에 아직 없는 날짜(예: 마지막 주 뒤쪽)를 비우는 것은 할 일이 없으므로 넘어간다. 값을 써야 하는데 칸이 없을 때만 문제다.
            if (value !== "") missingDates.push(md);
            return;
        }
        updateData.push({ range: a1(col, rowIdx, sheetName), values: [[value]] });
    });
    return { notFound: false, missingDates, updateData };
}
