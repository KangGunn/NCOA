/* eslint-disable @typescript-eslint/no-explicit-any */
import { getGoogleSheetsInstance, getSpreadsheetIdForMode } from "../repositories/sheet.repository";
import { getSpreadsheetSetting, getMovementSetting, refreshSpreadsheetUpdatedAt } from "../repositories/setting.repository";
import { getA1Address } from "../utils/sheet.util";
import * as logger from "firebase-functions/logger";

export async function syncMovements(movements: any[]) {
    const setting = await getSpreadsheetSetting();
    const movementSetting = await getMovementSetting();
    const allowVacationPassLink = !!movementSetting?.allowVacationPassLink;
    const sheetMode = (setting?.mode || "test") as "test" | "prod";
    const spreadsheetId = await getSpreadsheetIdForMode(sheetMode);
    
    logger.info(`syncMovementToSheet: using ${sheetMode} mode (${spreadsheetId})`);
    const sheetName = "NEW";
    const range = `'${sheetName}'!A1:AZ200`;

    const sheets = await getGoogleSheetsInstance();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = response.data.values;
    if (!rows || rows.length === 0) {
        throw new Error("시트 데이터를 읽을 수 없습니다.");
    }

    const dateRow = rows[0];
    const nameColumn = rows.map((r: any) => r[0]);

    const updateData: any[] = [];
    const ambiguousMembers: any[] = [];

    movements.forEach((m: any) => {
        const excelNameOnly = (m.name || "").replace(/\s*(병장|상병|일병|이병)/g, "").trim().split(/\s+/).pop();
        
        const matchingRows = nameColumn.map((name: string, idx: number) => ({ name, idx }))
            .filter((item: any) => {
                if (!item.name) return false;
                const sheetNameOnly = item.name.replace(/\s*(병장|상병|일병|이병)/g, "").trim().split(/\s+/).pop();
                return sheetNameOnly === excelNameOnly;
            });

        if (matchingRows.length === 0) {
            logger.warn(`Member not found in sheet: ${m.name}`);
            return;
        }

        let targetRowIdx = -1;
        
        if (matchingRows.length > 1) {
            const exactMatch = matchingRows.find((item: any) => item.name === m.name);
            if (exactMatch) {
                targetRowIdx = exactMatch.idx;
            } else {
                ambiguousMembers.push({
                    excelName: m.name,
                    options: matchingRows.map((r: any) => r.name)
                });
                return;
            }
        } else {
            targetRowIdx = matchingRows[0].idx;
        }

        const rowIdx = targetRowIdx;
        const setStatus = (dateStr: string, status: string) => {
            const [targetM, targetD] = dateStr.split(".").map(Number);
            const colIdx = dateRow.findIndex((d: string) => {
                if (!d) return false;
                const clean = d.replace(/\s/g, "");
                const parts = clean.split(".").filter((p: string) => p !== "");
                if (parts.length >= 3) {
                    const month = parseInt(parts[1]);
                    const day = parseInt(parts[2]);
                    return month === targetM && day === targetD;
                }
                return false;
            });
            if (colIdx !== -1) {
                updateData.push({
                    range: getA1Address(colIdx, rowIdx, sheetName),
                    values: [[status]]
                });
            }
        };

        const hasPassDepart = !!m.depart;
        const hasVacReturn = m.vacation && !!m.vacation.return;
        const isVacPassOverlap = hasPassDepart && hasVacReturn && m.depart === m.vacation.return;

        if (m.depart) setStatus(m.depart, "외박출발");
        
        const isLinked = m.vacation && m.vacation.isLinked;
        if (m.return && !isLinked) {
            setStatus(m.return, "외박복귀");
        }

        if (m.stayDays) {
            m.stayDays.forEach((d: string) => {
                if (d !== m.depart && d !== m.return) {
                    setStatus(d, "외박");
                }
            });
        }

        if (m.vacation) {
            const v = m.vacation;
            if (v.depart) {
                setStatus(v.depart, v.isLinked ? "휴가출발(연계)" : "휴가출발");
            }
            if (v.return) {
                setStatus(v.return, isVacPassOverlap ? (allowVacationPassLink ? "외박출발(연계)" : "외박 휴가복귀/외박출발") : "휴가복귀");
            }
            if (v.stayDays) {
                v.stayDays.forEach((d: string) => {
                    if (d !== v.depart && d !== v.return) {
                        setStatus(d, "휴가");
                    }
                });
            }
        }

        if (m.type === "당직" && m.date) {
            setStatus(m.date, "당직");
        }
    });

    if (ambiguousMembers.length > 0) {
        return { status: "ambiguous", ambiguousMembers };
    }

    if (updateData.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: "RAW",
                data: updateData,
            },
        });
        
        await refreshSpreadsheetUpdatedAt(sheetMode);
        return { status: "success", count: updateData.length };
    }

    return { status: "success", message: "업데이트할 항목이 없습니다." };
}

