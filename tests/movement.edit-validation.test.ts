import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    validateMovementEdit,
    hasBlockingIssue,
    getFieldIssues,
    countDaysInclusive,
    addDaysIso,
    extractPassDaysFromReason,
    extractVacationDaysFromReason,
} from '../src/utils/movement/movement.edit-validation.ts';
import type { MovementEditInput } from '../src/utils/movement/movement.edit-validation.ts';

const base: MovementEditInput = {
    hasPass: false,
    passStart: '',
    passEnd: '',
    passReason: '',
    hasVacation: false,
    vacationStart: '',
    vacationEnd: '',
    vacationReason: '',
    allowVacationPassLink: false,
    dutyIsoDates: [],
    otherMovements: [],
};

const codes = (input: Partial<MovementEditInput>) =>
    validateMovementEdit({ ...base, ...input }).map(issue => issue.code);

test('date helpers', () => {
    assert.equal(countDaysInclusive('2026-11-14', '2026-11-15'), 2);
    assert.equal(countDaysInclusive('2026-12-31', '2027-01-01'), 2);
    assert.equal(countDaysInclusive('bad', '2026-11-15'), 0);
    assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28');
});

test('reason day extraction', () => {
    assert.equal(extractPassDaysFromReason('일반 투데이'), 2);
    assert.equal(extractPassDaysFromReason('BLC 컴펜 3데이'), 3);
    assert.equal(extractPassDaysFromReason('포상'), null);
    assert.equal(extractVacationDaysFromReason('연가 4일'), 4);
    assert.equal(extractVacationDaysFromReason('연가'), null);
});

test('nothing enabled → no issues', () => {
    assert.deepEqual(codes({}), []);
});

