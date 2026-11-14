/**
 * 엑셀 업로드의 '잔류' 기록 기간: 항상 토요일~일요일 이틀.
 * 기준일(anchor)이 속한 주의 토요일을 찾는다. 기준일이 토·일이면 그 주말, 금이면 다음 토요일,
 * 월~목이면 가장 가까운 토요일을 쓴다. 결과는 시트와 같은 'M.D' 형식.
 */
const md = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`;

export function stayWeekendMD(anchor: Date): { start: string; end: string } {
    const base = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 12, 0, 0, 0);
    // 토요일까지 남은 날 (-3 ~ +3 범위로 가장 가까운 토요일)
    let diff = (6 - base.getDay());
    if (diff > 3) diff -= 7;
    const sat = new Date(base);
    sat.setDate(base.getDate() + diff);
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    return { start: md(sat), end: md(sun) };
}
