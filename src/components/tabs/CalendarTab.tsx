import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
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

    // Form states
    const [type, setType] = useState<'vacation' | 'pass'>('vacation');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [memo, setMemo] = useState('');

    // Duty states
    const [isBatchDutyAdding, setIsBatchDutyAdding] = useState(false);
    const [dutyHistory, setDutyHistory] = useState<string[]>([]);
    
    // Members state
    const [members, setMembers] = useState<{ id: string; name: string; enlistmentDate: string }[]>([]);

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) return;

        const q = query(
            collection(db, "schedules"),
            where("uid", "==", user.uid)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Event[];
            setEvents(data);
        });

        const qMembers = query(collection(db, 'members'));
        const unsubscribeMembers = onSnapshot(qMembers, (snapshot) => {
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

        return () => {
            unsubscribe();
            unsubscribeMembers();
        };
    }, []);

    const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));

    const handleAddEvent = async () => {
        const user = auth.currentUser;
        if (!user || !startDate || !endDate) return;

        try {
            await addDoc(collection(db, "schedules"), {
                uid: user.uid,
                type,
                startDate,
                endDate,
                memo,
                createdAt: serverTimestamp()
            });
            setIsAdding(false);
            setStartDate('');
            setEndDate('');
            setMemo('');
            setSelectedDate(null);
        } catch (error) {
            console.error("Error adding event:", error);
            alert("저장 중 오류가 발생했습니다.");
        }
    };

    const handleDeleteEvent = async (id: string) => {
        if (!confirm("일정을 삭제하시겠습니까?")) return;
        try {
            await deleteDoc(doc(db, "schedules", id));
        } catch (error) {
            console.error("Error deleting event:", error);
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
        const user = auth.currentUser;
        if (!user) return;

        try {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const batchPromises = [];
            
            // Find and delete existing duties for this month to overwrite
            const currentMonthDuties = events.filter(e => {
                if (e.type !== 'duty') return false;
                const eYear = new Date(e.startDate).getFullYear();
                const eMonth = new Date(e.startDate).getMonth();
                return eYear === year && eMonth === month;
            });
            for (const d of currentMonthDuties) {
                batchPromises.push(deleteDoc(doc(db, "schedules", d.id)));
            }

            for (let i = 0; i < dutyHistory.length; i++) {
                const name = dutyHistory[i];
                if (name && name.trim()) {
                    const d = i + 1;
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    batchPromises.push(addDoc(collection(db, "schedules"), {
                        uid: user.uid,
                        type: 'duty',
                        startDate: dateStr,
                        endDate: dateStr,
                        memo: name.trim(),
                        createdAt: serverTimestamp()
                    }));
                }
            }
            await Promise.all(batchPromises);
            setIsBatchDutyAdding(false);
            setDutyHistory([]);
        } catch (error) {
            console.error("Error setting batch duties:", error);
            alert("당직 일괄 저장 중 오류가 발생했습니다.");
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
                        setStartDate(dateStr);
                        setEndDate(dateStr);
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
                    당직 등록하기
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
                                <div key={e.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                    <div className="flex items-center gap-3">
                                        <div className={cn("w-2 h-2 rounded-full", e.type === 'vacation' ? "bg-blue-500" : e.type === 'duty' ? "bg-yellow-500" : "bg-indigo-500")} />
                                        <div>
                                            <div className="font-black text-sm text-gray-900">{e.type === 'vacation' ? '휴가' : e.type === 'duty' ? '당직' : '외박'}</div>
                                            <div className="text-[10px] font-bold text-gray-400">{e.startDate} ~ {e.endDate}</div>
                                            {e.memo && <div className="text-xs text-gray-500 font-medium mt-0.5">{e.memo}</div>}
                                        </div>
                                    </div>
                                    <button onClick={() => handleDeleteEvent(e.id)} className="p-2 text-gray-300 hover:text-red-500">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="h-px bg-gray-100" />

                        <div className="space-y-4">
                            <div className="flex p-1 bg-gray-50 rounded-2xl">
                                <button onClick={() => setType('vacation')} className={cn("flex-1 py-3 rounded-xl font-bold text-sm transition-all", type === 'vacation' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400")}>휴가</button>
                                <button onClick={() => setType('pass')} className={cn("flex-1 py-3 rounded-xl font-bold text-sm transition-all", type === 'pass' ? "bg-white text-indigo-600 shadow-sm" : "text-gray-400")}>외박</button>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-gray-400 ml-1 uppercase">시작일</label>
                                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-4 py-3 bg-gray-50 rounded-2xl border-none font-bold text-sm outline-none" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-gray-400 ml-1 uppercase">종료일</label>
                                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-4 py-3 bg-gray-50 rounded-2xl border-none font-bold text-sm outline-none" />
                                </div>
                            </div>

                            <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 입력 (선택사항)" className="w-full px-4 py-4 bg-gray-50 rounded-2xl border-none font-bold text-sm outline-none" />

                            <button onClick={handleAddEvent} className="w-full py-4 bg-blue-600 text-white rounded-[1.5rem] font-black text-lg shadow-xl shadow-blue-100 active:scale-95 transition-all">
                                일정 저장하기
                            </button>
                        </div>
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
                            <button onClick={handleBatchSaveDuties} className="flex-1 py-4 bg-yellow-500 hover:bg-yellow-600 text-white rounded-[1.5rem] font-black text-lg shadow-xl shadow-yellow-100 active:scale-95 transition-all outline-none">
                                당직 일괄 저장
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
