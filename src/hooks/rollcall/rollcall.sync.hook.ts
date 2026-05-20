import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { RollCallData } from '../../types/rollcall/rollcall.type';

export function useRollCallSync(baseDate: Date) {
    const [rollCallData, setRollCallData] = useState<RollCallData | null>(null);
    const [sheetMode, setSheetMode] = useState<'test' | 'prod'>('test');
    const [sheetUpdatedAt, setSheetUpdatedAt] = useState<string>('0');

    // 실시간 스프레드시트 업데이트 감지
    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'settings', 'spreadsheet'), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const currentMode = data.mode || 'test';
                setSheetMode(currentMode);

                const targetKey = currentMode === 'prod' ? 'prodUpdatedAt' : 'testUpdatedAt';
                const lastUpdate = data[targetKey] || data.updatedAt;
                if (lastUpdate) {
                    setSheetUpdatedAt(lastUpdate.toMillis ? lastUpdate.toMillis().toString() : lastUpdate.toString());
                } else {
                    setSheetUpdatedAt(Date.now().toString());
                }
            } else {
                setSheetMode('test');
            }
        });
        return () => unsub();
    }, []);

    const handleManualRefresh = async () => {
        setRollCallData(null);
        try {
            const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
            const FUNCTION_URL = `https://getrollcalldata-daomamzojq-du.a.run.app`;
            const res = await fetch(`${FUNCTION_URL}?date=${dateStr}&t=${Date.now()}`);
            const json = await res.json();

            if (json.status === 'success') {
                const data = json.data;
                setRollCallData(data);

                if (sheetUpdatedAt !== '0') {
                    const cacheKey = `rollcall_${sheetMode}_${dateStr}_${sheetUpdatedAt}`;
                    localStorage.setItem(cacheKey, JSON.stringify(data));

                    try {
                        await setDoc(doc(db, "rollcall_cache", `${sheetMode}_${dateStr}_${sheetUpdatedAt}`), {
                            data: data,
                            updatedAt: serverTimestamp()
                        });
                    } catch (e) {
                        console.error("Firestore cache write error:", e);
                    }
                }
            }
        } catch (err) {
            console.error('Manual refresh error:', err);
        }
    };

    // 백엔드 API 호출 함수
    const fetchData = async (mode: 'test' | 'prod', updatedAtStr?: string) => {
        try {
            const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;

            // 캐시 키 설정
            const cacheKey = updatedAtStr ? `rollcall_${mode}_${dateStr}_${updatedAtStr}` : null;
            const cached = cacheKey ? localStorage.getItem(cacheKey) : null;

            // 1. 로컬 캐시 확인
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    setRollCallData(parsed);
                    return;
                } catch (e) {
                    console.error('Cache parsing error:', e);
                }
            }

            // 로딩 상태 표시를 위해 데이터 초기화
            setRollCallData(null);

            // 2. Firestore 공유 캐시 확인
            if (updatedAtStr) {
                try {
                    const cacheDoc = await getDoc(doc(db, "rollcall_cache", `${mode}_${dateStr}_${updatedAtStr}`));
                    if (cacheDoc.exists()) {
                        const sharedData = cacheDoc.data().data;
                        setRollCallData(sharedData);

                        // 로컬에도 저장
                        if (cacheKey) {
                            localStorage.setItem(cacheKey, JSON.stringify(sharedData));
                        }
                        return;
                    }
                } catch (e) {
                    console.error("Firestore cache read error:", e);
                }
            }

            // 3. 백엔드 API 호출 (캐시 없음)
            const FUNCTION_URL = `https://getrollcalldata-daomamzojq-du.a.run.app`;
            const res = await fetch(`${FUNCTION_URL}?date=${dateStr}`);
            const json = await res.json();

            if (json.status === 'success') {
                const data = json.data;
                setRollCallData(data);

                if (updatedAtStr) {
                    const cacheKey = `rollcall_${mode}_${dateStr}_${updatedAtStr}`;

                    // 기존 캐시 청소 (이전 시간에 저장된 동일 날짜의 캐시 삭제)
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && k.startsWith(`rollcall_${mode}_${dateStr}_`) && k !== cacheKey) {
                            keysToRemove.push(k);
                        }
                    }
                    keysToRemove.forEach(k => localStorage.removeItem(k));

                    localStorage.setItem(cacheKey, JSON.stringify(data));

                    // Firestore 공유 캐시에 저장 (다른 사용자와 공유)
                    try {
                        await setDoc(doc(db, "rollcall_cache", `${mode}_${dateStr}_${updatedAtStr}`), {
                            data: data,
                            updatedAt: serverTimestamp()
                        });
                    } catch (e) {
                        console.error("Firestore cache write error:", e);
                    }
                }
            } else {
                console.error('백엔드 오류:', json.message);
            }
        } catch (err) {
            console.error('fetchData error:', err);
        }
    };

    const lastLoadedTimestampRef = useRef<string>('0');
    const lastLoadedModeRef = useRef<'test' | 'prod'>('test');
    const lastLoadedDateRef = useRef<string>('');

    // 데이터 로드 로직
    useEffect(() => {
        if (sheetMode && sheetUpdatedAt !== '0') {
            const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;

            const isInitialLoad = lastLoadedTimestampRef.current === '0';
            const isModeChange = sheetMode !== lastLoadedModeRef.current;
            const isDateChange = dateStr !== lastLoadedDateRef.current;
            const isTimestampChange = !isInitialLoad && !isModeChange && !isDateChange && sheetUpdatedAt !== lastLoadedTimestampRef.current;

            // 시트 타임스탬프가 변경된 경우(편집 발생): 4초 디바운스 대기하여 연속 편집 신호 수집
            // 초기 진입, 모드 전환, 날짜 전환인 경우: 즉시 로딩(0초)
            const delay = isTimestampChange ? 4000 : 0;

            const timer = setTimeout(() => {
                fetchData(sheetMode, sheetUpdatedAt);
                lastLoadedTimestampRef.current = sheetUpdatedAt;
                lastLoadedModeRef.current = sheetMode;
                lastLoadedDateRef.current = dateStr;
            }, delay);

            return () => clearTimeout(timer);
        }
    }, [baseDate, sheetMode, sheetUpdatedAt]);

    return {
        rollCallData,
        sheetMode,
        sheetUpdatedAt,
        handleManualRefresh
    };
}
