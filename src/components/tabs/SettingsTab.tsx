import { useState } from 'react';
import { Settings, ArrowRightLeft, ShieldCheck, AlertCircle } from 'lucide-react';
import { useMovementSettings } from '../../hooks/movement/useMovementSettings';

export default function SettingsTab() {
    const { allowVacationPassLink, updateAllowVacationPassLink, loading } = useMovementSettings();
    const [saving, setSaving] = useState(false);

    const handleToggle = async () => {
        if (loading || saving) return;
        setSaving(true);
        try {
            await updateAllowVacationPassLink(!allowVacationPassLink);
        } catch (e) {
            console.error('설정 저장 실패:', e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50/50 pb-28 pt-6 px-4 sm:px-6 max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-6">
                <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-sm">
                    <Settings className="w-5 h-5" />
                </div>
                <div>
                    <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">설정</h1>
                    <p className="text-xs text-slate-500 font-medium">부대 출타 및 시스템 동작 환경을 설정합니다.</p>
                </div>
            </div>

            {/* Section: 출타 연계 관리 */}
            <div className="space-y-4">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
                    출타 연계 정책
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden divide-y divide-slate-100">
                    {/* Setting Item: 휴외연계 허용 스위치 */}
                    <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3.5 flex-1">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                                allowVacationPassLink ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'
                            }`}>
                                <ArrowRightLeft className="w-5 h-5" />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm sm:text-base font-bold text-slate-900">
                                        휴외연계 허용
                                    </span>
                                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full transition-colors ${
                                        allowVacationPassLink 
                                            ? 'bg-blue-100 text-blue-700' 
                                            : 'bg-slate-100 text-slate-500'
                                    }`}>
                                        {allowVacationPassLink ? '허용됨 (O)' : '미허용 (X)'}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-600 leading-relaxed">
                                    휴가 종료일(복귀일)에 바로 외박을 출발하는 경우, 부대에 복귀하지 않고 외박을 연속하여 출발하도록 허용합니다.
                                </p>
                            </div>
                        </div>

                        {/* Toggle Switch Button */}
                        <div className="flex items-center self-end sm:self-center shrink-0">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={allowVacationPassLink}
                                disabled={loading || saving}
                                onClick={handleToggle}
                                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                                    allowVacationPassLink ? 'bg-blue-600' : 'bg-slate-300'
                                } ${loading || saving ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                                <span className="sr-only">휴외연계 허용 토글</span>
                                <span
                                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                        allowVacationPassLink ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>

                    {/* Policy Detail Guide Box */}
                    <div className="bg-slate-50/70 p-4 sm:p-5 text-xs text-slate-600 space-y-2">
                        <div className="font-bold text-slate-800 flex items-center gap-1.5 mb-1.5">
                            <ShieldCheck className="w-4 h-4 text-blue-600" />
                            <span>휴외연계 설정에 따른 적용 기준</span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2.5">
                            <div className={`p-3 rounded-xl border transition-colors ${
                                allowVacationPassLink 
                                    ? 'bg-blue-50/80 border-blue-200/80 text-blue-900' 
                                    : 'bg-white border-slate-200 text-slate-600'
                            }`}>
                                <div className="font-bold flex items-center gap-1.5 mb-1">
                                    <span className={`w-2 h-2 rounded-full ${allowVacationPassLink ? 'bg-blue-600' : 'bg-slate-400'}`} />
                                    <span>휴외연계 허용 시 (O)</span>
                                </div>
                                <p className="text-[11px] leading-relaxed opacity-90">
                                    휴가 복귀를 하지 않아도 되므로, <strong>휴가 마지막 날의 복귀 인원 리스트에서 제외</strong>됩니다.
                                </p>
                            </div>

                            <div className={`p-3 rounded-xl border transition-colors ${
                                !allowVacationPassLink 
                                    ? 'bg-amber-50/80 border-amber-200/80 text-amber-900' 
                                    : 'bg-white border-slate-200 text-slate-600'
                            }`}>
                                <div className="font-bold flex items-center gap-1.5 mb-1">
                                    <span className={`w-2 h-2 rounded-full ${!allowVacationPassLink ? 'bg-amber-600' : 'bg-slate-400'}`} />
                                    <span>휴외연계 미허용 시 (X)</span>
                                </div>
                                <p className="text-[11px] leading-relaxed opacity-90">
                                    휴가 복귀 후 다시 외박을 출발하므로, <strong>휴가 마지막 날의 복귀 인원 리스트에 포함</strong>됩니다.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start gap-1.5 text-[11px] text-slate-500 pt-1">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                            <span>
                                점호 보고는 허용 여부와 관계없이 동일하게 <strong>휴가 복귀일 저녁 점호 보고부터 외박</strong>으로 처리됩니다.
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
