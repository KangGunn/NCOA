import { getRankDetails } from '../lib/rankUtils';
import type { MovementRecord } from '../types/movement/movement.type';

/**
 * Extracts the day count (number) from a given reason string.
 * Supports patterns like "쓰리데이", "3일", "포데이", "4.5일", "원데이" etc.
 */
export function extractDayCountFromText(reasonStr: string | undefined | null): number | null {
    if (!reasonStr) return null;
    const clean = reasonStr.trim().toLowerCase();
    
    // Match numeric days like "3일", "4.5일", "4 데이", "3.5데이"
    const numericMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:데이|일)/);
    if (numericMatch) {
        return parseFloat(numericMatch[1]);
    }
    
    // Match Korean day words
    const textDayMap: Record<string, number> = {
        '원': 1, 'one': 1,
        '투': 2, 'two': 2,
        '쓰리': 3, 'three': 3,
        '포': 4, 'four': 4,
        '파이브': 5, 'five': 5,
        '식스': 6, 'six': 6,
        '세븐': 7, 'seven': 7,
        '에잇': 8, 'eight': 8,
        '나인': 9, 'nine': 9,
        '텐': 10, 'ten': 10
    };
    
    for (const [key, val] of Object.entries(textDayMap)) {
        if (clean.includes(`${key}데이`) || clean.includes(`${key} 데이`)) {
            return val;
        }
    }
    
    return null;
}

/**
 * 다양한 형식으로 저장된 이름(예: '일병 2호봉 심규서', '일병 심규서', '심규서', '이병 3호봉 박세환')에서
 * 순수 부대원 이름('심규서', '박세환')을 정확하게 추출합니다.
 */
export function extractPureMemberName(rawStr: string | undefined | null): string {
    if (!rawStr) return '';
    let s = String(rawStr).trim();

    // 1. 괄호 내용 제거 (예: (금당), (토당), (원데이) 등)
    s = s.replace(/\([^\)]*\)/g, '').trim();

    // 2. 당직 키워드 제거
    s = s.replace(/당직.*/g, '').trim();

    // 3. 계급 접두사 제거
    s = s.replace(/^(병장|상병|일병|이병|SGT|CPL|PFC|PV2|PVT)\s*/i, '').trim();

    // 4. 호봉 접두사 제거 (예: 1호봉, 2호봉, 12호봉 등)
    s = s.replace(/^\d+호봉\s*/, '').trim();

    // 5. 호봉 뒤에 계급이 남거나 순서가 바뀐 경우 대비 재제거
    s = s.replace(/^(병장|상병|일병|이병|SGT|CPL|PFC|PV2|PVT)\s*/i, '').trim();

    // 6. 기타 특수기호 정리
    s = s.replace(/[^\w\s가-힣]/g, '').trim();

    // 7. 한글 이름 (2~5자) 매칭
    const match = s.match(/[가-힣]{2,5}$/);
    if (match) return match[0];

    return s.trim();
}

/**
 * 외특 탭의 특정 주차 타임라인에 맞추어, 캘린더 당직 일정(dutySchedules)을 실시간으로 읽어와
 * 스프레드시트는 변경하지 않고 외특 탭 화면 표시용 dataList에 당직('duty') 및 회복('recovery') 상태를 합성합니다.
 */
