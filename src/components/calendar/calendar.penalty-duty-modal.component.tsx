import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, ChevronDown, Check, Search } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getRankDetails } from '../../lib/rankUtils';
import type { CalendarMember, PenaltyItem } from '../../types/calendar/calendar.type';

interface PenaltyDutyModalProps {
    isOpen: boolean;
    onClose: () => void;
    members: CalendarMember[];
}

export function PenaltyDutyModal({
    isOpen,
    onClose,
    members
}: PenaltyDutyModalProps) {
    const [isAddSelectOpen, setIsAddSelectOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMemberToAdd, setSelectedMemberToAdd] = useState<CalendarMember | null>(null);
    const [penaltyTypeToAdd, setPenaltyTypeToAdd] = useState<'weekday' | 'friSun' | 'sat' | 'warning'>('warning');
    const [penaltyDateToAdd, setPenaltyDateToAdd] = useState<string>(() => {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    });
    const [penaltyReasonToAdd, setPenaltyReasonToAdd] = useState('');
    const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!isOpen) return null;

    // Helper to compute rank name without hobong (계급 + 성명)
    const getMemberDisplayName = (m: CalendarMember) => {
        if (!m.enlistmentDate) {
            const rankPrefix = m.rank ? `${m.rank} ` : '';
            return `${rankPrefix}${m.name}`;
        }
        const { rank } = getRankDetails(new Date(m.enlistmentDate), new Date(), m.earlyPromotion || 0);
        return `${rank} ${m.name}`;
    };

    // Filter non-runner members only
    const validMembers = members.filter(m => m.role !== 'runner');

    // Filter members with penalties or dutyOffset > 0, sorted by enlistmentDate ascending (짬순: 입대일 빠른 순)
    const penaltyMembers = validMembers
        .filter(m => (m.penalties && m.penalties.length > 0) || (m.dutyOffset || 0) > 0)
        .sort((a, b) => {
            const dateA = a.enlistmentDate ? a.enlistmentDate.trim() : '9999-12-31';
            const dateB = b.enlistmentDate ? b.enlistmentDate.trim() : '9999-12-31';
            return dateA.localeCompare(dateB);
        });

    // Non-runner members without penalty who can be added
    const nonPenaltyMembers = validMembers
        .sort((a, b) => {
            const dateA = a.enlistmentDate ? a.enlistmentDate.trim() : '9999-12-31';
            const dateB = b.enlistmentDate ? b.enlistmentDate.trim() : '9999-12-31';
            return dateA.localeCompare(dateB);
        });

    const filteredAddableMembers = nonPenaltyMembers.filter(m => {
        const displayName = getMemberDisplayName(m);
        return displayName.toLowerCase().includes(searchQuery.toLowerCase().trim());
    });

    const typeLabels = {
        warning: '경고',
        weekday: '평당 추가',
        friSun: '금일당 추가',
        sat: '토당 추가'
    };

    const handleAddPenaltyItem = async () => {
        if (!selectedMemberToAdd) return;
        
        let formattedDate = '';
        if (penaltyDateToAdd) {
            const [, m, d] = penaltyDateToAdd.split('-');
            formattedDate = `${m}/${d}`;
        }
        const cleanReason = penaltyReasonToAdd.trim() || (penaltyTypeToAdd === 'warning' ? '주의 / 경고' : '페널티 당직');

        const newItem: PenaltyItem = {
            id: Date.now().toString(),
            type: penaltyTypeToAdd,
            date: formattedDate,
            reason: cleanReason,
            createdAt: new Date().toISOString()
        };

        const existingPenalties = selectedMemberToAdd.penalties || [];
        const updatedPenalties = [...existingPenalties, newItem];
        const newOffset = updatedPenalties.filter(p => p.type !== 'warning').length;

        setSavingMemberId(selectedMemberToAdd.id);
        try {
            await updateDoc(doc(db, 'members', selectedMemberToAdd.id), {
                penalties: updatedPenalties,
                dutyOffset: newOffset
            });
            setSelectedMemberToAdd(null);
            setPenaltyReasonToAdd('');
            setIsAddSelectOpen(false);
            setIsDropdownOpen(false);
            setSearchQuery('');
        } catch (error) {
            console.error("Failed to add penalty item:", error);
            alert("페널티 추가 중 오류가 발생했습니다.");
        } finally {
            setSavingMemberId(null);
        }
    };

    const handleDeletePenaltyItem = async (member: CalendarMember, penaltyId: string) => {
        const existingPenalties = member.penalties || [];
        const updatedPenalties = existingPenalties.filter(p => p.id !== penaltyId);
        const newOffset = updatedPenalties.filter(p => p.type !== 'warning').length;

        setSavingMemberId(member.id);
        try {
            await updateDoc(doc(db, 'members', member.id), {
                penalties: updatedPenalties,
                dutyOffset: newOffset
            });
        } catch (error) {
            console.error("Failed to delete penalty item:", error);
            alert("페널티 삭제 중 오류가 발생했습니다.");
        } finally {
            setSavingMemberId(null);
        }
    };

    const handleClearAllPenalties = async (member: CalendarMember) => {
        setSavingMemberId(member.id);
        try {
            await updateDoc(doc(db, 'members', member.id), {
                penalties: [],
                dutyOffset: 0
            });
        } catch (error) {
            console.error("Failed to clear penalties:", error);
            alert("페널티 삭제 중 오류가 발생했습니다.");
        } finally {
            setSavingMemberId(null);
        }
    };

    return createPortal(
        <div className="overlay-safe fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-5 shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-2xl font-black text-gray-900">페널티 당직 관리</h2>
                        <p className="text-xs text-gray-500 font-bold mt-1">당직 완료 기준이 추가 부여된 인원을 관리합니다.</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                {/* List of members with penalty */}
                <div className="overflow-y-auto flex-1 custom-scrollbar space-y-3 pr-1 min-h-[200px]">
                    {penaltyMembers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-44 text-gray-400 text-sm font-semibold">
                            페널티 당직 대상자가 없습니다.
                        </div>
                    ) : (
                        penaltyMembers.map(m => {
                            const isSaving = savingMemberId === m.id;
                            const displayName = getMemberDisplayName(m);
                            const memberPenalties = m.penalties && m.penalties.length > 0
                                ? m.penalties
                                : Array.from({ length: m.dutyOffset || 0 }).map((_, idx) => ({
                                    id: `legacy-${idx}`,
                                    type: 'weekday' as const,
                                    date: '',
                                    reason: '기존 페널티 당직',
                                    createdAt: ''
                                }));

                            // Breakdown count by duty type
                            const counts = {
                                warning: memberPenalties.filter(p => p.type === 'warning').length,
                                weekday: memberPenalties.filter(p => p.type === 'weekday').length,
                                friSun: memberPenalties.filter(p => p.type === 'friSun').length,
                                sat: memberPenalties.filter(p => p.type === 'sat').length
                            };

                            return (
                                <div
                                    key={m.id}
                                    className="p-4 bg-orange-50/60 border border-orange-100 rounded-2xl space-y-2.5 transition-all"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-black text-gray-900 truncate pr-2">
                                            {displayName}
                                        </span>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {counts.warning > 0 && (
                                                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-lg text-xs font-black">
                                                    경고 {counts.warning}회
                                                </span>
                                            )}
                                            {counts.weekday > 0 && (
                                                <span className="px-2 py-0.5 bg-amber-100/70 text-amber-800 rounded-lg text-xs font-black">
                                                    평당 +{counts.weekday}
                                                </span>
                                            )}
                                            {counts.friSun > 0 && (
                                                <span className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded-lg text-xs font-black">
                                                    금일당 +{counts.friSun}
                                                </span>
                                            )}
                                            {counts.sat > 0 && (
                                                <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-lg text-xs font-black">
                                                    토당 +{counts.sat}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedMemberToAdd(m);
                                                    setIsAddSelectOpen(true);
                                                    setIsDropdownOpen(false);
                                                }}
                                                className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-100 rounded-lg transition-colors"
                                                title="이 인원에 페널티/경고 추가"
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                disabled={isSaving}
                                                onClick={() => handleClearAllPenalties(m)}
                                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-0.5"
                                                title="모든 페널티 삭제"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Penalty items detail: 당직 -> 날짜 -> 사유 (날짜 순 정렬: 과거 -> 최신) */}
                                    <div className="space-y-1.5 pt-1">
                                        {[...memberPenalties].sort((a, b) => {
                                            const getEffectiveDate = (item: typeof a) => {
                                                if (item.date) {
                                                    const parts = item.date.split('/');
                                                    if (parts.length === 2) {
                                                        const m = parts[0].padStart(2, '0');
                                                        const d = parts[1].padStart(2, '0');
                                                        return `9999-${m}-${d}`;
                                                    }
                                                    return item.date;
                                                }
                                                if (item.reason) {
                                                    const match = item.reason.match(/^(\d{1,2})\/(\d{1,2})/);
                                                    if (match) {
                                                        return `9999-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
                                                    }
                                                }
                                                if (item.createdAt) return item.createdAt;
                                                return '0000-00-00';
                                            };
                                            const dateComp = getEffectiveDate(a).localeCompare(getEffectiveDate(b));
                                            if (dateComp !== 0) return dateComp;
                                            return (a.createdAt || '').localeCompare(b.createdAt || '');
                                        }).map(item => {
                                            // Extract date and clean reason
                                            let displayDate = item.date || '';
                                            let displayReason = item.reason;

                                            if (!displayDate && item.reason) {
                                                const match = item.reason.match(/^(\d{1,2}\/\d{1,2})\s*(.*)/);
                                                if (match) {
                                                    displayDate = match[1];
                                                    displayReason = match[2] || '페널티 당직';
                                                }
                                            }

                                            return (
                                                <div
                                                    key={item.id}
                                                    className="flex items-center justify-between bg-white px-3 py-2 rounded-xl border border-orange-100/70 text-xs shadow-2xs"
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0 pr-1">
                                                        {/* 1. 당직 종류 */}
                                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-black shrink-0 ${
                                                            item.type === 'warning' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
                                                            item.type === 'friSun' ? 'bg-sky-50 text-sky-600 border border-sky-100' :
                                                            item.type === 'sat' ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                                            'bg-amber-50 text-amber-700 border border-amber-100'
                                                        }`}>
                                                            {typeLabels[item.type]}
                                                        </span>

                                                        {/* 2. 날짜 */}
                                                        {displayDate && (
                                                            <span className="text-[11px] font-black text-gray-500 shrink-0">
                                                                {displayDate}
                                                            </span>
                                                        )}

                                                        {/* 3. 사유 */}
                                                        <span className="font-bold text-gray-800 truncate">
                                                            {displayReason || '페널티 당직'}
                                                        </span>
                                                    </div>

                                                    <button
                                                        disabled={isSaving}
                                                        onClick={() => handleDeletePenaltyItem(m, item.id)}
                                                        className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors shrink-0"
                                                        title="페널티 항목 삭제"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Add member section */}
                <div className="shrink-0 pt-3 border-t border-gray-100">
                    {!isAddSelectOpen ? (
                        <button
                            onClick={() => setIsAddSelectOpen(true)}
                            className="w-full h-11 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl text-sm font-black flex items-center justify-center gap-2 transition-all shadow-md shadow-orange-200 active:scale-[0.99]"
                        >
                            <Plus className="w-4 h-4" />
                            <span>페널티 인원 추가</span>
                        </button>
                    ) : (
                        <div className="space-y-3 animate-in fade-in duration-150 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                            {/* Member Dropdown */}
                            <div className="relative" ref={dropdownRef}>
                                <button
                                    type="button"
                                    onClick={() => setIsDropdownOpen(prev => !prev)}
                                    className="w-full h-11 px-3.5 bg-white border border-gray-200 hover:border-orange-300 rounded-xl text-xs font-black text-gray-800 flex items-center justify-between transition-all focus:outline-none"
                                >
                                    <span className={selectedMemberToAdd ? "text-gray-900 font-black truncate" : "text-gray-400 font-bold"}>
                                        {selectedMemberToAdd ? getMemberDisplayName(selectedMemberToAdd) : '인원 선택...'}
                                    </span>
                                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isDropdownOpen && (
                                    <div className="absolute bottom-full left-0 mb-2 w-full bg-white border border-gray-100 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                                        <div className="p-2 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
                                            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0 ml-1" />
                                            <input
                                                type="text"
                                                value={searchQuery}
                                                onChange={e => setSearchQuery(e.target.value)}
                                                placeholder="이름 또는 계급 검색..."
                                                className="w-full bg-transparent text-xs font-bold text-gray-800 placeholder-gray-400 focus:outline-none"
                                                autoFocus
                                            />
                                            {searchQuery && (
                                                <button onClick={() => setSearchQuery('')} className="p-1 text-gray-400 hover:text-gray-600">
                                                    <X className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>

                                        <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                                            {filteredAddableMembers.length === 0 ? (
                                                <div className="py-4 text-center text-xs text-gray-400 font-semibold">
                                                    검색 결과가 없습니다.
                                                </div>
                                            ) : (
                                                filteredAddableMembers.map(m => {
                                                    const isSelected = selectedMemberToAdd?.id === m.id;
                                                    const nameWithRank = getMemberDisplayName(m);

                                                    return (
                                                        <button
                                                            key={m.id}
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedMemberToAdd(m);
                                                                setIsDropdownOpen(false);
                                                            }}
                                                            className={`w-full px-3 py-2.5 rounded-xl text-xs font-black text-left flex items-center justify-between transition-colors ${
                                                                isSelected
                                                                    ? 'bg-orange-50 text-orange-700'
                                                                    : 'text-gray-700 hover:bg-gray-50'
                                                            }`}
                                                        >
                                                            <span>{nameWithRank}</span>
                                                            {isSelected && <Check className="w-3.5 h-3.5 text-orange-600" />}
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Penalty Type Selection */}
                            <div className="grid grid-cols-4 gap-1.5">
                                {([
                                    { key: 'warning', label: '경고' },
                                    { key: 'weekday', label: '평당' },
                                    { key: 'friSun', label: '금일당' },
                                    { key: 'sat', label: '토당' }
                                ] as const).map(t => (
                                    <button
                                        key={t.key}
                                        type="button"
                                        onClick={() => setPenaltyTypeToAdd(t.key)}
                                        className={`py-2 rounded-xl text-xs font-black border transition-all ${
                                            penaltyTypeToAdd === t.key
                                                ? t.key === 'warning'
                                                    ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                                                    : 'bg-orange-600 text-white border-orange-600 shadow-xs'
                                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                                        }`}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>

                            {/* Date + Reason Inputs */}
                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    value={penaltyDateToAdd}
                                    onChange={e => setPenaltyDateToAdd(e.target.value)}
                                    className="h-10 px-3 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 focus:outline-none focus:border-orange-500 shrink-0"
                                />
                                <input
                                    type="text"
                                    value={penaltyReasonToAdd}
                                    onChange={e => setPenaltyReasonToAdd(e.target.value)}
                                    placeholder="사유 입력 (예: 지각 등)"
                                    className="flex-1 min-w-0 h-10 px-3 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 placeholder-gray-400 focus:outline-none focus:border-orange-500"
                                />
                            </div>

                            {/* Buttons */}
                            <div className="flex items-center gap-2 pt-1">
                                <button
                                    disabled={!selectedMemberToAdd || savingMemberId !== null}
                                    onClick={handleAddPenaltyItem}
                                    className="flex-1 h-10 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white rounded-xl text-xs font-black transition-all shadow-sm"
                                >
                                    페널티 추가
                                </button>
                                <button
                                    onClick={() => {
                                        setIsAddSelectOpen(false);
                                        setSelectedMemberToAdd(null);
                                        setIsDropdownOpen(false);
                                        setSearchQuery('');
                                        setPenaltyReasonToAdd('');
                                    }}
                                    className="h-10 px-4 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded-xl text-xs font-bold transition-colors"
                                >
                                    취소
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

