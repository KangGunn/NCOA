/* eslint-disable @typescript-eslint/no-explicit-any */
import * as logger from "firebase-functions/logger";
import { getGoogleSheetsInstance, getSpreadsheetIdForMode } from "../repositories/sheet.repository";
import { refreshSpreadsheetUpdatedAt } from "../repositories/setting.repository";
import { getAllMembers } from "../repositories/member.repository";
import { getA1Address } from "../utils/sheet.util";
import { getKSTDateStr } from "../utils/date.util";
import { computeRankNameUpdates, dateFromIso, RankNameUpdate } from "../utils/rankSync.util";

const SHEET_NAME = "NEW";

/** 오늘(한국 시간) 기준 계급 계산용 날짜 */
export function getKSTToday(): Date {
    return dateFromIso(getKSTDateStr()) as Date;
}

/**
 * 시트 A열의 관등성명을 asOf 날짜 기준 계급으로 고친다. 바뀐 행만 쓴다.
 */
export async function syncMemberRanksInSheet(
    mode: "test" | "prod",
    asOf: Date
): Promise<{ mode: string; updated: RankNameUpdate[]; skipped: string[] }> {
    const spreadsheetId = await getSpreadsheetIdForMode(mode);
    const sheets = await getGoogleSheetsInstance();

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAME}'!A1:A200`,
    });
    const nameColumn = (response.data.values || []).map((row: any[]) => (row && row[0]) || "");
    const members = await getAllMembers();

    const { updates, skipped } = computeRankNameUpdates(nameColumn, members, asOf);

    if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: "RAW",
                data: updates.map((u) => ({
                    range: getA1Address(0, u.rowIdx, SHEET_NAME),
                    values: [[u.to]],
                })),
            },
        });
        // 앱이 시트를 다시 읽도록 갱신 시각을 바꾼다
        await refreshSpreadsheetUpdatedAt(mode);
    }

    logger.info(`syncMemberRanksInSheet(${mode}): ${updates.length} updated`, { updates, skipped });
    return { mode, updated: updates, skipped };
}

/** 운영·테스트 시트를 모두 갱신한다. 한쪽이 실패해도 다른 쪽은 진행한다. */
export async function syncMemberRanksInAllSheets(asOf: Date = getKSTToday()) {
    const results: any[] = [];
    for (const mode of ["prod", "test"] as const) {
        try {
            results.push(await syncMemberRanksInSheet(mode, asOf));
        } catch (error: any) {
            logger.error(`syncMemberRanksInSheet(${mode}) failed`, error);
            results.push({ mode, error: error.message });
        }
    }
    return results;
}
