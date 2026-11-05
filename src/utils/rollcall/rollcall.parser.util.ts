import type { RollCallData } from '../../types/rollcall/rollcall.type';
import type { Member } from '../../types/member/member.type';
import { compareMembersByHobong } from '../../lib/rankUtils';

export interface EveningReportParams {
    rollCallData: RollCallData | null;
    baseDate: Date;
    healthNote: string;
    tomorrowNote: string;
    scheduleText: string;
    members?: Member[];
}

function getMemberForName(displayName: string, members: Member[]): Member | undefined {
    const rawName = displayName.split(' ')[0].trim();
    const found = members.find(m => m.name === rawName || m.name === displayName.trim());
    if (found) return found;
    return members.find(m => displayName.includes(m.name));
}

function sortDisplayNames(names: string[], members: Member[] | undefined, asOf: Date): string[] {
    if (!members || members.length === 0) return names;
    return [...names].sort((a, b) => {
        const mA = getMemberForName(a, members);
        const mB = getMemberForName(b, members);
        if (mA && mB) return compareMembersByHobong(mA, mB, asOf);
        if (mA) return -1;
        if (mB) return 1;
        return a.localeCompare(b, 'ko');
    });
}

function sortVacationsOrPasses<T extends { name: string; dateText?: string }>(
    list: T[],
    members: Member[] | undefined,
    asOf: Date
): T[] {
    if (!members || members.length === 0) return list;
    return [...list].sort((a, b) => {
        const mA = getMemberForName(a.name, members);
        const mB = getMemberForName(b.name, members);
        if (mA && mB) return compareMembersByHobong(mA, mB, asOf);
        if (mA) return -1;
        if (mB) return 1;
        return a.name.localeCompare(b.name, 'ko');
    });
}

export function generateEveningReportText({
    rollCallData,
    baseDate,
    healthNote,
    tomorrowNote,
    scheduleText,
    members
}: EveningReportParams): string {
    if (!rollCallData) return '데이터를 불러오는 중입니다...';

    const { stats, evening } = rollCallData;
    const dateStr = `${baseDate.getFullYear()}.${String(baseDate.getMonth() + 1).padStart(2, '0')}.${String(baseDate.getDate()).padStart(2, '0')}`;

    const exceptionsSummaryArr: string[] = [];
    if (stats.dutyCount > 0) exceptionsSummaryArr.push(`당직 ${stats.dutyCount}명`);
    if (stats.vacationCount > 0) exceptionsSummaryArr.push(`휴가 ${stats.vacationCount}명`);
    if (stats.passCount > 0) exceptionsSummaryArr.push(`외박 ${stats.passCount}명`);

    let report = `단결, 안녕하십니까.\n\n`;
    report += `${dateStr}\n`;
    report += `카투사교육대 인원 보고 드리겠습니다.\n\n`;
    report += `총원 ${stats.total}명\n`;
    report += `현재원 ${stats.present}명\n`;
    report += `열외 ${stats.absent}명\n`;
    report += `(열외 내용: ${exceptionsSummaryArr.length > 0 ? exceptionsSummaryArr.join(', ') : '없음'})\n\n`;

    // 건강 특이사항
    report += `<건강 특이사항>\n`;
    if (healthNote.trim()) {
        healthNote.split('\n').filter(l => l.trim()).forEach(line => { report += `-${line.trim()}\n`; });
    } else {
        report += `-없음\n`;
    }
    report += `\n`;

    // 익일 특이사항
    report += `<익일 특이사항>\n`;
    let hasSpecial = false;
    const sortedTomorrowDuties = sortDisplayNames(evening.tomorrowDuties || [], members, baseDate);
    const sortedRecoveries = sortDisplayNames(evening.recoveries || [], members, baseDate);
    const sortedTomorrowDeparts = sortDisplayNames(evening.tomorrowDeparts || [], members, baseDate);
    const sortedTomorrowPassDeparts = sortDisplayNames(evening.tomorrowPassDeparts || [], members, baseDate);

    sortedTomorrowDuties.forEach((name: string) => { report += `-${name} 당직\n`; hasSpecial = true; });
    sortedRecoveries.forEach((name: string) => { report += `-${name} 리커버리\n`; hasSpecial = true; });
    if (sortedTomorrowDeparts.length > 0) {
        report += `-${sortedTomorrowDeparts.join(', ')} 휴가 출발\n`;
        hasSpecial = true;
    }
    if (sortedTomorrowPassDeparts.length > 0) {
        report += `-${sortedTomorrowPassDeparts.join(', ')} 외박 출발\n`;
        hasSpecial = true;
    }
    if (tomorrowNote.trim()) {
        tomorrowNote.split('\n').filter(l => l.trim()).forEach(line => { report += `-${line.trim()}\n`; });
        hasSpecial = true;
    }
    if (!hasSpecial) report += `-없음\n`;
    report += `\n`;

    // 주요일정
    report += `<주요일정>\n`;
    const scheduleLines = scheduleText.trim().split('\n').filter(l => l.trim().length > 0);
    if (scheduleLines.length > 0) {
        scheduleLines.forEach(l => { report += `-${l.trim()}\n`; });
        report += `\n`;
    } else {
        report += `-없음\n\n`;
    }

    // 휴가
    report += `<휴가>\n`;
    const sortedVacations = sortVacationsOrPasses(evening.vacations || [], members, baseDate);
    if (sortedVacations.length > 0) {
        sortedVacations.forEach((v: any) => { report += `-${v.name}${v.dateText ? `(${v.dateText})` : ''}\n`; });
        report += `\n`;
    } else {
        report += `-없음\n\n`;
    }

    // 외박
    report += `<외박>\n`;
    const sortedPasses = sortVacationsOrPasses(evening.passes || [], members, baseDate);
    if (sortedPasses.length > 0) {
        sortedPasses.forEach((p: any) => { report += `-${p.name}${p.dateText ? `(${p.dateText})` : ''}\n`; });
        report += `\n`;
    } else {
        report += `-없음\n\n`;
    }

    // 듀티
    report += `<듀티>\n`;
    const sortedDuties = sortDisplayNames(evening.duties || [], members, baseDate);
    if (sortedDuties.length > 0) {
        sortedDuties.forEach((name: string) => { report += `-${name}\n`; });
    } else {
        report += `-없음\n`;
    }

    return report.trim();
}


