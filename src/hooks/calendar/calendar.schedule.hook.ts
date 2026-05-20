import { useState } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import type { CalendarEvent } from '../../types/calendar/calendar.type';

export function useCalendarSchedule(
    events: CalendarEvent[],
    currentDate: Date
) {
    const [isAdding, setIsAdding] = useState(false);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [activeAction, setActiveAction] = useState<{ id: string, mode: 'replace' | 'swap' } | null>(null);
    const [editingBatch, setEditingBatch] = useState<{ oldBatch: string; value: string; oldType?: 'A' | 'B'; ktaType?: 'A' | 'B' } | null>(null);

    const [isBatchDutyAdding, setIsBatchDutyAdding] = useState(false);
    const [isBatchSaving, setIsBatchSaving] = useState(false);
    const [dutyHistory, setDutyHistory] = useState<string[]>([]);

    const [holidayName, setHolidayName] = useState('');
    const [holidayStartDate, setHolidayStartDate] = useState('');
    const [holidayEndDate, setHolidayEndDate] = useState('');
    const [isHolidayNaming, setIsHolidayNaming] = useState(false);
    const [editingHoliday, setEditingHoliday] = useState<{ id: string; name: string; startDate: string; endDate: string } | null>(null);

    const isHolidayDate = (dateStr: string) => {
        return events.some(e => e.type === 'holiday' && dateStr >= e.startDate && dateStr <= e.endDate);
    };

    const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

    const handleAutoKtaDay0 = async () => {
        if (!selectedDate) return;
        const user = auth.currentUser;
        if (!user) return;

        const selectedStart = new Date(selectedDate);
        const proposedEnd = new Date(selectedStart);
        proposedEnd.setDate(selectedStart.getDate() + 20);

        const isOverlapping = events.some(e => {
            if (e.type !== 'kta' || !e.memo?.includes('Day 0')) return false;
            const existingStart = new Date(e.startDate);
            const existingEnd = new Date(existingStart);
            existingEnd.setDate(existingStart.getDate() + 20);
            return existingStart <= proposedEnd && selectedStart <= existingEnd;
        });

        if (isOverlapping) {
            alert("새로 생성될 KTA 기간이 이미 등록된 KTA 기수 기간과 겹칩니다.");
            return;
        }

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

        try {
            const startDate = new Date(selectedDate);
            const addPromises: Promise<any>[] = [];
            const day0DateStr = selectedDate;

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
        }
    };

    const handleAutoBlcDay0 = async () => {
        if (!selectedDate) return;
        const user = auth.currentUser;
        if (!user) return;

        const selectedStart = new Date(selectedDate);
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
            return existingStart <= proposedEnd && selectedStart <= existingEnd;
        });

        if (isOverlapping) {
            alert("새로 생성될 BLC 기간이 이미 등록된 BLC 기수 기간과 겹칩니다.");
            return;
        }

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

        try {
            await addDoc(collection(db, "schedules"), {
                uid: user.uid,
                type: 'blc',
                startDate: selectedDate,
                endDate: selectedDate,
                memo: `Day 0 (${nextBatch})`,
                batch: nextBatch,
                createdAt: serverTimestamp()
            });
            setIsAdding(false);
            setSelectedDate(null);
        } catch (error) {
            console.error("Error auto-setting BLC Day 0:", error);
            alert("BLC 일정 등록 중 오류가 발생했습니다.");
        }
    };

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

                if (targetBatchStr.includes('-')) {
                    const parts = targetBatchStr.split('-');
                    let num = parseInt(parts[0], 10);
                    let year = parseInt(parts[1], 10);
                    if (!isNaN(num) && !isNaN(year)) {
                        num += 1;
                        if (num > 12) { num = 1; year += 1; }
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
                        if (newMemo.includes(`(${oldFull})`)) newMemo = newMemo.replace(`(${oldFull})`, `(${newFull})`);
                        else if (newMemo.includes(`(${originalBatchStr})`)) newMemo = newMemo.replace(`(${originalBatchStr})`, `(${newFull})`);
                        else if (newMemo.includes(oldFull)) newMemo = newMemo.replace(oldFull, newFull);
                        else if (newMemo.includes(originalBatchStr)) newMemo = newMemo.replace(originalBatchStr, newFull);
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

            if (modIndex === -1) return;

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
                        if (num > 12) { num = 1; year += 1; }
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

    const handleReplace = async (eventId: string, newName: string) => {
        setIsAdding(false);
        setSelectedDate(null);
        setActiveAction(null);
        try {
            await updateDoc(doc(db, "schedules", eventId), { memo: newName });
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
            if (duty) newHistory[d - 1] = duty.memo;
            else newHistory[d - 1] = '';
        }

        while (newHistory.length > 0 && newHistory[newHistory.length - 1] === '') {
            newHistory.pop();
        }

        setDutyHistory(newHistory);
        setIsBatchDutyAdding(true);
    };

    const handleBatchSaveDuties = async () => {
        if (isBatchSaving) return;
        const user = auth.currentUser;
        if (!user) return;

        setIsBatchSaving(true);
        try {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const currentMonthDuties = events.filter(e => {
                if (e.type !== 'duty') return false;
                const eDate = new Date(e.startDate);
                return eDate.getFullYear() === year && eDate.getMonth() === month;
            });

            if (currentMonthDuties.length > 0) {
                await Promise.all(currentMonthDuties.map(d => deleteDoc(doc(db, "schedules", d.id))));
            }

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

            if (addPromises.length > 0) await Promise.all(addPromises);
            setIsBatchSaving(false);
            setIsBatchDutyAdding(false);
            setDutyHistory([]);
        } catch (error) {
            console.error("Error setting batch duties:", error);
            alert("당직 일괄 저장 중 오류가 발생했습니다.");
            setIsBatchSaving(false);
        }
    };

    return {
        // Modal States
        isAdding, setIsAdding,
        selectedDate, setSelectedDate,
        activeAction, setActiveAction,
        editingBatch, setEditingBatch,
        isBatchDutyAdding, setIsBatchDutyAdding,
        isBatchSaving, setIsBatchSaving,
        dutyHistory, setDutyHistory,
        holidayName, setHolidayName,
        holidayStartDate, setHolidayStartDate,
        holidayEndDate, setHolidayEndDate,
        isHolidayNaming, setIsHolidayNaming,
        editingHoliday, setEditingHoliday,
        
        // Handlers
        handleAutoKtaDay0,
        handleAutoBlcDay0,
        handleAddDuty,
        handleAddHoliday,
        handleUpdateHoliday,
        handleDeleteEvent,
        handleUpdateBatch,
        handleUpdateBlcBatch,
        handleReplace,
        handleRealSwap,
        openBatchDutyModal,
        handleBatchSaveDuties
    };
}
