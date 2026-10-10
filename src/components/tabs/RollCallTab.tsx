import { type Dispatch, type SetStateAction, useMemo } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../../lib/utils';

import { useMembers } from '../../hooks/member/member.subscription.hook';
import { useRollCallSync } from '../../hooks/rollcall/rollcall.sync.hook';
import { useMovements } from '../../hooks/movement/useMovements';
import { generateEveningReportText, generateMorningReportText } from '../../utils/rollcall/rollcall.parser.util';
import { compareMembersByHobong, getRankDetails } from '../../lib/rankUtils';

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

    // baseDate 기준으로 전입일(joinDate)이 미래인 부대원 필터링 (없는 사람 취급) 및 호봉순(짬순) 정렬
    const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
    const members = allMembers
        .filter(m => !m.joinDate || dateStr >= m.joinDate)
        .sort((a, b) => compareMembersByHobong(a, b, baseDate));

    const { movements } = useMovements();

    // 휴가 복귀 당일 외박 출발하는 인원(휴외연계) 감지 및 저녁점호 외박 리스트 보정
    const rollCallData = useMemo(() => {
        if (!rawRollCallData) return null;

        const tomorrow = new Date(baseDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        const sheetEvents = rawRollCallData.sheetEvents || [];
        const morningPasses = rawRollCallData.morning?.passes || [];
        const morningPassNames = morningPasses.map((p: any) => typeof p === 'string' ? p : p.name);

        const returnAndDepartNames = new Set<string>();

        // 1. sheetEvents 기반 감지:
        // 오늘 휴가 복귀이면서, 내일 외박이거나 오늘 외박 출발이거나 morning.passes에 있는 대원
        sheetEvents.forEach(e => {
            if (e.type === 'vacation' && e.startDate === dateStr && e.isReturnDay) {
                const name = e.memo;
                const hasPassTomorrow = sheetEvents.some(se => se.memo === name && se.type === 'pass' && se.startDate === tomorrowStr);
                const hasPassDepartToday = sheetEvents.some(se => se.memo === name && se.type === 'pass' && se.startDate === dateStr && se.isDepartDay);
                const isInMorningPass = morningPassNames.some(mp => mp.includes(name));

                if (hasPassTomorrow || hasPassDepartToday || isInMorningPass) {
                    returnAndDepartNames.add(name);
                }
            }
        });

        // 2. movements 기반 감지:
        // 오늘이 휴가 종료일(복귀일)이면서, 외박 시작일의 전날(출발일)이 오늘이거나 외박 시작일 당일인 대원
        movements.forEach(m => {
            if (m.type === 'vacation' && m.endDate === dateStr) {
                const name = m.name;
                const passMov = movements.find(pm => pm.name === name && pm.type === 'pass');
                if (passMov) {
                    const pStart = new Date(passMov.startDate);
                    pStart.setDate(pStart.getDate() - 1);
                    const pDepartIso = `${pStart.getFullYear()}-${String(pStart.getMonth() + 1).padStart(2, '0')}-${String(pStart.getDate()).padStart(2, '0')}`;
                    if (pDepartIso === dateStr || passMov.startDate === dateStr) {
                        returnAndDepartNames.add(name);
                    }
                }
            }
        });

        // 3. 만약 sheetEvents에 오늘 휴가 복귀 이벤트가 있고, morning.passes에 포함되어 있다면 무조건 감지
        members.forEach(mem => {
            const name = mem.name;
            const hasVacReturnToday = sheetEvents.some(se => se.memo === name && se.type === 'vacation' && se.startDate === dateStr && se.isReturnDay);
            const isInMorningPass = morningPassNames.some(mp => mp.includes(name));
            if (hasVacReturnToday && isInMorningPass) {
                returnAndDepartNames.add(name);
            }
        });

        if (returnAndDepartNames.size === 0) return rawRollCallData;

        // evening.passes 보정
        const existingPassNames = new Set((rawRollCallData.evening?.passes || []).map((p: any) => {
            const n = typeof p === 'string' ? p : p.name;
            return n.replace(/^(병장|상병|일병|이병)\s*/, '').trim();
        }));

        const updatedPasses = [...(rawRollCallData.evening?.passes || [])];

        returnAndDepartNames.forEach(rawName => {
            const cleanName = rawName.replace(/^(병장|상병|일병|이병)\s*/, '').trim();
            if (!existingPassNames.has(cleanName)) {
                const member = members.find(m => m.name === cleanName);
                let displayName = cleanName;
                if (member) {
                    if (member.enlistmentDate) {
                        const { rank } = getRankDetails(new Date(member.enlistmentDate), baseDate, member.earlyPromotion || 0);
                        displayName = `${member.name} ${rank}`;
                    } else {
                        const rank = (member.rank || '').replace(/\s*\d+호봉/, '').trim();
                        displayName = `${member.name} ${rank}`.trim();
                    }
                }

                // 현재 기준일(dateStr)과 관련된 외박 찾기 (출발일이 dateStr이거나, 외박 기간이 겹치는 외박)
                const passMov = movements.find(m => {
                    if (m.name !== cleanName || m.type !== 'pass') return false;
                    const sD = new Date(m.startDate);
                    sD.setDate(sD.getDate() - 1);
                    const pDepartIso = `${sD.getFullYear()}-${String(sD.getMonth() + 1).padStart(2, '0')}-${String(sD.getDate()).padStart(2, '0')}`;
                    return pDepartIso === dateStr || (m.startDate <= dateStr && m.endDate >= dateStr) || m.startDate === tomorrowStr;
                });

                let dateText = '';
                if (passMov) {
                    const ps = passMov.startDate.split('-');
                    const pe = passMov.endDate.split('-');
                    dateText = `${Number(ps[1])}.${Number(ps[2])}〜${Number(pe[1])}.${Number(pe[2])}`;
                } else {
                    const passEvent = sheetEvents.find(se => se.memo === cleanName && se.type === 'pass' && (se.startDate === dateStr || se.startDate === tomorrowStr));
                    dateText = passEvent?.dateText || '';
                }

                updatedPasses.push({
                    name: displayName,
                    dateText
                });
            }
        });

        // evening.vacations에서 해당 인원 제거
        const updatedVacations = (rawRollCallData.evening?.vacations || []).filter((v: any) => {
            const vName = (typeof v === 'string' ? v : v.name).replace(/^(병장|상병|일병|이병)\s*/, '').trim();
            return !returnAndDepartNames.has(vName);
        });

        const newPassCount = updatedPasses.length;
        const newVacationCount = updatedVacations.length;
        const newAbsent = (rawRollCallData.stats?.dutyCount || 0) + newVacationCount + newPassCount;
        const total = rawRollCallData.stats?.total || 0;
        const newPresent = total - newAbsent;

        return {
            ...rawRollCallData,
            stats: {
                ...rawRollCallData.stats,
                passCount: newPassCount,
                vacationCount: newVacationCount,
                absent: newAbsent,
                present: newPresent
            },
            evening: {
                ...rawRollCallData.evening,
                passes: updatedPasses,
                vacations: updatedVacations
            }
        };
    }, [rawRollCallData, baseDate, members, movements]);

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
            scheduleText,
            members
        });
    };

    const generateMorningReport = () => {
        return generateMorningReportText({
            rollCallData,
            baseDate,
            healthNote,
            scheduleParticipants,
            customSchedules,
            members
        });
    };

    const inputBase = "w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-900";
    const labelBase = "text-sm font-bold text-gray-700 mb-1.5 block ml-1";

    return (
        <div className="pt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
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
                asOf={baseDate}
            />

            <RollCallMentionInput
                label="2. 익일 특이사항"
                value={tomorrowNote}
                onChange={setTomorrowNote}
                members={members}
                asOf={baseDate}
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
