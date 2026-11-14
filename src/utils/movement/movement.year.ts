/**
 * 엑셀 댓글에는 연도가 없다. 월.일마다 기준일에서 가장 가까운 연도를 고른다.
 * 예) 기준일 2026-12-20: 12/28 → 2026-12-28, 1/3 → 2027-01-03
 *     기준일 2027-01-05: 12/28 → 2026-12-28, 1/3 → 2027-01-03
 */
export function nearestYearDate(m: number, d: number, ref: Date): Date {
    const y = ref.getFullYear();
    const refNoon = new Date(y, ref.getMonth(), ref.getDate(), 12, 0, 0, 0).getTime();
    let best = new Date(y, m - 1, d, 12, 0, 0, 0);
    for (const cy of [y - 1, y + 1]) {
        const c = new Date(cy, m - 1, d, 12, 0, 0, 0);
        if (Math.abs(c.getTime() - refNoon) < Math.abs(best.getTime() - refNoon)) best = c;
    }
    return best;
}

/** 범위의 끝: 시작보다 앞서면(연말을 넘는 기간) 다음 해로 */
export function rangeEndDate(start: Date, m: number, d: number): Date {
    const end = nearestYearDate(m, d, start);
    if (end.getTime() < start.getTime()) end.setFullYear(end.getFullYear() + 1);
    return end;
}

export const toIsoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
