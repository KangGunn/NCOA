export function getRankDetailsWithHobong(enlistmentDate: Date, earlyPromotionMonths = 0, asOfDate: Date = new Date()): { rank: string; hobong: number } {
    if (asOfDate.getTime() < enlistmentDate.getTime()) {
        return { rank: "이병", hobong: 1 };
    }

    const baseMonths = (asOfDate.getFullYear() - enlistmentDate.getFullYear()) * 12
        + asOfDate.getMonth() - enlistmentDate.getMonth();
    const m = baseMonths + earlyPromotionMonths;
    const isFirstDay = enlistmentDate.getDate() === 1;

    let tier = "이병";
    let hobong = 1;

    if (m === 0) {
        tier = "이병";
        hobong = 1;
    } else if (m === 1) {
        tier = "이병";
        hobong = 2;
    } else if (m === 2) {
        if (isFirstDay) {
            tier = "일병";
            hobong = 1;
        } else {
            tier = "이병";
            hobong = 3;
        }
    } else {
        const monthsInIlbyeongOrAbove = m - (isFirstDay ? 2 : 3);
        if (monthsInIlbyeongOrAbove < 6) {
            tier = "일병";
            hobong = monthsInIlbyeongOrAbove + 1;
        } else if (monthsInIlbyeongOrAbove < 12) {
            tier = "상병";
            hobong = (monthsInIlbyeongOrAbove - 6) + 1;
        } else {
            tier = "병장";
            hobong = (monthsInIlbyeongOrAbove - 12) + 1;
        }
    }

    return { rank: tier, hobong };
}

export function getSeniorityRankScore(enlistmentDate?: string | Date | null, earlyPromotionMonths = 0, asOfDate: Date = new Date()): number {
    if (!enlistmentDate) return -1;
    const date = typeof enlistmentDate === "string" ? new Date(enlistmentDate) : enlistmentDate;
    if (isNaN(date.getTime())) return -1;

    const { rank, hobong } = getRankDetailsWithHobong(date, earlyPromotionMonths, asOfDate);
    const tierWeight: Record<string, number> = {
        "이병": 100,
        "일병": 200,
        "상병": 300,
        "병장": 400,
    };
    return (tierWeight[rank] || 0) + hobong;
}

export function compareMembersByHobong(a: any, b: any, asOfDate: Date = new Date()): number {
    const isHoldoverA = a?.role === "holdover" ? 1 : 0;
    const isHoldoverB = b?.role === "holdover" ? 1 : 0;
    if (isHoldoverA !== isHoldoverB) return isHoldoverA - isHoldoverB;

    const scoreA = getSeniorityRankScore(a?.enlistmentDate, a?.earlyPromotion || 0, asOfDate);
    const scoreB = getSeniorityRankScore(b?.enlistmentDate, b?.earlyPromotion || 0, asOfDate);

    // 1. 호봉순 (높은 호봉 먼저 = 내림차순)
    if (scoreA !== scoreB) {
        return scoreB - scoreA;
    }

    // 2. 호봉이 같다면 입대일 순 (빠른 입대일 = 오름차순)
    const dateA = typeof a?.enlistmentDate === "string" ? a.enlistmentDate.trim() : "";
    const dateB = typeof b?.enlistmentDate === "string" ? b.enlistmentDate.trim() : "";
    if (dateA || dateB) {
        if (!dateA) return 1;
        if (!dateB) return -1;
        if (dateA !== dateB) return dateA.localeCompare(dateB);
    }

    // 3. 이름 가나다 순
    const nameA = typeof a?.name === "string" ? a.name.trim() : "";
    const nameB = typeof b?.name === "string" ? b.name.trim() : "";
    return nameA.localeCompare(nameB, "ko");
}

export function calculateRankFromEnlistment(enlistmentDate: Date, earlyPromotionMonths = 0, asOfDate: Date = new Date()): string {
    return getRankDetailsWithHobong(enlistmentDate, earlyPromotionMonths, asOfDate).rank;
}

export function getMemberDisplayName(member: any, asOfDate: Date = new Date()): string {
    if (member.role !== "runner" && member.enlistmentDate) {
        const rank = calculateRankFromEnlistment(
            new Date(member.enlistmentDate),
            member.earlyPromotion || 0,
            asOfDate
        );
        return `${member.name} ${rank}`;
    }
    const cleanRank = member.role === "runner"
        ? (member.rank || "").split(" ")[0]
        : (member.rank || "");
    return `${member.name} ${cleanRank}`.trim();
}
