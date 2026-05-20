import { cn } from '../../lib/utils';
import type { Member } from '../../types/member/member.type';

interface RollCallMemberButtonProps {
    member: Member;
    isDuty: boolean;
    isAway: boolean;
    isSelectedHere: boolean;
    isSelectedElsewhere: boolean;
    onClick: () => void;
}

export function RollCallMemberButton({
    member,
    isDuty,
    isAway,
    isSelectedHere,
    isSelectedElsewhere,
    onClick
}: RollCallMemberButtonProps) {
    const isDisabled = isDuty || isAway;

    return (
        <button
            onClick={() => {
                if (!isDisabled) {
                    onClick();
                }
            }}
            disabled={isDisabled}
            className={cn(
                "px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl text-[10px] sm:text-[11px] font-black transition-all border break-keep",
                isDuty
                    ? "bg-amber-100 border-amber-300 text-amber-700 opacity-80 cursor-not-allowed"
                    : isAway
                        ? "bg-slate-100 border-slate-200 text-slate-400 opacity-60 cursor-not-allowed"
                        : isSelectedHere
                            ? "bg-blue-500 border-blue-600 text-white shadow-md shadow-blue-200/50 scale-105"
                            : isSelectedElsewhere
                                ? "bg-white border border-dashed border-gray-400 text-gray-400"
                                : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-white hover:border-gray-300"
            )}
        >
            {member.name}
        </button>
    );
}
