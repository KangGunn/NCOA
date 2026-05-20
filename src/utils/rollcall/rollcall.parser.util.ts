import type { RollCallData } from '../../types/rollcall/rollcall.type';

export interface EveningReportParams {
    rollCallData: RollCallData | null;
    baseDate: Date;
    healthNote: string;
    tomorrowNote: string;
    scheduleText: string;
}

export function generateEveningReportText({
    rollCallData,
    baseDate,
    healthNote,
    tomorrowNote,
    scheduleText
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
    (evening.tomorrowDuties || []).forEach((name: string) => { report += `-${name} 당직\n`; hasSpecial = true; });
    (evening.recoveries || []).forEach((name: string) => { report += `-${name} 리커버리\n`; hasSpecial = true; });
    if ((evening.tomorrowDeparts || []).length > 0) {
        report += `-${evening.tomorrowDeparts.join(', ')} 휴가 출발\n`;
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
    if ((evening.vacations || []).length > 0) {
        evening.vacations.forEach((v: any) => { report += `-${v.name}${v.dateText ? `(${v.dateText})` : ''}\n`; });
        report += `\n`;
    } else {
        report += `-없음\n\n`;
    }

    // 외박
    report += `<외박>\n`;
    if ((evening.passes || []).length > 0) {
        evening.passes.forEach((p: any) => { report += `-${p.name}${p.dateText ? `(${p.dateText})` : ''}\n`; });
        report += `\n`;
    } else {
        report += `-없음\n\n`;
    }

    // 듀티
    report += `<듀티>\n`;
    if ((evening.duties || []).length > 0) {
        evening.duties.forEach((name: string) => { report += `-${name}\n`; });
    } else {
        report += `-없음\n`;
    }

    return report;
}


export interface MorningReportParams {
    rollCallData: RollCallData | null;
    healthNote: string;
    scheduleParticipants: Record<string, string[]>;
    customSchedules: { name: string; participants: string[] }[];
}

export function generateMorningReportText({
    rollCallData,
    healthNote,
    scheduleParticipants,
    customSchedules
}: MorningReportParams): string {
    if (!rollCallData) return '데이터를 불러오는 중입니다...';

    const { morning } = rollCallData;

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
    const presentMembers = (morning.presentMembers || []).filter(
        (name: string) => !Array.from(allOffNames).some(off => name.startsWith(off.split(' ')[0]))
    );

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

    return report;
}
