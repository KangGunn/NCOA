import { Calendar as CalendarIcon, Trash2, LogOut, Info, Download, Check } from 'lucide-react';
 
interface DutyHeaderProps {
    viewMode: 'actual' | 'kta-template' | 'blc-template';
    setViewMode: (mode: 'actual' | 'kta-template' | 'blc-template') => void;
    year: number;
    month: number;
    prevMonth: () => void;
    nextMonth: () => void;
    handleClearMonth: () => void;
    onClose: () => void;
    onOpenInfoModal: () => void;
    onExportImage?: () => void;
    onConfirmDuties: () => void;
}

export function DutyHeader({
    viewMode, setViewMode,
    year, month, prevMonth, nextMonth, handleClearMonth, onClose,
    onOpenInfoModal, onExportImage, onConfirmDuties
}: DutyHeaderProps) {
    return (
        <header className="h-20 border-b border-slate-850 px-4 md:px-8 flex items-center justify-between shrink-0 select-none">
            <div className="flex items-center gap-3 md:gap-4 xl:gap-6 min-w-0">
                {viewMode === 'kta-template' ? (
                    <span className="text-xs md:text-sm font-black tracking-widest px-2 text-rose-400 flex items-center gap-2.5 whitespace-nowrap">
                        <CalendarIcon className="w-5 h-5 text-rose-450 shrink-0" />
                        <span className="hidden md:inline">KTA 일정 템플릿 편집 모드</span>
                        <span className="inline md:hidden">KTA 템플릿 편집</span>
                    </span>
                ) : viewMode === 'blc-template' ? (
                    <span className="text-xs md:text-sm font-black tracking-widest px-2 text-blue-400 flex items-center gap-2.5 whitespace-nowrap">
                        <CalendarIcon className="w-5 h-5 text-blue-450 shrink-0" />
                        <span className="hidden md:inline">BLC 일정 템플릿 편집 모드</span>
                        <span className="inline md:hidden">BLC 템플릿 편집</span>
                    </span>
                ) : (
                    <div className="flex items-center gap-1.5 md:gap-3 bg-slate-900 border border-slate-850 p-1 md:p-1.5 rounded-2xl shrink-0">
                        <button
                            onClick={prevMonth}
                            className="p-1.5 md:p-2 hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-slate-200"
                        >
                            ◀
                        </button>
                        <span className="text-xs md:text-sm font-black tracking-widest px-1 md:px-2 text-slate-100 flex items-center gap-1.5 md:gap-2 whitespace-nowrap">
                            <CalendarIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            {year}년 {month + 1}월
                        </span>
                        <button
                            onClick={nextMonth}
                            className="p-1.5 md:p-2 hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-slate-200"
                        >
                            ▶
                        </button>
                    </div>
                )}

                {viewMode === 'actual' && (
                    <div className="flex items-center gap-1.5 md:gap-2 animate-in fade-in duration-200 shrink-0">
                        <button
                            onClick={onOpenInfoModal}
                            className="flex items-center justify-center w-9 h-9 md:w-10 md:h-10 bg-slate-900 border border-slate-850 hover:bg-slate-800 text-slate-350 hover:text-slate-200 rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer shrink-0"
                            title="자동 적용 규칙 안내"
                        >
                            <Info className="w-4 h-4 text-indigo-400 animate-pulse" />
                        </button>
                        <button
                            onClick={onExportImage}
                            className="flex items-center justify-center gap-1.5 px-3 md:px-4 h-9 md:h-10 bg-slate-900 border border-slate-850 hover:bg-slate-800 text-slate-350 hover:text-slate-200 rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer shrink-0 text-xs font-black whitespace-nowrap"
                            title="이미지 파일로 내보내기"
                        >
                            <Download className="w-4 h-4 text-indigo-450 shrink-0" />
                            <span className="hidden md:inline">이미지 저장</span>
                            <span className="inline md:hidden">저장</span>
                        </button>
                        <button
                            onClick={onConfirmDuties}
                            className="flex items-center justify-center gap-1.5 px-3 md:px-4 h-9 md:h-10 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl transition-all shadow-lg shadow-indigo-550/25 active:scale-95 cursor-pointer shrink-0 text-xs font-black whitespace-nowrap"
                            title="현재 플래너의 당직을 캘린더 DB에 저장"
                        >
                            <Check className="w-4 h-4 text-white shrink-0" />
                            <span className="hidden lg:inline">당직 확정하기</span>
                            <span className="inline lg:hidden">당직 확정</span>
                        </button>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-2 xl:gap-3 shrink-0">
                <div className={`flex items-center gap-1.5 md:gap-2 transition-all duration-200 shrink-0 ${viewMode === 'actual' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                    }`}>
                    <button
                        onClick={handleClearMonth}
                        className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 md:py-2.5 bg-red-950/20 hover:bg-red-950/60 border border-red-900/30 hover:border-red-800 text-red-300 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 shrink-0 whitespace-nowrap"
                    >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="hidden lg:inline">당월 당직 초기화</span>
                        <span className="inline lg:hidden">초기화</span>
                    </button>
                    <div className="h-6 w-px bg-slate-850 shrink-0" />
                </div>

                <button
                    onClick={() => {
                        setViewMode('actual');
                    }}
                    className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 border whitespace-nowrap ${viewMode === 'actual'
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/25 scale-[1.02]'
                        : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                >
                    <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden md:inline">실제 당직 작성</span>
                    <span className="inline md:hidden">실제 당직</span>
                </button>

                <button
                    onClick={() => {
                        setViewMode('kta-template');
                    }}
                    className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 border whitespace-nowrap ${viewMode === 'kta-template'
                        ? 'bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-500/25 scale-[1.02]'
                        : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                >
                    <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden md:inline">KTA 일정 편집</span>
                    <span className="inline md:hidden">KTA 일정</span>
                </button>

                <button
                    onClick={() => {
                        setViewMode('blc-template');
                    }}
                    className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-2xl text-xs font-black transition-all shadow-md active:scale-95 border whitespace-nowrap ${viewMode === 'blc-template'
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/25 scale-[1.02]'
                        : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                >
                    <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden md:inline">BLC 일정 편집</span>
                    <span className="inline md:hidden">BLC 일정</span>
                </button>

                <div className="h-6 w-px bg-slate-850 shrink-0" />

                <button
                    onClick={onClose}
                    className="flex items-center justify-center w-9 h-9 md:w-10 md:h-10 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-2xl transition-all shadow-md active:scale-95 shrink-0"
                    title="모바일 화면으로"
                >
                    <LogOut className="w-4 h-4 shrink-0" />
                </button>
            </div>
        </header>
    );
}
