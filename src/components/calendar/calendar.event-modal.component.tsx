import { createPortal } from 'react-dom';
import { X, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

interface EventModalProps {
    events: CalendarEvent[];
    members: CalendarMember[];
    currentDate: Date;
    selectedDate: string | null;
    isAdding: boolean;
    setIsAdding: (val: boolean) => void;
    setSelectedDate: (val: string | null) => void;
    activeAction: { id: string, mode: 'replace' | 'swap' } | null;
    setActiveAction: (val: { id: string, mode: 'replace' | 'swap' } | null) => void;
    editingBatch: { oldBatch: string; value: string; oldType?: 'A' | 'B'; ktaType?: 'A' | 'B' } | null;
    setEditingBatch: (val: { oldBatch: string; value: string; oldType?: 'A' | 'B'; ktaType?: 'A' | 'B' } | null) => void;
    editingHoliday: { id: string; name: string; startDate: string; endDate: string } | null;
    setEditingHoliday: (val: { id: string; name: string; startDate: string; endDate: string } | null) => void;
    
    isHolidayNaming: boolean;
    setIsHolidayNaming: (val: boolean) => void;
    holidayName: string;
    setHolidayName: (val: string) => void;
    holidayStartDate: string;
    setHolidayStartDate: (val: string) => void;
    holidayEndDate: string;
    setHolidayEndDate: (val: string) => void;

    // Handlers
    handleAddHoliday: () => void;
    handleUpdateHoliday: (id: string) => void;
    handleAutoKtaDay0: () => void;
    handleAutoBlcDay0: () => void;
    handleAddDuty: (date: string, name: string) => void;
    handleDeleteEvent: (id: string) => void;
    handleUpdateBatch: (oldBatch: string, newBatch: string, newType?: 'A' | 'B') => void;
    handleUpdateBlcBatch: (oldBatch: string, newBatch: string) => void;
    handleReplace: (eventId: string, newName: string) => void;
    handleRealSwap: (id1: string, name1: string, id2: string, name2: string) => void;
    
    isKTASaving: boolean;
    isBLCSaving: boolean;
    calendarMode: 'schedule' | 'duty';
}

export function EventModal(props: EventModalProps) {
    if (!props.isAdding) return null;

    const isDateInRange = (dateStr: string, start: string, end: string) => dateStr >= start && dateStr <= end;

    const getEventsForDate = (dateStr: string) => {
        const baseEvents = props.events.filter(e => isDateInRange(dateStr, e.startDate, e.endDate));
        const blcDay0s = props.events.filter(e => e.type === 'blc' && e.memo?.includes('Day 0'));
        const dynamicBlcEvents: CalendarEvent[] = [];

        blcDay0s.forEach(day0 => {
            const start = new Date(day0.startDate);
            const batch = day0.batch || "";
            let dayCount = 0;
            let current = new Date(start);

            const isHolidayDateLocal = (dStr: string) => {
                return props.events.some(e => e.type === 'holiday' && e.holidayType !== 'duty' && dStr >= e.startDate && dStr <= e.endDate);
            };

            while (dayCount < 22) {
                current.setDate(current.getDate() + 1);
                const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                const isSunday = current.getDay() === 0;

                if (!isSunday && !isHolidayDateLocal(currentStr)) {
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

        const allEvents = [
            ...baseEvents.filter(e => !(e.type === 'blc' && !e.memo?.includes('Day 0'))),
            ...dynamicBlcEvents
        ];

        let filtered: CalendarEvent[] = [];
        if (props.calendarMode === 'duty') {
            filtered = allEvents.filter(e => {
                if (e.type === 'duty' || (e.type === 'holiday' && e.holidayType === 'duty')) {
                    return true;
                }
                if (e.type === 'kta' || e.type === 'blc') {
                    return e.memo?.includes('Day 0') || e.memo?.includes('Graduation') || e.memo?.includes('수료') || e.memo?.includes('🎓');
                }
                return false;
            });
        } else {
            filtered = allEvents.filter(e => e.type !== 'duty' && e.holidayType !== 'duty');
        }

        const order = { duty: 1, blc: 2, holiday: 2, kta: 3 };
        return filtered.sort((a, b) => (order[a.type as keyof typeof order] || 0) - (order[b.type as keyof typeof order] || 0));
    };

    return createPortal(
        <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-5 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-2xl font-black text-gray-900">
                            {props.selectedDate?.split('-')[1]}월 {props.selectedDate?.split('-')[2]}일
                        </h2>
                        <p className="text-sm text-gray-500 font-bold mt-1">이 날짜의 일정을 관리합니다.</p>
                    </div>
                    <button onClick={() => {
                        props.setIsAdding(false);
                        props.setSelectedDate(null);
                        props.setIsHolidayNaming(false);
                    }} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <div className="space-y-4 overflow-y-auto flex-1 custom-scrollbar pr-2 py-2">
                    {props.selectedDate && getEventsForDate(props.selectedDate).map(e => (
                        <div key={e.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            "text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider",
                                            e.type === 'duty' ? "bg-yellow-200 text-yellow-800" :
                                                e.type === 'kta' ? "bg-red-200 text-red-800" :
                                                    e.type === 'blc' ? "bg-blue-200 text-blue-800" :
                                                        "bg-purple-200 text-purple-800"
                                        )}>
                                            {e.type}
                                        </span>
                                        {e.batch && (
                                            <span className="text-[10px] font-bold text-gray-400">
                                                {e.batch}기 {e.ktaType || ''}
                                            </span>
                                        )}
                                    </div>

                                    {/* Edit Modals for Event */}
                                    <div className="mt-2">
                                        {e.type === 'holiday' && props.editingHoliday?.id === e.id ? (
                                            <div className="space-y-2 mt-1">
                                                <input
                                                    type="text"
                                                    value={props.editingHoliday.name}
                                                    onChange={(ev) => props.setEditingHoliday({ ...props.editingHoliday!, name: ev.target.value })}
                                                    className="w-full px-2 py-1 bg-white border border-purple-200 rounded-lg text-[10px] font-bold focus:outline-none focus:ring-2 focus:ring-purple-500"
                                                    placeholder="휴일 이름"
                                                />
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="date"
                                                        value={props.editingHoliday.startDate}
                                                        onChange={(ev) => props.setEditingHoliday({ ...props.editingHoliday!, startDate: ev.target.value })}
                                                        className="flex-1 min-w-0 px-1 py-1 bg-white border border-purple-200 rounded-lg text-[9px] font-bold tracking-tighter"
                                                    />
                                                    <span className="text-gray-400 shrink-0 text-xs">~</span>
                                                    <input
                                                        type="date"
                                                        value={props.editingHoliday.endDate}
                                                        onChange={(ev) => props.setEditingHoliday({ ...props.editingHoliday!, endDate: ev.target.value })}
                                                        className="flex-1 min-w-0 px-1 py-1 bg-white border border-purple-200 rounded-lg text-[9px] font-bold tracking-tighter"
                                                    />
                                                </div>
                                                <div className="flex gap-2 pt-1">
                                                    <button onClick={() => props.handleUpdateHoliday(e.id)} className="flex-1 py-1 bg-purple-600 text-white rounded-lg text-xs font-black">저장</button>
                                                    <button onClick={() => props.setEditingHoliday(null)} className="flex-1 py-1 bg-gray-100 text-gray-500 rounded-lg text-xs font-black">취소</button>
                                                </div>
                                            </div>
                                        ) : e.type === 'kta' && e.batch && props.editingBatch?.oldBatch === e.batch ? (
                                            <div className="flex items-center gap-1.5 mt-1 min-w-0">
                                                <input
                                                    type="text"
                                                    value={props.editingBatch.value}
                                                    onChange={(ev) => props.setEditingBatch({ ...props.editingBatch!, value: ev.target.value })}
                                                    className="px-2 py-1 bg-white border border-red-200 rounded-lg text-[11px] font-black text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 w-[70px] shrink-0"
                                                    autoFocus
                                                />
                                                <select
                                                    value={props.editingBatch.ktaType}
                                                    onChange={(ev) => props.setEditingBatch({ ...props.editingBatch!, ktaType: ev.target.value as 'A' | 'B' })}
                                                    className="px-1.5 py-1 bg-white border border-red-200 rounded-lg text-[11px] font-black text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 shrink-0"
                                                >
                                                    <option value="A">A</option>
                                                    <option value="B">B</option>
                                                </select>
                                                <button
                                                    onClick={() => props.handleUpdateBatch(props.editingBatch!.oldBatch, props.editingBatch!.value, props.editingBatch!.ktaType)}
                                                    className="px-2 py-1 bg-red-600 text-white rounded-lg text-[10px] font-black hover:bg-red-700 transition-all whitespace-nowrap shrink-0"
                                                >
                                                    저장
                                                </button>
                                                <button
                                                    onClick={() => props.setEditingBatch(null)}
                                                    className="px-2 py-1 bg-white border border-gray-200 text-gray-500 rounded-lg text-[10px] font-black hover:bg-gray-50 transition-all whitespace-nowrap shrink-0"
                                                >
                                                    취소
                                                </button>
                                            </div>
                                        ) : e.type === 'blc' && e.batch && props.editingBatch?.oldBatch === e.batch ? (
                                            <div className="flex items-center gap-1.5 mt-1 min-w-0">
                                                <input
                                                    type="text"
                                                    value={props.editingBatch.value}
                                                    onChange={(ev) => props.setEditingBatch({ ...props.editingBatch!, value: ev.target.value })}
                                                    className="px-2 py-1 bg-white border border-blue-200 rounded-lg text-[11px] font-black text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[70px] shrink-0"
                                                    autoFocus
                                                />
                                                <button
                                                    onClick={() => props.handleUpdateBlcBatch(props.editingBatch!.oldBatch, props.editingBatch!.value)}
                                                    className="px-2 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-700 transition-all whitespace-nowrap shrink-0"
                                                >
                                                    저장
                                                </button>
                                                <button
                                                    onClick={() => props.setEditingBatch(null)}
                                                    className="px-2 py-1 bg-white border border-gray-200 text-gray-500 rounded-lg text-[10px] font-black hover:bg-gray-50 transition-all whitespace-nowrap shrink-0"
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
                                {props.editingHoliday?.id !== e.id && (
                                    <div className="flex items-center gap-1">
                                        {e.type === 'holiday' && (
                                            <button
                                                onClick={() => props.setEditingHoliday({ id: e.id, name: e.memo, startDate: e.startDate, endDate: e.endDate })}
                                                className="px-2 py-1.5 bg-white border border-gray-100 text-gray-600 rounded-lg text-[10px] font-black hover:bg-gray-50 transition-all"
                                            >
                                                기간/이름 수정
                                            </button>
                                        )}
                                        {e.type === 'kta' && e.batch && !props.editingBatch && (
                                            <button
                                                onClick={() => props.setEditingBatch({ oldBatch: e.batch!, value: e.batch!, oldType: e.ktaType || 'A', ktaType: e.ktaType || 'A' })}
                                                className="px-2 py-1.5 bg-white border border-red-100 text-red-600 rounded-lg text-[10px] font-black hover:bg-red-50 transition-all"
                                            >
                                                기수 수정
                                            </button>
                                        )}
                                        {e.type === 'blc' && e.batch && !props.editingBatch && (
                                            <button
                                                onClick={() => props.setEditingBatch({ oldBatch: e.batch!, value: e.batch!, oldType: 'A', ktaType: 'A' })}
                                                className="px-2 py-1.5 bg-white border border-blue-100 text-blue-600 rounded-lg text-[10px] font-black hover:bg-blue-50 transition-all"
                                            >
                                                기수 수정
                                            </button>
                                        )}
                                        {e.type === 'duty' && (
                                            <>
                                                <button
                                                    onClick={() => props.setActiveAction(props.activeAction?.id === e.id && props.activeAction.mode === 'replace' ? null : { id: e.id, mode: 'replace' })}
                                                    className={cn(
                                                        "px-2 py-1.5 rounded-lg text-[10px] font-black transition-all",
                                                        props.activeAction?.id === e.id && props.activeAction.mode === 'replace' ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-blue-600 hover:bg-blue-50"
                                                    )}
                                                >
                                                    대체
                                                </button>
                                                <button
                                                    onClick={() => props.setActiveAction(props.activeAction?.id === e.id && props.activeAction.mode === 'swap' ? null : { id: e.id, mode: 'swap' })}
                                                    className={cn(
                                                        "px-2 py-1.5 rounded-lg text-[10px] font-black transition-all",
                                                        props.activeAction?.id === e.id && props.activeAction.mode === 'swap' ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-indigo-600 hover:bg-indigo-50"
                                                    )}
                                                >
                                                    교환
                                                </button>
                                            </>
                                        )}
                                        <button onClick={() => props.handleDeleteEvent(e.id)} className="p-2 text-gray-300 hover:text-red-500">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {props.activeAction?.id === e.id && (
                                <div className="pt-2 border-t border-gray-100 animate-in fade-in slide-in-from-top-2">
                                    {props.activeAction.mode === 'replace' ? (
                                        <div className="grid grid-cols-4 gap-1">
                                            {props.members.map(m => (
                                                <button
                                                    key={m.id}
                                                    onClick={() => props.handleReplace(e.id, m.name)}
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
                                                {props.events.filter(other => {
                                                    if (other.type !== 'duty' || other.id === e.id) return false;
                                                    const otherDate = new Date(other.startDate);
                                                    return otherDate.getFullYear() === props.currentDate.getFullYear() &&
                                                        otherDate.getMonth() === props.currentDate.getMonth();
                                                }).sort((a, b) => a.startDate.localeCompare(b.startDate)).map(other => (
                                                    <button
                                                        key={other.id}
                                                        onClick={() => props.handleRealSwap(e.id, e.memo, other.id, other.memo)}
                                                        className="py-2.5 px-3 bg-white border border-gray-100 rounded-xl text-[10px] font-bold text-left hover:border-indigo-300 hover:bg-indigo-50 transition-all flex flex-col"
                                                    >
                                                        <span className="text-[8px] text-indigo-400">{other.startDate}</span>
                                                        <span className="truncate">{other.memo}</span>
                                                    </button>
                                                ))}
                                                {props.events.filter(other => {
                                                    if (other.type !== 'duty' || other.id === e.id) return false;
                                                    const otherDate = new Date(other.startDate);
                                                    return otherDate.getFullYear() === props.currentDate.getFullYear() &&
                                                        otherDate.getMonth() === props.currentDate.getMonth();
                                                }).length === 0 && (
                                                    <div className="col-span-2 py-4 text-center text-[10px] text-gray-400 font-medium italic">이달 내 교환 가능한 다른 당직이 없습니다.</div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Duty assignment UI if empty */}
                {props.calendarMode === 'duty' && props.selectedDate && getEventsForDate(props.selectedDate).filter(e => e.type === 'duty').length === 0 && (
                    <div className="pt-4 border-t border-gray-100 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-gray-900 ml-1">당직 지정</h3>
                            <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded-lg">비어있음</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                            {props.members.map(m => (
                                <button
                                    key={m.id}
                                    onClick={() => props.handleAddDuty(props.selectedDate!, m.name)}
                                    className="py-2.5 bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 border border-transparent rounded-xl text-[10px] font-black transition-all truncate px-1"
                                >
                                    {m.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="pt-4 border-t border-gray-100 shrink-0">
                    {props.isHolidayNaming ? (
                        <div className="space-y-3 animate-in slide-in-from-bottom-2">
                            <div>
                                <label className="text-[10px] text-gray-500 font-bold ml-1 mb-1 block">휴일 이름</label>
                                <input
                                    type="text"
                                    placeholder="예: 어린이날, 추석 연휴"
                                    value={props.holidayName}
                                    onChange={(e) => props.setHolidayName(e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                                    autoFocus
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="min-w-0">
                                    <label className="text-[10px] text-gray-500 font-bold ml-1 mb-1 block">시작일</label>
                                    <input
                                        type="date"
                                        value={props.holidayStartDate}
                                        onChange={(e) => props.setHolidayStartDate(e.target.value)}
                                        className="w-full px-2 sm:px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-[11px] sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                                    />
                                </div>
                                <div className="min-w-0">
                                    <label className="text-[10px] text-gray-500 font-bold ml-1 mb-1 block">종료일</label>
                                    <input
                                        type="date"
                                        value={props.holidayEndDate}
                                        onChange={(e) => props.setHolidayEndDate(e.target.value)}
                                        className="w-full px-2 sm:px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-[11px] sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button onClick={() => { props.setIsHolidayNaming(false); props.setHolidayName(''); props.setHolidayEndDate(''); }} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-2xl text-xs font-black">취소</button>
                                <button onClick={props.handleAddHoliday} className="flex-1 py-3 bg-purple-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-purple-100">등록</button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => {
                                    props.setIsHolidayNaming(true);
                                    props.setHolidayStartDate(props.selectedDate || '');
                                    props.setHolidayEndDate(props.selectedDate || '');
                                }}
                                className="flex-1 py-3 bg-purple-50 text-purple-600 rounded-2xl text-xs font-black hover:bg-purple-100 transition-colors"
                            >
                                {props.calendarMode === 'duty' ? '당직용 휴일 추가' : 'BLC 기수용 휴일 추가'}
                            </button>
                            {props.calendarMode === 'schedule' && props.selectedDate && new Date(props.selectedDate).getDay() === 4 && (
                                <button
                                    onClick={props.handleAutoKtaDay0}
                                    disabled={props.isKTASaving}
                                    className="flex-1 py-3 bg-red-50 text-red-600 rounded-2xl text-xs font-black hover:bg-red-100 transition-colors disabled:opacity-50"
                                >
                                    KTA Day 0
                                </button>
                            )}
                            {props.calendarMode === 'schedule' && (
                                <button
                                    onClick={props.handleAutoBlcDay0}
                                    disabled={props.isBLCSaving}
                                    className="flex-1 py-3 bg-blue-50 text-blue-600 rounded-2xl text-xs font-black hover:bg-blue-100 transition-colors disabled:opacity-50"
                                >
                                    BLC Day 0
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
