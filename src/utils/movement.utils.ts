import { getRankDetails } from '../lib/rankUtils';

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
    baseDate?: Date
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

    // 3. 현재 표시 중인 주(timeline)의 날짜들에 한해서만 당직자 조회 및 반영
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

    return resultList;
}
