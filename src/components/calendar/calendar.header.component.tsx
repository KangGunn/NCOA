import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CalendarHeaderProps {
    currentDate: Date;
    prevMonth: () => void;
    nextMonth: () => void;
    mode: 'schedule' | 'duty';
    setMode: (mode: 'schedule' | 'duty') => void;
}

export function CalendarHeader({ currentDate, prevMonth, nextMonth, mode, setMode }: CalendarHeaderProps) {
    return (
        <header className="flex items-start justify-between mb-8 gap-2">
            <div className="flex items-center gap-3 h-[44px] min-w-0">
                <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight whitespace-nowrap truncate">
                    {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
                </h1>
                
                {/* Mode Switcher capsule */}
                <div className="flex bg-gray-100/80 p-0.5 rounded-xl items-center text-[10px] sm:text-xs font-black relative shrink-0 border border-gray-200/30">
                    <button
                        onClick={() => setMode('duty')}
                        className={cn(
                            "px-2.5 py-1.5 rounded-lg transition-all duration-200 cursor-pointer whitespace-nowrap",
                            mode === 'duty' 
                                ? "bg-white text-gray-900 shadow-sm" 
                                : "text-gray-400 hover:text-gray-655"
                        )}
                    >
                        당직
                    </button>
                    <button
                        onClick={() => setMode('schedule')}
                        className={cn(
                            "px-2.5 py-1.5 rounded-lg transition-all duration-200 cursor-pointer whitespace-nowrap",
                            mode === 'schedule' 
                                ? "bg-white text-gray-900 shadow-sm" 
                                : "text-gray-400 hover:text-gray-650"
                        )}
                    >
                        일정
                    </button>
                </div>
            </div>
            <div className="flex gap-2 shrink-0">
                <button 
                    onClick={prevMonth} 
                    className="w-11 h-11 bg-gray-50 rounded-2xl text-gray-400 hover:text-gray-900 transition-colors flex items-center justify-center"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <button 
                    onClick={nextMonth} 
                    className="w-11 h-11 bg-gray-50 rounded-2xl text-gray-400 hover:text-gray-900 transition-colors flex items-center justify-center"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </header>
    );
}
