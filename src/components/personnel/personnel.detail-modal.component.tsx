import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { deleteDoc, doc, collection, query, where, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
    calculateRank,
    DEFAULT_ARMY_SERVICE_MONTHS,
    formatExpectedDischargeFromEnlistmentStr,
} from '../../lib/rankUtils';
import { X, Trash2, Plus, Calendar } from 'lucide-react';
import type { MemberDoc } from '../../hooks/personnel/personnel.hook';
import { PersonnelFormModal } from './personnel.form-modal.component';

interface PersonnelDetailModalProps {
    member: MemberDoc;
    baseDate: Date;
    onClose: () => void;
    onDeleted: () => void;
}

interface MemberScheduleItem {
    id: string;
    type: 'pass' | 'vacation';
    startDate: string;
    endDate: string;
    memo: string;
}

export function PersonnelDetailModal({
    member,
    baseDate,
    onClose,
    onDeleted,
}: PersonnelDetailModalProps) {
    const [editing, setEditing] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // 모달이 열려 있는 동안 뒤 화면이 스크롤되지 않게 한다 (수정 화면으로 바뀌어도 잠금은 이어진다)
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    // 유급생 전용 외박/휴가 목록
    const [memberSchedules, setMemberSchedules] = useState<MemberScheduleItem[]>([]);
    const [addingSchedule, setAddingSchedule] = useState(false);
    const [newType, setNewType] = useState<'pass' | 'vacation'>('pass');
    const [newStartDate, setNewStartDate] = useState('');
    const [newEndDate, setNewEndDate] = useState('');
    const [savingSchedule, setSavingSchedule] = useState(false);

    const isHoldover = member.role === 'holdover';

    useEffect(() => {
        if (!isHoldover) return;
        const q = query(
            collection(db, 'schedules'),
            where('memo', '==', member.name)
        );
        const unsub = onSnapshot(q, (snap) => {
            const rows: MemberScheduleItem[] = snap.docs
                .map((d) => ({
                    id: d.id,
                    ...(d.data() as Omit<MemberScheduleItem, 'id'>),
                }))
                .filter((s) => s.type === 'pass' || s.type === 'vacation')
                .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
            setMemberSchedules(rows);
        });
        return () => unsub();
    }, [isHoldover, member.name]);

    const handleAddSchedule = async () => {
        if (!newStartDate) {
            alert('시작일을 입력해 주세요.');
            return;
        }
        const end = newEndDate || newStartDate;
        if (end < newStartDate) {
            alert('종료일은 시작일 이후여야 합니다.');
            return;
        }
        setSavingSchedule(true);
        try {
            await addDoc(collection(db, 'schedules'), {
                memo: member.name,
                type: newType,
                startDate: newStartDate,
                endDate: end,
                createdAt: serverTimestamp(),
            });
            setNewStartDate('');
            setNewEndDate('');
            setAddingSchedule(false);
        } catch (e) {
            console.error(e);
            alert('등록에 실패했습니다.');
        } finally {
            setSavingSchedule(false);
        }
    };

    const handleDeleteSchedule = async (id: string) => {
        if (!confirm('이 일정을 삭제할까요?')) return;
        try {
            await deleteDoc(doc(db, 'schedules', id));
        } catch (e) {
            console.error(e);
            alert('삭제에 실패했습니다.');
        }
    };

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
        const modalTitle = isHoldover
            ? "유급생 정보 수정"
            : member.role === 'runner'
                ? "미군 러너 정보 수정"
                : "부대원 정보 수정";
        return (
            <PersonnelFormModal
                title={modalTitle}
                isRunner={member.role === 'runner'}
                isHoldover={isHoldover}
                initial={member}
                onClose={() => setEditing(false)}
                onSaved={() => setEditing(false)}
            />
        );
    }

    // 인원 탭의 등장 애니메이션(transform) 안에서는 fixed 배경이 화면 전체를 덮지 못하므로 body에 띄운다
    return createPortal(
        <div className="overlay-safe fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2rem] p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-black text-gray-900">
                        {isHoldover ? "유급생 정보" : "부대원 정보"}
                    </h2>
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
                        <div className="text-xl font-black text-gray-900">
                            {member.name} 
                            {member.role === 'runner' && <span className="text-sm text-indigo-500 ml-2">(미군 러너)</span>}
                            {isHoldover && <span className="text-sm text-amber-600 ml-2">(유급생)</span>}
                        </div>
                    </div>
                    {member.englishName && (
                        <div>
                            <div className="text-xs font-black text-gray-400 uppercase tracking-wide mb-1">영문 이름</div>
                            <div className="text-lg font-bold text-gray-800">{member.englishName}</div>
                        </div>
                    )}
                    {member.phoneNumber && (
                        <div>
                            <div className="text-xs font-black text-gray-400 uppercase tracking-wide mb-1">전화번호</div>
                            <div className="text-lg font-bold text-gray-800">{member.phoneNumber}</div>
                        </div>
                    )}
                    <div>
                        <div className="text-xs font-black text-gray-400 uppercase tracking-wide mb-1">계급</div>
                        <div className="flex items-center gap-2">
                            <div className="text-lg font-bold text-gray-800">
                                {isHoldover 
                                    ? '이병' 
                                    : member.role === 'runner' 
                                        ? member.rank.split(' ')[0] 
                                        : calculateRank(new Date(member.enlistmentDate), member.earlyPromotion || 0, baseDate)
                                }
                            </div>
                            {!isHoldover && member.role !== 'runner' && (member.earlyPromotion || 0) > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-600 text-[10px] font-black italic">
                                    조기진급 {member.earlyPromotion}개월 적용됨
                                </span>
                            )}
                        </div>
                    </div>
                    {!isHoldover && member.role !== 'runner' && (
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
                    {!isHoldover && member.role !== 'runner' && (member.sections?.length || 0) > 0 && (
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

                {/* 유급생 외박 및 휴가 기간 관리 섹션 */}
                {isHoldover && (
                    <div className="space-y-3 rounded-2xl bg-amber-50/50 p-5 border border-amber-200/60">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <Calendar className="w-4 h-4 text-amber-700" />
                                <span className="text-sm font-black text-amber-900">외박 / 휴가 기간 관리</span>
                            </div>
                            {!addingSchedule && (
                                <button
                                    type="button"
                                    onClick={() => setAddingSchedule(true)}
                                    className="text-xs font-bold text-amber-700 flex items-center gap-1 hover:text-amber-800 transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5" /> 기간 추가
                                </button>
                            )}
                        </div>

                        {addingSchedule && (
                            <div className="p-4 bg-white rounded-xl border border-amber-200 space-y-3 animate-in fade-in duration-150">
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setNewType('pass')}
                                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                            newType === 'pass'
                                                ? 'bg-blue-600 text-white border-blue-600'
                                                : 'bg-gray-50 text-gray-600 border-gray-200'
                                        }`}
                                    >
                                        외박
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setNewType('vacation')}
                                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                            newType === 'vacation'
                                                ? 'bg-orange-500 text-white border-orange-500'
                                                : 'bg-gray-50 text-gray-600 border-gray-200'
                                        }`}
                                    >
                                        휴가
                                    </button>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-bold text-gray-500">시작일</label>
                                    <input
                                        type="date"
                                        value={newStartDate}
                                        onChange={(e) => setNewStartDate(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs font-bold focus:outline-none focus:border-amber-500"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-bold text-gray-500">종료일 (미입력 시 당일)</label>
                                    <input
                                        type="date"
                                        value={newEndDate}
                                        onChange={(e) => setNewEndDate(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs font-bold focus:outline-none focus:border-amber-500"
                                    />
                                </div>
                                <div className="flex gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setAddingSchedule(false)}
                                        className="flex-1 py-2 rounded-lg text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200"
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAddSchedule}
                                        disabled={savingSchedule}
                                        className="flex-1 py-2 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                                    >
                                        {savingSchedule ? '저장 중…' : '저장'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            {memberSchedules.length === 0 ? (
                                <p className="text-xs text-amber-700/60 font-medium py-3 text-center">
                                    등록된 외박/휴가 기간이 없습니다.
                                </p>
                            ) : (
                                memberSchedules.map((s) => (
                                    <div
                                        key={s.id}
                                        className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-amber-200/70 text-xs"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-black text-white ${
                                                    s.type === 'vacation' ? 'bg-orange-500' : 'bg-blue-600'
                                                }`}
                                            >
                                                {s.type === 'vacation' ? '휴가' : '외박'}
                                            </span>
                                            <span className="font-bold text-gray-800">
                                                {s.startDate === s.endDate
                                                    ? s.startDate
                                                    : `${s.startDate} ~ ${s.endDate}`}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteSchedule(s.id)}
                                            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                            title="삭제"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

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
        </div>,
        document.body
    );
}
