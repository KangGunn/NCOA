import { useState, useEffect } from 'react';
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    where,
    getDocs,
    writeBatch,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
    calculateRank,
    DEFAULT_ARMY_SERVICE_MONTHS,
    formatExpectedDischargeFromEnlistmentStr,
} from '../../lib/rankUtils';
import { Plus, ChevronRight, X, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface MemberDoc {
    id: string;
    name: string;
    rank: string;
    enlistmentDate: string;
    role?: 'member' | 'runner';
    sections?: string[];
    earlyPromotion?: number;
    updatedAt?: unknown;
}

export default function PersonnelTab() {
    const [members, setMembers] = useState<MemberDoc[]>([]);
    const [addOpen, setAddOpen] = useState(false);
    const [addingRunner, setAddingRunner] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const detailMember = selectedId
        ? members.find((m) => m.id === selectedId) ?? null
        : null;

    useEffect(() => {
        const unsub = onSnapshot(query(collection(db, 'members')), (snap) => {
            const rows: MemberDoc[] = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<MemberDoc, 'id'>),
            }));
            setMembers(rows);
        });
        return () => unsub();
    }, []);

    const sortedMembers = [...members].sort((a, b) => {
        const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
        const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
        if (dateA !== dateB) {
            return dateA < dateB ? -1 : 1;
        }
        
        const nameA = typeof a.name === 'string' ? a.name.trim() : '';
        const nameB = typeof b.name === 'string' ? b.name.trim() : '';
        if (nameA !== nameB) {
            return nameA < nameB ? -1 : 1;
        }
        return 0;
    });

    const regularMembers = sortedMembers.filter(m => m.role !== 'runner');
    const runners = sortedMembers.filter(m => m.role === 'runner');

    return (
        <div className="pt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            <header className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">
                        인원 <span className="text-blue-600 text-2xl ml-1">{regularMembers.length}</span><span className="text-xl text-gray-400">명</span>
                    </h1>
                    <p className="text-gray-500 font-medium mt-1">부대원 정보를 관리합니다.</p>
                </div>
                <button
                    type="button"
                    onClick={() => { setAddingRunner(false); setAddOpen(true); }}
                    className="shrink-0 flex items-center gap-2 px-4 py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm shadow-lg shadow-blue-200 active:scale-[0.98] transition-all"
                >
                    <Plus className="w-5 h-5" strokeWidth={2.5} />
                    부대원 추가
                </button>
            </header>

            <div className="flex flex-col gap-2.5">
                {regularMembers.length === 0 ? (
                    <p className="text-center text-gray-400 font-medium py-16 px-4 rounded-2xl border-2 border-dashed border-gray-100">
                        등록된 부대원이 없습니다. 우측 상단에서 추가해 주세요.
                    </p>
                ) : (
                    regularMembers.map((m) => (
                        <button
                            key={m.id}
                            type="button"
                            onClick={() => setSelectedId(m.id)}
                            className={cn(
                                'w-full px-5 py-4 rounded-2xl border-2 text-left font-bold transition-all flex items-center justify-between gap-3',
                                'bg-white border-gray-100 text-gray-700 hover:border-gray-300 active:scale-[0.99]'
                            )}
                        >
                            <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-base font-black text-gray-900 truncate">{m.name}</span>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-sm font-bold text-gray-500 shrink-0">
                                        {m.role === 'runner' 
                                            ? m.rank 
                                            : calculateRank(new Date(m.enlistmentDate), m.earlyPromotion || 0)
                                        }
                                    </span>
                                    {(m.earlyPromotion || 0) > 0 && (
                                        <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-600 text-[9px] font-extrabold">조기{m.earlyPromotion}</span>
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
                    ))
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
                <MemberFormModal
                    title={addingRunner ? "미군 러너 추가" : "부대원 추가"}
                    isRunner={addingRunner}
                    onClose={() => setAddOpen(false)}
                    onSaved={() => setAddOpen(false)}
                />
            )}

            {detailMember && (
                <MemberDetailModal
                    member={detailMember}
                    onClose={() => setSelectedId(null)}
                    onDeleted={() => setSelectedId(null)}
                />
            )}
        </div>
    );
}

function MemberFormModal({
    title,
    initial,
    isRunner,
    onClose,
    onSaved,
}: {
    title: string;
    initial?: MemberDoc;
    isRunner?: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [name, setName] = useState(initial?.name ?? '');
    const [enlistmentDate, setEnlistmentDate] = useState(initial?.enlistmentDate ?? '');
    const [rank, setRank] = useState(initial?.rank ?? '');
    const [sections, setSections] = useState<string[]>(initial?.sections ?? []);
    const [earlyPromotion, setEarlyPromotion] = useState<number>(initial?.earlyPromotion ?? 0);
    const availableSections = ['KTA', 'MEDIC', 'BLC', 'S1', 'S3', 'S4', 'S6', 'RSO', 'PAO'];
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        const n = name.trim();
        if (!n) {
            alert('이름을 입력해 주세요.');
            return;
        }
        if (!isRunner && !enlistmentDate) {
            alert('군 입대일을 입력해 주세요.');
            return;
        }
        if (isRunner && !rank.trim()) {
            alert('계급을 입력해 주세요.');
            return;
        }
        
        setSaving(true);
        try {
            const calculatedRank = isRunner ? rank.trim() : calculateRank(new Date(enlistmentDate), earlyPromotion);
            const dataToSave = {
                name: n,
                enlistmentDate: isRunner ? '' : enlistmentDate,
                rank: calculatedRank,
                role: isRunner ? 'runner' : 'member',
                sections: sections,
                earlyPromotion: isRunner ? 0 : earlyPromotion,
                updatedAt: serverTimestamp(),
            };

            if (initial) {
                // 이름이 바뀌었으면 관련 일정도 모두 업데이트
                if (initial.name !== n) {
                    try {
                        const q = query(collection(db, "schedules"), where("memo", "==", initial.name));
                        const snapshots = await getDocs(q);
                        const batch = writeBatch(db);
                        snapshots.forEach(d => {
                            batch.update(d.ref, { memo: n });
                        });
                        await batch.commit();
                    } catch (syncError) {
                        console.error("Schedule name sync error:", syncError);
                        // 일정 동기화 실패해도 인원 정보는 저장 진행
                    }
                }
                await updateDoc(doc(db, 'members', initial.id), dataToSave);
            } else {
                await addDoc(collection(db, 'members'), dataToSave);
            }
            onSaved();
        } catch (e) {
            console.error(e);
            alert('저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2rem] p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-black text-gray-900">{title}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-full bg-gray-50 hover:bg-gray-100"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700 ml-1">이름</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="홍길동"
                            className="w-full px-5 py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-lg font-bold"
                        />
                    </div>
                    {isRunner ? (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-700 ml-1">계급</label>
                            <input
                                type="text"
                                value={rank}
                                onChange={(e) => setRank(e.target.value)}
                                placeholder="예: 상병"
                                className="w-full px-5 py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-lg font-bold"
                            />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-700 ml-1">군 입대일</label>
                            <input
                                type="date"
                                value={enlistmentDate}
                                onChange={(e) => setEnlistmentDate(e.target.value)}
                                className="w-full px-5 py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-lg font-bold"
                            />
                            <p className="text-xs text-blue-500 font-bold ml-1">
                                입대일 기준으로 계급이 자동 반영됩니다.
                            </p>
                            {enlistmentDate && formatExpectedDischargeFromEnlistmentStr(enlistmentDate) && (
                                <p className="text-xs text-gray-600 font-bold ml-1 mt-2">
                                    전역 예정일:{' '}
                                    <span className="text-gray-900">
                                        {formatExpectedDischargeFromEnlistmentStr(enlistmentDate)}
                                    </span>
                                </p>
                            )}
                        </div>
                    )}

                    {!isRunner && (
                        <div className="space-y-3 pt-4 border-t border-gray-100">
                            <label className="text-sm font-bold text-gray-700 ml-1">조기진급 설정</label>
                            <div className="flex gap-2">
                                {[0, 1, 2].map(months => (
                                    <button
                                        key={months}
                                        type="button"
                                        onClick={() => {
                                            setEarlyPromotion(months);
                                        }}
                                        className={cn(
                                            "flex-1 py-3 rounded-2xl text-[11px] font-black transition-all border",
                                            earlyPromotion === months
                                                ? "bg-blue-100 border-blue-300 text-blue-700 shadow-sm"
                                                : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                                        )}
                                    >
                                        {months === 0 ? '없음' : `${months}개월 조기`}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {!isRunner && (
                        <div className="space-y-3 pt-4 border-t border-gray-100">
                            <label className="text-sm font-bold text-gray-700 ml-1">소속 섹션 설정 (다중 선택 가능)</label>
                            <div className="flex flex-wrap gap-2">
                                {availableSections.map(sec => {
                                    const isSelected = sections.includes(sec);
                                    return (
                                        <button
                                            key={sec}
                                            type="button"
                                            onClick={() => {
                                                if (isSelected) setSections(sections.filter(s => s !== sec));
                                                else setSections([...sections, sec]);
                                            }}
                                            className={cn(
                                                "px-3 py-2 rounded-xl text-xs font-black transition-all border",
                                                isSelected 
                                                    ? "bg-amber-100 border-amber-300 text-amber-700 shadow-sm" 
                                                    : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                                            )}
                                        >
                                            {sec}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-100 disabled:opacity-50"
                >
                    {saving ? '저장 중…' : '저장'}
                </button>
            </div>
        </div>
    );
}

function MemberDetailModal({
    member,
    onClose,
    onDeleted,
}: {
    member: MemberDoc;
    onClose: () => void;
    onDeleted: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        if (!confirm(`「${member.name}」 정보를 삭제할까요?`)) return;
        setDeleting(true);
        try {
            await deleteDoc(doc(db, 'members', member.id));
            onDeleted();
        } catch (e) {
            console.error(e);
            alert('삭제에 실패했습니다.');
        } finally {
            setDeleting(false);
        }
    };

    if (editing) {
        return (
            <MemberFormModal
                title={member.role === 'runner' ? "미군 러너 정보 수정" : "부대원 정보 수정"}
                isRunner={member.role === 'runner'}
                initial={member}
                onClose={() => setEditing(false)}
                onSaved={() => setEditing(false)}
            />
        );
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2rem] p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-black text-gray-900">부대원 정보</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-full bg-gray-50 hover:bg-gray-100"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="space-y-4 rounded-2xl bg-gray-50 p-6 border border-gray-100">
                    <div>
                        <div className="text-xs font-black text-gray-400 uppercase tracking-wide mb-1">이름 (구분)</div>
                        <div className="text-xl font-black text-gray-900">{member.name} {member.role === 'runner' && <span className="text-sm text-indigo-500 ml-2">(미군 러너)</span>}</div>
                    </div>
                    <div>
                        <div className="text-xs font-black text-gray-400 uppercase tracking-wide mb-1">계급</div>
                        <div className="flex items-center gap-2">
                            <div className="text-lg font-bold text-gray-800">
                                {member.role === 'runner' 
                                    ? member.rank.split(' ')[0] 
                                    : calculateRank(new Date(member.enlistmentDate), member.earlyPromotion || 0)
                                }
                            </div>
                            {member.role !== 'runner' && (member.earlyPromotion || 0) > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-600 text-[10px] font-black italic">
                                    조기진급 {member.earlyPromotion}개월 적용됨
                                </span>
                            )}
                        </div>
                    </div>
                    {member.role !== 'runner' && (
                        <>
                            <div>
                                <div className="text-xs font-black text-gray-400 uppercase tracking-wide mb-1">군 입대일</div>
                                <div className="text-lg font-bold text-gray-800">{member.enlistmentDate}</div>
                            </div>
                            <div>
                                <div className="text-xs font-black text-gray-400 uppercase tracking-wide mb-1">
                                    전역 예정일
                                </div>
                                <div className="text-lg font-bold text-gray-800">
                                    {formatExpectedDischargeFromEnlistmentStr(member.enlistmentDate) ?? '—'}
                                </div>
                                <p className="text-[11px] text-gray-400 font-medium mt-1">
                                    입대일 + {DEFAULT_ARMY_SERVICE_MONTHS}개월(육군 병 복무 기준 예시)로 계산합니다.
                                </p>
                            </div>
                        </>
                    )}
                    {member.role !== 'runner' && (member.sections?.length || 0) > 0 && (
                        <div className="mt-2 pt-4 border-t border-gray-100">
                            <div className="text-xs font-black text-gray-400 uppercase tracking-wide mb-2">소속 섹션</div>
                            <div className="flex gap-2 flex-wrap">
                                {(member.sections || []).map(s => (
                                    <span key={s} className="px-3 py-1 rounded bg-amber-50 border border-amber-200 text-amber-600 text-[11px] font-black">{s}</span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <p className="text-xs text-gray-400 font-medium text-center">
                    세부 항목은 이후에 이 화면에 추가할 수 있습니다.
                </p>

                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="flex-1 py-4 rounded-2xl border-2 border-red-100 text-red-600 font-bold flex items-center justify-center gap-2 hover:bg-red-50 disabled:opacity-50"
                    >
                        <Trash2 className="w-5 h-5" />
                        삭제
                    </button>
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black shadow-lg shadow-blue-100"
                    >
                        수정
                    </button>
                </div>
            </div>
        </div>
    );
}
