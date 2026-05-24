interface DutyTemplateGridProps {
    viewMode: 'kta-template' | 'blc-template';
    ktaTemplate: any;
    blcTemplate: any;
    restrictions: Record<number, { kta: boolean; medic: boolean; pao: boolean }>;
    blcRestrictions: Record<number, { blc: boolean; s3: boolean; pao: boolean }>;
    restrictionBrush: 'kta' | 'medic' | 'personal' | 'blc' | 's3' | 'pao' | null;
    handleToggleRestriction: (day: number, type: 'kta' | 'medic' | 'pao') => void;
    handleToggleBlcRestriction: (day: number, type: 'blc' | 's3' | 'pao') => void;
    ktaDayLabels: Record<number, string>;
    setKtaDayLabels: React.Dispatch<React.SetStateAction<Record<number, string>>>;
    blcDayLabels: Record<number, string>;
    setBlcDayLabels: React.Dispatch<React.SetStateAction<Record<number, string>>>;
}

export function DutyTemplateGrid({
    viewMode, ktaTemplate, blcTemplate,
    restrictions, blcRestrictions, restrictionBrush,
    handleToggleRestriction, handleToggleBlcRestriction,
    ktaDayLabels, setKtaDayLabels,
    blcDayLabels, setBlcDayLabels
}: DutyTemplateGridProps) {
    if (viewMode === 'kta-template') {
        const totalCells = 28;
        return (
            <div className="flex-1 min-h-0 grid grid-cols-7 bg-slate-950/20 w-full h-full relative grid-rows-4">
                {Array.from({ length: totalCells }).map((_, i) => {
                    const isSat = i % 7 === 5;
                    const isSun = i % 7 === 6;
                    const dayNum = i - 3; // 월요일(i=0) = Day -3, ...

                    const dayEvents = ktaTemplate?.schedules?.find((s: any) => s.day === dayNum)?.events || [];
                    const ktaRestricted = !!restrictions[dayNum]?.kta;
                    const medicRestricted = !!restrictions[dayNum]?.medic;
                    const paoRestricted = !!restrictions[dayNum]?.pao;
                    const customLabel = ktaDayLabels[dayNum];

                    return (
                        <div 
                            key={i} 
                            onClick={() => {
                                  if (restrictionBrush === 'kta' || restrictionBrush === 'medic' || restrictionBrush === 'pao') {
                                      handleToggleRestriction(dayNum, restrictionBrush);
                                  }
                            }}
                            className="border-r border-b border-slate-850 p-3.5 flex flex-col justify-between select-none relative transition-all h-full min-h-0 bg-slate-900/20 hover:bg-slate-900/40 cursor-crosshair"
                        >
                            <div className="flex flex-col h-full min-h-0 w-full justify-between">
                                <div className="flex justify-between items-center shrink-0 h-6">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className={`text-[11px] font-black tracking-tight ${
                                            dayNum === 0 || dayNum === 13 || dayNum === 14 || dayNum === 20
                                                ? 'text-rose-400 font-black bg-rose-950/30 px-2 py-0.5 rounded border border-rose-900/30 shadow-sm'
                                                : isSun 
                                                    ? 'text-rose-500 font-black' 
                                                    : isSat 
                                                        ? 'text-sky-500 font-black' 
                                                        : 'text-slate-300 font-extrabold'
                                        }`}>
                                            Day {dayNum}
                                        </span>
                                        {customLabel && (
                                            <span 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const next = { ...ktaDayLabels };
                                                    delete next[dayNum];
                                                    setKtaDayLabels(next);
                                                }}
                                                className="text-[8px] font-black px-1.5 py-0.5 rounded leading-none shrink-0 bg-rose-950/80 text-rose-450 border border-rose-900/35 cursor-pointer hover:bg-rose-900 hover:text-white transition-all select-none animate-pulse"
                                                title="클릭 시 라벨 삭제"
                                            >
                                                K-{customLabel}
                                            </span>
                                        )}
                                    </div>
                                    {dayNum === 0 && (
                                        <span className="text-[9px] font-black text-rose-400 bg-rose-950/20 px-2 py-0.5 rounded-lg border border-rose-500/10 uppercase shrink-0">
                                            ★ 목요일 고정 (Day 0)
                                        </span>
                                    )}
                                </div>
                                
                                <div className="flex-1 min-h-0 my-1.5 flex flex-col gap-0.5 overflow-y-auto custom-scrollbar pr-0.5 w-full">
                                    {dayEvents.map((evt: string, idx: number) => (
                                        <div 
                                            key={idx} 
                                            className="text-slate-100 text-[8.5px] font-extrabold tracking-tight truncate w-full shrink-0 py-0.5 flex items-center gap-1.5 hover:text-white transition-colors"
                                            title={evt}
                                        >
                                            <span className="text-rose-500/60 shrink-0 select-none">•</span>
                                            <span className="truncate">{evt}</span>
                                        </div>
                                    ))}
                                </div>
                                
                                <div className="flex flex-row gap-1 w-full shrink-0 mt-auto pt-1.5 border-t border-slate-800/40 min-h-[30px]">
                                    {ktaRestricted ? (
                                        <button
                                            onClick={(e) => { 
                                                e.stopPropagation(); 
                                                handleToggleRestriction(dayNum, 'kta'); 
                                            }}
                                            className="flex-1 py-1 rounded bg-rose-950/80 hover:bg-rose-900/60 border border-rose-500/35 text-rose-300 text-[8px] font-black text-center flex items-center justify-center gap-0.5 shrink-0 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md w-1/3 truncate"
                                            title="클릭 시 KTA 제한 해제"
                                        >
                                            🚫 KTA
                                        </button>
                                    ) : (
                                        <div className="flex-1 w-1/3" />
                                    )}
                                    {medicRestricted ? (
                                        <button
                                            onClick={(e) => { 
                                                e.stopPropagation(); 
                                                handleToggleRestriction(dayNum, 'medic'); 
                                            }}
                                            className="flex-1 py-1 rounded bg-amber-950/80 hover:bg-amber-900/60 border border-amber-500/35 text-amber-300 text-[8px] font-black text-center flex items-center justify-center gap-0.5 shrink-0 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md w-1/3 truncate"
                                            title="클릭 시 MEDIC 제한 해제"
                                        >
                                            🚫 MED
                                        </button>
                                    ) : (
                                        <div className="flex-1 w-1/3" />
                                    )}
                                    {paoRestricted ? (
                                        <button
                                            onClick={(e) => { 
                                                e.stopPropagation(); 
                                                handleToggleRestriction(dayNum, 'pao'); 
                                            }}
                                            className="flex-1 py-1 rounded bg-purple-950/80 hover:bg-purple-900/60 border border-purple-500/35 text-purple-300 text-[8px] font-black text-center flex items-center justify-center gap-0.5 shrink-0 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md w-1/3 truncate"
                                            title="클릭 시 PAO 제한 해제"
                                        >
                                            🚫 PAO
                                        </button>
                                    ) : (
                                        <div className="flex-1 w-1/3" />
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    if (viewMode === 'blc-template') {
        const blcDays = Array.from({ length: 25 }, (_, i) => i - 2); // Day -2 ~ Day 22
        return (
            <div className="flex-1 min-h-0 grid grid-cols-7 bg-slate-950/20 w-full h-full relative grid-rows-4">
                {blcDays.map((dayNum) => {
                    const dayEvents = blcTemplate?.schedules?.find((s: any) => s.day === dayNum)?.events || [];
                    const blcRestricted = !!blcRestrictions[dayNum]?.blc;
                    const s3Restricted = !!blcRestrictions[dayNum]?.s3;
                    const paoRestricted = !!blcRestrictions[dayNum]?.pao;
                    const customLabel = blcDayLabels[dayNum];

                    return (
                        <div 
                            key={dayNum} 
                            onClick={() => {
                                if (restrictionBrush === 'blc' || restrictionBrush === 's3' || restrictionBrush === 'pao') {
                                    handleToggleBlcRestriction(dayNum, restrictionBrush);
                                }
                            }}
                            className="border-r border-b border-slate-850 p-3.5 flex flex-col justify-between select-none relative transition-all h-full min-h-0 bg-slate-900/20 hover:bg-slate-900/40 cursor-crosshair"
                        >
                            <div className="flex flex-col h-full min-h-0 w-full justify-between">
                                <div className="flex justify-between items-center shrink-0 h-6">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className={`text-[11px] font-black tracking-tight ${
                                            dayNum === 0 || dayNum === 22
                                                ? 'text-blue-400 font-black bg-blue-950/30 px-2 py-0.5 rounded border border-blue-900/30 shadow-sm'
                                                : 'text-slate-300 font-extrabold'
                                        }`}>
                                            Day {dayNum}
                                        </span>
                                        {customLabel && (
                                            <span 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const next = { ...blcDayLabels };
                                                    delete next[dayNum];
                                                    setBlcDayLabels(next);
                                                }}
                                                className="text-[8px] font-black px-1.5 py-0.5 rounded leading-none shrink-0 bg-indigo-950/80 text-indigo-400 border border-indigo-900/35 cursor-pointer hover:bg-indigo-900 hover:text-white transition-all select-none animate-pulse"
                                                title="클릭 시 라벨 삭제"
                                            >
                                                B-{customLabel}
                                            </span>
                                        )}
                                    </div>
                                    {dayNum === 0 && (
                                        <span className="text-[9px] font-black text-blue-400 bg-blue-950/20 px-2 py-0.5 rounded-lg border border-blue-500/10 uppercase shrink-0">
                                            ★ 입소일
                                        </span>
                                    )}
                                    {dayNum === 22 && (
                                        <span className="text-[9px] font-black text-blue-400 bg-blue-950/20 px-2 py-0.5 rounded-lg border border-blue-500/10 uppercase shrink-0">
                                            Grad
                                        </span>
                                    )}
                                </div>
                                
                                <div className="flex-1 min-h-0 my-1.5 flex flex-col gap-0.5 overflow-y-auto custom-scrollbar pr-0.5 w-full">
                                    {dayEvents.map((evt: string, idx: number) => (
                                        <div 
                                            key={idx} 
                                            className="text-slate-100 text-[8.5px] font-extrabold tracking-tight truncate w-full shrink-0 py-0.5 flex items-center gap-1.5 hover:text-white transition-colors"
                                            title={evt}
                                        >
                                            <span className="text-blue-500/60 shrink-0 select-none">•</span>
                                            <span className="truncate">{evt}</span>
                                        </div>
                                    ))}
                                    {dayEvents.length === 0 && (
                                        <span className="text-[8.5px] text-slate-700 italic">등록된 일정 없음</span>
                                    )}
                                </div>

                                <div className="flex flex-row gap-1 w-full shrink-0 mt-auto pt-1.5 border-t border-slate-800/40 min-h-[30px]">
                                    {blcRestricted ? (
                                        <button
                                            onClick={(e) => { 
                                                e.stopPropagation(); 
                                                handleToggleBlcRestriction(dayNum, 'blc'); 
                                            }}
                                            className="flex-1 py-1 rounded bg-blue-950/80 hover:bg-blue-900/60 border border-blue-500/35 text-blue-300 text-[8px] font-black text-center flex items-center justify-center gap-0.5 shrink-0 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md w-1/3 truncate"
                                            title="클릭 시 BLC 제한 해제"
                                        >
                                            🚫 BLC
                                        </button>
                                    ) : (
                                        <div className="flex-1 w-1/3" />
                                    )}
                                    {s3Restricted ? (
                                        <button
                                            onClick={(e) => { 
                                                e.stopPropagation(); 
                                                handleToggleBlcRestriction(dayNum, 's3'); 
                                            }}
                                            className="flex-1 py-1 rounded bg-indigo-950/80 hover:bg-indigo-900/60 border border-indigo-500/35 text-indigo-300 text-[8px] font-black text-center flex items-center justify-center gap-0.5 shrink-0 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md w-1/3 truncate"
                                            title="클릭 시 S3 제한 해제"
                                        >
                                            🚫 S3
                                        </button>
                                    ) : (
                                        <div className="flex-1 w-1/3" />
                                    )}
                                    {paoRestricted ? (
                                        <button
                                            onClick={(e) => { 
                                                e.stopPropagation(); 
                                                handleToggleBlcRestriction(dayNum, 'pao'); 
                                            }}
                                            className="flex-1 py-1 rounded bg-purple-950/80 hover:bg-purple-900/60 border border-purple-500/35 text-purple-300 text-[8px] font-black text-center flex items-center justify-center gap-0.5 shrink-0 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md w-1/3 truncate"
                                            title="클릭 시 PAO 제한 해제"
                                        >
                                            🚫 PAO
                                        </button>
                                    ) : (
                                        <div className="flex-1 w-1/3" />
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`empty-blc-${i}`} className="border-r border-b border-slate-850 bg-slate-900/5 select-none" />
                ))}
            </div>
        );
    }

    return null;
}
