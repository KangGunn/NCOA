import { useState } from 'react';
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

    const handleAddCustomSchedule = () => {
        addCustomSchedule(newScheduleName);
        setNewScheduleName('');
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
        const isAway = sheetEvents.filter((e: SheetEvent) =>
            e.startDate === tomStr && (
                !e.isDepartDay ||
                (e.isDepartDay && e.isConsecutive)
            )
        ).some((e: SheetEvent) => e.memo === m.name);

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
                    const targetSection = category.split(' ')[0]; // 'HQ', 'KTA', 'MEDIC', 'BLC'

                    let sectionMembers: Member[] = [];
                    if (targetSection === 'HQ') {
                        const excludeList = ['KTA', 'MEDIC', 'RSO'];
                        sectionMembers = members.filter(m =>
                            m.role !== 'runner' &&
                            (!m.sections || !m.sections.some(s => excludeList.includes(s)))
                        );
                    } else {
                        sectionMembers = members.filter(m =>
                            m.role !== 'runner' &&
                            m.sections?.includes(targetSection)
                        );
                    }

                    return (
                        <div key={category} className="p-5 bg-white border border-gray-200 rounded-3xl shadow-sm">
                            <h3 className="text-sm font-black text-gray-900 mb-3 flex items-center justify-between">
                                {category}
                            </h3>
                            {sectionMembers.length === 0 ? (
                                <p className="text-xs text-gray-400 font-bold bg-gray-50 p-3 rounded-xl border border-dashed border-gray-200">
                                    {targetSection === 'HQ'
                                        ? '대상 인원이 없습니다.'
                                        : `인원 탭에서 이 섹션( ${targetSection} )에 소속된 인원을 먼저 설정해주세요.`}
                                </p>
                            ) : targetSection === 'HQ' ? (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        {sectionMembers.filter(m => !m.sections?.includes('BLC')).map(m => (
                                            <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                        ))}
                                    </div>
                                    {sectionMembers.some(m => m.sections?.includes('BLC')) && (
                                        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                                            {sectionMembers.filter(m => m.sections?.includes('BLC')).map(m => (
                                                <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {sectionMembers.map(m => (
                                        <RollCallMemberButton key={m.name} {...getMemberProps(m, category)} />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* 임시 추가 일정 카드 */}
                {customSchedules.map(schedule => {
                    const allNonRunners = members.filter(m => m.role !== 'runner');
                    return (
                        <div key={schedule.name} className="p-5 bg-white border border-indigo-200 rounded-3xl shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-black text-indigo-700">{schedule.name}</h3>
                                <button
                                    onClick={() => removeCustomSchedule(schedule.name)}
                                    className="text-[10px] font-black text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2 py-1 transition-all"
                                >
                                    삭제
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {allNonRunners.map(m => (
                                    <RollCallMemberButton key={m.name} {...getMemberProps(m, schedule.name)} />
                                ))}
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
