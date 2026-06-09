interface DutyTemplateGridProps {
    viewMode: 'kta-template' | 'blc-template';
    ktaTemplate: any;
    blcTemplate: any;
    restrictions: Record<number, Record<string, boolean>>;
    blcRestrictions: Record<number, Record<string, boolean>>;
    restrictionBrush: string | null;
    handleToggleRestriction: (day: number, section: string) => void;
    handleToggleBlcRestriction: (day: number, section: string) => void;
    ktaDayLabels: Record<number, string>;
    setKtaDayLabels: React.Dispatch<React.SetStateAction<Record<number, string>>>;
    blcDayLabels: Record<number, string>;
    setBlcDayLabels: React.Dispatch<React.SetStateAction<Record<number, string>>>;
    ktaSections: string[];
    blcSections: string[];
}

export function DutyTemplateGrid({
    viewMode, ktaTemplate, blcTemplate,
    restrictions, blcRestrictions, restrictionBrush,
    handleToggleRestriction, handleToggleBlcRestriction,
    ktaDayLabels, setKtaDayLabels,
    blcDayLabels, setBlcDayLabels,
    ktaSections, blcSections
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
                    const customLabel = ktaDayLabels[dayNum];

                    return (
                        <div
                            key={i}
                            onClick={() => {
                                if (restrictionBrush && ktaSections.includes(restrictionBrush)) {
                                    handleToggleRestriction(dayNum, restrictionBrush);
                                }
                            }}
                            className="border-r border-b border-slate-850 p-3.5 flex flex-col justify-between select-none relative transition-all h-full min-h-0 bg-slate-900/20 hover:bg-slate-900/40 cursor-crosshair"
                        >
                            <div className="flex flex-col h-full min-h-0 w-full justify-between">
                                <div className="flex justify-between items-center shrink-0 h-6">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className={`text-[11px] font-black tracking-tight ${dayNum === 0 || dayNum === 13 || dayNum === 14 || dayNum === 20
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

                                <div className="flex flex-row gap-1 w-full shrink-0 mt-auto pt-1.5 border-t border-slate-800/40 min-h-[30px] flex-wrap">
                                    {ktaSections.map((sec) => {
                                        const isRestricted = !!restrictions[dayNum]?.[sec] ||
                                            (sec === 'KTA' && !!restrictions[dayNum]?.['kta']) ||
                                            (sec === 'MEDIC' && !!restrictions[dayNum]?.['medic']) ||
                                            (sec === 'PAO' && !!restrictions[dayNum]?.['pao']);
                                        if (!isRestricted) return null;
                                        return (
                                            <button
                                                key={sec}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleToggleRestriction(dayNum, sec);
                                                }}
                                                className="py-1 px-1.5 rounded bg-rose-950/80 hover:bg-rose-900/60 border border-rose-500/35 text-rose-300 text-[8px] font-black text-center flex items-center justify-center gap-0.5 shrink-0 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md truncate"
                                                title={`클릭 시 ${sec} 제한 해제`}
                                            >
                                                🚫 {sec}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    if (viewMode === 'blc-template') {
        const blcDays = Array.from({ length: 28 }, (_, i) => i - 1); // Day -1 ~ Day 26
        return (
            <div className="flex-1 min-h-0 grid grid-cols-7 bg-slate-950/20 w-full h-full relative grid-rows-4">
                {blcDays.map((dayNum) => {
                    const dayEvents = blcTemplate?.schedules?.find((s: any) => s.day === dayNum)?.events || [];
                    const customLabel = blcDayLabels[dayNum];

                    return (
                        <div
                            key={dayNum}
                            onClick={() => {
                                if (restrictionBrush && blcSections.includes(restrictionBrush)) {
                                    handleToggleBlcRestriction(dayNum, restrictionBrush);
                                }
                            }}
                            className="border-r border-b border-slate-850 p-3.5 flex flex-col justify-between select-none relative transition-all h-full min-h-0 bg-slate-900/20 hover:bg-slate-900/40 cursor-crosshair"
                        >
                            <div className="flex flex-col h-full min-h-0 w-full justify-between">
                                <div className="flex justify-between items-center shrink-0 h-6">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className={`text-[11px] font-black tracking-tight ${dayNum === 0 || dayNum === 22
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

                                <div className="flex flex-row gap-1 w-full shrink-0 mt-auto pt-1.5 border-t border-slate-800/40 min-h-[30px] flex-wrap">
                                    {blcSections.map((sec) => {
                                        const isRestricted = !!blcRestrictions[dayNum]?.[sec] ||
                                            (sec === 'BLC' && !!blcRestrictions[dayNum]?.['blc']) ||
                                            (sec === 'S3' && !!blcRestrictions[dayNum]?.['s3']) ||
                                            (sec === 'PAO' && !!blcRestrictions[dayNum]?.['pao']);
                                        if (!isRestricted) return null;
                                        return (
                                            <button
                                                key={sec}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleToggleBlcRestriction(dayNum, sec);
                                                }}
                                                className="py-1 px-1.5 rounded bg-blue-950/80 hover:bg-blue-900/60 border border-blue-500/35 text-blue-300 text-[8px] font-black text-center flex items-center justify-center gap-0.5 shrink-0 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md truncate"
                                                title={`클릭 시 ${sec} 제한 해제`}
                                            >
                                                🚫 {sec}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    return null;
}
