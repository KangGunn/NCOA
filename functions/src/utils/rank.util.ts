/* eslint-disable @typescript-eslint/no-explicit-any */
export function calculateRankFromEnlistment(enlistmentDate: Date, earlyPromotionMonths = 0): string {
    const now = new Date();
    const baseMonths = (now.getFullYear() - enlistmentDate.getFullYear()) * 12
        + now.getMonth() - enlistmentDate.getMonth();
    const m = baseMonths + earlyPromotionMonths;
    const isFirstDay = enlistmentDate.getDate() === 1;

    let tier = "이병";

    if (m <= 1) {
        tier = "이병";
    } else if (m === 2) {
        tier = isFirstDay ? "일병" : "이병";
    } else {
        const above = m - (isFirstDay ? 2 : 3);
        if (above < 6) tier = "일병";
        else if (above < 12) tier = "상병";
        else tier = "병장";
    }
    return tier;
}

export function getMemberDisplayName(member: any): string {
    if (member.role !== "runner" && member.enlistmentDate) {
        const rank = calculateRankFromEnlistment(
            new Date(member.enlistmentDate),
            member.earlyPromotion || 0
        );
        return `${member.name} ${rank}`;
    }
    const cleanRank = member.role === "runner"
        ? (member.rank || "").split(" ")[0]
        : (member.rank || "");
    return `${member.name} ${cleanRank}`.trim();
}