export async function updateMemberScheduleInSheet(
    memberName: string, 
    dayStatuses: Record<string, string>,
    cellUpdates?: Record<string, string>
) {
    // 서로 기다릴 필요 없는 설정 두 개와 시트 클라이언트를 한꺼번에 준비한다
    const [setting, movementSetting, sheets] = await Promise.all([
        getSpreadsheetSetting(),
        getMovementSetting(),
        getGoogleSheetsInstance(),
    ]);
    const allowVacationPassLink = !!movementSetting?.allowVacationPassLink;
    const sheetMode = (setting?.mode || "test") as "test" | "prod";
    const spreadsheetId = await getSpreadsheetIdForMode(sheetMode);

    logger.info(`updateMemberScheduleInSheet: using ${sheetMode} mode (${spreadsheetId}) for ${memberName}`);
    const sheetName = "NEW";

    // 셀 위치를 찾는 데는 날짜 줄(1행)과 이름 열(A열)만 있으면 된다 — 표 전체(A1:AZ200)를 받지 않는다
    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [`'${sheetName}'!1:1`, `'${sheetName}'!A1:A200`],
    });
    const [headerRange, nameRange] = response.data.valueRanges || [];
    const dateRow: string[] = headerRange?.values?.[0] || [];
    const nameColumn: string[] = (nameRange?.values || []).map((r: any) => r?.[0]);
    if (dateRow.length === 0 || nameColumn.length === 0) {
        throw new Error("시트 데이터를 읽을 수 없습니다.");
    }

    const targetNameOnly = (memberName || "").replace(/\s*(병장|상병|일병|이병)/g, "").trim().split(/\s+/).pop();
    
    const matchingRows = nameColumn.map((name: string, idx: number) => ({ name, idx }))
        .filter((item: any) => {
            if (!item.name) return false;
            const sheetNameOnly = item.name.replace(/\s*(병장|상병|일병|이병)/g, "").trim().split(/\s+/).pop();
            return sheetNameOnly === targetNameOnly;
        });

    if (matchingRows.length === 0) {
        throw new Error(`시트에서 '${memberName}' 대원을 찾을 수 없습니다.`);
    }

    let targetRowIdx = matchingRows[0].idx;
    if (matchingRows.length > 1) {
        const exactMatch = matchingRows.find((item: any) => item.name.includes(targetNameOnly!));
        if (exactMatch) targetRowIdx = exactMatch.idx;
    }

    // Determine fallback start and return dates for pass and vacation if cellUpdates is not provided
    const passDates = Object.entries(dayStatuses).filter(([_, s]) => s === 'pass').map(([d]) => d);
    const lastPassDate = passDates[passDates.length - 1];

    const vacDates = Object.entries(dayStatuses).filter(([_, s]) => s === 'vacation' || s === 'linked').map(([d]) => d);
    const firstVacDate = vacDates[0];
    const lastVacDate = vacDates[vacDates.length - 1];

    const updateData: any[] = [];
    const datesToProcess = cellUpdates 
        ? Object.keys(cellUpdates) 
        : Object.keys(dayStatuses);

    datesToProcess.forEach((dateStr) => {
        const [targetM, targetD] = dateStr.split(".").map(Number);
        const colIdx = dateRow.findIndex((d: string) => {
            if (!d) return false;
            const clean = d.replace(/\s/g, "");
            const parts = clean.split(".").filter((p: string) => p !== "");
            if (parts.length >= 3) {
                const month = parseInt(parts[1]);
                const day = parseInt(parts[2]);
                return month === targetM && day === targetD;
            }
            return false;
        });

        if (colIdx !== -1) {
            let cellValue = "";
            if (cellUpdates && cellUpdates[dateStr] !== undefined) {
                cellValue = cellUpdates[dateStr];
            } else {
                const status = dayStatuses[dateStr];
                if (status === "pass") {
                    cellValue = (dateStr === lastPassDate) ? "외박복귀" : "외박";
                } else if (status === "pass-depart" || status === "recovery-pass-depart") {
                    cellValue = "외박출발";
                } else if (status === "vacation-pass-depart") {
                    cellValue = allowVacationPassLink ? "외박출발(연계)" : "외박 휴가복귀/외박출발";
                } else if (status === "vacation") {
                    if (dateStr === firstVacDate && dateStr === lastVacDate) {
                        cellValue = "휴가";
                    } else if (dateStr === firstVacDate) {
                        cellValue = "휴가출발";
                    } else if (dateStr === lastVacDate) {
                        cellValue = "휴가복귀";
                    } else {
                        cellValue = "휴가";
                    }
                } else if (status === "linked") {
                    cellValue = "휴가출발(연계)";
                } else if (status === "duty") {
                    cellValue = "당직";
                } else if (status === "recovery" || status === "none") {
                    cellValue = "";
                } else {
                    cellValue = status || "";
                }
            }

            updateData.push({
                range: getA1Address(colIdx, targetRowIdx, sheetName),
                values: [[cellValue]]
            });
        }
    });

    if (updateData.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: "RAW",
                data: updateData,
            },
        });
        
        await refreshSpreadsheetUpdatedAt(sheetMode);
        return { status: "success", count: updateData.length };
    }

    return { status: "success", message: "변경할 항목이 없습니다." };
}
