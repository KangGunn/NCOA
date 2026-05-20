import { Calendar, RotateCcw } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

interface RollCallHeaderProps {
    baseDate: Date;
    setBaseDate: Dispatch<SetStateAction<Date>>;
    handleManualRefresh: () => void;
}

export function RollCallHeader({ baseDate, setBaseDate, handleManualRefresh }: RollCallHeaderProps) {
    const todayStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;

    return (
        <header className="flex items-start justify-between gap-2 sm:gap-4 mb-8">
            <div className="flex items-center gap-2 sm:gap-4 h-[44px]">
                <img src="/favicon.png" alt="로고" className="w-10 h-10 object-contain shrink-0" />
                <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight leading-none translate-y-[-1px] whitespace-nowrap">점호 보고</h1>
            </div>
            <div className="flex flex-col gap-1.5 w-[130px] sm:w-[135px] shrink-0 pt-[2px] sm:pt-0">
                <div className="relative group w-full h-[32px] sm:h-[38px] bg-white border-2 border-slate-200 rounded-xl flex items-center justify-between pl-2.5 pr-2.5 hover:border-slate-300 transition-all cursor-pointer">
                    <span className="text-[11px] sm:text-[11px] font-black text-slate-600 select-none">
                        {baseDate.getFullYear()}-{String(baseDate.getMonth() + 1).padStart(2, '0')}-{String(baseDate.getDate()).padStart(2, '0')}
                    </span>
                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                        type="date"
                        value={todayStr}
                        onChange={(e) => setBaseDate(new Date(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0"
                    />
                </div>
                <button
                    onClick={handleManualRefresh}
                    className="w-full h-[32px] sm:h-[38px] flex items-center justify-center gap-1 px-2 sm:px-3 rounded-xl bg-white border-2 border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95 shadow-sm shadow-slate-100"
                >
                    <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span className="text-[9px] sm:text-[11px] font-black">새로고침</span>
                </button>
            </div>
        </header>
    );
}
