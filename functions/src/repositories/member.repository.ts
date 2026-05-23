/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "../config/firebase.config";

export async function getAllMembers(): Promise<any[]> {
    const snap = await db.collection("members").get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getMemberByName(name: string): Promise<any | null> {
    const snap = await db.collection("members").where("name", "==", name).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data(), ref: snap.docs[0].ref };
}

export async function getMemberByTelegramId(telegramId: number): Promise<any | null> {
    const snap = await db.collection("members").where("telegramId", "==", telegramId).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data(), ref: snap.docs[0].ref };
}

export async function updateMemberTelegramId(memberId: string, telegramId: number): Promise<void> {
    await db.collection("members").doc(memberId).update({ telegramId });
}
