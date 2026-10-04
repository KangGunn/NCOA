export interface RankDetail {
    rank: string;
    hobong: number;
    totalMonths: number;
}

type RankTier = '이병' | '일병' | '상병' | '병장';

export const getRankDetails = (enlistmentDate: Date, asOf: Date = new Date(), earlyPromotionMonths: number = 0): RankDetail => {
    const e = enlistmentDate;
    const t = asOf;

    if (t.getTime() < e.getTime()) {
        return { rank: '이병', hobong: 1, totalMonths: 1 };
    }

    // 실제 경과 개월 수 + 조기 진급 개월 수
    const baseMonths = (t.getFullYear() - e.getFullYear()) * 12 + t.getMonth() - e.getMonth();
    const m = baseMonths + earlyPromotionMonths;
    const isFirstDay = e.getDate() === 1;

    let tier: RankTier = '이병';
    let hobong = 1;

    if (m === 0) {
        tier = '이병';
        hobong = 1;
    } else if (m === 1) {
        tier = '이병';
        hobong = 2;
    } else if (m === 2) {
        if (isFirstDay) {
            tier = '일병';
            hobong = 1;
        } else {
            tier = '이병';
            hobong = 3;
        }
    } else {
        const monthsInIlbyeongOrAbove = m - (isFirstDay ? 2 : 3);
        
        if (monthsInIlbyeongOrAbove < 6) {
            tier = '일병';
            hobong = monthsInIlbyeongOrAbove + 1;
        } else if (monthsInIlbyeongOrAbove < 12) {
            tier = '상병';
            hobong = (monthsInIlbyeongOrAbove - 6) + 1;
        } else {
            tier = '병장';
            hobong = (monthsInIlbyeongOrAbove - 12) + 1;
        }
    }

    return { rank: tier, hobong, totalMonths: baseMonths + 1 };
};

/**
 * 짬순(호봉순) 정렬을 위한 계급/호봉 절대 점수 계산
 * 조기진급(earlyPromotionMonths)이 반영된 계급 및 호봉을 수치화하여
 * 높은 계급/호봉일수록 더 큰 값을 반환합니다.
 */
export const getSeniorityRankScore = (
    enlistmentDate?: string | Date | null,
    earlyPromotionMonths: number = 0,
    asOf: Date = new Date()
): number => {
    if (!enlistmentDate) return -1;
    const date = typeof enlistmentDate === 'string' ? new Date(enlistmentDate) : enlistmentDate;
    if (isNaN(date.getTime())) return -1;

    const { rank, hobong } = getRankDetails(date, asOf, earlyPromotionMonths);
    const tierWeight: Record<RankTier, number> = {
        '이병': 100,
        '일병': 200,
        '상병': 300,
        '병장': 400
    };
    return (tierWeight[rank as RankTier] || 0) + hobong;
};

/**
 * 조기진급을 고려한 짬순 비교 함수
 * 1. 호봉순 (높은 호봉이 먼저 = 내림차순)
 * 2. 호봉이 같다면 입대일 순 (빠른 입대일 = 오름차순)
 * 3. 이름 가나다 순 (오름차순)
 */
export const compareMembersByHobong = <T extends { name?: string; enlistmentDate?: string; earlyPromotion?: number; role?: string }>(
    a: T,
    b: T,
    asOf: Date = new Date()
): number => {
    // 유급생(holdover)은 기간병보다 아래 (holdover = 1, regular = 0)
    const isHoldoverA = a?.role === 'holdover' ? 1 : 0;
    const isHoldoverB = b?.role === 'holdover' ? 1 : 0;
    if (isHoldoverA !== isHoldoverB) return isHoldoverA - isHoldoverB;

    const scoreA = getSeniorityRankScore(a.enlistmentDate, a.earlyPromotion || 0, asOf);
    const scoreB = getSeniorityRankScore(b.enlistmentDate, b.earlyPromotion || 0, asOf);

    // 1. 호봉 점수 비교 (높은 호봉 = 선임 = 먼저)
    if (scoreA !== scoreB) {
        return scoreB - scoreA;
    }

    // 2. 입대일 비교 (빠른 입대일 = 선임 = 먼저)
    const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
    const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
    if (dateA || dateB) {
        if (!dateA) return 1;
        if (!dateB) return -1;
        if (dateA !== dateB) {
            return dateA.localeCompare(dateB);
        }
    }

    // 3. 이름 가나다 순
    const nameA = typeof a.name === 'string' ? a.name.trim() : '';
    const nameB = typeof b.name === 'string' ? b.name.trim() : '';
    return nameA.localeCompare(nameB, 'ko');
};

export const calculateRank = (enlistmentDate: Date, earlyPromotionMonths: number = 0, asOf: Date = new Date()): string => {
    const discharge = getExpectedDischargeDate(enlistmentDate);
    const dischargeMidnight = new Date(discharge.getFullYear(), discharge.getMonth(), discharge.getDate()).getTime();
    const asOfMidnight = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()).getTime();

    if (asOfMidnight > dischargeMidnight) {
        return "민간인";
    }

    const { rank, hobong } = getRankDetails(enlistmentDate, asOf, earlyPromotionMonths);
    return `${rank} ${hobong}호봉`;
};

export const formatEnlistmentDate = (dateStr: string): Date | null => {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
};

/** 육군 병역 복무 기간(개월) — 전역 예정일 계산용 기본값 */
export const DEFAULT_ARMY_SERVICE_MONTHS = 18;

export function getExpectedDischargeDate(enlistmentDate: Date): Date {
    const d = new Date(enlistmentDate.getTime());
    d.setMonth(d.getMonth() + DEFAULT_ARMY_SERVICE_MONTHS);
    d.setDate(d.getDate() - 1);
    return d;
}

export function formatDateYmd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** 입대일 문자열로부터 전역 예정일(YYYY-MM-DD), 파싱 실패 시 null */
export function formatExpectedDischargeFromEnlistmentStr(enlistmentDateStr: string): string | null {
    const enlist = formatEnlistmentDate(enlistmentDateStr);
    if (!enlist) return null;
    return formatDateYmd(getExpectedDischargeDate(enlist));
}
