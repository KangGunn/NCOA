import { setGlobalOptions } from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";

// 전역 옵션 설정
setGlobalOptions({ maxInstances: 10, region: "asia-northeast3" });

// Firebase Admin 초기화 (에뮬레이터 환경에서도 자동으로 동작)
admin.initializeApp();
export const db = admin.firestore();

// CORS 핸들러
export const corsHandler = cors({ origin: true });
