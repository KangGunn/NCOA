/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import Papa from "papaparse";
import { google } from "googleapis";
import * as path from "path";
import { getSpreadsheetSetting } from "./setting.repository";
import { SHEET_URLS, SPREADSHEET_IDS } from "../config/sheet.config";

export async function getSheetData(): Promise<any[]> {
    const setting = await getSpreadsheetSetting();
    const sheetMode = setting?.mode || "test";
    const sheetUrl = SHEET_URLS[sheetMode as keyof typeof SHEET_URLS] || SHEET_URLS.test;
    const finalUrl = `${sheetUrl}&t=${Date.now()}`;

    const csvRes = await axios.get(finalUrl);

    return new Promise<any[]>((resolve) => {
        Papa.parse(csvRes.data, {
            complete: (results) => {
                const rows = results.data as string[][];
                if (rows.length < 2) { resolve([]); return; }

                const dateRow = rows[0];
                const result: any[] = [];

                for (let i = 2; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || !row[0]) continue;
                    const nameWithRank = row[0].trim();
                    const name = (nameWithRank.split(/\s+/)[1] || nameWithRank).trim();
                    const days: any[] = [];

                    for (let col = 1; col < row.length; col++) {
                        const rawDate = dateRow[col];
                        if (!rawDate) continue;
                        const parts = rawDate.split(".").map((p: string) => p.trim());
                        if (parts.length < 3) continue;
                        const mStr = parts[1].padStart(2, "0");
                        const dStr = parts[2].padStart(2, "0");
                        days.push({
                            dateStr: `${parts[0]}-${mStr}-${dStr}`,
                            m: Number(mStr),
                            d: Number(dStr),
                            cell: row[col] || "",
                        });
                    }
                    result.push({ name, days });
                }
                resolve(result);
            },
        });
    });
}

export async function getGoogleSheetsInstance() {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, "../../service-account.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
}

export async function getSpreadsheetIdForMode(mode: "test" | "prod") {
    return SPREADSHEET_IDS[mode] || SPREADSHEET_IDS.test;
}
