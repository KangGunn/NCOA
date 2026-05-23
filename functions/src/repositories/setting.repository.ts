/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "../config/firebase.config";
import { FieldValue } from "firebase-admin/firestore";

export async function getSpreadsheetSetting(): Promise<any> {
    const snap = await db.collection("settings").doc("spreadsheet").get();
    return snap.exists ? snap.data() : null;
}

export async function updateSpreadsheetSetting(data: any): Promise<void> {
    await db.collection("settings").doc("spreadsheet").set(data, { merge: true });
}

export async function getDebugSetting(): Promise<any> {
    const snap = await db.collection("settings").doc("debug").get();
    return snap.exists ? snap.data() : null;
}

export async function updateDebugSetting(data: any): Promise<void> {
    await db.collection("settings").doc("debug").set(data, { merge: true });
}

export async function getSeniorSetting(): Promise<any> {
    const snap = await db.collection("settings").doc("senior").get();
    return snap.exists ? snap.data() : null;
}

export async function updateSeniorSetting(name: string): Promise<void> {
    await db.collection("settings").doc("senior").set({ name }, { merge: true });
}

export async function refreshSpreadsheetUpdatedAt(mode: "test" | "prod"): Promise<void> {
    const updateKey = mode === "prod" ? "prodUpdatedAt" : "testUpdatedAt";
    await db.collection("settings").doc("spreadsheet").set({
        [updateKey]: FieldValue.serverTimestamp()
    }, { merge: true });
}
