import { usePersonnel } from '../../hooks/personnel/personnel.hook';
import { PersonnelHeader } from '../personnel/personnel.header.component';
import { PersonnelFormModal } from '../personnel/personnel.form-modal.component';
import { PersonnelDetailModal } from '../personnel/personnel.detail-modal.component';
import { calculateRank } from '../../lib/rankUtils';
import { Plus, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface PersonnelTabProps {
    baseDate: Date;
}

export default function PersonnelTab({ baseDate }: PersonnelTabProps) {
    const {
        addOpen,
        setAddOpen,
        addingRunner,
        setAddingRunner,
        setSelectedId,
        detailMember,
        regularMembers,
        runners,
        activeRegularCount,
    } = usePersonnel(baseDate);

    const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;

    return (
        <div className="pt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            <PersonnelHeader
                regularMembersCount={activeRegularCount}
                onAddClick={() => {
                    setAddingRunner(false);
                    setAddOpen(true);
                }}
            />

            <div className="flex flex-col gap-2.5">
                {regularMembers.length === 0 ? (
                    <p className="text-center text-gray-400 font-medium py-16 px-4 rounded-2xl border-2 border-dashed border-gray-100">
                        등록된 부대원이 없습니다. 우측 상단에서 추가해 주세요.
                    </p>
                ) : (
                    regularMembers.map((m) => {
                        const isFuture = m.joinDate && dateStr < m.joinDate;
                        return (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setSelectedId(m.id)}
                                className={cn(
                                    'w-full px-5 py-4 rounded-2xl border-2 text-left font-bold transition-all flex items-center justify-between gap-3',
                                    'bg-white border-gray-100 text-gray-700 hover:border-gray-300 active:scale-[0.99]',
                                    isFuture && 'opacity-65 bg-slate-50/50'
                                )}
                            >
                                <div className="flex flex-col min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base font-black text-gray-900 truncate">{m.name}</span>
                                        {isFuture && (
                                            <span className="px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-600 text-[9px] font-extrabold shrink-0">
                                                {m.joinDate?.slice(5).replace('-', '/')} 전입 예정
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-sm font-bold text-gray-500 shrink-0">
                                            {m.role === 'runner' 
                                                ? m.rank 
                                                : calculateRank(new Date(m.enlistmentDate), m.earlyPromotion || 0, baseDate)
                                            }
                                        </span>
                                        {(m.earlyPromotion || 0) > 0 && (
                                            <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-600 text-[9px] font-extrabold">{m.earlyPromotion}조진</span>
                                        )}
                                        {m.role !== 'runner' && (m.sections?.length || 0) > 0 && (
                                            <div className="flex gap-1 flex-wrap">
                                                {(m.sections || []).map(s => (
                                                    <span key={s} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-600 text-[9px] uppercase tracking-wider font-extrabold">{s}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
                            </button>
                        );
                    })
                )}
            </div>

            <div className="mt-12 flex items-center justify-between pb-3 border-b-2 border-gray-100">
                <h2 className="text-xl font-black text-gray-900">미군 러너</h2>
                <button
                    type="button"
                    onClick={() => { setAddingRunner(true); setAddOpen(true); }}
                    className="text-sm font-bold text-blue-600 flex items-center gap-1.5 hover:text-blue-700 transition-colors"
                >
                    <Plus className="w-4 h-4" /> 러너 추가
                </button>
            </div>
            
            <div className="flex flex-col gap-2.5 mt-4">
                {runners.length === 0 ? (
                    <p className="text-center text-gray-400 font-medium py-12 px-4 rounded-2xl border-2 border-dashed border-gray-100">
                        등록된 미군 러너가 없습니다.
                    </p>
                ) : (
                    runners.map((m) => (
                        <button
                            key={m.id}
                            type="button"
                            onClick={() => setSelectedId(m.id)}
                            className={cn(
                                'w-full px-5 py-4 rounded-2xl border-2 text-left font-bold transition-all flex items-center justify-between gap-3',
                                'bg-indigo-50/50 border-indigo-100 text-indigo-900 hover:border-indigo-200 active:scale-[0.99]'
                            )}
                        >
                            <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-base font-black truncate">{m.name}</span>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-sm font-bold text-indigo-500/80 shrink-0">
                                        {m.role === 'runner' ? m.rank.split(' ')[0] : m.rank}
                                    </span>
                                    {m.role !== 'runner' && (m.sections?.length || 0) > 0 && (
                                        <div className="flex gap-1 flex-wrap">
                                            {(m.sections || []).map(s => (
                                                <span key={s} className="px-1.5 py-0.5 rounded bg-indigo-100/50 border border-indigo-200 text-indigo-600 text-[9px] uppercase tracking-wider font-extrabold">{s}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-indigo-300 shrink-0" />
                        </button>
                    ))
                )}
            </div>

            {addOpen && (
                <PersonnelFormModal
                    title={addingRunner ? "미군 러너 추가" : "부대원 추가"}
                    isRunner={addingRunner}
                    onClose={() => setAddOpen(false)}
                    onSaved={() => setAddOpen(false)}
                />
            )}

            {detailMember && (
                <PersonnelDetailModal
                    member={detailMember}
                    baseDate={baseDate}
                    onClose={() => setSelectedId(null)}
                    onDeleted={() => setSelectedId(null)}
                />
            )}
        </div>
    );
}
