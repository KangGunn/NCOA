import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DndContext, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { DraggableEventItem, DroppableDayZone } from './calendar.dnd.component.tsx';
import { sortedWithIndex, formatDateWithDay } from '../../utils/calendar.utils';
import type { ScheduleTemplateDay } from '../../types/calendar/calendar.type';

interface KtaTemplateModalProps {
    isKTAScheduleAdding: boolean;
    setIsKTAScheduleAdding: (val: boolean) => void;
    ktaScheduleTemplate: ScheduleTemplateDay[];
    handleKtaDragEnd: (event: DragEndEvent) => void;
    handleKtaTemplateChange: (day: number, eventIndex: number, value: string) => void;
    addEventToTemplate: (day: number) => void;
    removeEventFromTemplate: (day: number, index: number) => void;
    handleKtaSave: (dayLabels?: Record<number, string>) => void;
    isKTASaving: boolean;
    ktaReferenceBatch: string;
    ktaReferenceType: string;
    ktaReferenceDate: Date | null;
    ktaDayLabels?: Record<number, string>;
}

export function KtaTemplateModal({
    isKTAScheduleAdding, setIsKTAScheduleAdding,
    ktaScheduleTemplate, handleKtaDragEnd, handleKtaTemplateChange,
    addEventToTemplate, removeEventFromTemplate,
    handleKtaSave, isKTASaving,
    ktaReferenceBatch, ktaReferenceType, ktaReferenceDate,
    ktaDayLabels
}: KtaTemplateModalProps) {
    const dndSensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
    );

    const [localDayLabels, setLocalDayLabels] = useState<Record<number, string>>({});
    const [newDay, setNewDay] = useState('');
    const [newText, setNewText] = useState('');

    useEffect(() => {
        if (isKTAScheduleAdding) {
            setLocalDayLabels(ktaDayLabels || {});
        }
    }, [isKTAScheduleAdding, ktaDayLabels]);

    if (!isKTAScheduleAdding) return null;

    return createPortal(
        <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-5 shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl sm:text-2xl font-black text-gray-900 whitespace-nowrap">KTA 주요일정</h2>
                            {ktaReferenceBatch && (
                                <span className="text-[10px] sm:text-xs font-black text-red-650 bg-red-50 px-2 py-1 rounded-xl border border-red-100 whitespace-nowrap animate-pulse">
                                    {ktaReferenceBatch}기 {ktaReferenceType}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 font-bold mt-1">Day 0부터 Day 20까지의 일정을 미리 설정합니다.</p>
                    </div>
                    <button onClick={() => setIsKTAScheduleAdding(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <DndContext sensors={dndSensors} onDragEnd={handleKtaDragEnd}>
                    <div className="overflow-y-auto flex-1 custom-scrollbar py-2 space-y-4 pr-2">
                        {ktaScheduleTemplate.map((item) => (
                            <DroppableDayZone key={item.day} id={`kta-day-${item.day}`} color="red">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-[11px] sm:text-xs font-black text-red-500 whitespace-nowrap">Day {item.day}</span>
                                        {ktaReferenceDate && (
                                            <span className="text-[9px] sm:text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-lg whitespace-nowrap shrink-0">
                                                {formatDateWithDay(ktaReferenceDate, item.day)}
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
                                    {sortedWithIndex(item.events).map(({ evt, oi }) => {
                                        const type = ktaReferenceType;
                                        const firstPlt = type === 'A' ? '1, 2' : '3, 4';
                                        const secondPlt = type === 'A' ? '3, 4' : '1, 2';
                                        const preview = evt
                                            .replace(/{batch}/g, ktaReferenceBatch)
                                            .replace(/{first}/g, firstPlt)
                                            .replace(/{second}/g, secondPlt);

                                        return (
                                            <DraggableEventItem key={`kta-${item.day}-${oi}`} id={`kta-${item.day}-${oi}`}>
                                                <div className="space-y-1">
                                                    <div className="flex gap-1 items-center">
                                                        <div className="flex-1">
                                                            <input
                                                                type="text"
                                                                value={evt}
                                                                onChange={(e) => handleKtaTemplateChange(item.day, oi, e.target.value)}
                                                                placeholder="예: 0700 KTA {batch} PRT Demo"
                                                                className="w-full px-2.5 py-1.5 bg-white border border-gray-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-500 transition-all"
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={() => removeEventFromTemplate(item.day, oi)}
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
                                            </DraggableEventItem>
                                        );
                                    })}
                                    {item.events.length === 0 && (
                                        <p className="text-center py-2 text-[10px] text-gray-300 font-medium italic">등록된 일정이 없습니다.</p>
                                    )}
                                </div>
                            </DroppableDayZone>
                        ))}

                        {/* Day 커스텀 배지 라벨 설정 Section */}
                        <div className="p-5 bg-red-50/30 border border-red-100 rounded-3xl space-y-3 shrink-0 mt-6 shadow-sm">
                            <h4 className="text-xs font-black text-red-650 tracking-wider flex items-center gap-1.5">🏷️ Day 커스텀 배지 라벨 설정</h4>
                            <p className="text-[10px] text-gray-500 font-bold leading-normal">표준 일정의 특정 Day 날짜 오른쪽에 표시할 붉은색 배지 라벨을 지정합니다. (예: Day 12 &rarr; 면담선발)</p>
                            
                            <div className="flex flex-col gap-2 w-full">
                                <div className="flex gap-2 w-full">
                                    <input 
                                        type="number" 
                                        placeholder="Day"
                                        value={newDay}
                                        onChange={(e) => setNewDay(e.target.value)}
                                        className="w-16 shrink-0 py-1.5 px-2 bg-white border border-gray-200 rounded-xl text-xs text-center font-black text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                    />
                                    <input 
                                        type="text" 
                                        placeholder="예: 면담선발"
                                        value={newText}
                                        onChange={(e) => setNewText(e.target.value)}
                                        className="flex-1 min-w-0 py-1.5 px-3 bg-white border border-gray-200 rounded-xl text-xs font-black text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                    />
                                </div>
                                <button
                                    onClick={() => {
                                        const dayNum = parseInt(newDay, 10);
                                        const txt = newText.trim();
                                        if (isNaN(dayNum) || !txt) {
                                            alert("Day 번호와 배지 텍스트를 정확히 입력해주세요.");
                                            return;
                                        }
                                        setLocalDayLabels(prev => ({ ...prev, [dayNum]: txt }));
                                        setNewDay('');
                                        setNewText('');
                                    }}
                                    className="w-full py-2 bg-red-500 hover:bg-red-600 active:scale-95 text-white rounded-xl text-xs font-black transition-all cursor-pointer text-center shadow-md shadow-red-100"
                                >
                                    라벨 추가
                                </button>
                            </div>
                            
                            {Object.keys(localDayLabels).length > 0 && (
                                <div className="space-y-1.5 max-h-[500px] overflow-y-auto custom-scrollbar pt-3 border-t border-red-100/50">
                                    {Object.entries(localDayLabels).map(([d, label]) => (
                                        <div key={d} className="flex items-center justify-between bg-white py-1.5 px-3 rounded-xl border border-red-50/50 shadow-xs">
                                            <span className="text-[10px] font-black text-gray-700 truncate pr-1">
                                                Day {d}: <span className="text-red-650 font-extrabold">{label}</span>
                                            </span>
                                            <button
                                                onClick={() => {
                                                    const next = { ...localDayLabels };
                                                    delete next[parseInt(d, 10)];
                                                    setLocalDayLabels(next);
                                                }}
                                                className="text-[9px] font-black text-gray-400 hover:text-red-600 transition-colors shrink-0 px-1"
                                            >
                                                삭제
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </DndContext>

                <div className="pt-2 shrink-0">
                    <button
                        onClick={() => handleKtaSave(localDayLabels)}
                        disabled={isKTASaving}
                        className={cn(
                            "w-full py-4 rounded-[1.5rem] font-black text-lg transition-all outline-none",
                            isKTASaving
                                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                : "bg-red-500 hover:bg-red-650 text-white shadow-xl shadow-red-100 active:scale-95"
                        )}
                    >
                        {isKTASaving ? '저장 중...' : '주요일정 템플릿 저장'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

interface BlcTemplateModalProps {
    isBLCScheduleAdding: boolean;
    setIsBLCScheduleAdding: (val: boolean) => void;
    blcScheduleTemplate: ScheduleTemplateDay[];
    handleBlcDragEnd: (event: DragEndEvent) => void;
    handleBlcTemplateChange: (day: number, eventIndex: number, value: string) => void;
    addEventToBlcTemplate: (day: number) => void;
    removeEventFromBlcTemplate: (day: number, index: number) => void;
    handleBlcSave: (dayLabels?: Record<number, string>) => void;
    isBLCSaving: boolean;
    blcReferenceBatch: string;
    blcReferenceDate: Date | null;
    isHolidayDate: (dateStr: string) => boolean;
    blcDayLabels?: Record<number, string>;
}

export function BlcTemplateModal({
    isBLCScheduleAdding, setIsBLCScheduleAdding,
    blcScheduleTemplate, handleBlcDragEnd, handleBlcTemplateChange,
    addEventToBlcTemplate, removeEventFromBlcTemplate,
    handleBlcSave, isBLCSaving,
    blcReferenceBatch, blcReferenceDate, isHolidayDate,
    blcDayLabels
}: BlcTemplateModalProps) {
    const dndSensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
    );

    const [localDayLabels, setLocalDayLabels] = useState<Record<number, string>>({});
    const [newDay, setNewDay] = useState('');
    const [newText, setNewText] = useState('');

    useEffect(() => {
        if (isBLCScheduleAdding) {
            setLocalDayLabels(blcDayLabels || {});
        }
    }, [isBLCScheduleAdding, blcDayLabels]);

    if (!isBLCScheduleAdding) return null;

    return createPortal(
        <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-5 shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl sm:text-2xl font-black text-gray-900 whitespace-nowrap">BLC 주요일정</h2>
                            {blcReferenceBatch && (
                                <span className="text-[10px] sm:text-xs font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-xl border border-blue-100 whitespace-nowrap">
                                    {blcReferenceBatch}기
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 font-bold mt-1">Day 0부터 Day 22까지의 일정을 미리 설정합니다.</p>
                    </div>
                    <button onClick={() => setIsBLCScheduleAdding(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <DndContext sensors={dndSensors} onDragEnd={handleBlcDragEnd}>
                    <div className="overflow-y-auto flex-1 custom-scrollbar py-2 space-y-4 pr-2">
                        {blcScheduleTemplate.map((item) => (
                            <DroppableDayZone key={item.day} id={`blc-day-${item.day}`} color="blue">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-[11px] sm:text-xs font-black text-blue-500 whitespace-nowrap">Day {item.day}</span>
                                        {(() => {
                                            if (!blcReferenceDate) return null;
                                            let target = new Date(blcReferenceDate);
                                            let workingDays = 0;
                                            while (workingDays < item.day) {
                                                target.setDate(target.getDate() + 1);
                                                const tStr = target.toISOString().split('T')[0];
                                                if (target.getDay() !== 0 && !isHolidayDate(tStr)) workingDays++;
                                            }
                                            const mm = String(target.getMonth() + 1).padStart(2, '0');
                                            const dd = String(target.getDate()).padStart(2, '0');
                                            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                                            return (
                                                <span className="text-[9px] sm:text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-lg whitespace-nowrap shrink-0">
                                                    {mm}.{dd}({dayNames[target.getDay()]})
                                                </span>
                                            );
                                        })()}
                                    </div>
                                    <button
                                        onClick={() => addEventToBlcTemplate(item.day)}
                                        className="text-[9px] sm:text-[10px] font-black text-blue-500 bg-white px-2 py-1 rounded-lg border border-blue-100 hover:bg-red-50 whitespace-nowrap"
                                    >
                                        + 일정 추가
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {sortedWithIndex(item.events).map(({ evt, oi }) => {
                                        const preview = evt.replace(/{batch}/g, blcReferenceBatch);
                                        return (
                                            <DraggableEventItem key={`blc-${item.day}-${oi}`} id={`blc-${item.day}-${oi}`}>
                                                <div className="space-y-1">
                                                    <div className="flex gap-1 items-center">
                                                        <div className="flex-1">
                                                            <input
                                                                type="text"
                                                                value={evt}
                                                                onChange={(e) => handleBlcTemplateChange(item.day, oi, e.target.value)}
                                                                placeholder="예: 0700 BLC {batch} In-processing"
                                                                className="w-full px-2.5 py-1.5 bg-white border border-gray-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={() => removeEventFromBlcTemplate(item.day, oi)}
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
                                            </DraggableEventItem>
                                        );
                                    })}
                                    {item.events.length === 0 && (
                                        <p className="text-center py-2 text-[10px] text-gray-300 font-medium italic">등록된 일정이 없습니다.</p>
                                    )}
                                </div>
                            </DroppableDayZone>
                        ))}

                        {/* Day 커스텀 배지 라벨 설정 Section */}
                        <div className="p-5 bg-blue-50/30 border border-blue-100 rounded-3xl space-y-3 shrink-0 mt-6 shadow-sm">
                            <h4 className="text-xs font-black text-blue-650 tracking-wider flex items-center gap-1.5">🏷️ Day 커스텀 배지 라벨 설정</h4>
                            <p className="text-[10px] text-gray-500 font-bold leading-normal">표준 일정의 특정 Day 날짜 오른쪽에 표시할 파란색 배지 라벨을 지정합니다. (예: Day 12 &rarr; 포데이)</p>
                            
                            <div className="flex flex-col gap-2 w-full">
                                <div className="flex gap-2 w-full">
                                    <input 
                                        type="number" 
                                        placeholder="Day"
                                        value={newDay}
                                        onChange={(e) => setNewDay(e.target.value)}
                                        className="w-16 shrink-0 py-1.5 px-2 bg-white border border-gray-200 rounded-xl text-xs text-center font-black text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                    <input 
                                        type="text" 
                                        placeholder="예: 포데이"
                                        value={newText}
                                        onChange={(e) => setNewText(e.target.value)}
                                        className="flex-1 min-w-0 py-1.5 px-3 bg-white border border-gray-200 rounded-xl text-xs font-black text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>
                                <button
                                    onClick={() => {
                                        const dayNum = parseInt(newDay, 10);
                                        const txt = newText.trim();
                                        if (isNaN(dayNum) || !txt) {
                                            alert("Day 번호와 배지 텍스트를 정확히 입력해주세요.");
                                            return;
                                        }
                                        setLocalDayLabels(prev => ({ ...prev, [dayNum]: txt }));
                                        setNewDay('');
                                        setNewText('');
                                    }}
                                    className="w-full py-2 bg-blue-500 hover:bg-blue-600 active:scale-95 text-white rounded-xl text-xs font-black transition-all cursor-pointer text-center shadow-md shadow-blue-100"
                                >
                                    라벨 추가
                                </button>
                            </div>
                            
                            {Object.keys(localDayLabels).length > 0 && (
                                <div className="space-y-1.5 max-h-[500px] overflow-y-auto custom-scrollbar pt-3 border-t border-blue-100/50">
                                    {Object.entries(localDayLabels).map(([d, label]) => (
                                        <div key={d} className="flex items-center justify-between bg-white py-1.5 px-3 rounded-xl border border-blue-50/50 shadow-xs">
                                            <span className="text-[10px] font-black text-gray-700 truncate pr-1">
                                                Day {d}: <span className="text-blue-650 font-extrabold">{label}</span>
                                            </span>
                                            <button
                                                onClick={() => {
                                                    const next = { ...localDayLabels };
                                                    delete next[parseInt(d, 10)];
                                                    setLocalDayLabels(next);
                                                }}
                                                className="text-[9px] font-black text-gray-400 hover:text-blue-650 transition-colors shrink-0 px-1"
                                            >
                                                삭제
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </DndContext>

                <div className="pt-2 shrink-0">
                    <button
                        onClick={() => handleBlcSave(localDayLabels)}
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
    );
}
