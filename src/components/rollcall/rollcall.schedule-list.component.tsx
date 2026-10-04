import { useState } from 'react';
import { UserPlus, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Member } from '../../types/member/member.type';
import type { SheetEvent } from '../../types/rollcall/rollcall.type';
import { RollCallMemberButton } from './rollcall.member-button.component';

interface RollCallScheduleListProps {
    members: Member[];
    scheduleParticipants: Record<string, string[]>;
    customSchedules: { name: string; participants: string[] }[];
    toggleMember: (memberName: string, category: string) => void;
    addCustomSchedule: (name: string) => void;
    removeCustomSchedule: (name: string) => void;
    baseDate: Date;
    rollCallData: any;
}

export function RollCallScheduleList({
    members,
    scheduleParticipants,
    customSchedules,
    toggleMember,
    addCustomSchedule,
    removeCustomSchedule,
    baseDate,
    rollCallData
}: RollCallScheduleListProps) {
    const [newScheduleName, setNewScheduleName] = useState('');
    const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

    const handleAddCustomSchedule = () => {
        addCustomSchedule(newScheduleName);
        setNewScheduleName('');
    };

    const toggleCategoryExpanded = (category: string) => {
        setExpandedCategories(prev => ({
            ...prev,
            [category]: !prev[category]
        }));
    };

    const getDefaultSectionMembers = (category: string) => {
        const targetSection = category.split(' ')[0]; // 'HQ', 'KTA', 'MEDIC', 'BLC', 'PAO'
        if (targetSection === 'HQ') {
            const excludeList = ['KTA', 'MEDIC', 'RSO'];
            return members.filter(m =>
                m.role !== 'runner' &&
                (!m.sections || !m.sections.some(s => excludeList.includes(s)))
            );
        }
        return members.filter(m =>
            m.role !== 'runner' &&
            m.sections?.includes(targetSection)
        );
    };

    const getMemberProps = (m: Member, currentCategory: string) => {
        const isSelectedHere = (scheduleParticipants[currentCategory] || []).includes(m.name) ||
            (customSchedules.find(s => s.name === currentCategory)?.participants.includes(m.name));

        const isSelectedElsewhere =
            Object.entries(scheduleParticipants).some(([cat, list]) => cat !== currentCategory && list.includes(m.name)) ||
            customSchedules.some(s => s.name !== currentCategory && s.participants.includes(m.name));

        const isDuty = (rollCallData?.evening?.duties || []).some((name: string) => name.startsWith(m.name)) ||
            (rollCallData?.evening?.tomorrowDuties || []).some((name: string) => name.startsWith(m.name));

        const tomorrowDt = new Date(baseDate);
        tomorrowDt.setDate(tomorrowDt.getDate() + 1);
        const tomStr = `${tomorrowDt.getFullYear()}-${String(tomorrowDt.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDt.getDate()).padStart(2, '0')}`;
        const sheetEvents = rollCallData?.sheetEvents || [];
        const isSheetAway = sheetEvents.filter((e: SheetEvent) =>
            e.startDate === tomStr && (
                !e.isDepartDay ||
                (e.isDepartDay && e.isConsecutive)
            )
        ).some((e: SheetEvent) => e.memo === m.name);

        const isMorningVacation = (rollCallData?.morning?.vacations || []).some((name: string) => name.startsWith(m.name));
        const isMorningPass = (rollCallData?.morning?.passes || []).some((name: string) => name.startsWith(m.name));

        const isAway = isSheetAway || isMorningVacation || isMorningPass;

        return {
            member: m,
            isDuty,
            isAway,
            isSelectedHere: !!isSelectedHere,
            isSelectedElsewhere,
            onClick: () => toggleMember(m.name, currentCategory)
        };
    };

    const labelBase = "text-sm font-bold text-gray-700 mb-1.5 block ml-1";

    return (
        <section className="space-y-3">
            <div className="flex justify-between items-end pr-1">
                <label className={labelBase}>4. 익일 일정 참여 인원</label>
            </div>
            <div className="flex flex-col gap-4">
                {Object.keys(scheduleParticipants).map(category => {
                    const sectionMembers = getDefaultSectionMembers(category);
                    const sectionMemberNames = new Set(sectionMembers.map(m => m.name));

                    // 기본 제공 인원 외 나머지 대원 목록 (짬순 정렬)
                    const remainingMembers = members.filter(m =>
                        m.role !== 'runner' && !sectionMemberNames.has(m.name)
                    );

                    const isExpanded = !!expandedCategories[category];
                    const selectedInThisCategory = scheduleParticipants[category] || [];
                    const selectedRemainingMembers = remainingMembers.filter(m =>
                        selectedInThisCategory.includes(m.name)
                    );
                    const targetSection = category.split(' ')[0]; // 'HQ', 'KTA', 'MEDIC', 'BLC', 'PAO'

                    return (
                        <div key={category} className="p-5 bg-white border border-gray-200 rounded-3xl shadow-sm transition-all">
                            {/* Card Header */}
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-sm font-black text-gray-900">
                                        {category}
                                    </h3>
                                    {selectedInThisCategory.length > 0 && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                                            {selectedInThisCategory.length}명 참여
                                        </span>
                                    )}
                                </div>
                                {remainingMembers.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => toggleCategoryExpanded(category)}
                                        aria-label={isExpanded ? "접기" : "인원 추가"}
                                        className={cn(
                                            "flex items-center justify-center rounded-lg p-1.5 transition-all active:scale-95 border shadow-sm",
                                            isExpanded
                                                ? "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
                                                : "text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border-indigo-200"
                                        )}
                                    >
                                        {isExpanded ? (
                                            <ChevronUp className="w-4 h-4" />
                                        ) : (
                                            <UserPlus className="w-4 h-4" />
                                        )}
                                    </button>
                                )}
                            </div>

                            {/* 기본 제공 인원 버튼 목록 */}
                            {sectionMembers.length === 0 ? (
                                <p className="text-xs text-gray-400 font-bold bg-gray-50 p-3 rounded-xl border border-dashed border-gray-200">
                                    {targetSection === 'HQ'
                                        ? '대상 인원이 없습니다.'
                                        : `인원 탭에서 이 섹션( ${targetSection} )에 소속된 인원을 먼저 설정해주세요.`}
                                </p>
                            ) : targetSection === 'HQ' ? (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        {sectionMembers.filter(m => m.role !== 'holdover' && !m.sections?.includes('BLC')).map(m => (
                                            <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                        ))}
                                    </div>
                                    {sectionMembers.some(m => m.role !== 'holdover' && m.sections?.includes('BLC')) && (
                                        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                                            {sectionMembers.filter(m => m.role !== 'holdover' && m.sections?.includes('BLC')).map(m => (
                                                <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                            ))}
                                        </div>
                                    )}
                                    {sectionMembers.some(m => m.role === 'holdover') && (
                                        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                                            {sectionMembers.filter(m => m.role === 'holdover').map(m => (
                                                <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        {sectionMembers.filter(m => m.role !== 'holdover').map(m => (
                                            <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                        ))}
                                    </div>
                                    {sectionMembers.some(m => m.role === 'holdover') && (
                                        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                                            {sectionMembers.filter(m => m.role === 'holdover').map(m => (
                                                <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 접기 상태일 때: 이미 선택된 추가 인원이 있다면 보여주기 */}
                            {!isExpanded && selectedRemainingMembers.length > 0 && (
                                <div className="pt-2.5 mt-2.5 border-t border-dashed border-blue-200 space-y-1.5 animate-in fade-in duration-200">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-blue-600 flex items-center gap-1">
                                            <span>+ 선택된 추가 인원</span>
                                            <span className="text-blue-400 font-bold">({selectedRemainingMembers.length}명)</span>
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedRemainingMembers.map(m => (
                                            <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 펼치기(확장) 상태: 구분선과 함께 나머지 전체 인원 표시 */}
                            {isExpanded && remainingMembers.length > 0 && (
                                <div className="pt-3 mt-3 border-t border-dashed border-indigo-200 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-black text-indigo-700 flex items-center gap-1">
                                            <span>+ 추가 인원</span>
                                            <span className="text-indigo-400 font-bold">({remainingMembers.length}명)</span>
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {remainingMembers.map(m => (
                                            <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* 임시 추가 일정 카드 */}
                {customSchedules.map(schedule => {
                    const regularMembers = members.filter(m => m.role !== 'runner' && m.role !== 'holdover');
                    const holdoverMembers = members.filter(m => m.role === 'holdover');
                    const selectedCount = (schedule.participants || []).length;
                    return (
                        <div key={schedule.name} className="p-5 bg-white border border-indigo-200 rounded-3xl shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-sm font-black text-indigo-700">{schedule.name}</h3>
                                    {selectedCount > 0 && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
                                            {selectedCount}명 참여
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => removeCustomSchedule(schedule.name)}
                                    className="text-[10px] font-black text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2 py-1 transition-all"
                                >
                                    삭제
                                </button>
                            </div>
                            <div className="space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    {regularMembers.map(m => (
                                        <RollCallMemberButton key={m.name} {...getMemberProps(m, schedule.name)} />
                                    ))}
                                </div>
                                {holdoverMembers.length > 0 && (
                                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                                        {holdoverMembers.map(m => (
                                            <RollCallMemberButton key={m.name} {...getMemberProps(m, schedule.name)} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* 새 일정 추가 입력 */}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newScheduleName}
                        onChange={e => setNewScheduleName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddCustomSchedule(); }}
                        placeholder="일정 이름 입력 후 + 버튼 클릭"
                        className="flex-1 px-4 py-3 rounded-xl bg-gray-50 border border-dashed border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all text-gray-900 text-sm placeholder:text-gray-400"
                    />
                    <button
                        onClick={handleAddCustomSchedule}
                        className="px-4 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-black text-sm transition-all active:scale-95 shadow-md shadow-indigo-200/50"
                    >
                        +
                    </button>
                </div>
            </div>
        </section>
    );
}
