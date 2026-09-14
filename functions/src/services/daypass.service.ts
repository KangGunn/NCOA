/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "../config/firebase.config";
import { getAllMembers } from "../repositories/member.repository";
import { getSheetData } from "../repositories/sheet.repository";
import { calculateRankFromEnlistment } from "../utils/rank.util";
import { FieldValue } from "firebase-admin/firestore";

function getRankName(member: any, asOfDate: Date = new Date()): string {
    if (member.role !== "runner" && member.enlistmentDate) {
        return calculateRankFromEnlistment(
            new Date(member.enlistmentDate),
            member.earlyPromotion || 0,
            asOfDate
        );
    }
    return member.rank || "병장";
}

export async function parseAndSaveDayPass(utterance: string, todayStr: string): Promise<any | null> {
    const tokens = utterance.trim().split(/\s+/);
    if (tokens.length < 4) return null;

    const returnTimeCandidate = tokens[tokens.length - 1];
    const departTimeCandidate = tokens[tokens.length - 2];

    const is4Digit = (s: string) => /^\d{4}$/.test(s);
    if (!is4Digit(returnTimeCandidate) || !is4Digit(departTimeCandidate)) {
        return null;
    }

    const [members, sheetData] = await Promise.all([
        getAllMembers(),
        getSheetData().catch(() => []),
    ]);

    const validMembers = members.filter((m) => m.role !== "holdover" && m.role !== "runner");
    const memberNames = new Set([
        ...validMembers.map((m) => m.name),
        ...sheetData.map((s) => s.name),
    ]);

    const matchedNames: string[] = [];
    let reasonStartIndex = 0;

    for (let i = 0; i < tokens.length - 2; i++) {
        if (memberNames.has(tokens[i])) {
            matchedNames.push(tokens[i]);
            reasonStartIndex = i + 1;
        } else {
            break;
        }
    }

    if (matchedNames.length === 0) {
        return null;
    }

    const reasonTokens = tokens.slice(reasonStartIndex, tokens.length - 2);
    const reason = reasonTokens.join(" ").trim();
    if (!reason) return null;

    const departTime = departTimeCandidate;
    const returnTime = returnTimeCandidate;

    const docRef = db.collection("dayPassLogs").doc(todayStr);
    const newEntries = matchedNames.map((name) => ({
        name,
        reason,
        departTime,
        returnTime,
        createdAt: new Date().toISOString(),
    }));

    await docRef.set({
        logs: FieldValue.arrayUnion(...newEntries),
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
        matchedNames,
        reason,
        departTime,
        returnTime,
    };
}

export async function getDayPassReport(todayStr: string): Promise<string> {
    const docSnap = await db.collection("dayPassLogs").doc(todayStr).get();
    const data = docSnap.data();
    if (!docSnap.exists || !data || !Array.isArray(data.logs) || data.logs.length === 0) {
        return "⚠️ 금일 등록된 외출 기록이 없습니다.";
    }

    const logs: any[] = data.logs;
    const members = await getAllMembers();

    const dateObj = new Date(todayStr);
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const dateText = `${month}월 ${day}일`;

    let reportText = `통신보안 \n\n금일 외출 기록 보고드립니다.\n\n`;

    const lines = logs.map((log) => {
        const member = members.find((m) => m.name === log.name);
        if (member && (member.role === "holdover" || member.role === "runner")) return null; // 유급생 제외
        const rank = member ? getRankName(member, dateObj) : "병장";
        return `${rank} / ${log.name} / ${log.reason} / ${dateText} / ${log.departTime} / ${log.returnTime}`;
    }).filter(Boolean);

    if (lines.length === 0) {
        return "⚠️ 금일 등록된 유효한 외출 기록이 없습니다.";
    }

    reportText += lines.join("\n\n") + `\n\n이상입니다.`;
    return reportText;
}

export async function clearDayPassReport(todayStr: string): Promise<string> {
    await db.collection("dayPassLogs").doc(todayStr).delete();
    return "🗑️ 금일 외출 기록이 초기화되었습니다.";
}

export async function cancelDayPassEntriesFromMessage(replyText: string, todayStr: string): Promise<string> {
    const docRef = db.collection("dayPassLogs").doc(todayStr);
    const docSnap = await docRef.get();
    const data = docSnap.data();

    if (!docSnap.exists || !data || !Array.isArray(data.logs) || data.logs.length === 0) {
        return "⚠️ 금일 등록된 외출 기록이 없습니다.";
    }

    const currentLogs: any[] = data.logs;
    const [members, sheetData] = await Promise.all([
        getAllMembers(),
        getSheetData().catch(() => []),
    ]);

    const validMembers = members.filter((m) => m.role !== "holdover" && m.role !== "runner");
    const memberNames = new Set([
        ...validMembers.map((m) => m.name),
        ...sheetData.map((s) => s.name),
    ]);

    const targetNamesInReply = Array.from(memberNames).filter((name) => replyText.includes(name));

    if (targetNamesInReply.length === 0) {
        return "⚠️ 답장한 메시지에서 등록된 대원 이름을 찾을 수 없습니다.";
    }

    const targetSet = new Set(targetNamesInReply);
    const remainingLogs = currentLogs.filter((log) => !targetSet.has(log.name));

    const removedCount = currentLogs.length - remainingLogs.length;
    if (removedCount === 0) {
        return `⚠️ 답장한 메시지의 대원(${targetNamesInReply.join(", ")})에 대한 외출 기록이 없습니다.`;
    }

    await docRef.update({
        logs: remainingLogs,
        updatedAt: FieldValue.serverTimestamp(),
    });

    return `🗑️ ${targetNamesInReply.join(", ")} 님의 외출 기록(${removedCount}건)이 취소되었습니다.`;
}