test('valid pass passes', () => {
    assert.deepEqual(codes({ hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15', passReason: '일반 투데이' }), []);
});

test('missing dates and reason are reported per field', () => {
    const issues = validateMovementEdit({ ...base, hasPass: true });
    assert.deepEqual(issues.map(i => i.code), ['pass-start-missing', 'pass-end-missing', 'pass-reason-missing']);
    assert.equal(getFieldIssues(issues, 'passStart').length, 1);
    assert.equal(getFieldIssues(issues, 'vacationStart').length, 0);
    assert.ok(hasBlockingIssue(issues));
});

test('inverted range', () => {
    assert.ok(codes({ hasPass: true, passStart: '2026-11-16', passEnd: '2026-11-15', passReason: '일반' }).includes('pass-range-inverted'));
    assert.ok(codes({ hasVacation: true, vacationStart: '2026-11-16', vacationEnd: '2026-11-15', vacationReason: '연가' }).includes('vacation-range-inverted'));
});

test('reason day count must match the selected period', () => {
    assert.deepEqual(
        codes({ hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-16', passReason: '일반 투데이' }),
        ['pass-reason-days-mismatch']
    );
    assert.deepEqual(
        codes({ hasVacation: true, vacationStart: '2026-11-10', vacationEnd: '2026-11-12', vacationReason: '연가 4일' }),
        ['vacation-reason-days-mismatch']
    );
    // 일수가 없는 사유는 검사하지 않는다
    assert.deepEqual(codes({ hasVacation: true, vacationStart: '2026-11-10', vacationEnd: '2026-11-12', vacationReason: '연가' }), []);
});

test('vacation on a duty day is blocked', () => {
    const issues = validateMovementEdit({
        ...base,
        hasVacation: true, vacationStart: '2026-11-10', vacationEnd: '2026-11-12', vacationReason: '연가 3일',
        dutyIsoDates: ['2026-11-11', '2026-11-20'],
    });
    assert.deepEqual(issues.map(i => i.code), ['vacation-duty-overlap']);
    assert.match(issues[0].message, /11\/11/);
});

test('duty on a pass day or on the departure day is blocked', () => {
    const pass = { hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15', passReason: '일반 2일' };
    const issues = validateMovementEdit({ ...base, ...pass, dutyIsoDates: ['2026-11-15'] });
    assert.deepEqual(issues.map(i => i.code), ['pass-duty-overlap']);
    assert.match(issues[0].message, /11\/15/);
    assert.deepEqual(issues[0].fields, ['passStart', 'passEnd']);

    const depart = validateMovementEdit({ ...base, ...pass, dutyIsoDates: ['2026-11-13'] });
    assert.deepEqual(depart.map(i => i.code), ['pass-duty-overlap']);
    assert.match(depart[0].message, /출발일 11\/13/);

    // 출발일 전날(11/12) 당직 → 출발일은 회복일, 허용
    assert.deepEqual(codes({ ...pass, dutyIsoDates: ['2026-11-12'] }), []);
});

test('a graduation reason without 기수 is blocked', () => {
    const pass = { hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15', passReason: 'KTA 수료 투데이' };
    assert.deepEqual(codes({ ...pass, passBatchMissing: true }), ['pass-batch-missing']);
    assert.deepEqual(codes({ ...pass, passBatchMissing: false }), []);
});

test('포상휴가 without a kind is blocked', () => {
    const vac = { hasVacation: true, vacationStart: '2026-11-10', vacationEnd: '2026-11-12', vacationReason: '포상휴가 3일' };
    assert.deepEqual(codes({ ...vac, vacationKindMissing: true }), ['vacation-kind-missing']);
    assert.deepEqual(codes({ ...vac, vacationReason: '교육유공 포상휴가 3일' }), []);
});

test('pass reason day count in N일 form is checked', () => {
    assert.equal(extractPassDaysFromReason('일반 2일'), 2);
    assert.equal(extractPassDaysFromReason('생일'), null);
    assert.deepEqual(
        codes({ hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-16', passReason: '일반 2일' }),
        ['pass-reason-days-mismatch']
    );
});

test('the same conflict reported by two records appears once', () => {
    const otherMovements = [
        { type: 'vacation' as const, startDate: '2026-11-16', endDate: '2026-11-19' },
        { type: 'vacation' as const, startDate: '2026-11-16', endDate: '2026-11-19' },
    ];
    assert.deepEqual(
        codes({ hasVacation: true, vacationStart: '2026-11-18', vacationEnd: '2026-11-20', vacationReason: '연가', otherMovements }),
        ['vacation-overlaps-existing']
    );
});

test('pass and vacation overlap, but linked boundaries are allowed', () => {
    const pass = { hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15', passReason: '일반 투데이' };
    // 겹침
    assert.ok(codes({ ...pass, hasVacation: true, vacationStart: '2026-11-15', vacationEnd: '2026-11-17', vacationReason: '연가' }).length === 0,
        '외휴연계 (외박 복귀일 = 휴가 출발일) 은 겹침이 아니다');
    assert.ok(codes({ ...pass, hasVacation: true, vacationStart: '2026-11-14', vacationEnd: '2026-11-16', vacationReason: '연가' }).includes('pass-vacation-overlap'));
});

test('vacation return on pass departure warns only when 휴외연계 is off', () => {
    const input = {
        hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15', passReason: '일반 투데이',
        hasVacation: true, vacationStart: '2026-11-10', vacationEnd: '2026-11-13', vacationReason: '연가 4일',
    };
    const off = validateMovementEdit({ ...base, ...input, allowVacationPassLink: false });
    assert.deepEqual(off.map(i => i.code), ['vacation-pass-link-disabled']);
    assert.equal(hasBlockingIssue(off), false);

    assert.deepEqual(codes({ ...input, allowVacationPassLink: true }), []);
});

test('conflicts with other remaining records', () => {
    const otherMovements = [
        { type: 'pass' as const, startDate: '2026-11-21', endDate: '2026-11-22', reason: '일반 투데이' },
        { type: 'vacation' as const, startDate: '2026-11-01', endDate: '2026-11-03', reason: '연가 3일' },
    ];
    assert.deepEqual(
        codes({ hasPass: true, passStart: '2026-11-22', passEnd: '2026-11-23', passReason: '일반 투데이', otherMovements }),
        ['pass-overlaps-existing']
    );
    assert.deepEqual(
        codes({ hasVacation: true, vacationStart: '2026-11-03', vacationEnd: '2026-11-05', vacationReason: '연가 3일', otherMovements }),
        ['vacation-overlaps-existing']
    );
    // 다른 외박의 복귀일에 휴가를 출발하는 것은 외휴연계로 허용
    assert.deepEqual(
        codes({ hasVacation: true, vacationStart: '2026-11-22', vacationEnd: '2026-11-24', vacationReason: '연가 3일', otherMovements }),
        []
    );
});
