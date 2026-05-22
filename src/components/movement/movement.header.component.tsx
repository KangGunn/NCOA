import { cn } from '../../lib/utils';

interface MovementHeaderProps {
    sheetMode: 'test' | 'prod' | null;
    toggleMode: () => void;
}

export function MovementHeader({ sheetMode, toggleMode }: MovementHeaderProps) {
    return (
        <header className="flex items-start justify-between gap-2 sm:gap-4 mb-8">
            <div className="flex items-center h-[44px]">
                <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight whitespace-nowrap">
                    외박 특이사항
                </h1>
            </div>

            <div className="flex items-center bg-gray-100 p-1 rounded-2xl w-[180px] h-[44px] justify-center shrink-0">
                {sheetMode === null ? (
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                    <>
                        <button
                            onClick={toggleMode}
                            className={cn(
                                "flex-1 h-full rounded-xl text-sm font-black transition-all",
                                sheetMode === 'prod'
                                    ? "bg-white text-red-600 shadow-sm"
                                    : "text-gray-400 hover:text-gray-600"
                            )}
                        >
                            PROD
                        </button>
                        <button
                            onClick={toggleMode}
                            className={cn(
                                "flex-1 h-full rounded-xl text-sm font-black transition-all",
                                sheetMode === 'test'
                                    ? "bg-white text-blue-600 shadow-sm"
                                    : "text-gray-400 hover:text-gray-600"
                            )}
                        >
                            TEST
                        </button>
                    </>
                )}
            </div>
        </header>
    );
}
