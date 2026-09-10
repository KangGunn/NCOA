import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp, collection } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { RollCallData } from '../../types/rollcall/rollcall.type';

export function useRollCallSync(baseDate: Date) {
    const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;

    // 1. 초기 렌더링 시 로컬 스토리지에 저장된 최근 캐시가 있다면 즉시 로드 (0초 렌더링)
    const [rollCallData, setRollCallData] = useState<RollCallData | null>(() => {
        try {
            // 가장 최근 날짜의 캐시 검색
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.includes(`_${dateStr}_`)) {
                    const raw = localStorage.getItem(k);
                    if (raw) return JSON.parse(raw);
                }
            }
        } catch {
            // ignore
        }
        return null;
    });

    const [sheetMode, setSheetMode] = useState<'test' | 'prod'>('test');
    const [sheetUpdatedAt, setSheetUpdatedAt] = useState<string>('0');
    const [firestoreVersion, setFirestoreVersion] = useState<number>(0);

    // 1. 실시간 스프레드시트 업데이트 감지
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

    // 2. 실시간 Firestore (members, schedules) 변경 감지
    useEffect(() => {
        let isInitialMembers = true;
        let isInitialSchedules = true;

        const unsubMembers = onSnapshot(collection(db, 'members'), () => {
            if (isInitialMembers) {
                isInitialMembers = false;
                return;
            }
            setFirestoreVersion(v => v + 1);
        });

        const unsubSchedules = onSnapshot(collection(db, 'schedules'), () => {
            if (isInitialSchedules) {
                isInitialSchedules = false;
                return;
            }
            setFirestoreVersion(v => v + 1);
        });

        return () => {
            unsubMembers();
            unsubSchedules();
        };
    }, []);

    // 백엔드 API 호출 함수
    const fetchData = useCallback(async (mode: 'test' | 'prod', updatedAtStr?: string, force = false) => {
        try {
            const targetDateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
            const cacheKey = updatedAtStr && updatedAtStr !== '0' ? `rollcall_${mode}_${targetDateStr}_${updatedAtStr}` : null;

            // 로컬 캐시 확인 (강제 새로고침이 아닐 때)
            if (!force && cacheKey) {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        setRollCallData(parsed);
                        return;
                    } catch (e) {
                        console.error('Cache parsing error:', e);
                    }
                }
            }

            // Firestore 공유 캐시 확인 (강제 새로고침이 아닐 때)
            if (!force && updatedAtStr && updatedAtStr !== '0') {
                try {
                    const cacheDoc = await getDoc(doc(db, "rollcall_cache", `${mode}_${targetDateStr}_${updatedAtStr}`));
                    if (cacheDoc.exists()) {
                        const sharedData = cacheDoc.data().data;
                        setRollCallData(sharedData);

                        if (cacheKey) {
                            localStorage.setItem(cacheKey, JSON.stringify(sharedData));
                        }
                        return;
                    }
                } catch (e) {
                    console.error("Firestore cache read error:", e);
                }
            }

            // 백엔드 API 호출
            const FUNCTION_URL = `https://getrollcalldata-daomamzojq-du.a.run.app`;
            const res = await fetch(`${FUNCTION_URL}?date=${targetDateStr}&t=${Date.now()}`);
            const json = await res.json();

            if (json.status === 'success') {
                const data = json.data;
                setRollCallData(data);

                if (updatedAtStr && updatedAtStr !== '0') {
                    const targetCacheKey = `rollcall_${mode}_${targetDateStr}_${updatedAtStr}`;

                    // 이전 시간 캐시 정리
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && k.startsWith(`rollcall_${mode}_${targetDateStr}_`) && k !== targetCacheKey) {
                            keysToRemove.push(k);
                        }
                    }
                    keysToRemove.forEach(k => localStorage.removeItem(k));

                    localStorage.setItem(targetCacheKey, JSON.stringify(data));

                    try {
                        await setDoc(doc(db, "rollcall_cache", `${mode}_${targetDateStr}_${updatedAtStr}`), {
                            data: data,
                            updatedAt: serverTimestamp()
                        });
                    } catch (e) {
                        console.error("Firestore cache write error:", e);
                    }
                }
            }
        } catch (err) {
            console.error('fetchData error:', err);
        }
    }, [baseDate]);

    const handleManualRefresh = async () => {
        setRollCallData(null);
        await fetchData(sheetMode, sheetUpdatedAt, true);
    };

    const lastLoadedTimestampRef = useRef<string>('0');
    const lastLoadedModeRef = useRef<'test' | 'prod'>('test');
    const lastLoadedDateRef = useRef<string>('');

    // 날짜 변경 시 로컬 캐시 즉시 복원
    useEffect(() => {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.includes(`_${dateStr}_`)) {
                    const raw = localStorage.getItem(k);
                    if (raw) {
                        setRollCallData(JSON.parse(raw));
                        break;
                    }
                }
            }
        } catch {
            // ignore
        }
    }, [dateStr]);

    const lastLoadedFirestoreVersionRef = useRef<number>(0);

    // 데이터 로드 로직 (시트 업데이트, 날짜 변경, Firestore 변경)
    useEffect(() => {
        const isInitialLoad = lastLoadedTimestampRef.current === '0';
        const isModeChange = sheetMode !== lastLoadedModeRef.current;
        const isDateChange = dateStr !== lastLoadedDateRef.current;
        const isTimestampChange = !isInitialLoad && !isModeChange && !isDateChange && sheetUpdatedAt !== '0' && sheetUpdatedAt !== lastLoadedTimestampRef.current;
        const isFirestoreChange = !isInitialLoad && !isModeChange && !isDateChange && firestoreVersion !== lastLoadedFirestoreVersionRef.current;

        // 시트 편집은 4초, Firestore 편집은 2.5초 디바운스
        const delay = isTimestampChange ? 4000 : (isFirestoreChange ? 2500 : 0);

        const timer = setTimeout(() => {
            // Firestore 변경인 경우 캐시를 우회하여 최신 계산을 가져옴
            fetchData(sheetMode, sheetUpdatedAt, isFirestoreChange);
            lastLoadedTimestampRef.current = sheetUpdatedAt;
            lastLoadedModeRef.current = sheetMode;
            lastLoadedDateRef.current = dateStr;
            lastLoadedFirestoreVersionRef.current = firestoreVersion;
        }, delay);

        return () => clearTimeout(timer);
    }, [baseDate, dateStr, sheetMode, sheetUpdatedAt, firestoreVersion, fetchData]);

    // iOS 모바일 웹앱 백그라운드 복귀 감지 (화면 켜지거나 다시 진입 시 자동 새로고침)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchData(sheetMode, sheetUpdatedAt);
            }
        };

        const handleOnline = () => {
            fetchData(sheetMode, sheetUpdatedAt);
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('online', handleOnline);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('online', handleOnline);
        };
    }, [sheetMode, sheetUpdatedAt, fetchData]);

    return {
        rollCallData,
        sheetMode,
        sheetUpdatedAt,
        handleManualRefresh
    };
}
