/**
 * 주간 출타 저장 요청.
 *
 * 저장 버튼을 누르면 앱은 Firestore에 '저장 요청' 문서(movement_save_jobs) 하나만 쓴다.
 * 서버(Cloud Function processMovementSaveJobs)가 이 문서를 받아 movements 기록과 시트 반영을 처리하고,
 * 결과를 같은 문서에 'done' / 'failed'로 적는다 — 앱을 닫아도 서버에서 계속 처리된다.
 *
 * Firestore 오프라인 저장소가 켜져 있으므로 요청은 폰에 먼저 남는다.
 * 서버에 닿기 전에 앱을 닫아도 다음에 앱을 열 때 SDK가 이어서 보낸다.
 *
 * 앱은 끝나지 않은 요청(대기·처리 중·실패)을 지켜보며 상태를 보여 주고, 실패한 요청은 다시 시도하거나 버린다.
 */
import { collection, deleteField, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';

export const SHEET_FUNCTIONS_BASE = 'https://asia-northeast3-seniorkatusa-aa594.cloudfunctions.net';
const JOBS = 'movement_save_jobs';
/** 저장 버튼을 누른 뒤 요청이 서버에 닿기를 기다리는 최대 시간 (그 뒤엔 폰에 남은 요청을 SDK가 이어서 보낸다) */
const SUBMIT_WAIT_MS = 1500;

export interface PassRecordInput {
    type: 'pass' | 'stay';
    startDate: string;
    endDate: string;
    reason: string;
}

export interface VacationRecordInput {
    startDate: string;
    endDate: string;
    reason: string;
}

export interface SaveJobInput {
    memberName: string;
    label: string;
    periodWindow: { coreStart: string; coreEnd: string };
    pass: PassRecordInput | null;
    vacation: VacationRecordInput | null;
    sheet: { dayStatuses: Record<string, string>; cellUpdates: Record<string, string> };
}

export interface SaveJobView {
    id: string;
    memberName: string;
    label: string;
    status: 'pending' | 'running' | 'failed';
    done: { firestore?: boolean; sheet?: boolean };
    /** 실패 이유 (무엇을 고쳐야 하는지) */
    lastError?: string;
    /** 원래 오류 문구 */
    errorDetail?: string;
    /** 서버가 처리를 시작한 시각 (ms) */
    startedAt?: number;
}

export interface SaveQueueState {
    jobs: SaveJobView[];
    /** 마지막으로 끝나지 않은 요청이 모두 끝난 시각 (없으면 0) */
    lastCompletedAt: number;
}

let serverJobs: SaveJobView[] = [];
/** 방금 이 기기에서 보낸 요청 (서버 목록에 나타나기 전까지 화면 값을 지키려고 따로 둔다) */
const localJobs = new Map<string, SaveJobView>();
const discarded = new Set<string>();
let lastCompletedAt = 0;
let started = false;
const listeners = new Set<(s: SaveQueueState) => void>();

/** 서버 처리 시간 한도(2분)를 넘겨도 '처리 중'이면 멈춘 것으로 본다 */
const STALE_RUNNING_MS = 3 * 60 * 1000;

const currentJobs = (): SaveJobView[] => {
    const ids = new Set(serverJobs.map(j => j.id));
    const now = Date.now();
    return [...serverJobs, ...[...localJobs.values()].filter(j => !ids.has(j.id))].map(j =>
        j.status === 'running' && j.startedAt && now - j.startedAt > STALE_RUNNING_MS
            ? { ...j, status: 'failed' as const, lastError: '서버 처리 시간이 초과되었습니다. 다시 시도해 주세요.' }
            : j
    );
};

function getState(): SaveQueueState {
    return { jobs: currentJobs().map(j => ({ ...j })), lastCompletedAt };
}

const emit = () => {
    const s = getState();
    listeners.forEach(fn => fn(s));
};

function start() {
    if (started) return;
    started = true;
    onSnapshot(
        query(collection(db, JOBS), where('status', 'in', ['pending', 'running', 'failed'])),
        (snap) => {
            const before = currentJobs();
            serverJobs = snap.docs.map(d => {
                const data = d.data() as any;
                return {
                    id: d.id,
                    memberName: data.memberName,
                    label: data.label || data.memberName,
                    status: data.status,
                    done: data.done || {},
                    lastError: data.lastError,
                    errorDetail: data.errorDetail,
                    startedAt: data.startedAt?.toMillis ? data.startedAt.toMillis() : undefined,
                };
            });
            // 서버 목록에 들어온 요청은 로컬 표시에서 뺀다 (서버 목록에서 빠지면 끝난 것)
            serverJobs.forEach(j => localJobs.delete(j.id));
            const nowIds = new Set(currentJobs().map(j => j.id));
            const finished = before.filter(j => !nowIds.has(j.id) && !discarded.has(j.id));
            if (finished.length > 0 && !currentJobs().some(j => j.status !== 'failed')) lastCompletedAt = Date.now();
            emit();
        },
        (err) => console.error('save job listener error', err)
    );
}

/**
 * 저장 요청을 보낸다. 서버에 닿을 때까지 최대 1.5초만 기다리고 돌아온다
 * (그 안에 못 닿아도 요청은 폰에 남아 있다가 이어서 보내진다).
 */
async function submit(input: SaveJobInput): Promise<void> {
    start();
    const ref = doc(collection(db, JOBS));
    localJobs.set(ref.id, { id: ref.id, memberName: input.memberName, label: input.label, status: 'pending', done: {} });
    emit();
    const write = setDoc(ref, {
        ...input,
        status: 'pending',
        done: {},
        attempts: 0,
        uid: auth.currentUser?.uid || null,
        createdAt: serverTimestamp(),
    });
    // 오프라인 저장소에 남는 쓰기라 기다리지 않아도 사라지지 않는다. 오류만 기록한다.
    write.catch(err => {
        console.error('save job submit failed', err);
        const local = localJobs.get(ref.id);
        if (local) {
            localJobs.set(ref.id, { ...local, status: 'failed', lastError: err?.message || '저장 요청을 보내지 못했습니다.' });
            emit();
        }
    });
    await Promise.race([write.catch(() => undefined), new Promise(r => setTimeout(r, SUBMIT_WAIT_MS))]);
}

export const movementSaveQueue = {
    start,
    submit,
    /** 실패한 요청을 서버가 다시 처리하게 한다 (끝난 단계는 건너뛴다) */
    retry(id: string) {
        if (localJobs.has(id) && !serverJobs.some(j => j.id === id)) return; // 서버에 닿지도 못한 요청은 다시 시도할 문서가 없다
        void updateDoc(doc(db, JOBS, id), { status: 'pending', attempts: 0, lastError: deleteField(), errorDetail: deleteField() });
    },
    /** 실패한 요청을 버린다 (화면 값은 새로고침하면 서버 값으로 돌아간다) */
    discard(id: string) {
        discarded.add(id);
        if (localJobs.delete(id)) emit();
        if (serverJobs.some(j => j.id === id)) void updateDoc(doc(db, JOBS, id), { status: 'discarded' });
    },
    /** 이 인원의 저장이 아직 끝나지 않았는지 (대기·처리 중·실패) */
    hasPendingFor(memberName: string) {
        return currentJobs().some(j => j.memberName === memberName);
    },
    getState,
    subscribe(fn: (s: SaveQueueState) => void) {
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    },
};
