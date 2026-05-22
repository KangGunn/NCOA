import { useState } from 'react';
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    query,
    where,
    getDocs,
    writeBatch,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
    calculateRank,
    formatExpectedDischargeFromEnlistmentStr,
} from '../../lib/rankUtils';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { MemberDoc } from '../../hooks/personnel/personnel.hook';

interface PersonnelFormModalProps {
    title: string;
    initial?: MemberDoc;
    isRunner?: boolean;
    onClose: () => void;
    onSaved: () => void;
}

export function PersonnelFormModal({
    title,
    initial,
    isRunner,
    onClose,
    onSaved,
}: PersonnelFormModalProps) {
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
                            className="w-full px-4 py-3 sm:px-5 sm:py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-base sm:text-lg font-bold"
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
                                className="w-full px-4 py-3 sm:px-5 sm:py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-base sm:text-lg font-bold"
                            />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-700 ml-1">군 입대일</label>
                            <input
                                type="date"
                                value={enlistmentDate}
                                onChange={(e) => setEnlistmentDate(e.target.value)}
                                className="w-full px-4 py-3 sm:px-5 sm:py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-base sm:text-lg font-bold"
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
