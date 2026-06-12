import { type Dispatch, type SetStateAction } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../../lib/utils';

import { useMembers } from '../../hooks/member/member.subscription.hook';
import { useRollCallSync } from '../../hooks/rollcall/rollcall.sync.hook';
import { generateEveningReportText, generateMorningReportText } from '../../utils/rollcall/rollcall.parser.util';

import { RollCallHeader } from '../rollcall/rollcall.header.component';
import { RollCallPreview } from '../rollcall/rollcall.preview.component';
import { RollCallMentionInput } from '../rollcall/rollcall.mention-input.component';
import { RollCallScheduleList } from '../rollcall/rollcall.schedule-list.component';

interface RollCallTabProps {
    healthNote: string;
    setHealthNote: Dispatch<SetStateAction<string>>;
    tomorrowNote: string;
    setTomorrowNote: Dispatch<SetStateAction<string>>;
    baseDate: Date;
    setBaseDate: Dispatch<SetStateAction<Date>>;
    scheduleText: string;
    setScheduleText: Dispatch<SetStateAction<string>>;
    
    // Props from the new hook
    scheduleParticipants: Record<string, string[]>;
    customSchedules: { name: string; participants: string[] }[];
    addCustomSchedule: (name: string) => void;
    removeCustomSchedule: (name: string) => void;
    toggleMember: (memberName: string, category: string) => void;
}

export default function RollCallTab({
    healthNote,
    setHealthNote,
    tomorrowNote,
    setTomorrowNote,
    baseDate,
    setBaseDate,
    scheduleText,
    setScheduleText,
    scheduleParticipants,
    customSchedules,
    addCustomSchedule,
    removeCustomSchedule,
    toggleMember
}: RollCallTabProps) {
    const { rollCallData: rawRollCallData, handleManualRefresh } = useRollCallSync(baseDate);
    const { members: allMembers } = useMembers();

    // baseDate 기준으로 전입일(joinDate)이 미래인 부대원 필터링 (없는 사람 취급)
    const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
    const members = allMembers.filter(m => !m.joinDate || dateStr >= m.joinDate);

    const rollCallData = rawRollCallData;

    const handleSortSchedules = () => {
        const sorted = scheduleText
            .split('\n')
            .filter(line => line.trim().length > 0)
            .sort((a, b) => {
                const timeA = a.trim().substring(0, 4);
                const timeB = b.trim().substring(0, 4);
                return timeA.localeCompare(timeB);
            })
            .join('\n');
        setScheduleText(sorted);
    };

    const generateReport = () => {
        return generateEveningReportText({
            rollCallData,
            baseDate,
            healthNote,
            tomorrowNote,
            scheduleText
        });
    };

    const generateMorningReport = () => {
        return generateMorningReportText({
            rollCallData,
            healthNote,
            scheduleParticipants,
            customSchedules
        });
    };

    const inputBase = "w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-900";
    const labelBase = "text-sm font-bold text-gray-700 mb-1.5 block ml-1";

    return (
        <div className="pt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            <RollCallHeader 
                baseDate={baseDate} 
                setBaseDate={setBaseDate} 
                handleManualRefresh={handleManualRefresh} 
            />

            <RollCallMentionInput
                label="1. 건강 특이사항"
                value={healthNote}
                onChange={setHealthNote}
                members={members}
            />

            <RollCallMentionInput
                label="2. 익일 특이사항"
                value={tomorrowNote}
                onChange={setTomorrowNote}
                members={members}
            />

            <section className="space-y-4">
                <div className="flex justify-between items-center pr-1">
                    <label className={labelBase}>3. 주요 일정</label>
                    <button
                        onClick={handleSortSchedules}
                        className="text-[10px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-2 py-1 transition-all flex items-center gap-1"
                    >
                        <Clock className="w-3 h-3" />
                        시간순 정렬
                    </button>
                </div>
                <div className="space-y-3">
                    <textarea
                        value={scheduleText}
                        onChange={(e) => setScheduleText(e.target.value)}
                        className={cn(inputBase, "min-h-[120px] resize-y")}
                    />
                </div>
            </section>

            <RollCallScheduleList
                members={members}
                scheduleParticipants={scheduleParticipants}
                customSchedules={customSchedules}
                toggleMember={toggleMember}
                addCustomSchedule={addCustomSchedule}
                removeCustomSchedule={removeCustomSchedule}
                baseDate={baseDate}
                rollCallData={rollCallData}
            />

            <RollCallPreview 
                eveningReportText={generateReport()} 
                morningReportText={generateMorningReport()} 
            />
        </div>
    );
}