export interface MorningReportParams {
    rollCallData: RollCallData | null;
    baseDate?: Date;
    healthNote: string;
    scheduleParticipants: Record<string, string[]>;
    customSchedules: { name: string; participants: string[] }[];
    members?: Member[];
}

export function generateMorningReportText({
    rollCallData,
    baseDate,
    healthNote,
    scheduleParticipants,
    customSchedules,
    members
}: MorningReportParams): string {
    if (!rollCallData) return '데이터를 불러오는 중입니다...';

    const { morning } = rollCallData;
    const tomorrow = new Date(baseDate || new Date());
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 스케줄 참여 인원은 프런트에서만 관리 (실시간 선택 UI)
    const scheduleOffNames = [
        ...Object.values(scheduleParticipants).flat(),
        ...customSchedules.flatMap(s => s.participants)
    ];
    const allOffNames = new Set([
        ...(morning.duties || []),
        ...(morning.recoveries || []),
        ...(morning.vacations || []),
        ...(morning.passes || []),
        ...scheduleOffNames,
    ]);

    // 아침점호 출석 인원 = 백엔드가 보낸 전체 인원 중 열외자 제외
    const rawPresentMembers = (morning.presentMembers || []).filter(
        (name: string) => !Array.from(allOffNames).some(off => name.startsWith(off.split(' ')[0]))
    );
    const presentMembers = sortDisplayNames(rawPresentMembers, members, tomorrow);

    const totalCount = rollCallData.stats.total;
    const offCount = allOffNames.size;
    const presentCount = totalCount - offCount;

    let exceptionsTextArr: string[] = [];
    if ((morning.duties || []).length > 0) exceptionsTextArr.push(`당직 ${morning.duties.length}명`);
    if ((morning.recoveries || []).length > 0) exceptionsTextArr.push(`리커버리 ${morning.recoveries.length}명`);
    if ((morning.vacations || []).length > 0) exceptionsTextArr.push(`휴가 ${morning.vacations.length}명`);
    if ((morning.passes || []).length > 0) exceptionsTextArr.push(`외박 ${morning.passes.length}명`);
    Object.entries(scheduleParticipants).forEach(([category, list]) => {
        if (list.length > 0) exceptionsTextArr.push(`${category} ${list.length}명`);
    });
    customSchedules.forEach(s => {
        if (s.participants.length > 0) exceptionsTextArr.push(`${s.name} ${s.participants.length}명`);
    });

    let report = `단결, 안녕하십니까.\n\n`;
    report += `${(morning.tomorrowStr || '').replace(/-/g, '.')}\n`;
    report += `카투사교육대 아침점호 인원보고 드리겠습니다.\n\n`;
    report += `총원 ${totalCount}명\n`;
    report += `현재원 ${presentCount}명\n`;
    report += `열외 ${offCount}명\n`;
    report += `(열외내용: ${exceptionsTextArr.length > 0 ? exceptionsTextArr.join(', ') : '없음'})\n\n`;

    report += `<아침점호 인원>\n`;
    if (presentMembers.length > 0) {
        presentMembers.forEach((name: string) => { report += `-${name}\n`; });
    } else {
        report += `-없음\n`;
    }
    report += `\n`;

    report += `<건강 특이사항>\n`;
    if (healthNote.trim()) {
        healthNote.split('\n').filter(l => l.trim()).forEach(line => { report += `-${line.trim()}\n`; });
    } else {
        report += `-없음\n`;
    }
    report += `\n`;

    return report.trim();
}
