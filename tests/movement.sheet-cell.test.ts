import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeSheetCell, sheetCellToStatus, countSheetColumn, SHEET_CELL_VALUES } from '../src/utils/movement/movement.sheet-cell.ts';
import { composeSheetCell as serverCompose, SHEET_CELL_VALUES as SERVER_VALUES, planMovementCells } from '../functions/src/utils/sheetPlan.util.ts';
import { buildCellUpdates, eachIsoDate, isoToMD, type CellUpdateContext, type EditedState } from '../src/utils/movement/movement.edit-period.ts';
import { validateMovementEdit } from '../src/utils/movement/movement.edit-validation.ts';

const noDuty = () => false;
const none: EditedState = { hasPass: false, passStart: '', passEnd: '', hasVacation: false, vacationStart: '', vacationEnd: '' };
const ctx = (state: Partial<EditedState>, extra: Partial<CellUpdateContext> = {}): CellUpdateContext => ({
    ...none, ...state, ownedOriginalDates: [], retainedVacations: [], retainedPasses: [], isDutyOn: noDuty, allowVacationPassLink: false, ...extra,
});

/** 한 사람의 셀들을 시트 수식처럼 세어, 출발 = 복귀인지와 날짜별 밤 상태를 본다 */
function audit(cells: Record<string, string>) {
    const values = Object.values(cells).filter(Boolean);
    values.forEach(v => assert.ok((SHEET_CELL_VALUES as readonly string[]).includes(v), `드롭다운에 없는 값: ${v}`));
    const c = countSheetColumn(values);
    assert.equal(c.passDepart, c.passReturn, `외박 출발 ${c.passDepart} ≠ 복귀 ${c.passReturn} (${JSON.stringify(cells)})`);
    assert.equal(c.vacationDepart, c.vacationReturn, `휴가 출발 ${c.vacationDepart} ≠ 복귀 ${c.vacationReturn} (${JSON.stringify(cells)})`);
    const night = (md: string) => {
        const k = countSheetColumn([cells[md] || '']);
        return k.awayPass ? '외박' : k.awayVacation ? '휴가' : '부대';
    };
    return { counts: c, night };
}

test('app and server use the same cell rules and dropdown', () => {
    assert.deepEqual([...SHEET_CELL_VALUES], SERVER_VALUES);
    const flags = ['passReturn', 'vacationDepart', 'vacationReturn', 'passDepart', 'passStay', 'vacationStay'] as const;
    for (let mask = 0; mask < 64; mask++) {
        const e = Object.fromEntries(flags.map((f, i) => [f, !!(mask & (1 << i))]));
        for (const allow of [false, true]) assert.equal(composeSheetCell(e, allow), serverCompose(e, allow));
    }
});

test('every combination is written in day order with the link mark only for 휴외연계', () => {
    assert.equal(composeSheetCell({ passReturn: true, vacationDepart: true }, false), '외박복귀/휴가출발');
    assert.equal(composeSheetCell({ vacationReturn: true, passDepart: true }, false), '휴가복귀/외박출발');
    assert.equal(composeSheetCell({ vacationReturn: true, passDepart: true }, true), '휴가복귀/외박출발');
    assert.equal(composeSheetCell({ vacationDepart: true, vacationReturn: true }, true), '휴가출발/휴가복귀');
    assert.equal(composeSheetCell({ vacationDepart: true, vacationReturn: true, passDepart: true }, true), '휴가출발/휴가복귀/외박출발');
    assert.equal(composeSheetCell({ passReturn: true, vacationDepart: true, vacationReturn: true }, false), '외박복귀/휴가출발/휴가복귀');
    assert.equal(composeSheetCell({ passReturn: true, passDepart: true }, false), '외박복귀/외박출발');
    assert.equal(composeSheetCell({ passStay: true }, false), '외박');
    assert.equal(composeSheetCell({}, false), '');
});

test('reading the sheet: new and old values map to the same grass status', () => {
    const map: Record<string, string> = {
        '외박': 'pass', '외박출발': 'pass-depart', '외박복귀': 'pass',
        '휴가': 'vacation', '휴가출발': 'vacation', '휴가복귀': 'vacation', '휴가출발/휴가복귀': 'vacation',
        '외박복귀/휴가출발': 'linked', '외박복귀/휴가출발/휴가복귀': 'linked', '휴가출발(연계)': 'linked',
        '휴가복귀/외박출발': 'vacation-pass-depart', '휴가복귀(연계)/외박출발': 'vacation-pass-depart', '휴가출발/휴가복귀/외박출발': 'vacation-pass-depart',
        '외박출발(연계)': 'vacation-pass-depart', '외박 휴가복귀/외박출발': 'vacation-pass-depart',
        '외박복귀/외박출발': 'pass-depart', '당직': 'duty', '외출': 'none', '': 'none',
    };
    for (const [cell, status] of Object.entries(map)) assert.equal(sheetCellToStatus(cell), status, cell);
});

