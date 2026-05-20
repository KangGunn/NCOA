import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarHeaderProps {
    currentDate: Date;
    prevMonth: () => void;
    nextMonth: () => void;
}

export function CalendarHeader({ currentDate, prevMonth, nextMonth }: CalendarHeaderProps) {
    return (
        <header className="flex items-start justify-between mb-8 gap-2">
            <div className="flex items-center h-[44px]">
                <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight whitespace-nowrap">
                    {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
                </h1>
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
