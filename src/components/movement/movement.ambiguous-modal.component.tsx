/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface MovementAmbiguousModalProps {
    ambiguousMembers: any[];
    resolutions: Record<string, string>;
    setResolutions: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    handleSync: (resolvedData?: any[]) => void;
    cancelResolving: () => void;
}

export function MovementAmbiguousModal({
    ambiguousMembers,
    resolutions,
    setResolutions,
    handleSync,
    cancelResolving
}: MovementAmbiguousModalProps) {
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-6 text-white text-center">
                    <h3 className="text-xl font-black mb-1">동명이인 확인 필요</h3>
                    <p className="text-sm opacity-90 font-bold">엑셀의 이름과 일치하는 인원이 여러 명입니다.</p>
                </div>

                <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                    {ambiguousMembers.map((member, idx) => (
                        <div key={idx} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                            <div className="text-sm font-black text-gray-400 mb-3 uppercase tracking-tighter">
                                엑셀 표기: <span className="text-gray-800">{member.excelName}</span>
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                                {member.options.map((option: string) => (
                                    <button
                                        key={option}
                                        onClick={() => setResolutions(prev => ({ ...prev, [member.excelName]: option }))}
                                        className={cn(
                                            "p-3 rounded-xl text-sm font-black transition-all duration-200 border-2 text-left flex items-center justify-between",
                                            resolutions[member.excelName] === option
                                                ? "bg-orange-50 border-orange-500 text-orange-600 shadow-md scale-[1.02]"
                                                : "bg-white border-gray-100 text-gray-500 hover:border-orange-200"
                                        )}
                                    >
                                        {option}
                                        {resolutions[member.excelName] === option && <CheckCircle2 className="w-4 h-4" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-6 bg-gray-50 flex gap-3 border-t border-gray-100">
                    <button
                        onClick={cancelResolving}
                        className="flex-1 py-4 bg-white border border-gray-200 rounded-2xl text-gray-500 font-black hover:bg-gray-50 transition-colors"
                    >
                        취소
                    </button>
                    <button
                        onClick={() => handleSync()}
                        disabled={Object.keys(resolutions).length < ambiguousMembers.length}
                        className={cn(
                            "flex-1 py-4 rounded-2xl font-black text-white transition-all shadow-lg shadow-orange-200",
                            Object.keys(resolutions).length < ambiguousMembers.length
                                ? "bg-gray-300 cursor-not-allowed"
                                : "bg-orange-500 hover:bg-orange-600 active:scale-95"
                        )}
                    >
                        선택 완료 및 계속
                    </button>
                </div>
            </div>
        </div>
    );
}
