/* eslint-disable @typescript-eslint/no-explicit-any */
import { getGoogleSheetsInstance, getSpreadsheetIdForMode } from "../repositories/sheet.repository";
import { getSpreadsheetSetting, refreshSpreadsheetUpdatedAt } from "../repositories/setting.repository";
import { getA1Address } from "../utils/sheet.util";
import * as logger from "firebase-functions/logger";

export async function syncMovements(movements: any[]) {
    const setting = await getSpreadsheetSetting();
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
        const excelNameOnly = m.name.split(/\s+/).pop();
        
        const matchingRows = nameColumn.map((name: string, idx: number) => ({ name, idx }))
            .filter((item: any) => {
                if (!item.name) return false;
                const sheetNameOnly = item.name.split(/\s+/).pop();
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
                setStatus(v.return, "휴가복귀");
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
