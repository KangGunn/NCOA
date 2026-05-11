import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, setDoc, getDocs, where } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { Trash2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Event {
    id: string;
    type: 'duty' | 'kta' | 'blc' | 'holiday';
    startDate: string;
    endDate: string;
    memo: string;
    batch?: string;
    ktaType?: 'A' | 'B';
}

export default function CalendarTab() {
    const [events, setEvents] = useState<Event[]>([]);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [isAdding, setIsAdding] = useState(false);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [activeAction, setActiveAction] = useState<{ id: string, mode: 'replace' | 'swap' } | null>(null);
    const [isBatchDutyAdding, setIsBatchDutyAdding] = useState(false);
    const [isBatchSaving, setIsBatchSaving] = useState(false);
    const [dutyHistory, setDutyHistory] = useState<string[]>([]);

    // KTA Template state
    const [isKTAScheduleAdding, setIsKTAScheduleAdding] = useState(false);
    const [ktaScheduleTemplate, setKtaScheduleTemplate] = useState<{ day: number, events: string[] }[]>(Array.from({ length: 21 }, (_, i) => ({ day: i, events: [] })));
    const [isKTASaving, setIsKTASaving] = useState(false);

    // BLC Template state
    const [isBLCScheduleAdding, setIsBLCScheduleAdding] = useState(false);
    const [blcScheduleTemplate, setBlcScheduleTemplate] = useState<{ day: number, events: string[] }[]>(Array.from({ length: 23 }, (_, i) => ({ day: i, events: [] })));
    const [isBLCSaving, setIsBLCSaving] = useState(false);

    // Members state
    const [members, setMembers] = useState<{ id: string; name: string; enlistmentDate: string }[]>([]);
    const [editingBatch, setEditingBatch] = useState<{ oldBatch: string; value: string; oldType?: 'A' | 'B'; ktaType?: 'A' | 'B' } | null>(null);
    const [holidayName, setHolidayName] = useState('');
    const [holidayStartDate, setHolidayStartDate] = useState('');
    const [holidayEndDate, setHolidayEndDate] = useState('');
    const [isHolidayNaming, setIsHolidayNaming] = useState(false);
    const [editingHoliday, setEditingHoliday] = useState<{ id: string; name: string; startDate: string; endDate: string } | null>(null);

    useEffect(() => {
        if (isAdding || isBatchDutyAdding || isKTAScheduleAdding || isBLCScheduleAdding) {
            document.documentElement.style.overflow = 'hidden';
            document.body.style.overflow = 'hidden';
        } else {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
        }
        return () => {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
        };
    }, [isAdding, isBatchDutyAdding, isKTAScheduleAdding, isBLCScheduleAdding]);

    useEffect(() => {
        let unsubscribeSchedules: () => void = () => { };
        let unsubscribeMembers: () => void = () => { };
        let unsubscribeKta: () => void = () => { };
        let unsubscribeBlc: () => void = () => { };

        const authUnsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                // 1. 일정(schedules) 구독
                const qSchedules = query(
                    collection(db, "schedules")
                );
                unsubscribeSchedules = onSnapshot(qSchedules, (snapshot) => {
                    const data = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    })) as Event[];
                    setEvents(data);
                });

                // 2. 인원(members) 구독
                const qMembers = query(collection(db, 'members'));
                unsubscribeMembers = onSnapshot(qMembers, (snapshot) => {
                    const data = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    })) as any[];
                    data.sort((a, b) => {
                        if (a.role === 'runner' && b.role !== 'runner') return 1;
                        if (a.role !== 'runner' && b.role === 'runner') return -1;
                        const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
                        const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
                        if (dateA !== dateB) return dateA < dateB ? -1 : 1;
                        const nameA = typeof a.name === 'string' ? a.name.trim() : '';
                        const nameB = typeof b.name === 'string' ? b.name.trim() : '';
                        if (nameA !== nameB) return nameA < nameB ? -1 : 1;
                        return 0;
                    });
                    setMembers(data);
                });

                // 3. KTA 주요일정 템플릿 구독
                const qKta = doc(db, 'settings', 'ktaTemplate');
                unsubscribeKta = onSnapshot(qKta, (docSnap) => {
                    if (docSnap.exists()) {
                        const savedSchedules = docSnap.data().schedules || [];
                        setKtaScheduleTemplate(
                            Array.from({ length: 21 }, (_, i) => {
                                const found = savedSchedules.find((s: any) => s.day === i);
                                if (found) {
                                    // Migration: handle old string 'memo' if it exists, or use 'events'
                                    const events = Array.isArray(found.events) ? found.events : (found.memo ? [found.memo] : []);
                                    return { day: i, events };
                                }
                                return { day: i, events: [] };
                            })
                        );
                    } else {
                        setKtaScheduleTemplate(Array.from({ length: 21 }, (_, i) => ({ day: i, events: [] })));
                    }
                });

                // 4. BLC 주요일정 템플릿 구독
                const qBlc = doc(db, 'settings', 'blcTemplate');
                unsubscribeBlc = onSnapshot(qBlc, (docSnap) => {
                    if (docSnap.exists()) {
                        const savedSchedules = docSnap.data().schedules || [];
                        setBlcScheduleTemplate(
                            Array.from({ length: 23 }, (_, i) => {
                                const found = savedSchedules.find((s: any) => s.day === i);
                                if (found) {
                                    const events = Array.isArray(found.events) ? found.events : (found.memo ? [found.memo] : []);
                                    return { day: i, events };
                                }
                                return { day: i, events: [] };
                            })
                        );
                    } else {
                        setBlcScheduleTemplate(Array.from({ length: 23 }, (_, i) => ({ day: i, events: [] })));
                    }
                });
            } else {
                setEvents([]);
                setMembers([]);
                setKtaScheduleTemplate(Array.from({ length: 21 }, (_, i) => ({ day: i, events: [] })));
                setBlcScheduleTemplate(Array.from({ length: 23 }, (_, i) => ({ day: i, events: [] })));
            }
        });

        return () => {
            authUnsubscribe();
            unsubscribeSchedules();
            unsubscribeMembers();
            unsubscribeKta();
            unsubscribeBlc();
        };
    }, []);

    const handleAutoKtaDay0 = async () => {
        if (!selectedDate) return;

        const user = auth.currentUser;
        if (!user) return;

        // 중복 체크 (정확한 기간 겹침 확인)
        const selectedStart = new Date(selectedDate);
        const proposedEnd = new Date(selectedStart);
        proposedEnd.setDate(selectedStart.getDate() + 20); // KTA는 20일 뒤 졸업

        const isOverlapping = events.some(e => {
            if (e.type !== 'kta' || !e.memo?.includes('Day 0')) return false;

            const existingStart = new Date(e.startDate);
            const existingEnd = new Date(existingStart);
            existingEnd.setDate(existingStart.getDate() + 20); // 기존 KTA도 20일 뒤 졸업

            // 두 기간 [start1, end1] 과 [start2, end2] 가 겹칠 조건: start1 <= end2 && start2 <= end1
            return existingStart <= proposedEnd && selectedStart <= existingEnd;
        });

        if (isOverlapping) {
            alert("새로 생성될 KTA 기간이 이미 등록된 KTA 기수 기간과 겹칩니다.");
            return;
        }

        // 1. 가장 최근 Day 0 일정을 찾아서 다음 기수 정보 자동 계산
        const lastDay0Event = [...events]
            .filter(e => e.type === 'kta' && e.memo?.includes('Day 0'))
            .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];

        let nextBatch = "01-01";
        let nextType: 'A' | 'B' = "A";

        if (lastDay0Event) {
            const lastBatch = lastDay0Event.batch || "";
            const lastType = lastDay0Event.ktaType || "A";

            if (lastBatch.includes('-')) {
                const parts = lastBatch.split('-');
                let num = parseInt(parts[0], 10) + 1;
                let year = parseInt(parts[1], 10);
                if (num > 12) { num = 1; year += 1; }
                nextBatch = `${String(num).padStart(2, '0')}-${String(year).padStart(2, '0')}`;
            }
            nextType = lastType === "A" ? "B" : "A";
        }

        setIsKTASaving(true);
        try {
            const startDate = new Date(selectedDate);
            const addPromises: Promise<any>[] = [];
            const day0DateStr = selectedDate;

            // Day 0 추가
            addPromises.push(addDoc(collection(db, "schedules"), {
                uid: user.uid,
                type: 'kta',
                startDate: day0DateStr,
                endDate: day0DateStr,
                memo: `Day 0 (${nextBatch} ${nextType})`,
                batch: nextBatch,
                ktaType: nextType,
                createdAt: serverTimestamp()
            }));

            // Graduation (Day 20) 추가
            const day20Date = new Date(startDate);
            day20Date.setDate(startDate.getDate() + 20);
            const day20DateStr = day20Date.toISOString().split('T')[0];
            addPromises.push(addDoc(collection(db, "schedules"), {
                uid: user.uid,
                type: 'kta',
                startDate: day20DateStr,
                endDate: day20DateStr,
                memo: `Graduation (${nextBatch} ${nextType})`,
                batch: nextBatch,
                ktaType: nextType,
                createdAt: serverTimestamp()
            }));

            await Promise.all(addPromises);
            setIsAdding(false);
            setSelectedDate(null);
        } catch (error) {
            console.error("Error auto-setting KTA Day 0:", error);
            alert("KTA 일정 등록 중 오류가 발생했습니다.");
        } finally {
            setIsKTASaving(false);
        }
    };

    const handleAddHoliday = async () => {
        if (!holidayName || !holidayStartDate || !holidayEndDate) return;

        const user = auth.currentUser;
        if (!user) return;
        try {
            await addDoc(collection(db, "schedules"), {
                uid: user.uid,
                type: 'holiday',
                startDate: holidayStartDate,
                endDate: holidayEndDate,
                memo: holidayName.trim() || "휴일",
                createdAt: serverTimestamp()
            });
            setHolidayName('');
            setHolidayStartDate('');
            setHolidayEndDate('');
            setIsHolidayNaming(false);
            setIsAdding(false);
            setSelectedDate(null);
        } catch (error) {
            console.error("Error adding holiday:", error);
            alert("휴일 추가 중 오류가 발생했습니다.");
        }
    };

    const handleUpdateHoliday = async (id: string) => {
        if (!editingHoliday || !editingHoliday.name.trim() || !editingHoliday.startDate || !editingHoliday.endDate) return;
        if (editingHoliday.endDate < editingHoliday.startDate) {
            alert("종료일은 시작일보다 빠를 수 없습니다.");
            return;
        }

        try {
            await updateDoc(doc(db, "schedules", id), {
                memo: editingHoliday.name.trim(),
                startDate: editingHoliday.startDate,
                endDate: editingHoliday.endDate
            });
            setEditingHoliday(null);
        } catch (error) {
            console.error("Error updating holiday:", error);
            alert("휴일 수정 중 오류가 발생했습니다.");
        }
    };

    const isHolidayDate = (dateStr: string) => {
        return events.some(e => e.type === 'holiday' && dateStr >= e.startDate && dateStr <= e.endDate);
    };

    const handleAutoBlcDay0 = async () => {
        if (!selectedDate) return;

        const user = auth.currentUser;
        if (!user) return;

        // 중복 체크 (정확한 기간 겹침 확인)
        const selectedStart = new Date(selectedDate);

        // 새로 생성될 BLC의 졸업일 계산
        let proposedDayCount = 0;
        let proposedCurrent = new Date(selectedStart);
        while (proposedDayCount < 22) {
            proposedCurrent.setDate(proposedCurrent.getDate() + 1);
            const currentStr = `${proposedCurrent.getFullYear()}-${String(proposedCurrent.getMonth() + 1).padStart(2, '0')}-${String(proposedCurrent.getDate()).padStart(2, '0')}`;
            if (proposedCurrent.getDay() !== 0 && !isHolidayDate(currentStr)) {
                proposedDayCount++;
            }
        }
        const proposedEnd = proposedCurrent;

        const isOverlapping = events.some(e => {
            if (e.type !== 'blc' || !e.memo?.includes('Day 0')) return false;

            const existingStart = new Date(e.startDate);
            // 기존 BLC 졸업일 계산
            let dayCount = 0;
            let current = new Date(existingStart);
            while (dayCount < 22) {
                current.setDate(current.getDate() + 1);
                const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                if (current.getDay() !== 0 && !isHolidayDate(currentStr)) {
                    dayCount++;
                }
            }
            const existingEnd = current;

            // 두 기간이 겹치는지 확인
            return existingStart <= proposedEnd && selectedStart <= existingEnd;
        });

        if (isOverlapping) {
            alert("새로 생성될 BLC 기간이 이미 등록된 BLC 기수 기간과 겹칩니다.");
            return;
        }

        // 1. 가장 최근 Day 0 일정을 찾아서 다음 기수 정보 자동 계산
        const lastDay0Event = [...events]
            .filter(e => e.type === 'blc' && e.memo?.includes('Day 0'))
            .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];

        let nextBatch = "24-01";
        if (lastDay0Event) {
            const lastBatch = lastDay0Event.batch || "";
            const batchMatch = lastBatch.match(/^(\d+)(.*)$/);
            if (batchMatch) {
                const nextNum = String(parseInt(batchMatch[1], 10) + 1).padStart(2, '0');
                nextBatch = `${nextNum}${batchMatch[2]}`;
            }
        }

        setIsBLCSaving(true);
        try {
            const day0DateStr = selectedDate;

            await addDoc(collection(db, "schedules"), {
                uid: user.uid,
                type: 'blc',
                startDate: day0DateStr,
                endDate: day0DateStr,
                memo: `Day 0 (${nextBatch})`,
                batch: nextBatch,
                createdAt: serverTimestamp()
            });

            setIsAdding(false);
            setSelectedDate(null);
        } catch (error) {
            console.error("Error auto-setting BLC Day 0:", error);
            alert("BLC 일정 등록 중 오류가 발생했습니다.");
        } finally {
            setIsBLCSaving(false);
        }
    };

    const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

    const getKtaReferenceDate = () => {
        const todayStr = new Date().toISOString().split('T')[0];
        const ktaBatches = events
            .filter(e => e.type === 'kta' && e.memo?.includes('Day 0'))
            .sort((a, b) => a.startDate.localeCompare(b.startDate));

        if (ktaBatches.length === 0) return null;

        const activeBatch = ktaBatches.find(b => {
            const start = new Date(b.startDate);
            const end = new Date(start);
            end.setDate(start.getDate() + 20);
            const endStr = end.toISOString().split('T')[0];
            return todayStr >= b.startDate && todayStr <= endStr;
        });

        if (activeBatch) return new Date(activeBatch.startDate);

        const nextBatch = ktaBatches.find(b => b.startDate > todayStr);
        if (nextBatch) return new Date(nextBatch.startDate);

        return new Date(ktaBatches[ktaBatches.length - 1].startDate);
    };

    const getKtaReferenceBatch = () => {
        const todayStr = new Date().toISOString().split('T')[0];
        const ktaBatches = events
            .filter(e => e.type === 'kta' && e.memo?.includes('Day 0') && e.batch)
            .sort((a, b) => a.startDate.localeCompare(b.startDate));

        if (ktaBatches.length === 0) return "";

        // 현재 진행 중인 기수 찾기
        const activeBatch = ktaBatches.find(b => {
            const start = new Date(b.startDate);
            const end = new Date(start);
            end.setDate(start.getDate() + 20);
            const endStr = end.toISOString().split('T')[0];
            return todayStr >= b.startDate && todayStr <= endStr;
        });

        if (activeBatch) return activeBatch.batch || "";

        // 진행 중인 게 없다면 가장 가까운 미래 기수
        const nextBatch = ktaBatches.find(b => b.startDate > todayStr);
        if (nextBatch) return nextBatch.batch || "";

        // 그것도 없다면 마지막 기수
        return ktaBatches[ktaBatches.length - 1].batch || "";
    };

    const getKtaReferenceType = () => {
        const todayStr = new Date().toISOString().split('T')[0];
        const ktaBatches = events
            .filter(e => e.type === 'kta' && e.memo?.includes('Day 0') && e.batch)
            .sort((a, b) => a.startDate.localeCompare(b.startDate));

        if (ktaBatches.length === 0) return "A";

        const activeBatch = ktaBatches.find(b => {
            const start = new Date(b.startDate);
            const end = new Date(start);
            end.setDate(start.getDate() + 20);
            const endStr = end.toISOString().split('T')[0];
            return todayStr >= b.startDate && todayStr <= endStr;
        });

        if (activeBatch) return activeBatch.ktaType || "A";

        const nextBatch = ktaBatches.find(b => b.startDate > todayStr);
        if (nextBatch) return nextBatch.ktaType || "A";

        return ktaBatches[ktaBatches.length - 1].ktaType || "A";
    };

    const getBlcReferenceDate = () => {
        const todayStr = new Date().toISOString().split('T')[0];
        const blcBatches = events
            .filter(e => e.type === 'blc' && e.memo?.includes('Day 0'))
            .sort((a, b) => a.startDate.localeCompare(b.startDate));

        if (blcBatches.length === 0) return null;

        const activeBatch = blcBatches.find(b => {
            const start = new Date(b.startDate);
            const end = new Date(start);
            end.setDate(start.getDate() + 25);
            const endStr = end.toISOString().split('T')[0];
            return todayStr >= b.startDate && todayStr <= endStr;
        });

        if (activeBatch) return new Date(activeBatch.startDate);

        const nextBatch = blcBatches.find(b => b.startDate > todayStr);
        if (nextBatch) return new Date(nextBatch.startDate);

        return new Date(blcBatches[blcBatches.length - 1].startDate);
    };

    const getBlcReferenceBatch = () => {
        const todayStr = new Date().toISOString().split('T')[0];
        const blcBatches = events
            .filter(e => e.type === 'blc' && e.memo?.includes('Day 0'))
            .sort((a, b) => a.startDate.localeCompare(b.startDate));

        if (blcBatches.length === 0) return "";

        const activeBatch = blcBatches.find(b => {
            const start = new Date(b.startDate);
            const end = new Date(start);
            end.setDate(start.getDate() + 25);
            const endStr = end.toISOString().split('T')[0];
            return todayStr >= b.startDate && todayStr <= endStr;
        });

        if (activeBatch) return activeBatch.batch || "";

        const nextBatch = blcBatches.find(b => b.startDate > todayStr);
        if (nextBatch) return nextBatch.batch || "";

        return blcBatches[blcBatches.length - 1].batch || "";
    };

    const formatDateWithDay = (baseDate: Date, addDays: number) => {
        const targetDate = new Date(baseDate);
        targetDate.setDate(baseDate.getDate() + addDays);
        const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dd = String(targetDate.getDate()).padStart(2, '0');
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const dayName = dayNames[targetDate.getDay()];
        return `${mm}.${dd}(${dayName})`;
    };

    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));


    const handleAddDuty = async (date: string, name: string) => {
        setIsAdding(false);
        setSelectedDate(null);

        const user = auth.currentUser;
        if (!user) return;
        try {
            await addDoc(collection(db, "schedules"), {
                uid: user.uid,
                type: 'duty',
                startDate: date,
                endDate: date,
                memo: name.trim(),
                createdAt: serverTimestamp()
            });
        } catch (error) {
            console.error("Error adding duty:", error);
            alert("당직 추가 중 오류가 발생했습니다.");
        }
    };

    const handleUpdateBatch = async (oldBatch: string, newBatch: string, newType?: 'A' | 'B') => {
        if (!oldBatch || !newBatch) {
            setEditingBatch(null);
            return;
        }

        try {
            const qAll = query(collection(db, "schedules"), where("type", "==", "kta"));
            const allSnap = await getDocs(qAll);

            const batchMap = new Map<string, { startDate: string, type: 'A' | 'B', docs: any[] }>();

            allSnap.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (!data.batch) return;

                if (!batchMap.has(data.batch)) {
                    batchMap.set(data.batch, { startDate: data.startDate, type: data.ktaType || 'A', docs: [] });
                }
                const b = batchMap.get(data.batch)!;
                b.docs.push(docSnap);
                if (data.memo?.includes('Day 0')) {
                    b.startDate = data.startDate;
                }
            });

            const sortedBatches = Array.from(batchMap.entries()).sort((a, b) => a[1].startDate.localeCompare(b[1].startDate));

            const modIndex = sortedBatches.findIndex(b => b[0] === oldBatch);

            if (modIndex === -1) {
                console.error("Batch not found in chronological list");
                return;
            }

            let currentCalculatedBatch = newBatch;
            let currentCalculatedType = newType || sortedBatches[modIndex][1].type;

            const updatePromises: Promise<any>[] = [];

            for (let i = modIndex; i < sortedBatches.length; i++) {
                const [originalBatchStr, batchInfo] = sortedBatches[i];

                const targetBatchStr = currentCalculatedBatch;
                const targetTypeStr = currentCalculatedType;

                // Calculate next batch for the next iteration
                if (targetBatchStr.includes('-')) {
                    const parts = targetBatchStr.split('-');
                    let num = parseInt(parts[0], 10);
                    let year = parseInt(parts[1], 10);
                    if (!isNaN(num) && !isNaN(year)) {
                        num += 1;
                        if (num > 12) {
                            num = 1;
                            year += 1;
                        }
                        currentCalculatedBatch = `${String(num).padStart(2, '0')}-${String(year).padStart(2, '0')}`;
                    }
                }
                currentCalculatedType = targetTypeStr === 'A' ? 'B' : 'A';

                batchInfo.docs.forEach(docSnap => {
                    const data = docSnap.data();
                    let newMemo = data.memo;

                    const oldFull = `${originalBatchStr} ${batchInfo.type}`;
                    const newFull = `${targetBatchStr} ${targetTypeStr}`;

                    if (originalBatchStr !== targetBatchStr || batchInfo.type !== targetTypeStr) {
                        if (newMemo.includes(`(${oldFull})`)) {
                            newMemo = newMemo.replace(`(${oldFull})`, `(${newFull})`);
                        } else if (newMemo.includes(`(${originalBatchStr})`)) {
                            newMemo = newMemo.replace(`(${originalBatchStr})`, `(${newFull})`);
                        } else if (newMemo.includes(oldFull)) {
                            newMemo = newMemo.replace(oldFull, newFull);
                        } else if (newMemo.includes(originalBatchStr)) {
                            newMemo = newMemo.replace(originalBatchStr, newFull);
                        }
                    }

                    if (batchInfo.type !== targetTypeStr) {
                        if (batchInfo.type === 'A' && targetTypeStr === 'B') {
                            newMemo = newMemo.replace(/1,\s*2/g, '@@@').replace(/3,\s*4/g, '1, 2').replace(/@@@/g, '3, 4');
                        } else if (batchInfo.type === 'B' && targetTypeStr === 'A') {
                            newMemo = newMemo.replace(/3,\s*4/g, '@@@').replace(/1,\s*2/g, '3, 4').replace(/@@@/g, '1, 2');
                        }
                    }

                    updatePromises.push(updateDoc(docSnap.ref, {
                        batch: targetBatchStr,
                        memo: newMemo,
                        ktaType: targetTypeStr
                    }));
                });
            }

            await Promise.all(updatePromises);
            setEditingBatch(null);
        } catch (error) {
            console.error("Error updating batch:", error);
            alert("기수 수정 중 오류가 발생했습니다.");
        }
    };

    const handleUpdateBlcBatch = async (oldBatch: string, newBatch: string) => {
        if (!oldBatch || !newBatch) {
            setEditingBatch(null);
            return;
        }

        try {
            const qAll = query(collection(db, "schedules"), where("type", "==", "blc"));
            const allSnap = await getDocs(qAll);

            const batchMap = new Map<string, { startDate: string, docs: any[] }>();

            allSnap.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (!data.batch) return;

                if (!batchMap.has(data.batch)) {
                    batchMap.set(data.batch, { startDate: data.startDate, docs: [] });
                }
                const b = batchMap.get(data.batch)!;
                b.docs.push(docSnap);
                if (data.memo?.includes('Day 0')) {
                    b.startDate = data.startDate;
                }
            });

            const sortedBatches = Array.from(batchMap.entries()).sort((a, b) => a[1].startDate.localeCompare(b[1].startDate));
            const modIndex = sortedBatches.findIndex(b => b[0] === oldBatch);

            if (modIndex === -1) {
                console.error("BLC Batch not found");
                return;
            }

            let currentCalculatedBatch = newBatch;
            const updatePromises: Promise<any>[] = [];

            for (let i = modIndex; i < sortedBatches.length; i++) {
                const [originalBatchStr, batchInfo] = sortedBatches[i];
                const targetBatchStr = currentCalculatedBatch;

                if (targetBatchStr.includes('-')) {
                    const parts = targetBatchStr.split('-');
                    let num = parseInt(parts[0], 10);
                    let year = parseInt(parts[1], 10);
                    if (!isNaN(num) && !isNaN(year)) {
                        num += 1;
                        if (num > 12) {
                            num = 1;
                            year += 1;
                        }
                        currentCalculatedBatch = `${String(num).padStart(2, '0')}-${String(year).padStart(2, '0')}`;
                    }
                }

                batchInfo.docs.forEach(docSnap => {
                    const data = docSnap.data();
                    let newMemo = data.memo;
                    if (originalBatchStr !== targetBatchStr) {
                        newMemo = newMemo.replace(new RegExp(originalBatchStr.replace('-', '\\-'), 'g'), targetBatchStr);
                    }
                    updatePromises.push(updateDoc(docSnap.ref, {
                        batch: targetBatchStr,
                        memo: newMemo
                    }));
                });
            }

            await Promise.all(updatePromises);
            setEditingBatch(null);
        } catch (error) {
            console.error("Error updating BLC batch:", error);
            alert("BLC 기수 수정 중 오류가 발생했습니다.");
        }
    };

    const handleDeleteEvent = async (id: string) => {
        const eventToDelete = events.find(e => e.id === id);
        const isKta = eventToDelete?.type === 'kta' && eventToDelete.batch;
        const isBlc = eventToDelete?.type === 'blc' && eventToDelete.batch;

        if (!confirm(isKta ? `해당 기수(${eventToDelete.batch}기)의 모든 KTA 일정을 삭제하시겠습니까?` : isBlc ? `해당 기수(${eventToDelete.batch}기)의 모든 BLC 일정을 삭제하시겠습니까?` : "일정을 삭제하시겠습니까?")) return;

        setIsAdding(false);
        setSelectedDate(null);

        try {
            if (isKta) {
                const linkedEvents = events.filter(e => e.type === 'kta' && e.batch === eventToDelete.batch);
                await Promise.all(linkedEvents.map(e => deleteDoc(doc(db, "schedules", e.id))));
            } else if (isBlc) {
                const linkedEvents = events.filter(e => e.type === 'blc' && e.batch === eventToDelete.batch);
                await Promise.all(linkedEvents.map(e => deleteDoc(doc(db, "schedules", e.id))));
            } else {
                await deleteDoc(doc(db, "schedules", id));
            }
        } catch (error) {
            console.error("Error deleting event:", error);
            alert("삭제 중 오류가 발생했습니다.");
        }
    };

    const handleReplace = async (eventId: string, newName: string) => {
        setIsAdding(false);
        setSelectedDate(null);
        setActiveAction(null);

        try {
            await updateDoc(doc(db, "schedules", eventId), {
                memo: newName
            });
        } catch (error) {
            console.error("Error replacing duty:", error);
            alert("대체 중 오류가 발생했습니다.");
        }
    };

    const handleRealSwap = async (id1: string, name1: string, id2: string, name2: string) => {
        if (!confirm(`${name1}님과 ${name2}님의 근무 날짜를 교환하시겠습니까?`)) return;

        setIsAdding(false);
        setSelectedDate(null);
        setActiveAction(null);

        try {
            await Promise.all([
                updateDoc(doc(db, "schedules", id1), { memo: name2 }),
                updateDoc(doc(db, "schedules", id2), { memo: name1 })
            ]);
        } catch (error) {
            console.error("Error swapping duties:", error);
            alert("교환 중 오류가 발생했습니다.");
        }
    };

    const openBatchDutyModal = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const totalDays = daysInMonth(year, month);

        const existingDuties = events.filter(e => {
            if (e.type !== 'duty') return false;
            const eYear = new Date(e.startDate).getFullYear();
            const eMonth = new Date(e.startDate).getMonth();
            return eYear === year && eMonth === month;
        });

        const newHistory: string[] = [];
        for (let d = 1; d <= totalDays; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const duty = existingDuties.find(e => e.startDate === dateStr);
            if (duty) {
                newHistory[d - 1] = duty.memo;
            } else {
                newHistory[d - 1] = '';
            }
        }

        // Remove trailing empty strings so that the "next" index is correct
        while (newHistory.length > 0 && newHistory[newHistory.length - 1] === '') {
            newHistory.pop();
        }

        setDutyHistory(newHistory);
        setIsBatchDutyAdding(true);
    };

    const handleNameClick = (name: string) => {
        const totalDays = daysInMonth(currentDate.getFullYear(), currentDate.getMonth());
        if (dutyHistory.length < totalDays) {
            setDutyHistory(prev => [...prev, name]);
        }
    };

    const handleUndo = () => {
        setDutyHistory(prev => prev.slice(0, -1));
    };

    const handleBatchSaveDuties = async () => {
        if (isBatchSaving) return;
        const user = auth.currentUser;
        if (!user) return;

        setIsBatchSaving(true);

        try {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();

            // 1. 해당 월의 모든 기존 당직 찾기 (중복 방지를 위해 전체 조회 결과 사용)
            const currentMonthDuties = events.filter(e => {
                if (e.type !== 'duty') return false;
                const eDate = new Date(e.startDate);
                return eDate.getFullYear() === year && eDate.getMonth() === month;
            });

            // 2. 기존 데이터 삭제 작업을 먼저 완료
            if (currentMonthDuties.length > 0) {
                await Promise.all(currentMonthDuties.map(d => deleteDoc(doc(db, "schedules", d.id))));
            }

            // 3. 삭제가 확인된 후 새로운 데이터 추가
            const addPromises: Promise<any>[] = [];
            for (let i = 0; i < dutyHistory.length; i++) {
                const name = dutyHistory[i];
                if (name && name.trim()) {
                    const d = i + 1;
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    addPromises.push(addDoc(collection(db, "schedules"), {
                        uid: user.uid,
                        type: 'duty',
                        startDate: dateStr,
                        endDate: dateStr,
                        memo: name.trim(),
                        createdAt: serverTimestamp()
                    }));
                }
            }

            if (addPromises.length > 0) {
                await Promise.all(addPromises);
            }

            setIsBatchSaving(false);
            setIsBatchDutyAdding(false);
            setDutyHistory([]);
        } catch (error) {
            console.error("Error setting batch duties:", error);
            alert("당직 일괄 저장 중 오류가 발생했습니다.");
            setIsBatchSaving(false);
        }
    };

    const handleKtaTemplateChange = (day: number, eventIndex: number, value: string) => {
        setKtaScheduleTemplate(prev => prev.map(item => {
            if (item.day === day) {
                const newEvents = [...item.events];
                newEvents[eventIndex] = value;
                return { ...item, events: newEvents.filter((v, i) => v !== '' || i === eventIndex) };
            }
            return item;
        }));
    };

    const addEventToTemplate = (day: number) => {
        setKtaScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: [...item.events, ''] } : item
        ));
    };

    const removeEventFromTemplate = (day: number, index: number) => {
        setKtaScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: item.events.filter((_, i) => i !== index) } : item
        ));
    };

    const handleKtaSave = async () => {
        setIsKTASaving(true);
        try {
            await setDoc(doc(db, 'settings', 'ktaTemplate'), {
                schedules: ktaScheduleTemplate.map(s => ({
                    day: s.day,
                    events: s.events.filter(e => e.trim() !== '')
                }))
            });
            setIsKTAScheduleAdding(false);
        } catch (error) {
            console.error("Error saving KTA template:", error);
            alert("KTA 일정 저장 중 오류가 발생했습니다.");
        } finally {
            setIsKTASaving(false);
        }
    };

    const handleBlcTemplateChange = (day: number, eventIndex: number, value: string) => {
        setBlcScheduleTemplate(prev => prev.map(item => {
            if (item.day === day) {
                const newEvents = [...item.events];
                newEvents[eventIndex] = value;
                return { ...item, events: newEvents.filter((v, i) => v !== '' || i === eventIndex) };
            }
            return item;
        }));
    };

    const addEventToBlcTemplate = (day: number) => {
        setBlcScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: [...item.events, ''] } : item
        ));
    };

    const removeEventFromBlcTemplate = (day: number, index: number) => {
        setBlcScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: item.events.filter((_, i) => i !== index) } : item
        ));
    };

    const handleBlcSave = async () => {
        setIsBLCSaving(true);
        try {
            await setDoc(doc(db, 'settings', 'blcTemplate'), {
                schedules: blcScheduleTemplate.map(s => ({
                    day: s.day,
                    events: s.events.filter(e => e.trim() !== '')
                }))
            });
            setIsBLCScheduleAdding(false);
        } catch (error) {
            console.error("Error saving BLC template:", error);
            alert("BLC 일정 저장 중 오류가 발생했습니다.");
        } finally {
            setIsBLCSaving(false);
        }
    };


    const isDateInRange = (dateStr: string, start: string, end: string) => {
        return dateStr >= start && dateStr <= end;
    };

    const getEventsForDate = (dateStr: string) => {
        const baseEvents = events.filter(e => isDateInRange(dateStr, e.startDate, e.endDate));

        // BLC 동적 생성 로직 추가
        const blcDay0s = events.filter(e => e.type === 'blc' && e.memo?.includes('Day 0'));

        const dynamicBlcEvents: Event[] = [];

        blcDay0s.forEach(day0 => {
            const start = new Date(day0.startDate);
            const batch = day0.batch || "";

            // 1~22일까지 계산
            let dayCount = 0;
            let current = new Date(start);

            while (dayCount < 22) {
                current.setDate(current.getDate() + 1);
                const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;

                const isSunday = current.getDay() === 0;

                if (!isSunday && !isHolidayDate(currentStr)) {
                    dayCount++;
                    if (currentStr === dateStr) {
                        dynamicBlcEvents.push({
                            id: `dynamic-blc-${batch}-${dayCount}`,
                            type: 'blc',
                            startDate: currentStr,
                            endDate: currentStr,
                            memo: dayCount === 22 ? `Graduation (${batch})` : `Day ${dayCount} (${batch})`,
                            batch: batch
                        });
                    }
                }
            }
        });

        // 기존 이벤트와 동적 BLC 이벤트 합치기 (기존의 중복된 Day 1~22 DB 데이터는 무시하기 위해 필터링)
        const finalEvents = [
            ...baseEvents.filter(e => !(e.type === 'blc' && !e.memo?.includes('Day 0'))),
            ...dynamicBlcEvents
        ];

        return finalEvents;
    };

    const renderHeader = () => (
        <header className="flex items-center justify-between mb-8">
            <div>
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">
                    {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
                </h1>
            </div>
            <div className="flex gap-2">
                <button onClick={prevMonth} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-gray-900 transition-colors">
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <button onClick={nextMonth} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-gray-900 transition-colors">
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </header>
    );

    const renderCalendar = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const totalDays = daysInMonth(year, month);
        const startDay = firstDayOfMonth(year, month);

        // Build flat array of all calendar dates (including leading/trailing)
        type CalendarDate = { d: number; m: number; y: number; isCurrentMonth: boolean; dateStr: string };
        const allDates: CalendarDate[] = [];

        // Leading days from previous month
        const prevMonthDate = new Date(year, month, 0);
        const prevMonthYear = prevMonthDate.getFullYear();
        const prevMonthMonth = prevMonthDate.getMonth();
        const prevMonthLastDate = prevMonthDate.getDate();
        for (let i = startDay - 1; i >= 0; i--) {
            const d = prevMonthLastDate - i;
            allDates.push({ d, m: prevMonthMonth, y: prevMonthYear, isCurrentMonth: false, dateStr: `${prevMonthYear}-${String(prevMonthMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
        }

        // Current month days
        for (let d = 1; d <= totalDays; d++) {
            allDates.push({ d, m: month, y: year, isCurrentMonth: true, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
        }

        // Trailing days from next month
        const nextMonthDate = new Date(year, month + 1, 1);
        const nextMonthYear = nextMonthDate.getFullYear();
        const nextMonthMonth = nextMonthDate.getMonth();
        const remainingCells = allDates.length % 7 === 0 ? 0 : 7 - (allDates.length % 7);
        for (let d = 1; d <= remainingCells; d++) {
            allDates.push({ d, m: nextMonthMonth, y: nextMonthYear, isCurrentMonth: false, dateStr: `${nextMonthYear}-${String(nextMonthMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
        }

        // Split into weeks
        const weeks: CalendarDate[][] = [];
        for (let i = 0; i < allDates.length; i += 7) {
            weeks.push(allDates.slice(i, i + 7));
        }

        // Event color/style map
        const eventStyle = (type: string) => {
            switch (type) {
                case 'duty': return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
                case 'kta': return { bg: 'bg-red-100', text: 'text-red-700' };
                case 'blc': return { bg: 'bg-blue-100', text: 'text-blue-700' };
                case 'holiday': return { bg: 'bg-purple-100', text: 'text-purple-700' };
                default: return { bg: 'bg-gray-100', text: 'text-gray-700' };
            }
        };

        // For a given week, compute the event bars to render
        const computeWeekEvents = (week: CalendarDate[]) => {
            const weekStart = week[0].dateStr;
            const weekEnd = week[6].dateStr;

            // Collect all unique events that touch this week
            const seen = new Set<string>();
            const weekEvents: { event: any; startCol: number; endCol: number }[] = [];

            for (let col = 0; col < 7; col++) {
                const dateEvents = getEventsForDate(week[col].dateStr);
                for (const ev of dateEvents) {
                    if (seen.has(ev.id)) continue;
                    seen.add(ev.id);

                    // Calculate the column span within this week
                    const evStart = ev.startDate < weekStart ? weekStart : ev.startDate;
                    const evEnd = ev.endDate > weekEnd ? weekEnd : ev.endDate;

                    const startCol = week.findIndex(d => d.dateStr >= evStart);
                    const endCol = week.findIndex(d => d.dateStr >= evEnd);

                    if (startCol !== -1 && endCol !== -1) {
                        weekEvents.push({ event: ev, startCol, endCol });
                    }
                }
            }

            // Sort: duty first, then blc/holiday, then kta
            const order = { duty: 1, blc: 2, holiday: 2, kta: 3 };
            weekEvents.sort((a, b) => (order[a.event.type as keyof typeof order] || 0) - (order[b.event.type as keyof typeof order] || 0));

            // Assign rows (lanes) to avoid overlap
            const lanes: { event: any; startCol: number; endCol: number }[][] = [];
            for (const we of weekEvents) {
                let placed = false;
                for (const lane of lanes) {
                    const overlaps = lane.some(item => !(we.endCol < item.startCol || we.startCol > item.endCol));
                    if (!overlaps) {
                        lane.push(we);
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    lanes.push([we]);
                }
            }

            return lanes;
        };

        const ROW_HEIGHT = 16; // height of each event bar in px
        const ROW_GAP = 2;    // gap between event bars
        const DATE_HEADER = 28; // space for date number

        return (
            <div className="bg-white rounded-[2.5rem] border-2 border-gray-50 p-4 shadow-sm overflow-hidden">
                <div className="grid grid-cols-7 mb-2">
                    {['일', '월', '화', '수', '목', '금', '토'].map((day, i) => (
                        <div key={day} className={cn(
                            "text-center text-[10px] font-black uppercase tracking-widest pb-2",
                            i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-300"
                        )}>
                            {day}
                        </div>
                    ))}
                </div>
                <div>
                    {weeks.map((week, wi) => {
                        const lanes = computeWeekEvents(week);
                        const MIN_WEEK_HEIGHT = 100; // Minimum height for the spacious look
                        const eventAreaHeight = Math.max(lanes.length * (ROW_HEIGHT + ROW_GAP), ROW_HEIGHT + ROW_GAP);
                        const totalHeight = Math.max(MIN_WEEK_HEIGHT, DATE_HEADER + eventAreaHeight + 8);

                        return (
                            <div key={wi} className="relative border-t border-gray-50 group" style={{ height: totalHeight }}>
                                {/* Background grid: date numbers + click targets */}
                                <div className="grid grid-cols-7 absolute inset-0 h-full">
                                    {week.map((cell, ci) => {
                                        const isToday = new Date().toISOString().split('T')[0] === cell.dateStr;
                                        return (
                                            <div
                                                key={cell.dateStr}
                                                onClick={() => {
                                                    setSelectedDate(cell.dateStr);
                                                    setIsAdding(true);
                                                }}
                                                className={cn(
                                                    "h-full cursor-pointer transition-colors hover:bg-blue-50/10",
                                                    selectedDate === cell.dateStr && "bg-blue-50/50",
                                                    !cell.isCurrentMonth && "bg-gray-50/30",
                                                    ci > 0 && "border-l border-gray-50/50"
                                                )}
                                            >
                                                <div className="p-1">
                                                    <span className={cn(
                                                        "text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full",
                                                        isToday ? "bg-blue-600 text-white" :
                                                            cell.isCurrentMonth ? "text-gray-400" : "text-gray-300"
                                                    )}>
                                                        {cell.d}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Event overlay layer */}
                                <div className="absolute left-0 right-0" style={{ top: DATE_HEADER }}>
                                    {lanes.map((lane, li) =>
                                        lane.map((item) => {
                                            const style = eventStyle(item.event.type);
                                            const isMultiDay = item.event.startDate !== item.event.endDate;
                                            const isHol = item.event.type === 'holiday';
                                            const startsBeforeWeek = item.event.startDate < week[0].dateStr;
                                            const endsAfterWeek = item.event.endDate > week[6].dateStr;

                                            // Calculate position as percentages
                                            const leftPct = (item.startCol / 7) * 100;
                                            const widthPct = ((item.endCol - item.startCol + 1) / 7) * 100;

                                            // Determine rounding
                                            const isVisualStart = !startsBeforeWeek;
                                            const isVisualEnd = !endsAfterWeek;

                                            // Display memo
                                            let displayMemo = item.event.memo || '';
                                            if (item.event.type === 'blc' && displayMemo && !displayMemo.includes('Day 0') && !displayMemo.includes('Graduation')) {
                                                displayMemo = displayMemo.replace(/\s*\([^)]*\)/g, '');
                                            }


                                            const marginLeft = isVisualStart ? 3 : 0;
                                            const marginRight = isVisualEnd ? 3 : 0;

                                            return (
                                                <div
                                                    key={`${item.event.id}-${wi}`}
                                                    className={cn(
                                                        "absolute text-[8.5px] font-black leading-none flex items-center pointer-events-none",
                                                        style.bg, style.text,
                                                        isMultiDay ? "justify-center" : "justify-start",
                                                        isMultiDay && isHol ? cn(
                                                            isVisualStart && isVisualEnd ? "rounded-md" :
                                                                isVisualStart ? "rounded-l-md" :
                                                                    isVisualEnd ? "rounded-r-md" : ""
                                                        ) : "rounded-md"
                                                    )}
                                                    style={{
                                                        left: `calc(${leftPct}% + ${marginLeft}px)`,
                                                        width: `calc(${widthPct}% - ${marginLeft + marginRight}px)`,
                                                        top: li * (ROW_HEIGHT + ROW_GAP),
                                                        height: ROW_HEIGHT,
                                                        paddingLeft: isMultiDay ? (isVisualStart ? 6 : 4) : 4,
                                                        paddingRight: isMultiDay ? (isVisualEnd ? 6 : 4) : 4,
                                                    }}
                                                >
                                                    <span className="truncate">{displayMemo}</span>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="pt-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            {renderHeader()}

            {renderCalendar()}

            <div className="grid grid-cols-3 mt-4 gap-2 px-1">
                <button
                    onClick={() => setIsBLCScheduleAdding(true)}
                    className="px-2 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl font-black text-xs shadow-xl shadow-blue-100 active:scale-95 transition-all outline-none"
                >
                    BLC 주요일정
                </button>
                <button
                    onClick={() => setIsKTAScheduleAdding(true)}
                    className="px-2 py-3 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-black text-xs shadow-xl shadow-red-100 active:scale-95 transition-all outline-none"
                >
                    KTA 주요일정
                </button>
                <button
                    onClick={openBatchDutyModal}
                    className="px-2 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-2xl font-black text-xs shadow-xl shadow-yellow-100 active:scale-95 transition-all outline-none"
                >
                    당직 일괄 등록
                </button>
            </div>

            {/* Event Detail / Modal */}
            {isAdding && createPortal(
                <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-6 shadow-2xl animate-in slide-in-from-bottom-10">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-black text-gray-900">일정 상세보기</h2>
                            <button onClick={() => { setIsAdding(false); setSelectedDate(null); }} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>


                        {/* Event List for Selected Date */}
                        <div className="space-y-3">
                            {selectedDate && getEventsForDate(selectedDate).sort((a, b) => {
                                const order = { duty: 1, blc: 2, holiday: 2, kta: 3 };
                                return (order[a.type as keyof typeof order] || 0) - (order[b.type as keyof typeof order] || 0);
                            }).map(e => (
                                <div key={e.id} className="flex flex-col gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                    {editingHoliday?.id === e.id ? (
                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-[10px] text-gray-500 font-bold ml-1 mb-1 block">휴일 이름</label>
                                                <input
                                                    type="text"
                                                    value={editingHoliday.name}
                                                    onChange={evt => setEditingHoliday({ ...editingHoliday, name: evt.target.value })}
                                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500"
                                                />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1">
                                                    <label className="text-[10px] text-gray-500 font-bold ml-1 mb-1 block">시작일</label>
                                                    <input
                                                        type="date"
                                                        value={editingHoliday.startDate}
                                                        onChange={evt => setEditingHoliday({ ...editingHoliday, startDate: evt.target.value })}
                                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500"
                                                    />
                                                </div>
                                                <span className="self-end pb-2 font-black text-gray-400">~</span>
                                                <div className="flex-1">
                                                    <label className="text-[10px] text-gray-500 font-bold ml-1 mb-1 block">종료일</label>
                                                    <input
                                                        type="date"
                                                        value={editingHoliday.endDate}
                                                        onChange={evt => setEditingHoliday({ ...editingHoliday, endDate: evt.target.value })}
                                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex gap-2 pt-2">
                                                <button onClick={() => setEditingHoliday(null)} className="flex-1 py-2 bg-gray-200 text-gray-600 rounded-xl text-xs font-black">취소</button>
                                                <button onClick={() => handleUpdateHoliday(e.id)} className="flex-1 py-2 bg-purple-500 text-white rounded-xl text-xs font-black shadow-md shadow-purple-100">저장</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={cn("w-2 h-2 rounded-full", e.type === 'duty' ? "bg-yellow-500" : e.type === 'kta' ? "bg-red-500" : e.type === 'blc' ? "bg-blue-500" : "bg-purple-500")} />
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-black text-sm text-gray-900">{e.type === 'duty' ? '당직' : e.type === 'kta' ? 'KTA' : e.type === 'blc' ? 'BLC' : '휴일'}</span>
                                                        {e.type === 'holiday' && (
                                                            <span className="text-[10px] font-bold text-gray-500">
                                                                {e.startDate} ~ {e.endDate}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {e.type === 'kta' && e.batch && editingBatch?.oldBatch === e.batch ? (
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <select
                                                                value={editingBatch.ktaType || 'A'}
                                                                onChange={(ev) => setEditingBatch({ ...editingBatch, ktaType: ev.target.value as 'A' | 'B' })}
                                                                className="px-2 py-1 bg-white border border-red-200 rounded-lg text-[11px] font-black text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 w-12"
                                                            >
                                                                <option value="A">A</option>
                                                                <option value="B">B</option>
                                                            </select>
                                                            <input
                                                                type="text"
                                                                value={editingBatch.value}
                                                                onChange={(ev) => setEditingBatch({ ...editingBatch, value: ev.target.value })}
                                                                className="px-2 py-1 bg-white border border-red-200 rounded-lg text-[11px] font-black text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 w-24"
                                                                autoFocus
                                                                onKeyDown={(ev) => {
                                                                    if (ev.key === 'Enter') handleUpdateBatch(editingBatch.oldBatch, editingBatch.value, editingBatch.ktaType);
                                                                    if (ev.key === 'Escape') setEditingBatch(null);
                                                                }}
                                                            />
                                                            <button
                                                                onClick={() => handleUpdateBatch(editingBatch.oldBatch, editingBatch.value, editingBatch.ktaType)}
                                                                className="px-2 py-1 bg-red-600 text-white rounded-lg text-[10px] font-black hover:bg-red-700 transition-all"
                                                            >
                                                                저장
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingBatch(null)}
                                                                className="px-2 py-1 bg-white border border-gray-200 text-gray-500 rounded-lg text-[10px] font-black hover:bg-gray-50 transition-all"
                                                            >
                                                                취소
                                                            </button>
                                                        </div>
                                                    ) : e.type === 'blc' && e.batch && editingBatch?.oldBatch === e.batch ? (
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <input
                                                                type="text"
                                                                value={editingBatch.value}
                                                                onChange={(ev) => setEditingBatch({ ...editingBatch, value: ev.target.value })}
                                                                className="px-2 py-1 bg-white border border-blue-200 rounded-lg text-[11px] font-black text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 w-24"
                                                                autoFocus
                                                                onKeyDown={(ev) => {
                                                                    if (ev.key === 'Enter') handleUpdateBlcBatch(editingBatch.oldBatch, editingBatch.value);
                                                                    if (ev.key === 'Escape') setEditingBatch(null);
                                                                }}
                                                            />
                                                            <button
                                                                onClick={() => handleUpdateBlcBatch(editingBatch.oldBatch, editingBatch.value)}
                                                                className="px-2 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-700 transition-all"
                                                            >
                                                                저장
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingBatch(null)}
                                                                className="px-2 py-1 bg-white border border-gray-200 text-gray-500 rounded-lg text-[10px] font-black hover:bg-gray-50 transition-all"
                                                            >
                                                                취소
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="text-[10px] text-gray-500 font-bold mt-1 bg-gray-100 px-2 py-0.5 rounded-md inline-block">
                                                            {e.memo}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {e.type === 'holiday' && (
                                                    <button
                                                        onClick={() => setEditingHoliday({ id: e.id, name: e.memo, startDate: e.startDate, endDate: e.endDate })}
                                                        className="px-2 py-1.5 bg-white border border-gray-100 text-gray-600 rounded-lg text-[10px] font-black hover:bg-gray-50 transition-all"
                                                    >
                                                        기간/이름 수정
                                                    </button>
                                                )}
                                                {e.type === 'kta' && e.batch && !editingBatch && (
                                                    <button
                                                        onClick={() => setEditingBatch({ oldBatch: e.batch!, value: e.batch!, oldType: e.ktaType || 'A', ktaType: e.ktaType || 'A' })}
                                                        className="px-2 py-1.5 bg-white border border-red-100 text-red-600 rounded-lg text-[10px] font-black hover:bg-red-50 transition-all"
                                                    >
                                                        기수 수정
                                                    </button>
                                                )}
                                                {e.type === 'blc' && e.batch && !editingBatch && (
                                                    <button
                                                        onClick={() => setEditingBatch({ oldBatch: e.batch!, value: e.batch!, oldType: 'A', ktaType: 'A' })}
                                                        className="px-2 py-1.5 bg-white border border-blue-100 text-blue-600 rounded-lg text-[10px] font-black hover:bg-blue-50 transition-all"
                                                    >
                                                        기수 수정
                                                    </button>
                                                )}
                                                {e.type === 'duty' && (
                                                    <>
                                                        <button
                                                            onClick={() => setActiveAction(activeAction?.id === e.id && activeAction.mode === 'replace' ? null : { id: e.id, mode: 'replace' })}
                                                            className={cn(
                                                                "px-2 py-1.5 rounded-lg text-[10px] font-black transition-all",
                                                                activeAction?.id === e.id && activeAction.mode === 'replace' ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-blue-600 hover:bg-blue-50"
                                                            )}
                                                        >
                                                            대체
                                                        </button>
                                                        <button
                                                            onClick={() => setActiveAction(activeAction?.id === e.id && activeAction.mode === 'swap' ? null : { id: e.id, mode: 'swap' })}
                                                            className={cn(
                                                                "px-2 py-1.5 rounded-lg text-[10px] font-black transition-all",
                                                                activeAction?.id === e.id && activeAction.mode === 'swap' ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-indigo-600 hover:bg-indigo-50"
                                                            )}
                                                        >
                                                            교환
                                                        </button>
                                                    </>
                                                )}
                                                <button onClick={() => handleDeleteEvent(e.id)} className="p-2 text-gray-300 hover:text-red-500">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {activeAction?.id === e.id && (
                                        <div className="pt-2 border-t border-gray-100 animate-in fade-in slide-in-from-top-2">
                                            {activeAction.mode === 'replace' ? (
                                                <div className="grid grid-cols-4 gap-1">
                                                    {members.map(m => (
                                                        <button
                                                            key={m.id}
                                                            onClick={() => handleReplace(e.id, m.name)}
                                                            className="py-2 bg-white border border-gray-100 rounded-lg text-[10px] font-bold text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-all truncate px-1"
                                                        >
                                                            {m.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="space-y-1">
                                                    <p className="text-[9px] font-bold text-gray-400 mb-2 ml-1">교환할 다른 날짜의 당직을 선택하세요:</p>
                                                    <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto custom-scrollbar p-1">
                                                        {events.filter(other => other.type === 'duty' && other.id !== e.id).sort((a, b) => a.startDate.localeCompare(b.startDate)).map(other => (
                                                            <button
                                                                key={other.id}
                                                                onClick={() => handleRealSwap(e.id, e.memo, other.id, other.memo)}
                                                                className="py-2.5 px-3 bg-white border border-gray-100 rounded-xl text-[10px] font-bold text-left hover:border-indigo-300 hover:bg-indigo-50 transition-all flex flex-col"
                                                            >
                                                                <span className="text-[8px] text-indigo-400">{other.startDate}</span>
                                                                <span className="truncate">{other.memo}</span>
                                                            </button>
                                                        ))}
                                                        {events.filter(other => other.type === 'duty' && other.id !== e.id).length === 0 && (
                                                            <div className="col-span-2 py-4 text-center text-[10px] text-gray-400 font-medium italic">교환 가능한 다른 당직이 없습니다.</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* 당직 지정 UI (당직이 없는 경우에만 노출) */}
                        {selectedDate && getEventsForDate(selectedDate).filter(e => e.type === 'duty').length === 0 && (
                            <div className="pt-4 border-t border-gray-100 space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-black text-gray-900 ml-1">당직 지정</h3>
                                    <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded-lg">비어있음</span>
                                </div>
                                <div className="grid grid-cols-4 gap-1.5">
                                    {members.map(m => (
                                        <button
                                            key={m.id}
                                            onClick={() => handleAddDuty(selectedDate, m.name)}
                                            className="py-2.5 bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 border border-transparent rounded-xl text-[10px] font-black transition-all truncate px-1"
                                        >
                                            {m.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* 버튼 하단 배치 */}
                        <div className="pt-4 border-t border-gray-100">
                            {isHolidayNaming ? (
                                <div className="space-y-3 animate-in slide-in-from-bottom-2">
                                    <div>
                                        <label className="text-[10px] text-gray-500 font-bold ml-1 mb-1 block">휴일 이름</label>
                                        <input
                                            type="text"
                                            placeholder="예: 어린이날, 추석 연휴"
                                            value={holidayName}
                                            onChange={(e) => setHolidayName(e.target.value)}
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1">
                                            <label className="text-[10px] text-gray-500 font-bold ml-1 mb-1 block">시작일</label>
                                            <input
                                                type="date"
                                                value={holidayStartDate}
                                                onChange={(e) => setHolidayStartDate(e.target.value)}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                                            />
                                        </div>
                                        <span className="self-end pb-3 font-black text-gray-400">~</span>
                                        <div className="flex-1">
                                            <label className="text-[10px] text-gray-500 font-bold ml-1 mb-1 block">종료일</label>
                                            <input
                                                type="date"
                                                value={holidayEndDate}
                                                onChange={(e) => setHolidayEndDate(e.target.value)}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-2 pt-2">
                                        <button onClick={() => { setIsHolidayNaming(false); setHolidayName(''); setHolidayEndDate(''); }} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-2xl text-xs font-black">취소</button>
                                        <button onClick={handleAddHoliday} className="flex-1 py-3 bg-purple-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-purple-100">등록</button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            setIsHolidayNaming(true);
                                            setHolidayStartDate(selectedDate || '');
                                            setHolidayEndDate(selectedDate || '');
                                        }}
                                        className="flex-1 py-3 bg-purple-50 text-purple-600 rounded-2xl text-xs font-black hover:bg-purple-100 transition-colors"
                                    >
                                        휴일 추가
                                    </button>
                                    {selectedDate && new Date(selectedDate).getDay() === 4 && (
                                        <button
                                            onClick={handleAutoKtaDay0}
                                            disabled={isKTASaving}
                                            className="flex-1 py-3 bg-red-50 text-red-600 rounded-2xl text-xs font-black hover:bg-red-100 transition-colors disabled:opacity-50"
                                        >
                                            KTA Day 0
                                        </button>
                                    )}
                                    <button
                                        onClick={handleAutoBlcDay0}
                                        disabled={isBLCSaving}
                                        className="flex-1 py-3 bg-blue-50 text-blue-600 rounded-2xl text-xs font-black hover:bg-blue-100 transition-colors disabled:opacity-50"
                                    >
                                        BLC Day 0
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Batch Duty Modal */}
            {isBatchDutyAdding && createPortal(
                <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-5 shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[90vh]">
                        <div className="flex items-center justify-between shrink-0">
                            <div>
                                <h2 className="text-2xl font-black text-gray-900">{currentDate.getMonth() + 1}월 당직 등록</h2>
                                <p className="text-xs text-gray-500 font-bold mt-1">부대원 이름을 연속해서 눌러 당직을 채워보세요.</p>
                            </div>
                            <button onClick={() => setIsBatchDutyAdding(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        <div className="grid grid-cols-5 gap-1.5 shrink-0 py-2 border-b border-gray-100">
                            {members.map(m => (
                                <button
                                    key={m.id}
                                    onClick={() => handleNameClick(m.name)}
                                    className="py-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200 rounded-xl text-[11px] font-black transition-colors truncate px-1"
                                    title={m.name}
                                >
                                    {m.name}
                                </button>
                            ))}
                            {/* Skip Button */}
                            <button
                                onClick={() => handleNameClick('')}
                                className="py-2.5 bg-gray-100 text-gray-500 hover:bg-gray-200 active:bg-gray-300 rounded-xl text-[11px] font-black transition-colors"
                            >
                                비우기
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1 min-h-[150px] custom-scrollbar py-2">
                            <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
                                {Array.from({ length: daysInMonth(currentDate.getFullYear(), currentDate.getMonth()) }, (_, i) => i + 1).map(day => {
                                    const assignedTo = dutyHistory[day - 1]; // Because day is 1-indexed
                                    const isNext = dutyHistory.length === day - 1;
                                    return (
                                        <div key={day} className={cn(
                                            "flex flex-col items-center justify-center p-1 rounded-xl border-2 transition-all",
                                            assignedTo ? "border-yellow-200 bg-yellow-50" :
                                                isNext ? "border-blue-400 bg-blue-50 shadow-inner scale-105" : "border-gray-50 bg-gray-50/50 opacity-50"
                                        )}>
                                            <span className="text-[9px] font-black text-gray-400 mb-0.5">{day}일</span>
                                            <span className={cn(
                                                "text-[10px] font-black truncate max-w-full w-full text-center px-0.5",
                                                assignedTo ? "text-yellow-700" : "text-transparent"
                                            )}>
                                                {assignedTo || '-'}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="pt-2 shrink-0 flex gap-2">
                            <button
                                onClick={handleUndo}
                                disabled={dutyHistory.length === 0}
                                className="px-6 py-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-[1.5rem] font-black text-lg shadow-sm active:scale-95 transition-all outline-none disabled:opacity-50"
                            >
                                실행 취소
                            </button>
                            <button
                                onClick={handleBatchSaveDuties}
                                disabled={isBatchSaving}
                                className={cn(
                                    "flex-1 py-4 rounded-[1.5rem] font-black text-lg transition-all outline-none",
                                    isBatchSaving
                                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                        : "bg-yellow-500 hover:bg-yellow-600 text-white shadow-xl shadow-yellow-100 active:scale-95"
                                )}
                            >
                                {isBatchSaving ? '저장 중...' : '당직 일괄 저장'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* KTA Schedule Template Modal */}
            {isKTAScheduleAdding && createPortal(
                <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-5 shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[90vh]">
                        <div className="flex items-center justify-between shrink-0">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-xl sm:text-2xl font-black text-gray-900 whitespace-nowrap">KTA 주요일정</h2>
                                    {getKtaReferenceBatch() && (
                                        <span className="text-[10px] sm:text-xs font-black text-red-600 bg-red-50 px-2 py-1 rounded-xl border border-red-100 whitespace-nowrap">
                                            {getKtaReferenceBatch()}기 {getKtaReferenceType()}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500 font-bold mt-1">Day 0부터 Day 20까지의 일정을 미리 설정합니다.</p>
                            </div>
                            <button onClick={() => setIsKTAScheduleAdding(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1 custom-scrollbar py-2 space-y-4 pr-2">
                            {ktaScheduleTemplate.map((item) => (
                                <div key={item.day} className="bg-gray-50/50 rounded-3xl p-3 sm:p-4 border border-gray-50 space-y-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-[11px] sm:text-xs font-black text-red-500 whitespace-nowrap">Day {item.day}</span>
                                            {getKtaReferenceDate() && (
                                                <span className="text-[9px] sm:text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-lg whitespace-nowrap shrink-0">
                                                    {formatDateWithDay(getKtaReferenceDate()!, item.day)}
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => addEventToTemplate(item.day)}
                                            className="text-[9px] sm:text-[10px] font-black text-red-500 bg-white px-2 py-1 rounded-lg border border-red-100 hover:bg-red-50 whitespace-nowrap"
                                        >
                                            + 일정 추가
                                        </button>
                                    </div>
                                    <div className="space-y-2">
                                        {item.events.map((evt, idx) => {
                                            const type = getKtaReferenceType();
                                            const firstPlt = type === 'A' ? '1, 2' : '3, 4';
                                            const secondPlt = type === 'A' ? '3, 4' : '1, 2';
                                            
                                            const preview = evt
                                                .replace(/{batch}/g, getKtaReferenceBatch())
                                                .replace(/{first}/g, firstPlt)
                                                .replace(/{second}/g, secondPlt);

                                            return (
                                                <div key={idx} className="space-y-1">
                                                    <div className="flex gap-2 items-center">
                                                        <div className="flex-1">
                                                            <input
                                                                type="text"
                                                                value={evt}
                                                                onChange={(e) => handleKtaTemplateChange(item.day, idx, e.target.value)}
                                                                placeholder="예: KTA {batch} PRT Demo"
                                                                className="w-full px-3 py-2 bg-white border border-gray-100 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500 transition-all"
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={() => removeEventFromTemplate(item.day, idx)}
                                                            className="p-2 text-gray-300 hover:text-red-400"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                    {evt.includes('{') && (
                                                        <p className="text-[9px] font-bold text-gray-400 ml-1 flex items-center gap-1">
                                                            <span className="text-red-300">→</span> {preview}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {item.events.length === 0 && (
                                            <p className="text-center py-2 text-[10px] text-gray-300 font-medium italic">등록된 일정이 없습니다.</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="pt-2 shrink-0">
                            <button
                                onClick={handleKtaSave}
                                disabled={isKTASaving}
                                className={cn(
                                    "w-full py-4 rounded-[1.5rem] font-black text-lg transition-all outline-none",
                                    isKTASaving
                                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                        : "bg-red-500 hover:bg-red-600 text-white shadow-xl shadow-red-100 active:scale-95"
                                )}
                            >
                                {isKTASaving ? '저장 중...' : '주요일정 템플릿 저장'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* BLC Schedule Template Modal */}
            {isBLCScheduleAdding && createPortal(
                <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-5 shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[90vh]">
                        <div className="flex items-center justify-between shrink-0">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-xl sm:text-2xl font-black text-gray-900 whitespace-nowrap">BLC 주요일정</h2>
                                    {getBlcReferenceBatch() && (
                                        <span className="text-[10px] sm:text-xs font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-xl border border-blue-100 whitespace-nowrap">
                                            {getBlcReferenceBatch()}기
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500 font-bold mt-1">Day 0부터 Day 22까지의 일정을 미리 설정합니다.</p>
                            </div>
                            <button onClick={() => setIsBLCScheduleAdding(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1 custom-scrollbar py-2 space-y-4 pr-2">
                            {blcScheduleTemplate.map((item) => (
                                <div key={item.day} className="bg-gray-50/50 rounded-3xl p-3 sm:p-4 border border-gray-50 space-y-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-[11px] sm:text-xs font-black text-blue-500 whitespace-nowrap">Day {item.day}</span>
                                            {(() => {
                                                const base = getBlcReferenceDate();
                                                if (!base) return null;
                                                
                                                // Day n에 해당하는 실제 날짜 계산 (일요일, 휴일 제외)
                                                let target = new Date(base);
                                                let workingDays = 0;
                                                
                                                // Day 0은 시작일 그대로, 그 이후부터 루프
                                                while (workingDays < item.day) {
                                                    target.setDate(target.getDate() + 1);
                                                    const tStr = target.toISOString().split('T')[0];
                                                    const isSunday = target.getDay() === 0;
                                                    if (!isSunday && !isHolidayDate(tStr)) {
                                                        workingDays++;
                                                    }
                                                }
                                                
                                                const mm = String(target.getMonth() + 1).padStart(2, '0');
                                                const dd = String(target.getDate()).padStart(2, '0');
                                                const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                                                const dayName = dayNames[target.getDay()];
                                                
                                                return (
                                                    <span className="text-[9px] sm:text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-lg whitespace-nowrap shrink-0">
                                                        {mm}.{dd}({dayName})
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                        <button
                                            onClick={() => addEventToBlcTemplate(item.day)}
                                            className="text-[9px] sm:text-[10px] font-black text-blue-500 bg-white px-2 py-1 rounded-lg border border-blue-100 hover:bg-blue-50 whitespace-nowrap"
                                        >
                                            + 일정 추가
                                        </button>
                                    </div>
                                    <div className="space-y-2">
                                        {item.events.map((evt, idx) => {
                                            const preview = evt
                                                .replace(/{batch}/g, getBlcReferenceBatch());

                                            return (
                                                <div key={idx} className="space-y-1">
                                                    <div className="flex gap-2 items-center">
                                                        <div className="flex-1">
                                                            <input
                                                                type="text"
                                                                value={evt}
                                                                onChange={(e) => handleBlcTemplateChange(item.day, idx, e.target.value)}
                                                                placeholder="예: BLC {batch} In-processing"
                                                                className="w-full px-3 py-2 bg-white border border-gray-100 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={() => removeEventFromBlcTemplate(item.day, idx)}
                                                            className="p-2 text-gray-300 hover:text-blue-400"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                    {evt.includes('{') && (
                                                        <p className="text-[9px] font-bold text-gray-400 ml-1 flex items-center gap-1">
                                                            <span className="text-blue-300">→</span> {preview}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {item.events.length === 0 && (
                                            <p className="text-center py-2 text-[10px] text-gray-300 font-medium italic">등록된 일정이 없습니다.</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="pt-2 shrink-0">
                            <button
                                onClick={handleBlcSave}
                                disabled={isBLCSaving}
                                className={cn(
                                    "w-full py-4 rounded-[1.5rem] font-black text-lg transition-all outline-none",
                                    isBLCSaving
                                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                        : "bg-blue-500 hover:bg-blue-600 text-white shadow-xl shadow-blue-100 active:scale-95"
                                )}
                            >
                                {isBLCSaving ? '저장 중...' : '주요일정 템플릿 저장'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
