/**
 * 엑셀 반영 요청: 앱은 movement_import_jobs 문서 하나만 쓰고, 서버가 시트와 Firestore 기록을 처리한다.
 * 앱을 닫아도 서버에서 계속 처리된다. 앱이 열려 있는 동안에는 결과(완료·동명이인·실패)를 알려 준다.
 */
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';

const JOBS = 'movement_import_jobs';
/** 요청이 서버에 닿기를 기다리는 최대 시간 */
const SUBMIT_WAIT_MS = 1500;

export type ImportStatus = 'pending' | 'running' | 'done' | 'failed' | 'ambiguous' | 'warning' | 'discarded';

/** 서버 처리 시간 한도(5분)를 넘겨도 끝나지 않으면 시간 초과로 본다 */
const STALE_MS = 6 * 60 * 1000;

export interface ImportState {
    status: ImportStatus;
    count?: number;
    ambiguousMembers?: any[];
    /** 시트에 없는 이름·날짜 */
    warnings?: { name: string; message: string }[];
    /** 실패 이유 (무엇을 고쳐야 하는지) */
    lastError?: string;
    /** 원래 오류 문구 */
    errorDetail?: string;
}

/** 요청을 보내고 서버에 닿을 때까지 최대 1.5초만 기다린다. 결과는 onState로 계속 받는다. */
export async function submitMovementImport(
    movements: any[],
    /** 엑셀의 기준 주말 'YYYY-MM-DD' (서버가 월.일의 연도를 정할 때 쓴다) */
    anchorIso: string,
    onState: (s: ImportState) => void,
): Promise<string> {
    const ref = doc(collection(db, JOBS));
    const write = setDoc(ref, {
        movements,
        anchorIso,
        status: 'pending',
        done: {},
        attempts: 0,
        uid: auth.currentUser?.uid || null,
        createdAt: serverTimestamp(),
    });
    write.catch(err => onState({ status: 'failed', lastError: err?.message || '반영 요청을 보내지 못했습니다.' }));
    await Promise.race([write.catch(() => undefined), new Promise(r => setTimeout(r, SUBMIT_WAIT_MS))]);

    let finished = false;
    const stop = () => { finished = true; unsub(); clearTimeout(staleTimer); };
    const unsub = onSnapshot(ref, (snap) => {
        if (!snap.exists() || finished) return;
        const data = snap.data() as any;
        onState({
            status: data.status,
            count: data.count,
            ambiguousMembers: data.ambiguousMembers,
            warnings: data.warnings,
            lastError: data.lastError,
            errorDetail: data.errorDetail,
        });
        if (['done', 'failed', 'ambiguous', 'warning', 'discarded'].includes(data.status)) stop();
    }, (err) => onState({ status: 'failed', lastError: '반영 상태를 받아 오지 못했습니다. 인터넷 연결을 확인하세요.', errorDetail: err.message }));
    // 서버 함수가 시간 한도에 걸려 멈추면 문서가 '처리 중'으로 남는다 — 그때는 시간 초과로 알린다
    const staleTimer = setTimeout(() => {
        if (finished) return;
        stop();
        onState({ status: 'failed', lastError: '서버 처리 시간이 초과되었습니다. 시트에 일부만 반영됐을 수 있으니 확인한 뒤 다시 반영해 주세요.' });
    }, STALE_MS);
    return ref.id;
}
