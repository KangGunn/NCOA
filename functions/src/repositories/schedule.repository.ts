/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "../config/firebase.config";

export async function getAllSchedules(): Promise<any[]> {
    const snap = await db.collection("schedules").get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
