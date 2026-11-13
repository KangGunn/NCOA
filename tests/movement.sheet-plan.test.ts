import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMovementCells, planMemberCells, findDateColumn, a1 } from '../functions/src/utils/sheetPlan.util.ts';
import { explainError, JobError } from '../functions/src/utils/jobError.util.ts';

// 시트 1행: A열은 이름, B열부터 날짜
const dateRow = ['', '2026. 11. 13', '2026. 11. 14', '2026. 11. 15', '2026. 11. 16'];
const names = ['', '', '병장 홍길동', '상병 김철수', '일병 김철수'];

test('date columns and A1 addresses', () => {
    assert.equal(findDateColumn(dateRow, '11.14'), 2);
    assert.equal(findDateColumn(dateRow, '12.1'), -1);
    assert.equal(a1(2, 2), "'NEW'!C3");
});

test('a normal pass is planned cell by cell', () => {
    const plan = planMovementCells(dateRow, names, [{ name: '병장 홍길동', type: '외박', depart: '11.13', return: '11.15', stayDays: ['11.14'] }], false);
    assert.deepEqual(plan.warnings, []);
    assert.deepEqual(plan.updateData.map(u => [u.range, u.values[0][0]]), [
        ["'NEW'!B3", '외박출발'], ["'NEW'!D3", '외박복귀'], ["'NEW'!C3", '외박'],
    ]);
});

test('a name missing from the sheet becomes a warning (no longer skipped silently)', () => {
    const plan = planMovementCells(dateRow, names, [{ name: '병장 이영희', type: '외박', depart: '11.13', return: '11.14' }], false);
    assert.equal(plan.updateData.length, 0);
    assert.deepEqual(plan.warnings, [{ name: '병장 이영희', message: "시트에서 '병장 이영희' 대원을 찾을 수 없습니다. 이름을 확인하세요." }]);
});

test('dates missing from the sheet header become a warning', () => {
    const plan = planMovementCells(dateRow, names, [{ name: '병장 홍길동', type: '외박', depart: '11.15', return: '11.17', stayDays: ['11.16'] }], false);
    assert.equal(plan.warnings.length, 1);
    assert.match(plan.warnings[0].message, /11\.17 날짜 칸이 없습니다/);
});

test('same-named members without an exact match are ambiguous', () => {
    const plan = planMovementCells(dateRow, names, [{ name: '병장 김철수', type: '당직', date: '11.14' }], false);
    assert.equal(plan.ambiguousMembers.length, 1);
    assert.deepEqual(plan.ambiguousMembers[0].options, ['상병 김철수', '일병 김철수']);
});

test('edit save: missing member and missing dates are reported', () => {
    assert.equal(planMemberCells(dateRow, names, '이영희', {}, { '11.14': '외박' }, false).notFound, true);
    // 비우기만 하는 날짜는 칸이 없어도 문제없다
    const clearOnly = planMemberCells(dateRow, names, '홍길동', {}, { '11.14': '외박', '11.20': '' }, false);
    assert.deepEqual(clearOnly.missingDates, []);
    assert.deepEqual(clearOnly.updateData.map(u => u.range), ["'NEW'!C3"]);
    // 값을 써야 하는데 칸이 없으면 보고한다
    const needsCell = planMemberCells(dateRow, names, '홍길동', {}, { '11.14': '외박', '11.20': '외박복귀' }, false);
    assert.deepEqual(needsCell.missingDates, ['11.20']);
});

test('errors are explained, and only temporary ones are retried', () => {
    const quota = explainError({ response: { status: 429 }, message: 'Quota exceeded' });
    assert.equal(quota.permanent, false);
    assert.match(quota.message, /요청 한도/);

    const perm = explainError({ code: 403, message: 'The caller does not have permission' });
    assert.equal(perm.permanent, true);
    assert.match(perm.message, /권한/);

    const range = explainError(new Error('Unable to parse range: NEW!1:1'));
    assert.equal(range.permanent, true);
    assert.match(range.message, /'NEW' 탭/);

    const net = explainError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    assert.equal(net.permanent, false);

    const tooMany = explainError(new Error('maximum 500 writes allowed per request'));
    assert.equal(tooMany.permanent, true);

    const ours = explainError(new JobError("시트에서 '홍길동' 대원을 찾을 수 없습니다."));
    assert.equal(ours.permanent, true);
    assert.equal(ours.message, "시트에서 '홍길동' 대원을 찾을 수 없습니다.");
});
