/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Upload, ChevronLeft, ChevronRight } from 'lucide-react';
import { MovementGrid } from './movement.grid.component';

interface MovementSheetViewProps {
    sheetWeeks: any[];
    currentWeekIndex: number;
    setCurrentWeekIndex: React.Dispatch<React.SetStateAction<number>>;
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    dbMembers: any[];
    baseDate?: Date;
}

export function MovementSheetView({
    sheetWeeks,
    currentWeekIndex,
    setCurrentWeekIndex,
    handleFileUpload,
    dbMembers,
    baseDate
}: MovementSheetViewProps) {
    if (sheetWeeks.length === 0) return null;

    const currentWeek = sheetWeeks[currentWeekIndex];

    return (
        <div className="space-y-4 animate-in zoom-in-95 duration-300">
            <div className="flex flex-col sm:flex-row items-center justify-between bg-white border border-gray-200 rounded-2xl p-2 sm:p-3 shadow-sm gap-2 sm:gap-4 overflow-visible">
                {/* Left: File upload button */}
                <div className="relative group shrink-0 w-full sm:w-auto">
                    <input
                        type="file"
                        accept=".xlsx, .xls"
                        onChange={handleFileUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <button className="flex items-center justify-center gap-1.5 px-2.5 sm:px-4 h-[44px] bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm w-full">
                        <Upload className="w-4 h-4 text-blue-500 shrink-0" />
                        <span className="hidden sm:inline">엑셀 파일 업로드</span>
                        <span className="inline sm:hidden">업로드</span>
                    </button>
                </div>

                {/* Center: Date Range */}
                <div className="text-[17px] sm:text-lg md:text-xl font-black text-gray-900 tracking-tight text-center whitespace-normal break-words shrink-0">
                    {currentWeek.startDate} ~ {currentWeek.endDate}
                </div>

                {/* Right: Navigation buttons side-by-side */}
                <div className="flex items-center justify-center gap-1.5 shrink-0">
                    <button
                        onClick={() => setCurrentWeekIndex(i => Math.max(0, i - 1))}
                        disabled={currentWeekIndex === 0}
                        className="w-9 h-9 sm:w-11 sm:h-11 bg-gray-50 rounded-xl flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-gray-50 transition-all text-gray-600"
                    >
                        <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    <button
                        onClick={() => setCurrentWeekIndex(i => Math.min(sheetWeeks.length - 1, i + 1))}
                        disabled={currentWeekIndex === sheetWeeks.length - 1}
                        className="w-9 h-9 sm:w-11 sm:h-11 bg-gray-50 rounded-xl flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-gray-50 transition-all text-gray-600"
                    >
                        <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                </div>
            </div>

            <MovementGrid
                timeline={currentWeek.timeline}
                dataList={currentWeek.data}
                dbMembers={dbMembers}
                baseDate={baseDate}
            />
        </div>
    );
}
