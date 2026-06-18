import { cn } from '../../lib/utils';
import { Upload } from 'lucide-react';

interface MovementHeaderProps {
    sheetMode: 'test' | 'prod' | null;
    toggleMode: () => void;
    handleFileUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function MovementHeader({ sheetMode, toggleMode, handleFileUpload }: MovementHeaderProps) {
    return (
        <header className="flex items-center justify-between gap-2 sm:gap-4 mb-8">
            <div className="flex items-center h-[44px] min-w-0">
                <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-gray-900 tracking-tight truncate">
                    외박 특이사항
                </h1>
            </div>

            <div className="flex items-center shrink-0 gap-1.5 sm:gap-2">
                {sheetMode === null ? (
                    <div className="flex items-center bg-gray-100 p-1 rounded-2xl w-[80px] sm:w-[100px] h-[44px] justify-center">
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <button
                        onClick={toggleMode}
                        className={cn(
                            "h-[44px] px-3 sm:px-6 rounded-2xl text-xs sm:text-sm font-black transition-all shadow-sm flex items-center justify-center min-w-[70px] sm:min-w-[100px] shrink-0",
                            sheetMode === 'prod'
                                ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                                : "bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                        )}
                    >
                        {sheetMode === 'prod' ? 'PROD' : 'TEST'}
                    </button>
                )}

                {handleFileUpload && (
                    <div className="relative group w-auto shrink-0">
                        <input
                            type="file"
                            accept=".xlsx, .xls"
                            onChange={handleFileUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        />
                        <button className="flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-4 h-[44px] bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm w-auto whitespace-nowrap">
                            <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-500 shrink-0" />
                            <span>업로드</span>
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
}
