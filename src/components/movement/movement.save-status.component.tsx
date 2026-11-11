import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { movementSaveQueue } from '../../utils/movement/movement.save-runner';
import type { SaveQueueState } from '../../utils/movement/movement.save-runner';

/**
 * 주간 출타 저장을 뒤에서 처리하는 동안 하단 탭 위에 작게 보여 준다.
 * - 처리 중: '시트 반영 중'
 * - 끝나면: 잠깐 '시트 반영 완료'
 * - 실패: 인원별로 이유와 [다시 시도] [버리기]
 * 앱 어느 탭에서든 보이도록 App에서 한 번만 그린다.
 */
export function MovementSaveStatus() {
    const [state, setState] = useState<SaveQueueState>(() => movementSaveQueue.getState());
    const [showDone, setShowDone] = useState(false);
    const lastCompletedRef = useRef(state.lastCompletedAt);

    useEffect(() => {
        const unsub = movementSaveQueue.subscribe(setState);
        movementSaveQueue.start();
        return unsub;
    }, []);

    // 대기열이 모두 끝나면 잠깐 완료 표시
    useEffect(() => {
        if (state.lastCompletedAt && state.lastCompletedAt !== lastCompletedRef.current) {
            lastCompletedRef.current = state.lastCompletedAt;
            setShowDone(true);
            const t = setTimeout(() => setShowDone(false), 2500);
            return () => clearTimeout(t);
        }
    }, [state.lastCompletedAt]);

    const active = state.jobs.filter(j => j.status !== 'failed');
    const failed = state.jobs.filter(j => j.status === 'failed');

    // 처리 중에 브라우저 창을 닫으려 하면 한 번 묻는다 (설치한 앱은 다음 실행 때 이어서 처리한다)
    useEffect(() => {
        if (active.length === 0) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [active.length]);

    if (active.length === 0 && failed.length === 0 && !showDone) return null;

    return (
        <div
            className="fixed left-0 right-0 z-[60] px-4 pointer-events-none"
            style={{ bottom: 'calc(5.75rem + env(safe-area-inset-bottom))' }}
        >
            <div className="max-w-md mx-auto flex flex-col items-center gap-2">
                {failed.map(job => (
                    <div
                        key={job.id}
                        role="alert"
                        className="pointer-events-auto w-full bg-white border border-red-200 rounded-2xl shadow-lg p-3 flex items-start gap-2.5"
                    >
                        <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-black text-gray-900">{job.label} 저장 실패</p>
                            <p className="text-xs text-gray-500 break-words">
                                {job.done.firestore ? '기록은 저장됐고 시트 반영이 안 됐습니다.' : '기록과 시트 모두 저장되지 않았습니다.'}
                                {job.lastError ? ` (${job.lastError})` : ''}
                            </p>
                            <div className="flex gap-2 mt-2">
                                <button
                                    type="button"
                                    onClick={() => movementSaveQueue.retry(job.id)}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-bold active:scale-95"
                                >
                                    <RotateCcw className="w-3.5 h-3.5" /> 다시 시도
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (confirm(`${job.label}의 이번 저장을 버릴까요? 화면은 새로고침하면 원래 값으로 돌아갑니다.`)) {
                                            movementSaveQueue.discard(job.id);
                                        }
                                    }}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold active:scale-95"
                                >
                                    <X className="w-3.5 h-3.5" /> 버리기
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
                {active.length > 0 ? (
                    <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-gray-900/90 text-white text-xs font-bold shadow-lg">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        시트 반영 중{active.length > 1 ? ` · ${active.length}건` : ''}
                    </div>
                ) : showDone && failed.length === 0 ? (
                    <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-green-600 text-white text-xs font-bold shadow-lg">
                        <Check className="w-3.5 h-3.5" />
                        시트 반영 완료
                    </div>
                ) : null}
            </div>
        </div>
    );
}
