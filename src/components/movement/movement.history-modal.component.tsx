import { useEffect } from 'react';
import { X, Calendar, ClipboardList } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { MovementRecord } from '../../types/movement/movement.type';

interface MovementHistoryModalProps {
    memberName: string;
    fullNameWithRank: string;
    movements: MovementRecord[];
    onClose: () => void;
    baseDate?: Date;
    sheetWeeks?: any[];
    timeline?: string[];
}

export function MovementHistoryModal({ 
    memberName, 
    fullNameWithRank, 
    movements, 
    onClose,
    baseDate,
    sheetWeeks = [],
    timeline = []
}: MovementHistoryModalProps) {
    const currentYear = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

    // Prevent background scrolling when modal is open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
        };
    }, []);

    // Filter and sort movements for this member
    const memberMovements = movements
        .filter(m => m.name === memberName)
        .sort((a, b) => b.startDate.localeCompare(a.startDate)); // Descending order (newest first)

    // Helper to format date string from YYYY-MM-DD to MM.DD
    const formatDate = (dateStr: string) => {
        const parts = dateStr.split('-');
        if (parts.length < 3) return dateStr;
        return `${parseInt(parts[1], 10)}.${parseInt(parts[2], 10)}`;
    };

    // Calculate Wednesday-to-Tuesday week range containing the "today" date (baseDate or current date)
    const today = baseDate || new Date();
    const day = today.getDay(); // 0: Sun, 1: Mon, ..., 3: Wed, etc.
    const diffToWed = (day - 3 + 7) % 7;
    
    const weekStart = new Date(today);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(today.getDate() - diffToWed);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setHours(23, 59, 59, 999);
    weekEnd.setDate(weekStart.getDate() + 6);

    // Helper to calculate Wednesday-to-Tuesday week group key for sorting and grouping
    const getWeekKey = (dateStr: string) => {
        const dateObj = new Date(dateStr);
        if (isNaN(dateObj.getTime())) return '';
        const d = dateObj.getDay();
        const diff = (d - 3 + 7) % 7;
        const wed = new Date(dateObj);
        wed.setHours(12, 0, 0, 0); // Noon to prevent timezone shifting
        wed.setDate(dateObj.getDate() - diff);
        
        const yr = wed.getFullYear();
        const mo = String(wed.getMonth() + 1).padStart(2, '0');
        const dy = String(wed.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${dy}`;
    };

    // Helper to calculate date with year boundary handling relative to timeline start
    const getRelativeDate = (m: number, d: number) => {
        let yr = currentYear;
        if (timeline.length > 0) {
            const [firstM] = timeline[0].split('.').map(Number);
            if (firstM === 12 && m === 1) {
                yr = currentYear + 1;
            } else if (firstM === 1 && m === 12) {
                yr = currentYear - 1;
            }
        }
        return new Date(yr, m - 1, d, 12, 0, 0, 0);
    };

    // Group movements by week key
    const groupedWeeks: Record<string, MovementRecord[]> = {};

    // Initialize all sheet weeks in groupedWeeks to ensure "stayback" (잔류) is shown for empty weeks
    sheetWeeks.forEach(w => {
        // Check if the member is listed in this week's data
        const isMemberInWeek = w.data && w.data.some((d: any) => {
            const clean = d.name.replace(/^(병장|상병|일병|이병)\s*/, '');
            return clean === memberName;
        });
        if (!isMemberInWeek) return;

        const [m, d] = w.startDate.split('.').map(Number);
        const dateObj = getRelativeDate(m, d);
        const dayOfWeek = dateObj.getDay();
        const diffToWed = (dayOfWeek - 3 + 7) % 7;
        const wed = new Date(dateObj);
        wed.setHours(12, 0, 0, 0); // Noon to prevent timezone shifting
        wed.setDate(dateObj.getDate() - diffToWed);
        
        const yr = wed.getFullYear();
        const mo = String(wed.getMonth() + 1).padStart(2, '0');
        const dy = String(wed.getDate()).padStart(2, '0');
        const key = `${yr}-${mo}-${dy}`;
        if (key) {
            groupedWeeks[key] = [];
        }
    });

    // Populate actual movements
    memberMovements.forEach(m => {
        const key = getWeekKey(m.startDate);
        if (key) {
            if (!groupedWeeks[key]) {
                groupedWeeks[key] = [];
            }
            groupedWeeks[key].push(m);
        }
    });

    // Sort weeks in descending order (newest first)
    const rawSortedWeekKeys = Object.keys(groupedWeeks).sort((a, b) => b.localeCompare(a));
    const sortedWeekKeys = rawSortedWeekKeys.filter(key => {
        if (timeline.length === 0) return true;
        const [firstM, firstD] = timeline[0].split('.').map(Number);
        const timelineStart = getRelativeDate(firstM, firstD);

        const [y, mo, dy] = key.split('-').map(Number);
        const weekStartDate = new Date(y, mo - 1, dy, 12, 0, 0, 0);
        
        // 과거/현재 주차는 항상 노출
        if (weekStartDate <= timelineStart) {
            return true;
        }
        
        // 미래 주차의 경우, 실제로 등록된 출타 기록(movements)이 있는 경우에만 노출
        const hasMovements = groupedWeeks[key] && groupedWeeks[key].length > 0;
        return hasMovements;
    });

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-2 sm:p-4">
            <div className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="bg-slate-800 p-4 sm:p-6 text-slate-100 shrink-0 relative border-b border-slate-700">
                    <h3 className="text-base sm:text-xl font-black flex items-center gap-2">
                        <ClipboardList className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-slate-300" />
                        {fullNameWithRank} 출타 히스토리
                    </h3>
                    <p className="text-[10px] sm:text-xs text-slate-400 mt-1 font-bold">외박 및 휴가 기록을 확인할 수 있습니다.</p>
                    <button
                        onClick={onClose}
                        className="absolute top-4 sm:top-6 right-4 sm:right-6 p-1.5 rounded-full bg-slate-700/50 hover:bg-slate-700 transition-colors text-slate-300"
                    >
                        <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                </div>

                {/* Body / List */}
                <div className="p-4 sm:p-6 overflow-y-auto flex-1">
                    {sortedWeekKeys.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <Calendar className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 opacity-30" />
                            <p className="font-bold text-xs sm:text-sm">출타 히스토리 내역이 없습니다.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {sortedWeekKeys.map((weekKey) => {
                                const rawItems = groupedWeeks[weekKey];
                                
                                // 1. Handle stayback case (no movements for this sheet week)
                                if (rawItems.length === 0) {
                                    const [y, mo, dy] = weekKey.split('-').map(Number);
                                    const wedDate = new Date(y, mo - 1, dy, 12, 0, 0, 0);
                                    const satDate = new Date(wedDate);
                                    satDate.setDate(wedDate.getDate() + 3);
                                    const sunDate = new Date(wedDate);
                                    sunDate.setDate(wedDate.getDate() + 4);
                                    
                                    const startFormatted = `${satDate.getMonth() + 1}.${satDate.getDate()}`;
                                    const endFormatted = `${sunDate.getMonth() + 1}.${sunDate.getDate()}`;
                                    
                                    const tueDate = new Date(wedDate);
                                    tueDate.setDate(wedDate.getDate() + 6);
                                    const isThisWeek = wedDate <= weekEnd && tueDate >= weekStart;

                                    return (
                                        <div 
                                            key={weekKey} 
                                            className={cn(
                                                "text-xs sm:text-sm text-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-x-4 gap-y-2 py-2 px-2.5 sm:px-2 border-b border-gray-100 last:border-0 transition-all",
                                                isThisWeek && "bg-blue-50/70 border-l-4 border-l-blue-500 rounded-r-xl"
                                            )}
                                        >
                                            <div className="flex flex-row flex-wrap items-center gap-2 flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold text-white shrink-0 bg-gray-500">
                                                        잔류
                                                    </span>
                                                    <span className="font-bold shrink-0 text-gray-900 text-xs sm:text-sm">
                                                        {startFormatted} ~ {endFormatted}
                                                    </span>
                                                </div>
                                                <span className="text-xs sm:text-sm text-slate-800 font-extrabold pl-2 border-l border-gray-200 inline break-all">
                                                    잔류
                                                </span>
                                            </div>
                                        </div>
                                    );
                                }

                                // 2. Handle normal movements sorting
                                const items = [...rawItems].sort((a, b) => {
                                    if (a.type === 'pass' && b.type === 'vacation') return -1;
                                    if (a.type === 'vacation' && b.type === 'pass') return 1;
                                    return 0;
                                });
                                
                                // Check if any item in this week group overlaps with "this week" range
                                const isThisWeek = items.some(item => {
                                    const itemStart = new Date(item.startDate);
                                    const itemEnd = new Date(item.endDate);
                                    return itemStart <= weekEnd && itemEnd >= weekStart;
                                });

                                return (
                                    <div 
                                        key={weekKey} 
                                        className={cn(
                                            "text-xs sm:text-sm text-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-x-4 gap-y-2 py-2 px-2.5 sm:px-2 border-b border-gray-100 last:border-0 transition-all",
                                            isThisWeek && "bg-blue-50/70 border-l-4 border-l-blue-500 rounded-r-xl"
                                        )}
                                    >
                                        <div className="flex flex-row flex-wrap items-center gap-2 flex-1 min-w-0">
                                            {items.map((item, idx) => (
                                                <div key={idx} className="flex flex-row flex-wrap items-center gap-1.5 sm:gap-2">
                                                    {idx > 0 && <span className="text-gray-300 font-black hidden sm:inline">+</span>}
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white shrink-0 ${
                                                            item.type === 'vacation' ? 'bg-orange-500' :
                                                            item.type === 'pass' ? 'bg-blue-500' : 'bg-gray-500'
                                                        }`}>
                                                            {item.type === 'vacation' ? '휴가' :
                                                             item.type === 'pass' ? '외박' : '잔류'}
                                                        </span>
                                                        <span className="font-bold shrink-0 text-gray-900 text-xs sm:text-sm">
                                                            {item.startDate === item.endDate
                                                                ? formatDate(item.startDate)
                                                                : `${formatDate(item.startDate)} ~ ${formatDate(item.endDate)}`
                                                            }
                                                        </span>
                                                    </div>
                                                    {(() => {
                                                        const isStayType = item.type !== 'pass' && item.type !== 'vacation';
                                                        const displayReason = item.reason || (isStayType ? '잔류' : '');
                                                        if (!displayReason) return null;
                                                        return (
                                                            <span className="text-xs sm:text-sm text-slate-800 font-extrabold pl-2 border-l border-gray-200 inline break-all">
                                                                {displayReason}
                                                            </span>
                                                        );
                                                    })()}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 sm:p-6 bg-gray-50 border-t border-gray-100 shrink-0">
                    <button
                        onClick={onClose}
                        className="w-full py-3.5 sm:py-4 bg-white border border-gray-200 rounded-xl sm:rounded-2xl text-gray-500 text-sm sm:text-base font-black hover:bg-gray-50 transition-colors shadow-sm"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