export function applyDutySchedulesToDataList(
    dataList: { name: string; dayStatuses: Record<string, string> }[],
    timeline: string[],
    dutySchedules: any[],
    dbMembers: any[],
    baseDate?: Date,
    sheetWeeks?: any[]
): { name: string; dayStatuses: Record<string, string> }[] {
    if (!timeline || timeline.length === 0 || !dutySchedules || dutySchedules.length === 0) {
        return dataList;
    }

    const currentYear = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

    // 1. 타임라인의 각 날짜 문자열("M.D")을 ISO ("YYYY-MM-DD")로 매핑
    const timelineIsoMap = new Map<string, string>();
    timeline.forEach(dateStr => {
        const [m, d] = dateStr.split('.').map(Number);
        if (!isNaN(m) && !isNaN(d)) {
            const iso = `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            timelineIsoMap.set(dateStr, iso);
        }
    });

    // 2. 기존 dataList를 깊은 복사하여 원본을 보존
    const resultList = dataList.map(item => ({
        name: item.name,
        dayStatuses: { ...item.dayStatuses }
    }));

    // 순수 이름 및 ID -> resultList 항목 매핑
    const memberEntryMap = new Map<string, { name: string; dayStatuses: Record<string, string> }>();
    resultList.forEach(item => {
        const pureName = extractPureMemberName(item.name);
        if (pureName) {
            memberEntryMap.set(pureName, item);
            const matchedDb = dbMembers.find((m: any) => m.name === pureName);
            if (matchedDb?.id) {
                memberEntryMap.set(matchedDb.id, item);
            }
        }
    });

    // 3. 현재 표시 중인 주(timeline)의 날짜들에 한해서 당직자 조회 및 반영
    timeline.forEach((dateStr, tIdx) => {
        const targetIso = timelineIsoMap.get(dateStr);
        if (!targetIso) return;

        const dutiesOnDate = dutySchedules.filter((s: any) =>
            (s.type === 'duty' || !s.type) && s.startDate === targetIso
        );

        dutiesOnDate.forEach((duty: any) => {
            if (!duty || !duty.memo) return;
            const pureName = extractPureMemberName(duty.memo);
            if (!pureName) return;

            // 당직 플래너의 데이터로부터 대응되는 부대원 객체 식별 (memberId 우선 매핑)
            const matchedDbMember = duty.memberId
                ? dbMembers.find((m: any) => m.id === duty.memberId)
                : dbMembers.find((m: any) => m.name === pureName);

            // 해당 부대원이 기존 목록에 있는지 확인 (ID 우선, 없으면 순수 이름)
            let entry = (duty.memberId ? memberEntryMap.get(duty.memberId) : null) || memberEntryMap.get(pureName);

            if (!entry) {
                // 이번 주 출타가 없어 시트 목록에 없던 당직자인 경우 새로운 행 생성
                // 시트와 동일한 형식("[순수 계급] [이름]", 예: "병장 최인성", "상병 강민")으로 표시
                let pureRank = '';
                if (matchedDbMember?.enlistmentDate) {
                    const dutyDate = new Date(`${targetIso}T12:00:00`);
                    const rankInfo = getRankDetails(
                        new Date(matchedDbMember.enlistmentDate),
                        dutyDate,
                        matchedDbMember.earlyPromotion || 0
                    );
                    pureRank = rankInfo.rank;
                } else if (matchedDbMember?.rank) {
                    pureRank = matchedDbMember.rank.replace(/\s*\d+호봉/, '').trim();
                }

                const displayName = pureRank ? `${pureRank} ${pureName}` : pureName;

                entry = {
                    name: displayName,
                    dayStatuses: {}
                };
                resultList.push(entry);
                if (matchedDbMember?.id) {
                    memberEntryMap.set(matchedDbMember.id, entry);
                }
                memberEntryMap.set(pureName, entry);
            }

            // 당직일 설정
            entry.dayStatuses[dateStr] = 'duty';

            // 익일 회복일 설정
            const nextIdx = tIdx + 1;
            if (nextIdx < timeline.length) {
                const nextDateStr = timeline[nextIdx];
                const currentNextStatus = entry.dayStatuses[nextDateStr] || 'none';
                if (currentNextStatus === 'pass-depart' || currentNextStatus === 'pass') {
                    entry.dayStatuses[nextDateStr] = 'recovery-pass-depart';
                } else if (currentNextStatus === 'none') {
                    entry.dayStatuses[nextDateStr] = 'recovery';
                }
            }
        });
    });

    // 4. 타임라인 시작일(timeline[0]) 바로 전날에 당직이었던 인원의 당일 회복일('recovery') 반영
    const firstDateStr = timeline[0];
    const [firstM, firstD] = firstDateStr.split('.').map(Number);
    if (!isNaN(firstM) && !isNaN(firstD)) {
        const prevDate = new Date(currentYear, firstM - 1, firstD - 1, 12, 0, 0, 0);
        const prevIso = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
        const prevDateMD = `${prevDate.getMonth() + 1}.${prevDate.getDate()}`;

        // 4-1) dutySchedules 에서 전날 당직자 확인
        const dutiesOnPrevDate = dutySchedules.filter((s: any) =>
            (s.type === 'duty' || !s.type) && s.startDate === prevIso
        );

        dutiesOnPrevDate.forEach((duty: any) => {
            if (!duty || !duty.memo) return;
            const pureName = extractPureMemberName(duty.memo);
            if (!pureName) return;

            const matchedDbMember = duty.memberId
                ? dbMembers.find((m: any) => m.id === duty.memberId)
                : dbMembers.find((m: any) => m.name === pureName);

            let entry = (duty.memberId ? memberEntryMap.get(duty.memberId) : null) || memberEntryMap.get(pureName);

            if (!entry) {
                let pureRank = '';
                if (matchedDbMember?.enlistmentDate) {
                    const dutyDate = new Date(`${prevIso}T12:00:00`);
                    const rankInfo = getRankDetails(
                        new Date(matchedDbMember.enlistmentDate),
                        dutyDate,
                        matchedDbMember.earlyPromotion || 0
                    );
                    pureRank = rankInfo.rank;
                } else if (matchedDbMember?.rank) {
                    pureRank = matchedDbMember.rank.replace(/\s*\d+호봉/, '').trim();
                }

                const displayName = pureRank ? `${pureRank} ${pureName}` : pureName;

                entry = {
                    name: displayName,
                    dayStatuses: {}
                };
                resultList.push(entry);
                if (matchedDbMember?.id) {
                    memberEntryMap.set(matchedDbMember.id, entry);
                }
                memberEntryMap.set(pureName, entry);
            }

            const currentStatus = entry.dayStatuses[firstDateStr] || 'none';
            if (currentStatus === 'pass-depart' || currentStatus === 'pass') {
                entry.dayStatuses[firstDateStr] = 'recovery-pass-depart';
            } else if (currentStatus === 'none') {
                entry.dayStatuses[firstDateStr] = 'recovery';
            }
        });

        // 4-2) sheetWeeks 가 전달된 경우 시트 상에서 전날 당직이었던 인원도 확인
        if (sheetWeeks && sheetWeeks.length > 0) {
            resultList.forEach(entry => {
                const pureName = extractPureMemberName(entry.name);
                if (!pureName) return;

                let wasDutyInSheet = false;
                for (const week of sheetWeeks) {
                    if (week.data && Array.isArray(week.data)) {
                        const row = week.data.find((r: any) => extractPureMemberName(r.name) === pureName);
                        if (row?.dayStatuses?.[prevDateMD] === 'duty') {
                            wasDutyInSheet = true;
                            break;
                        }
                    }
                }

                if (wasDutyInSheet) {
                    const currentStatus = entry.dayStatuses[firstDateStr] || 'none';
                    if (currentStatus === 'pass-depart' || currentStatus === 'pass') {
                        entry.dayStatuses[firstDateStr] = 'recovery-pass-depart';
                    } else if (currentStatus === 'none') {
                        entry.dayStatuses[firstDateStr] = 'recovery';
                    }
                }
            });
        }
    }

    return resultList;
}

/**
 * Converts "M.D" date string to "YYYY-MM-DD" based on baseYear,
 * handling year transitions if referenceMonth is provided.
 */
export function formatMDToISO(dateStr: string, baseYear: number, referenceMonth?: number): string {
    const parts = dateStr.split('.');
    if (parts.length < 2) return '';
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    let year = baseYear;
    if (referenceMonth !== undefined) {
        if (referenceMonth === 12 && m === 1) year += 1;
        else if (referenceMonth === 1 && m === 12) year -= 1;
    }
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Checks if a pass or stay movement falls within the period's core window:
 * "수요일부터 다음주 화요일 사이에 있는 외박"
 * Core window: timeline[0] (수요일) ~ timeline[6] (다음주 화요일)
 */
export function isPassInPeriod(mov: MovementRecord, coreStartIso: string, coreEndIso: string): boolean {
    if (mov.type !== 'pass' && mov.type !== 'stay') return false;
    // The pass belongs to this week if its start date is within the core window [Wed, Tue],
    // or overlaps the core window without having started in the previous week.
    return mov.startDate >= coreStartIso && mov.startDate <= coreEndIso;
}

/**
 * Checks if a vacation is linked to a pass (외휴연계 or 휴외연계).
 */
export function isVacationLinkedToPass(
    vacation: MovementRecord,
    pass: MovementRecord,
    dayStatuses?: Record<string, string>
): boolean {
    if (vacation.type !== 'vacation' || (pass.type !== 'pass' && pass.type !== 'stay')) return false;

    // 1. 외휴연계 (Pass -> Vacation): pass end is vacation start (or next day)
    const pEndObj = new Date(pass.endDate);
    const dayAfterPEnd = new Date(pEndObj);
    dayAfterPEnd.setDate(pEndObj.getDate() + 1);
    const dayAfterPEndIso = `${dayAfterPEnd.getFullYear()}-${String(dayAfterPEnd.getMonth() + 1).padStart(2, '0')}-${String(dayAfterPEnd.getDate()).padStart(2, '0')}`;

    if (vacation.startDate === pass.endDate || vacation.startDate === dayAfterPEndIso) {
        return true;
    }

    // 2. 휴외연계 (Vacation -> Pass): vacation end is pass departure or pass start
    const pStartObj = new Date(pass.startDate);
    const dayBeforePStart = new Date(pStartObj);
    dayBeforePStart.setDate(pStartObj.getDate() - 1);
    const dayBeforePStartIso = `${dayBeforePStart.getFullYear()}-${String(dayBeforePStart.getMonth() + 1).padStart(2, '0')}-${String(dayBeforePStart.getDate()).padStart(2, '0')}`;

    if (vacation.endDate === dayBeforePStartIso || vacation.endDate === pass.startDate) {
        return true;
    }

    // 3. Reason text / day status hints
    const vReason = vacation.reason || '';
    if (/외휴연계|휴외연계/.test(vReason)) {
        const vStart = new Date(vacation.startDate).getTime();
        const vEnd = new Date(vacation.endDate).getTime();
        const pStart = new Date(pass.startDate).getTime();
        const pEnd = new Date(pass.endDate).getTime();
        const diff1 = Math.abs(vStart - pEnd) / (1000 * 60 * 60 * 24);
        const diff2 = Math.abs(pStart - vEnd) / (1000 * 60 * 60 * 24);
        if (diff1 <= 2 || diff2 <= 2) return true;
    }

    if (dayStatuses) {
        const [, vm, vd] = vacation.startDate.split('-').map(Number);
        if (dayStatuses[`${vm}.${vd}`] === 'linked') {
            const vStart = new Date(vacation.startDate).getTime();
            const pEnd = new Date(pass.endDate).getTime();
            if (Math.abs(vStart - pEnd) / (1000 * 60 * 60 * 24) <= 2) return true;
        }
        const [, em, ed] = vacation.endDate.split('-').map(Number);
        if (dayStatuses[`${em}.${ed}`] === 'vacation-pass-depart') {
            const vEnd = new Date(vacation.endDate).getTime();
            const pStart = new Date(pass.startDate).getTime();
            if (Math.abs(pStart - vEnd) / (1000 * 60 * 60 * 24) <= 2) return true;
        }
    }

    return false;
}

/**
 * Filter movements corresponding to a 10-day period (수요일 ~ 다음주 금요일):
 * 1. 수요일부터 다음주 화요일 사이에 있는 외박과 그와 연계되는 휴가
 * 2. 외휴연계 혹은 휴외연계되지 않는 기간 내 휴가
 */
export function getPeriodMovementsForMember(
    cleanName: string,
    timeline: string[],
    currentYear: number,
    allMovements: MovementRecord[],
    dayStatuses?: Record<string, string>
): {
    thisPeriodPass: MovementRecord | null;
    thisPeriodVacation: MovementRecord | null;
    allPeriodMovements: MovementRecord[];
} {
    const memberMovements = allMovements.filter(m => m.name === cleanName);
    if (!timeline || timeline.length === 0) {
        return { thisPeriodPass: null, thisPeriodVacation: null, allPeriodMovements: [] };
    }

    const refMonth = parseInt(timeline[0].split('.')[0], 10);
    const periodStartIso = formatMDToISO(timeline[0], currentYear, refMonth);
    const periodEndIso = formatMDToISO(timeline[timeline.length - 1], currentYear, refMonth);

    const coreTimeline = timeline.slice(0, 7); // Wed ~ Tue (7 days)
    const coreStartIso = formatMDToISO(coreTimeline[0], currentYear, refMonth);
    const coreEndIso = formatMDToISO(coreTimeline[coreTimeline.length - 1], currentYear, refMonth);

    // 1. Pass in this period: "수요일부터 다음주 화요일 사이에 있는 외박"
    const periodPasses = memberMovements.filter(m => isPassInPeriod(m, coreStartIso, coreEndIso));
    let thisPeriodPass: MovementRecord | null = null;
    if (periodPasses.length > 0) {
        thisPeriodPass = periodPasses.find(p => p.startDate >= coreStartIso && p.startDate <= coreEndIso) || periodPasses[0];
    }

    // 2. Vacation in this period:
    // - Either linked to thisPeriodPass (외휴연계 or 휴외연계)
    // - OR independent vacation within the period (not linked to ANY pass)
    const memberPasses = memberMovements.filter(m => m.type === 'pass' || m.type === 'stay');
    const memberVacations = memberMovements.filter(m => m.type === 'vacation');

    const periodVacations: MovementRecord[] = [];
    memberVacations.forEach(vac => {
        // Check if linked to thisPeriodPass
        if (thisPeriodPass && isVacationLinkedToPass(vac, thisPeriodPass, dayStatuses)) {
            periodVacations.push(vac);
            return;
        }

        // Check if linked to another pass of this member (e.g. next week or previous week pass)
        const linkedOtherPass = memberPasses.find(p => 
            p !== thisPeriodPass && isVacationLinkedToPass(vac, p, dayStatuses)
        );
        if (linkedOtherPass) {
            // It belongs to that other pass's period, so do NOT include here
            return;
        }

        // Unlinked vacation ("외휴연계 혹은 휴외연계되지 않는 기간 내 휴가")
        // Check if it falls within the displayed period (Wednesday ~ next Friday)
        if (vac.startDate <= periodEndIso && vac.endDate >= periodStartIso) {
            periodVacations.push(vac);
        }
    });

    const thisPeriodVacation = periodVacations.find(v => {
        if (thisPeriodPass && isVacationLinkedToPass(v, thisPeriodPass, dayStatuses)) return true;
        return v.startDate >= periodStartIso && v.startDate <= periodEndIso;
    }) || periodVacations[0] || null;

    const allPeriodMovements: MovementRecord[] = [];
    if (thisPeriodPass) allPeriodMovements.push(thisPeriodPass);
    periodVacations.forEach(v => {
        if (!allPeriodMovements.some(m => m.id === v.id || (m.startDate === v.startDate && m.endDate === v.endDate && m.type === v.type))) {
            allPeriodMovements.push(v);
        }
    });

    return {
        thisPeriodPass,
        thisPeriodVacation,
        allPeriodMovements
    };
}