test('① 외휴연계: pass return day counts 외박복귀 and 휴가출발, away on vacation that night', () => {
    const cells = buildCellUpdates(ctx({ hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15', hasVacation: true, vacationStart: '2026-11-15', vacationEnd: '2026-11-18' }));
    assert.equal(cells['11.15'], '외박복귀/휴가출발');
    const a = audit(cells);
    assert.equal(a.night('11.15'), '휴가');
    assert.equal(a.night('11.18'), '부대');
});

test('① + 당일 휴가 does not happen: the editor blocks it and an Excel row is stopped with a warning', () => {
    const issues = validateMovementEdit({
        hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15', passReason: '일반 투데이',
        hasVacation: true, vacationStart: '2026-11-15', vacationEnd: '2026-11-15', vacationReason: '연가 1일',
        allowVacationPassLink: false, dutyIsoDates: [], otherMovements: [],
    });
    assert.ok(issues.some(i => i.code === 'linked-one-day-vacation' && i.severity === 'error'));
    assert.ok(!(SHEET_CELL_VALUES as readonly string[]).includes('외박복귀/휴가출발/휴가복귀'));

    const dateRow = ['', '2026. 11. 13', '2026. 11. 14', '2026. 11. 15'];
    const plan = planMovementCells(dateRow, ['', '', '병장 홍길동'], [
        { name: '병장 홍길동', type: '외박', depart: '11.13', return: '11.15', stayDays: ['11.14'], vacation: { depart: '11.15', return: '11.15', stayDays: [] } },
    ], false);
    assert.equal(plan.warnings.length, 1);
    assert.match(plan.warnings[0].message, /쓸 수 없는 조합/);
});

test('②③ 휴외연계 allowed and not allowed count the same, only the label differs', () => {
    for (const allow of [true, false]) {
        const cells = buildCellUpdates(ctx(
            { hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15', hasVacation: true, vacationStart: '2026-11-10', vacationEnd: '2026-11-13' },
            { allowVacationPassLink: allow },
        ));
        assert.equal(cells['11.13'], '휴가복귀/외박출발');
        const a = audit(cells);
        assert.equal(a.night('11.13'), '외박');
        assert.deepEqual(a.counts.passDepart, 1);
        assert.deepEqual(a.counts.vacationReturn, 1);
    }
});

test('④ 당일 휴가 counts one departure and one return, on base that night', () => {
    const cells = buildCellUpdates(ctx({ hasVacation: true, vacationStart: '2026-11-12', vacationEnd: '2026-11-12' }));
    assert.equal(cells['11.12'], '휴가출발/휴가복귀');
    assert.equal(audit(cells).night('11.12'), '부대');
});

test('⑤ 당일 휴가 then pass departure the same day', () => {
    const cells = buildCellUpdates(ctx({ hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15', hasVacation: true, vacationStart: '2026-11-13', vacationEnd: '2026-11-13' }, { allowVacationPassLink: true }));
    assert.equal(cells['11.13'], '휴가출발/휴가복귀/외박출발');
    assert.equal(audit(cells).night('11.13'), '외박');
});

test('⑦ a pass departing on the day another pass returns', () => {
    // 지난 기간 외박 11/10 출발 ~ 11/13 복귀(시트에 이미 있음), 이번 외박 11/14~11/15 (출발 11/13)
    const sheet: Record<string, string> = { '11.10': '외박출발', '11.11': '외박', '11.12': '외박', '11.13': '외박복귀' };
    const cells = buildCellUpdates(ctx(
        { hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15' },
        { retainedPasses: [{ start: '2026-11-11', end: '2026-11-13' }] },
    ));
    assert.equal(cells['11.13'], '외박복귀/외박출발');
    const merged = { ...sheet, ...cells };
    const a = audit(merged);
    assert.equal(a.night('11.13'), '외박');
});

test('Excel import: same-day events of one member are combined into one cell', () => {
    const dateRow = ['', ...eachIsoDate('2026-11-10', '2026-11-20').map(iso => `2026. ${Number(iso.slice(5, 7))}. ${Number(iso.slice(8))}`)];
    const names = ['', '', '병장 홍길동'];
    const col = (iso: string) => dateRow.indexOf(`2026. ${Number(iso.slice(5, 7))}. ${Number(iso.slice(8))}`);
    const valueAt = (plan: ReturnType<typeof planMovementCells>, iso: string) => {
        const letter = String.fromCharCode(65 + col(iso));
        return plan.updateData.find(u => u.range === `'NEW'!${letter}3`)?.values[0][0];
    };
    // 외휴연계 (isLinked 표시와 무관하게 같은 날이면 합친다)
    const linked = planMovementCells(dateRow, names, [{ name: '병장 홍길동', type: '외박', depart: '11.13', return: '11.15', stayDays: ['11.14'], vacation: { depart: '11.15', return: '11.18', stayDays: ['11.16', '11.17'], isLinked: true } }], false);
    assert.deepEqual(linked.warnings, []);
    assert.equal(valueAt(linked, '2026-11-15'), '외박복귀/휴가출발');
    // 원데이 외박 두 번 연속 (11/14 복귀일에 다음 외박 출발)
    const twoOneDays = planMovementCells(dateRow, names, [
        { name: '병장 홍길동', type: '외박', depart: '11.13', return: '11.14', stayDays: [] },
        { name: '병장 홍길동', type: '외박', depart: '11.14', return: '11.15', stayDays: [] },
    ], false);
    assert.equal(valueAt(twoOneDays, '2026-11-14'), '외박복귀/외박출발');
    // 당일 휴가
    const oneDay = planMovementCells(dateRow, names, [{ name: '병장 홍길동', type: '외박', period: '', depart: '', return: '11.12', stayDays: [], vacation: { depart: '11.12', return: '11.12', stayDays: [] } }], false);
    assert.equal(valueAt(oneDay, '2026-11-12'), '휴가출발/휴가복귀');
    // 당직인 날 출타가 겹치면 경고
    const dutyClash = planMovementCells(dateRow, names, [
        { name: '병장 홍길동', type: '외박', depart: '11.13', return: '11.14', stayDays: [] },
        { name: '병장 홍길동', type: '당직', date: '11.13' },
    ], false);
    assert.equal(dutyClash.warnings.length, 1);
    assert.match(dutyClash.warnings[0].message, /당직인 날에 출타가 겹칩니다/);
});

test('isoToMD sanity for the helpers above', () => {
    assert.equal(isoToMD('2026-11-05'), '11.5');
});
