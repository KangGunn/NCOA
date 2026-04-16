import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { Trash2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Event {
    id: string;
    type: 'vacation' | 'pass' | 'duty';
    startDate: string;
    endDate: string;
    memo: string;
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

    // Members state
    const [members, setMembers] = useState<{ id: string; name: string; enlistmentDate: string }[]>([]);

    useEffect(() => {
        let unsubscribeSchedules: () => void = () => { };
        let unsubscribeMembers: () => void = () => { };

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
            } else {
                setEvents([]);
                setMembers([]);
            }
        });

        return () => {
            authUnsubscribe();
            unsubscribeSchedules();
            unsubscribeMembers();
        };
    }, []);

    const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

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

    const handleDeleteEvent = async (id: string) => {
        if (!confirm("일정을 삭제하시겠습니까?")) return;
        
        setIsAdding(false);
        setSelectedDate(null);

        try {
            await deleteDoc(doc(db, "schedules", id));
        } catch (error) {
            console.error("Error deleting event:", error);
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
            const addPromises = [];
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

    const isDateInRange = (dateStr: string, start: string, end: string) => {
        return dateStr >= start && dateStr <= end;
    };

    const getEventsForDate = (dateStr: string) => {
        return events.filter(e => isDateInRange(dateStr, e.startDate, e.endDate));
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
        const days = [];

        // Empty cells for previous month
        for (let i = 0; i < startDay; i++) {
            days.push(<div key={`empty-${i}`} className="h-24 sm:h-32" />);
        }

        // Days of current month
        for (let d = 1; d <= totalDays; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dateEvents = getEventsForDate(dateStr);
            const isToday = new Date().toISOString().split('T')[0] === dateStr;

            days.push(
                <div
                    key={d}
                    onClick={() => {
                        setSelectedDate(dateStr);
                        setIsAdding(true);
                    }}
                    className={cn(
                        "h-24 sm:h-32 p-1 border-t border-gray-50 flex flex-col gap-1 transition-all cursor-pointer hover:bg-blue-50/30",
                        selectedDate === dateStr && "bg-blue-50/50"
                    )}
                >
                    <span className={cn(
                        "text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mt-1 ml-1",
                        isToday ? "bg-blue-600 text-white" : "text-gray-400"
                    )}>
                        {d}
                    </span>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                        {dateEvents.map((e) => (
                            <div
                                key={e.id}
                                className={cn(
                                    "text-[8.5px] font-black px-1 py-0.5 rounded truncate leading-tight",
                                    e.type === 'vacation' ? "bg-blue-100 text-blue-700" :
                                        e.type === 'duty' ? "bg-yellow-100 text-yellow-700" : "bg-indigo-100 text-indigo-700"
                                )}
                            >
                                {e.type === 'vacation' ? '휴가' : e.type === 'duty' ? e.memo : '외박'}
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

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
                <div className="grid grid-cols-7 border-collapse">
                    {days}
                </div>
            </div>
        );
    };

    return (
        <div className="pt-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            {renderHeader()}

            {renderCalendar()}

            <div className="flex justify-end mt-4 px-1">
                <button
                    onClick={openBatchDutyModal}
                    className="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-2xl font-black text-sm shadow-xl shadow-yellow-100 active:scale-95 transition-all outline-none"
                >
                    당직 일괄 등록하기
                </button>
            </div>

            {/* Event Detail / Modal */}
            {isAdding && (
                <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-6 shadow-2xl animate-in slide-in-from-bottom-10">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-black text-gray-900">일정 상세보기</h2>
                            <button onClick={() => { setIsAdding(false); setSelectedDate(null); }} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        {/* Event List for Selected Date */}
                        <div className="space-y-3">
                            {selectedDate && getEventsForDate(selectedDate).map(e => (
                                <div key={e.id} className="flex flex-col gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={cn("w-2 h-2 rounded-full", e.type === 'vacation' ? "bg-blue-500" : e.type === 'duty' ? "bg-yellow-500" : "bg-indigo-500")} />
                                            <div>
                                                <div className="font-black text-sm text-gray-900">{e.type === 'vacation' ? '휴가' : e.type === 'duty' ? '당직' : '외박'}</div>
                                                {e.memo && <div className="text-xs text-gray-500 font-medium mt-0.5">{e.memo}</div>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
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
                                                        {events.filter(other => other.type === 'duty' && other.id !== e.id).sort((a,b) => a.startDate.localeCompare(b.startDate)).map(other => (
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
                    </div>
                </div>
            )}

            {/* Batch Duty Modal */}
            {isBatchDutyAdding && (
                <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
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
                </div>
            )}
        </div>
    );
}
