import { Calendar as CalendarIcon, Trash2, LogOut, Info, Download, Check, Zap } from 'lucide-react';

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
    isForceAssignMode: boolean;
    setIsForceAssignMode: (val: boolean) => void;
}

export function DutyHeader({
    viewMode, setViewMode,
    year, month, prevMonth, nextMonth, handleClearMonth, onClose,
    onOpenInfoModal, onExportImage, onConfirmDuties,
    isForceAssignMode, setIsForceAssignMode
}: DutyHeaderProps) {
    const containerStyle = {
        gap: 'clamp(4px, 0.9vw, 18px)'
    };
    const dividerStyle = {
        marginLeft: 'calc(clamp(4px, 0.9vw, 18px) * -0.5)',
        marginRight: 'calc(clamp(4px, 0.9vw, 18px) * -0.5)'
    };
    const infoCloseStyle = {
        width: 'clamp(32px, 2.6vw, 40px)',
        height: 'clamp(32px, 2.6vw, 40px)'
    };
    const buttonStyle = {
        fontSize: 'clamp(9.5px, 0.7vw, 12px)',
        height: 'clamp(32px, 2.6vw, 40px)'
    };

    return (
        <header className="h-20 border-b border-slate-850 px-3 md:px-6 flex items-center justify-between shrink-0 select-none gap-4 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-2 md:gap-3 xl:gap-4 shrink-0">
                {viewMode === 'kta-template' ? (
                    <span className="text-xs md:text-sm font-black tracking-widest px-2 text-rose-400 flex items-center gap-2.5 whitespace-nowrap">
                        <CalendarIcon className="w-5 h-5 text-rose-455 shrink-0" />
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
                    <div className="flex items-center gap-1 md:gap-2 bg-slate-900 border border-slate-850 p-0.5 md:p-1 rounded-xl shrink-0">
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
            </div>

            <div className="flex-1 min-w-0 flex items-center justify-end shrink-0" style={containerStyle}>
                {viewMode === 'actual' && (
                    <>
                        <button
                            onClick={onOpenInfoModal}
                            className="flex items-center justify-center bg-slate-900 border border-slate-850 hover:bg-slate-800 text-slate-350 hover:text-slate-200 rounded-xl 2xl:rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer shrink-0"
                            title="자동 적용 규칙 안내"
                            style={infoCloseStyle}
                        >
                            <Info className="w-3.5 h-3.5 2xl:w-4 2xl:h-4 text-indigo-400 animate-pulse" />
                        </button>
                        <button
                            onClick={onExportImage}
                            className="flex items-center justify-center gap-1 bg-slate-900 border border-slate-850 hover:bg-slate-800 text-slate-350 hover:text-slate-200 rounded-xl 2xl:rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer shrink-0 grow min-w-0 max-w-[140px] font-black whitespace-nowrap text-center"
                            title="이미지 파일로 내보내기"
                            style={buttonStyle}
                        >
                            <Download className="w-3.5 h-3.5 2xl:w-4 2xl:h-4 text-indigo-455 shrink-0" />
                            <span className="hidden 2xl:inline">이미지 저장</span>
                            <span className="inline 2xl:hidden">이미지</span>
                        </button>
                        <button
                            onClick={onConfirmDuties}
                            className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl 2xl:rounded-2xl transition-all shadow-lg shadow-indigo-550/25 active:scale-95 cursor-pointer shrink-0 grow min-w-0 max-w-[140px] font-black whitespace-nowrap text-center"
                            title="현재 플래너의 당직을 캘린더 DB에 저장"
                            style={buttonStyle}
                        >
                            <Check className="w-3.5 h-3.5 2xl:w-4 2xl:h-4 text-white shrink-0" />
                            <span className="hidden 2xl:inline">당직 확정하기</span>
                            <span className="inline 2xl:hidden">당직 확정</span>
                        </button>
                        <div className="h-6 w-px bg-slate-850 shrink-0" style={dividerStyle} />
                        <button
                            onClick={() => setIsForceAssignMode(!isForceAssignMode)}
                            className={`flex items-center justify-center gap-1 border rounded-xl 2xl:rounded-2xl font-black transition-all shadow-md active:scale-95 shrink-0 grow min-w-0 max-w-[140px] whitespace-nowrap ${
                                isForceAssignMode
                                    ? 'bg-amber-600 border-amber-500 text-white shadow-lg shadow-amber-500/25 scale-[1.02]'
                                    : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                            }`}
                            title="제한 대원 강제 배정 모드 토글"
                            style={buttonStyle}
                        >
                            <Zap className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 shrink-0" />
                            <span>강제 배정</span>
                        </button>
                        <button
                            onClick={handleClearMonth}
                            className="flex items-center justify-center gap-1 bg-red-950/20 hover:bg-red-950/60 border border-red-900/30 hover:border-red-800 text-red-300 rounded-xl 2xl:rounded-2xl font-black transition-all shadow-md active:scale-95 shrink-0 grow min-w-0 max-w-[140px] whitespace-nowrap text-center"
                            style={buttonStyle}
                        >
                            <Trash2 className="w-3.5 h-3.5 2xl:w-4 2xl:h-4 shrink-0" />
                            <span className="hidden 2xl:inline">당월 당직 초기화</span>
                            <span className="inline 2xl:hidden">초기화</span>
                        </button>
                        <div className="h-6 w-px bg-slate-850 shrink-0" style={dividerStyle} />
                    </>
                )}

                <button
                    onClick={() => {
                        setViewMode('actual');
                    }}
                    className={`flex items-center justify-center gap-1 rounded-xl 2xl:rounded-2xl font-black transition-all shadow-md active:scale-95 border whitespace-nowrap text-center grow shrink min-w-0 max-w-[140px] ${viewMode === 'actual'
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/25 scale-[1.02]'
                        : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                    style={buttonStyle}
                >
                    <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden 2xl:inline">실제 당직 작성</span>
                    <span className="inline 2xl:hidden">당직 작성</span>
                </button>

                <button
                    onClick={() => {
                        setViewMode('kta-template');
                    }}
                    className={`flex items-center justify-center gap-1 rounded-xl 2xl:rounded-2xl font-black transition-all shadow-md active:scale-95 border whitespace-nowrap text-center grow shrink min-w-0 max-w-[140px] ${viewMode === 'kta-template'
                        ? 'bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-500/25 scale-[1.02]'
                        : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                    style={buttonStyle}
                >
                    <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden 2xl:inline">KTA 일정 편집</span>
                    <span className="inline 2xl:hidden">KTA 일정</span>
                </button>

                <button
                    onClick={() => {
                        setViewMode('blc-template');
                    }}
                    className={`flex items-center justify-center gap-1 rounded-xl 2xl:rounded-2xl font-black transition-all shadow-md active:scale-95 border whitespace-nowrap text-center grow shrink min-w-0 max-w-[140px] ${viewMode === 'blc-template'
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/25 scale-[1.02]'
                        : 'bg-slate-900 border-slate-850 text-slate-350 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                    style={buttonStyle}
                >
                    <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden 2xl:inline">BLC 일정 편집</span>
                    <span className="inline 2xl:hidden">BLC 일정</span>
                </button>

                <div className="h-6 w-px bg-slate-850 shrink-0" style={dividerStyle} />

                <button
                    onClick={onClose}
                    className="flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl 2xl:rounded-2xl transition-all shadow-md active:scale-95 shrink-0"
                    title="모바일 화면으로"
                    style={infoCloseStyle}
                >
                    <LogOut className="w-3.5 h-3.5 2xl:w-4 2xl:h-4 shrink-0" />
                </button>
            </div>
        </header>
    );
}
