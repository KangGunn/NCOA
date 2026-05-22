import { Plus } from 'lucide-react';

interface PersonnelHeaderProps {
    regularMembersCount: number;
    onAddClick: () => void;
}

export function PersonnelHeader({ regularMembersCount, onAddClick }: PersonnelHeaderProps) {
    return (
        <header className="flex items-start justify-between gap-2 sm:gap-4 mb-8">
            <div className="flex flex-col justify-start">
                <div className="flex items-center h-[44px]">
                    <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight whitespace-nowrap">
                        인원 <span className="text-blue-600 text-xl sm:text-2xl ml-1">{regularMembersCount}</span><span className="text-lg sm:text-xl text-gray-400">명</span>
                    </h1>
                </div>
                <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">부대원 정보를 관리합니다.</p>
            </div>
            <button
                type="button"
                onClick={onAddClick}
                className="shrink-0 flex items-center gap-2 px-4 h-[44px] rounded-2xl bg-blue-600 text-white font-bold text-sm shadow-lg shadow-blue-200 active:scale-[0.98] transition-all"
            >
                <Plus className="w-5 h-5" strokeWidth={2.5} />
                부대원 추가
            </button>
        </header>
    );
}
