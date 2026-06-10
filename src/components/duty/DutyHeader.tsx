import { Calendar as CalendarIcon, Trash2, LogOut, Info } from 'lucide-react';

interface DutyHeaderProps {
    viewMode: 'actual' | 'kta-template' | 'blc-template';
    setViewMode: (mode: 'actual' | 'kta-template' | 'blc-template') => void;
    year: number;
    month: number;
    prevMonth: () => void;
    nextMonth: () => void;
    handleClearMonth: () => void;
    onClose: () => void;
    onOpenMonthlyLabelsModal: () => void;
    onOpenInfoModal: () => void;
}

export function DutyHeader({
    viewMode, setViewMode,
    year, month, prevMonth, nextMonth, handleClearMonth, onClose,
    onOpenMonthlyLabelsModal, onOpenInfoModal
}: DutyHeaderProps) {
    return (
        <header className="h-20 border-b border-slate-850 px-8 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-6">
                {viewMode === 'kta-template' ? (
                    <span className="text-sm font-black tracking-widest px-2 text-rose-400 flex items-center gap-2.5">
                        <CalendarIcon className="w-5 h-5 text-rose-450" />
                        KTA 표준 일정 및 당직 제한 템플릿 편집 모드
                    </span>
                ) : viewMode === 'blc-template' ? (
                    <span className="text-sm font-black tracking-widest px-2 text-blue-400 flex items-center gap-2.5">
                        <CalendarIcon className="w-5 h-5 text-blue-450" />
                        BLC 표준 일정 템플릿 편집 모드
                    </span>
                ) : (
                    <div className="flex items-center gap-3.5 bg-slate-900 border border-slate-850 p-1.5 rounded-2xl">
                        <button
                            onClick={prevMonth}
                            className="p-2 hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-slate-200"
                        >
                            ◀
                        </button>
                        <span className="text-sm font-black tracking-widest px-2 text-slate-100 flex items-center gap-2">
                            <CalendarIcon className="w-4 h-4 text-indigo-400" />
                            {year}년 {month + 1}월
                        </span>
                        <button
                            onClick={nextMonth}
                            className="p-2 hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-slate-200"
                        >
                            ▶
                        </button>
                    </div>
                )}

                {viewMode === 'actual' && (
                    <div className="flex items-center gap-2 animate-in fade-in duration-200">
                        <button
                            onClick={onOpenInfoModal}
                            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 text-slate-350 hover:text-slate-200 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 cursor-pointer"
                            title="당직 작성 규칙 정보 확인"
                        >
                            <Info className="w-4 h-4 text-indigo-400 animate-pulse" />
                            <span>자동 적용 규칙 안내</span>
                        </button>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3">
                <div className={`flex items-center gap-2 transition-all duration-200 shrink-0 ${viewMode === 'actual' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                    }`}>
                    <button
                        onClick={handleClearMonth}
                        className="flex items-center gap-2 px-4 py-2.5 bg-red-950/20 hover:bg-red-950/60 border border-red-900/30 hover:border-red-800 text-red-300 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 shrink-0"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        당월 당직 초기화
                    </button>
                    <div className="h-6 w-px bg-slate-850 shrink-0" />
                </div>

                <button
                    onClick={() => {
                        setViewMode('actual');
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 border ${viewMode === 'actual'
                            ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/25 scale-[1.02]'
                            : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    실제 당직 작성
                </button>

                <button
                    onClick={() => {
                        setViewMode('kta-template');
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 border ${viewMode === 'kta-template'
                            ? 'bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-500/25 scale-[1.02]'
                            : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    KTA 표준 일정 편집
                </button>

                <button
                    onClick={() => {
                        setViewMode('blc-template');
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 border ${viewMode === 'blc-template'
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/25 scale-[1.02]'
                            : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    BLC 표준 일정 편집
                </button>

                <button
                    onClick={onOpenMonthlyLabelsModal}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 border bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200"
                >
                    <CalendarIcon className="w-3.5 h-3.5 text-emerald-450" />
                    날짜 레이블 편집
                </button>

                <div className="h-6 w-px bg-slate-850" />

                <button
                    onClick={onClose}
                    className="flex items-center justify-center w-10 h-10 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-2xl transition-all shadow-md active:scale-95 shrink-0"
                    title="모바일 화면으로"
                >
                    <LogOut className="w-4 h-4" />
                </button>
            </div>
        </header>
    );
}
