import { useState } from 'react';
import { deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
    calculateRank,
    DEFAULT_ARMY_SERVICE_MONTHS,
    formatExpectedDischargeFromEnlistmentStr,
} from '../../lib/rankUtils';
import { X, Trash2 } from 'lucide-react';
import type { MemberDoc } from '../../hooks/personnel/personnel.hook';
import { PersonnelFormModal } from './personnel.form-modal.component';

interface PersonnelDetailModalProps {
    member: MemberDoc;
    baseDate: Date;
    onClose: () => void;
    onDeleted: () => void;
}

export function PersonnelDetailModal({
    member,
    baseDate,
    onClose,
    onDeleted,
}: PersonnelDetailModalProps) {
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
            <PersonnelFormModal
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
                                    : calculateRank(new Date(member.enlistmentDate), member.earlyPromotion || 0, baseDate)
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
                            {member.joinDate && (
                                <div>
                                    <div className="text-xs font-black text-gray-400 uppercase tracking-wide mb-1">전입일</div>
                                    <div className="text-lg font-bold text-gray-800">{member.joinDate}</div>
                                </div>
                            )}
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
