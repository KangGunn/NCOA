import { useState } from 'react';
import { Copy, Check, FileText } from 'lucide-react';
import { cn } from '../../lib/utils';

interface RollCallPreviewProps {
    eveningReportText: string;
    morningReportText: string;
}

export function RollCallPreview({ eveningReportText, morningReportText }: RollCallPreviewProps) {
    const [copiedType, setCopiedType] = useState<'evening' | 'morning' | null>(null);

    const handleCopy = (text: string, type: 'evening' | 'morning') => {
        navigator.clipboard.writeText(text);
        setCopiedType(type);
        setTimeout(() => setCopiedType(null), 2000);
    };

    return (
        <div className="pt-8 space-y-6">
            <h2 className="text-2xl font-black text-gray-900 tracking-tight ml-1">점호 보고서 미리보기</h2>

            {/* Evening Roll Call Preview */}
            <div className="rounded-3xl bg-slate-900 shadow-2xl border border-slate-800 relative flex flex-col">
                <div className="absolute top-0 left-0 p-4 opacity-5 pointer-events-none">
                    <FileText className="w-48 h-48 text-white" />
                </div>

                <div className="flex items-center justify-between p-5 border-b border-slate-800 relative z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                        <span className="text-sm font-black text-slate-200 tracking-wide">저녁점호 보고</span>
                    </div>

                    <button
                        onClick={() => handleCopy(eveningReportText, 'evening')}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95",
                            copiedType === 'evening'
                                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                : "bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30"
                        )}
                    >
                        {copiedType === 'evening' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {copiedType === 'evening' ? '복사 완료' : '문자 복사하기'}
                    </button>
                </div>

                <div className="p-6 relative z-10">
                    <pre className="text-[13px] leading-relaxed text-slate-300 font-mono whitespace-pre-wrap break-all">
                        {eveningReportText}
                    </pre>
                </div>
            </div>

            {/* Morning Roll Call Preview */}
            <div className="rounded-3xl bg-slate-900 shadow-2xl border border-slate-800 relative flex flex-col">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <FileText className="w-48 h-48 text-white" />
                </div>

                <div className="flex items-center justify-between p-5 border-b border-slate-800 relative z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                        <span className="text-sm font-black text-slate-200 tracking-wide">아침점호 보고</span>
                    </div>

                    <button
                        onClick={() => handleCopy(morningReportText, 'morning')}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95",
                            copiedType === 'morning'
                                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                : "bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 border border-yellow-500/30"
                        )}
                    >
                        {copiedType === 'morning' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {copiedType === 'morning' ? '복사 완료' : '문자 복사하기'}
                    </button>
                </div>

                <div className="p-6 relative z-10">
                    <pre className="text-[13px] leading-relaxed text-slate-300 font-mono whitespace-pre-wrap break-all">
                        {morningReportText}
                    </pre>
                </div>
            </div>
        </div>
    );
}
