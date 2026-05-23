/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "../config/firebase.config";

export async function getDailyReturns(todayStr: string): Promise<{ data: any, docRef: any, exists: boolean }> {
    const docRef = db.collection("dailyReturns").doc(todayStr);
    const docSnap = await docRef.get();
    
    let data = {
        expectedVacation: [], expectedPass: [],
        returnedVacation: [], returnedPass: []
    };
    if (docSnap.exists) {
        data = docSnap.data() as any;
    }
    return { data, docRef, exists: docSnap.exists };
}

export async function updateDailyReturns(todayStr: string, data: any): Promise<void> {
    await db.collection("dailyReturns").doc(todayStr).set(data, { merge: true });
}

export async function deleteDailyReturns(todayStr: string): Promise<void> {
    await db.collection("dailyReturns").doc(todayStr).delete();
}
