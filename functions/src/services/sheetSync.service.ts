/* eslint-disable @typescript-eslint/no-explicit-any */
import { getGoogleSheetsInstance, getSpreadsheetIdForMode } from "../repositories/sheet.repository";
import { getSpreadsheetSetting, getMovementSetting, refreshSpreadsheetUpdatedAt } from "../repositories/setting.repository";
import { planMovementCells, planMemberCells, nameOnly, a1 } from "../utils/sheetPlan.util";
import { findFreeMemberRow } from "../utils/recruitSheet.util";
import { JobError } from "../utils/jobError.util";
import * as logger from "firebase-functions/logger";

const SHEET_NAME = "NEW";

/** 설정·시트 연결을 준비하고, 칸 위치를 찾는 데 필요한 날짜 줄(1행)과 이름 열(A열)만 읽는다 */
async function readSheetIndex() {
    const [setting, movementSetting, sheets] = await Promise.all([
        getSpreadsheetSetting(),
        getMovementSetting(),
        getGoogleSheetsInstance(),
    ]);
    const sheetMode = (setting?.mode || "test") as "test" | "prod";
    const spreadsheetId = await getSpreadsheetIdForMode(sheetMode);
    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [`'${SHEET_NAME}'!1:1`, `'${SHEET_NAME}'!A1:A200`],
    });
    const [headerRange, nameRange] = response.data.valueRanges || [];
    const dateRow: string[] = headerRange?.values?.[0] || [];
    const nameColumn: string[] = (nameRange?.values || []).map((r: any) => r?.[0]);
    if (dateRow.length === 0 || nameColumn.length === 0) {
        throw new JobError(`'${SHEET_NAME}' 탭의 날짜 줄(1행) 또는 이름 열(A열)을 읽을 수 없습니다. 시트 구조를 확인하세요.`);
    }
    return { sheets, spreadsheetId, sheetMode, dateRow, nameColumn, allowVacationPassLink: !!movementSetting?.allowVacationPassLink };
}

async function writeCells(sheets: any, spreadsheetId: string, sheetMode: "test" | "prod", data: any[]) {
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
    });
    await refreshSpreadsheetUpdatedAt(sheetMode);
}

/**
 * 엑셀 반영. 동명이인이 있으면 'ambiguous', 시트에 없는 이름·날짜가 있으면 'warning'을 돌려주고
 * 그 경우 아무것도 쓰지 않는다 (예전에는 조용히 건너뛰었다).
 */
export async function syncMovements(movements: any[]) {
    const { sheets, spreadsheetId, sheetMode, dateRow, nameColumn, allowVacationPassLink } = await readSheetIndex();
    logger.info(`syncMovementToSheet: using ${sheetMode} mode (${spreadsheetId})`);

    const plan = planMovementCells(dateRow, nameColumn, movements, allowVacationPassLink, SHEET_NAME);
    if (plan.ambiguousMembers.length > 0) {
        return { status: "ambiguous", ambiguousMembers: plan.ambiguousMembers };
    }
    if (plan.warnings.length > 0) {
        return {
            status: "warning",
            warnings: plan.warnings,
            message: `시트와 맞지 않는 항목 ${plan.warnings.length}건이 있어 반영하지 않았습니다.`,
        };
    }
    if (plan.updateData.length > 0) {
        await writeCells(sheets, spreadsheetId, sheetMode, plan.updateData);
        return { status: "success", count: plan.updateData.length };
    }
    return { status: "success", count: 0, message: "업데이트할 항목이 없습니다." };
}

/**
 * 주간 편집 저장. 시트에 없는 이름이나 날짜가 있으면 쓰지 않고 이유를 담은 오류를 던진다 (다시 시도해도 같으므로 바로 실패).
 */
export async function updateMemberScheduleInSheet(
    memberName: string,
    dayStatuses: Record<string, string>,
    cellUpdates?: Record<string, string>,
    options: { ignoreMissingDates?: boolean } = {}
) {
    const { sheets, spreadsheetId, sheetMode, dateRow, nameColumn, allowVacationPassLink } = await readSheetIndex();
    logger.info(`updateMemberScheduleInSheet: using ${sheetMode} mode (${spreadsheetId}) for ${memberName}`);

    const plan = planMemberCells(dateRow, nameColumn, memberName, dayStatuses, cellUpdates, allowVacationPassLink, SHEET_NAME);
    if (plan.notFound) {
        throw new JobError(`시트에서 '${memberName}' 대원을 찾을 수 없습니다. 시트의 이름을 확인하세요.`);
    }
    if (plan.missingDates.length > 0) {
        // 미뤄 둔 신병 출타를 반영할 때는 시트 범위를 벗어난 지난 날짜를 건너뛴다
        if (!options.ignoreMissingDates) {
            throw new JobError(`시트에 ${plan.missingDates.join(", ")} 날짜 칸이 없습니다. 시트의 날짜 범위를 확인하세요.`);
        }
        logger.warn(`updateMemberScheduleInSheet: ${memberName} 시트에 없는 날짜 건너뜀: ${plan.missingDates.join(", ")}`);
    }
    if (plan.updateData.length > 0) {
        await writeCells(sheets, spreadsheetId, sheetMode, plan.updateData);
        return { status: "success", count: plan.updateData.length };
    }
    return { status: "success", message: "변경할 항목이 없습니다." };
}

/**
 * 시트 인원 칸(3~22행)의 첫 빈 행에 '계급 이름'을 쓴다. 같은 이름이 이미 있으면 쓰지 않고 그 행을 돌려준다.
 * 빈 행이 없으면 사람이 시트를 정리해야 하므로 JobError.
 */
export async function addMemberRowToSheet(rowLabel: string): Promise<{ rowIdx: number; added: boolean }> {
    const { sheets, spreadsheetId, sheetMode, nameColumn } = await readSheetIndex();
    const target = nameOnly(rowLabel);
    const existing = nameColumn.findIndex((n) => !!n && nameOnly(n) === target);
    if (existing !== -1) return { rowIdx: existing, added: false };

    const rowIdx = findFreeMemberRow(nameColumn);
    if (rowIdx === -1) {
        throw new JobError(`'${SHEET_NAME}' 탭 인원 칸(3~22행)에 빈 행이 없어 '${rowLabel}'을(를) 추가하지 못했습니다.`);
    }
    await writeCells(sheets, spreadsheetId, sheetMode, [{ range: a1(0, rowIdx, SHEET_NAME), values: [[rowLabel]] }]);
    logger.info(`addMemberRowToSheet: '${rowLabel}' → row ${rowIdx + 1} (${sheetMode})`);
    return { rowIdx, added: true };
}
