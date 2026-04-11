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

export const calculateRank = (enlistmentDate: Date, earlyPromotionMonths: number = 0): string => {
    const { rank, hobong } = getRankDetails(enlistmentDate, new Date(), earlyPromotionMonths);
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
