import { useState, useEffect } from 'react';
import { History } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { MovementRecord } from '../../types/movement/movement.type';
import { MovementHistoryModal } from './movement.history-modal.component';

export interface DbMember {
    name: string;
    enlistmentDate?: string;
    englishName?: string;
    rank?: string;
    sections?: string[];
    phoneNumber?: string;
}

interface MovementGridProps {
    timeline: string[];
    dataList: { name: string; dayStatuses: Record<string, string> }[];
    dbMembers: DbMember[];
    baseDate?: Date;
    movements?: MovementRecord[];
    sheetWeeks?: any[];
}

export function MovementGrid({ timeline, dataList, dbMembers, baseDate, movements = [], sheetWeeks = [] }: MovementGridProps) {
    const [activeCardIndex, setActiveCardIndex] = useState<number | null>(null);
    const [historyMember, setHistoryMember] = useState<{ name: string; fullName: string } | null>(null);

    useEffect(() => {
        const handleOutsideClick = () => {
            setActiveCardIndex(null);
        };
        document.addEventListener('click', handleOutsideClick);
        return () => {
            document.removeEventListener('click', handleOutsideClick);
        };
    }, []);

    useEffect(() => {
        if (activeCardIndex === null) return;
        const timer = setTimeout(() => {
            setActiveCardIndex(null);
        }, 1000);
        return () => clearTimeout(timer);
    }, [activeCardIndex]);

    const currentYear = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

    const sortedEntries = [...dataList].sort((a, b) => {
        const cleanA = a.name.replace(/^(병장|상병|일병|이병)\s*/, '');
        const cleanB = b.name.replace(/^(병장|상병|일병|이병)\s*/, '');

        const memA = dbMembers.find(m => m.name === cleanA);
        const memB = dbMembers.find(m => m.name === cleanB);

        if (memA?.enlistmentDate && memB?.enlistmentDate) {
            if (memA.enlistmentDate !== memB.enlistmentDate) {
                return memA.enlistmentDate < memB.enlistmentDate ? -1 : 1;
            }
        } else if (memA?.enlistmentDate) {
            return -1;
        } else if (memB?.enlistmentDate) {
            return 1;
        }

        const rankPriority: Record<string, number> = { '병장': 1, '상병': 2, '일병': 3, '이병': 4 };
        const rA = Object.keys(rankPriority).find(r => a.name.includes(r)) || '';
        const rB = Object.keys(rankPriority).find(r => b.name.includes(r)) || '';
        const pA = rankPriority[rA] || 99;
        const pB = rankPriority[rB] || 99;

        if (pA !== pB) return pA - pB;
        return a.name.localeCompare(b.name);
    });

    return (
        <div className="grid gap-2">
            {sortedEntries.map((member, idx) => {
                const cleanName = member.name.replace(/^(병장|상병|일병|이병)\s*/, '');
                
                const [firstM, firstD] = timeline[0].split('.').map(Number);
                const timelineStartIso = `${currentYear}-${String(firstM).padStart(2, '0')}-${String(firstD).padStart(2, '0')}`;

                // Collect all movements for this member that overlap with the current timeline view
                // For passes (외박), they must contain at least one weekend day within the visible timeline
                const memberMovements = movements.filter(mov => {
                    if (mov.name !== cleanName) return false;
                    if (mov.startDate < timelineStartIso) return false;
                    
                    return timeline.some(dateStr => {
                        const [m, d] = dateStr.split('.').map(Number);
                        const isoDate = `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        const isOverlapping = isoDate >= mov.startDate && isoDate <= mov.endDate;
                        if (!isOverlapping) return false;
                        
                        if (mov.type === 'pass') {
                            const gridStatus = member.dayStatuses[dateStr] || '';
                            const isGridVacation = gridStatus === 'vacation' || gridStatus === 'linked';
                            if (!isGridVacation) {
                                const isWeekend = new Date(currentYear, m - 1, d, 12, 0, 0, 0).getDay() % 6 === 0;
                                return isWeekend;
                            }
                        }
                        
                        return true;
                    });
                });

                const hasReason = memberMovements.some(mov => mov.reason);

                return (
                    <div 
                        key={idx} 
                        className="bg-white border border-gray-100 rounded-xl px-3 py-0 shadow-sm transition-all flex items-center gap-4 relative h-[56px]"
                    >
                        <div className="w-24 shrink-0 flex items-center">
                            <span className="text-sm font-black text-gray-900 truncate block">{member.name}</span>
                        </div>

                        <div className="flex-1 flex items-stretch overflow-visible pb-1 no-scrollbar pt-3 h-full">
                            <div 
                                className={cn(
                                    "inline-flex items-center gap-1 overflow-visible relative h-full group/timeline",
                                    hasReason && "cursor-pointer"
                                )}
                                onClick={(e) => {
                                    if (!hasReason) return;
                                    e.stopPropagation();
                                    setActiveCardIndex(prev => prev === idx ? null : idx);
                                }}
                            >
                                {/* Tooltip centered over the boxes */}
                                {hasReason && (
                                    <div className={cn(
                                        "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex-col items-center z-50 animate-in fade-in zoom-in-95 duration-100 pointer-events-none",
                                        activeCardIndex === idx ? "flex" : "hidden group-hover/timeline:flex"
                                    )}>
                                        <div className="bg-gray-950 text-white text-[11px] font-medium rounded-lg py-1.5 px-2.5 whitespace-nowrap shadow-xl leading-tight text-center border border-gray-800 space-y-1">
                                            {memberMovements.filter(m => m.reason).map((mov, mIdx) => (
                                                <div key={mIdx} className={mIdx > 0 ? "border-t border-gray-800 pt-1 mt-1" : ""}>
                                                    <div className="text-[9px] text-gray-400 font-bold mb-0.5">
                                                        {mov.type === 'pass' ? '외박' : '휴가'} ({mov.startDate.slice(5).replace('-', '.')} ~ {mov.endDate.slice(5).replace('-', '.')})
                                                    </div>
                                                    <div className="text-gray-100 font-semibold">{mov.reason}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="w-1.5 h-1.5 bg-gray-950 rotate-45 -mt-[3.5px] border-r border-b border-gray-800" />
                                    </div>
                                )}
                                {timeline.map((dateStr, tIdx) => {
                                let status = member.dayStatuses[dateStr] || 'none';
                                const [m, d] = dateStr.split('.').map(Number);
                                const isWeekend = new Date(currentYear, m - 1, d, 12, 0, 0, 0).getDay() % 6 === 0;

                                // Dynamically detect if we are departing for/on a pass on the recovery day (day after duty)
                                if (status === 'pass-depart' || status === 'pass') {
                                    const yesterdayStr = tIdx > 0 ? timeline[tIdx - 1] : null;
                                    const yesterdayStatus = yesterdayStr ? (member.dayStatuses[yesterdayStr] || 'none') : 'none';
                                    if (yesterdayStatus === 'duty') {
                                        status = 'recovery-pass-depart';
                                    }
                                }

                                return (
                                    <div key={tIdx} className="flex flex-col items-center gap-1 relative">
                                        <div
                                            className={cn(
                                                "w-4 h-4 rounded-sm transition-all duration-300",
                                                status === 'none' && "bg-gray-100",
                                                status === 'pass' && "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.3)]",
                                                status === 'pass-depart' && "",
                                                status === 'vacation' && "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.3)]",
                                                status === 'duty' && "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]",
                                                status === 'recovery' && "bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.4)]",
                                                status === 'linked' && "shadow-[0_0_8px_rgba(59,130,246,0.4)]",
                                                status === 'recovery-pass-depart' && "shadow-[0_0_6px_rgba(250,204,21,0.4)]",
                                                isWeekend && "border-2 border-black"
                                            )}
                                            style={
                                                status === 'linked' ? {
                                                    background: 'linear-gradient(135deg, #3b82f6 50%, #f97316 50%)'
                                                } : status === 'pass-depart' ? {
                                                    background: 'linear-gradient(135deg, #f3f4f6 50%, #3b82f6 50%)'
                                                } : status === 'recovery-pass-depart' ? {
                                                    background: 'linear-gradient(135deg, #facc15 50%, #3b82f6 50%)'
                                                } : undefined
                                            }
                                        />
                                        {(() => {
                                            const isFirst = tIdx === 0;
                                            const isLast = tIdx === timeline.length - 1;
                                            const isSunday = new Date(currentYear, m - 1, d, 12, 0, 0, 0).getDay() === 0;
                                            const isMonthStart = d === 1;
                                            const today = baseDate || new Date();
                                            const isToday = today.getMonth() === m - 1 && today.getDate() === d;

                                            if (isFirst || isLast || isSunday || isMonthStart || isToday) {
                                                return (
                                                    <span className={cn(
                                                        "text-[8px] font-black absolute -top-4 whitespace-nowrap",
                                                        isToday ? "text-red-500 font-extrabold" : "text-gray-300"
                                                    )}>
                                                        {dateStr}
                                                    </span>
                                                );
                                            }
                                            return null;
                                        })()}
                                    </div>
                                );
                            })}
                            </div>
                        </div>

                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const rankMatch = member.name.match(/^(병장|상병|일병|이병)\s*(.*)$/);
                                const formattedName = rankMatch ? `${rankMatch[2]} ${rankMatch[1]}` : member.name;
                                setHistoryMember({ name: cleanName, fullName: formattedName });
                            }}
                            className="flex items-center justify-center p-1.5 rounded-lg text-gray-400 shrink-0"
                            title="출타 히스토리"
                        >
                            <History className="w-4 h-4" />
                        </button>
                    </div>
                );
            })}
            {historyMember && (
                <MovementHistoryModal
                    memberName={historyMember.name}
                    fullNameWithRank={historyMember.fullName}
                    movements={movements}
                    onClose={() => setHistoryMember(null)}
                    baseDate={baseDate}
                    sheetWeeks={sheetWeeks}
                    timeline={timeline}
                />
            )}
        </div>
    );
}
