import { useState, useRef } from 'react';
import { cn } from '../../lib/utils';
import type { Member } from '../../types/member/member.type';

interface RollCallMentionInputProps {
    label: string;
    value: string;
    onChange: (val: string) => void;
    members: Member[];
    minHeight?: string;
}

export function RollCallMentionInput({
    label,
    value,
    onChange,
    members,
    minHeight = "min-h-[50px]"
}: RollCallMentionInputProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [mentionSearch, setMentionSearch] = useState<{ query: string, cursor: number } | null>(null);
    const [mentionSuggestions, setMentionSuggestions] = useState<Member[]>([]);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        const cursor = e.target.selectionStart;
        onChange(newValue);

        const textBeforeCursor = newValue.substring(0, cursor);
        const words = textBeforeCursor.split(/\s|\n/);
        const lastWord = words[words.length - 1];

        if (lastWord.length >= 1 && /^[가-힣]+$/.test(lastWord)) {
            const filtered = members.filter(m => m.name.startsWith(lastWord));
            if (filtered.length > 0) {
                setMentionSearch({ query: lastWord, cursor });
                setMentionSuggestions(filtered);
            } else {
                setMentionSearch(null);
            }
        } else {
            setMentionSearch(null);
        }
    };

    const insertMention = (member: Member) => {
        if (!mentionSearch) return;
        const before = value.substring(0, mentionSearch.cursor - mentionSearch.query.length);
        const after = value.substring(mentionSearch.cursor);

        const cleanRank = member.rank.split(' ')[0];
        const textToInsert = `${member.name} ${cleanRank} `;
        const newText = before + textToInsert + after;

        onChange(newText);
        
        const newCursorPos = before.length + textToInsert.length;
        setMentionSearch(null);

        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
            }
        }, 0);
    };

    const inputBase = "w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-900";
    const labelBase = "text-sm font-bold text-gray-700 mb-1.5 block ml-1";

    return (
        <section className="space-y-1.5 relative">
            <label className={labelBase}>{label}</label>
            {mentionSearch && (
                <div className="absolute bottom-full left-0 mb-2 z-[150] bg-white border border-gray-200 rounded-2xl shadow-2xl p-2 max-h-48 overflow-y-auto w-48 animate-in slide-in-from-bottom-2 duration-200">
                    <p className="text-[10px] font-bold text-gray-400 px-2 mb-1">부대원 선택</p>
                    {mentionSuggestions.map((m, idx) => (
                        <button
                            key={idx}
                            onClick={() => insertMention(m)}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 rounded-xl transition-colors flex items-center justify-between"
                        >
                            <span className="text-xs font-black text-gray-900">{m.name}</span>
                            <span className="text-[10px] font-bold text-blue-500">{m.rank.split(' ')[0]}</span>
                        </button>
                    ))}
                </div>
            )}
            <textarea
                ref={textareaRef}
                value={value}
                onChange={handleTextChange}
                className={cn(inputBase, minHeight, "resize-y")}
            />
        </section>
    );
}
