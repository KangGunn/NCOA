import { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { Upload, Database, Check, FileSpreadsheet } from 'lucide-react';

interface MovementHeaderProps {
    sheetMode: 'test' | 'prod' | null;
    toggleMode: () => void;
    handleFileUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function MovementHeader({ sheetMode, toggleMode, handleFileUpload }: MovementHeaderProps) {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsSettingsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <header className="flex items-center justify-between gap-2 sm:gap-4 mb-8">
            <div className="flex items-center h-[44px] min-w-0">
                <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-gray-900 tracking-tight truncate">
                    외박 특이사항
                </h1>
            </div>

            <div className="flex items-center shrink-0 gap-1.5 sm:gap-2">
                <a
                    href={
                        sheetMode === 'prod'
                            ? "https://docs.google.com/spreadsheets/d/1WBJXIzLbbtRxt09KOaJeXKXtgbht-GDjX3N4DyDztOY/edit#gid=1529486829"
                            : "https://docs.google.com/spreadsheets/d/1eyiNzyvJ1BguGzzpkYDnVegi-4U-zuCacCvy9bOW8R8/edit#gid=1529486829"
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center w-[44px] h-[44px] bg-white border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm shrink-0"
                    title={`Google 스프레드시트(유동) 열기 (${sheetMode === 'prod' ? 'PROD' : 'TEST'})`}
                >
                    <FileSpreadsheet className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
                </a>

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

                {/* 설정 (PROD / TEST 모드 전환) 드롭다운 */}
                <div className="relative shrink-0" ref={menuRef}>
                    <button
                        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        title={`환경 설정 (${sheetMode === 'prod' ? 'PROD' : 'TEST'})`}
                        className="flex items-center justify-center w-[44px] h-[44px] bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
                    >
                        <Database
                            className={cn(
                                "w-4 h-4 sm:w-5 sm:h-5 transition-colors",
                                sheetMode === 'prod' ? "text-red-500 hover:text-red-600" :
                                sheetMode === 'test' ? "text-blue-500 hover:text-blue-600" :
                                "text-gray-400"
                            )}
                        />
                    </button>

                    {isSettingsOpen && (
                        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                            <div className="px-3 py-2 border-b border-gray-100 mb-1">
                                <p className="text-xs font-semibold text-gray-400">데이터 환경 설정 (비상용)</p>
                            </div>
                            
                            {sheetMode === null ? (
                                <div className="p-3 text-center text-xs text-gray-400">
                                    로딩 중...
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <button
                                        onClick={() => {
                                            if (sheetMode !== 'prod') toggleMode();
                                            setIsSettingsOpen(false);
                                        }}
                                        className={cn(
                                            "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all text-left",
                                            sheetMode === 'prod'
                                                ? "bg-red-50 text-red-600"
                                                : "text-gray-600 hover:bg-gray-50"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Database className="w-4 h-4 text-red-500" />
                                            <span>PROD (운영 서버)</span>
                                        </div>
                                        {sheetMode === 'prod' && <Check className="w-4 h-4 text-red-600" />}
                                    </button>

                                    <button
                                        onClick={() => {
                                            if (sheetMode !== 'test') toggleMode();
                                            setIsSettingsOpen(false);
                                        }}
                                        className={cn(
                                            "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all text-left",
                                            sheetMode === 'test'
                                                ? "bg-blue-50 text-blue-600"
                                                : "text-gray-600 hover:bg-gray-50"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Database className="w-4 h-4 text-blue-500" />
                                            <span>TEST (테스트 서버)</span>
                                        </div>
                                        {sheetMode === 'test' && <Check className="w-4 h-4 text-blue-600" />}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
