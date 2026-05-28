/* eslint-disable @typescript-eslint/no-explicit-any */
import { cn } from '../../lib/utils';

interface MovementGridProps {
    timeline: string[];
    dataList: { name: string; dayStatuses: Record<string, string> }[];
    dbMembers: any[];
    baseDate?: Date;
}

export function MovementGrid({ timeline, dataList, dbMembers, baseDate }: MovementGridProps) {
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
            {sortedEntries.map((member, idx) => (
                <div key={idx} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:border-blue-200 transition-all flex items-center gap-4">
                    <div className="w-24 shrink-0">
                        <span className="text-sm font-black text-gray-900 truncate block">{member.name}</span>
                    </div>

                    <div className="flex-1 flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar relative pt-4">
                        {timeline.map((dateStr, tIdx) => {
                            let status = member.dayStatuses[dateStr] || 'none';
                            const [m, d] = dateStr.split('.').map(Number);
                            const isWeekend = new Date(2026, m - 1, d, 12, 0, 0, 0).getDay() % 6 === 0;

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
                                        const isSunday = new Date(2026, m - 1, d, 12, 0, 0, 0).getDay() === 0;
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
            ))}
        </div>
    );
}
