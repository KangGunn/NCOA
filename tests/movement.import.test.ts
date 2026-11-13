import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planImportFirestore, mdToIso, type ImportMovement, type ExistingDoc } from '../functions/src/utils/movementImport.util.ts';

const Y = 2026;
const pass = (name: string, period: string, reason = '일반 투데이'): ImportMovement => ({ name, type: '외박', period, reason });
const vac = (name: string, depart: string, ret: string, reason = '연가 4일'): ImportMovement => ({ name, type: '외박', period: '', vacation: { depart, return: ret, reason } });
const stay = (name: string, detail = '잔류'): ImportMovement => ({ name, type: '잔류', stayStart: '11.14', stayEnd: '11.15', detail });

test('M.D converts to ISO with the given year; the one-day suffix is ignored', () => {
    assert.equal(mdToIso('9.4', Y), '2026-09-04');
    assert.equal(mdToIso('9.4 (원데이)', Y), '2026-09-04');
    assert.equal(mdToIso('', Y), '');
});

test('pass and stay records are written with the right dates', () => {
    const plan = planImportFirestore([pass('병장 홍길동', '9.4~9.7'), stay('병장 김철수')], [], Y);
    assert.deepEqual(plan.adds, [
        { name: '홍길동', type: 'pass', startDate: '2026-09-04', endDate: '2026-09-07', reason: '일반 투데이' },
        { name: '김철수', type: 'stay', startDate: '2026-11-14', endDate: '2026-11-15', reason: '잔류' },
    ]);
    assert.deepEqual(plan.deleteIds, []);
});

test('overlapping pass of the same member is deleted; other members untouched', () => {
    const existing: ExistingDoc[] = [
        { id: 'a', name: '홍길동', type: 'pass', startDate: '2026-09-05', endDate: '2026-09-06' },
        { id: 'b', name: '김철수', type: 'pass', startDate: '2026-09-05', endDate: '2026-09-06' },
        { id: 'c', name: '홍길동', type: 'pass', startDate: '2026-10-01', endDate: '2026-10-02' },
    ];
    assert.deepEqual(planImportFirestore([pass('병장 홍길동', '9.4~9.7')], existing, Y).deleteIds, ['a']);
});

test('a pass overlapping an incoming vacation of the same member is deleted (as before)', () => {
    const existing: ExistingDoc[] = [{ id: 'p', name: '홍길동', type: 'pass', startDate: '2026-09-08', endDate: '2026-09-08' }];
    assert.deepEqual(planImportFirestore([vac('병장 홍길동', '9.8', '9.11')], existing, Y).deleteIds, ['p']);
});

test('a vacation only replaces overlapping vacations', () => {
    const existing: ExistingDoc[] = [
        { id: 'v-same', name: '홍길동', type: 'vacation', startDate: '2026-09-09', endDate: '2026-09-10' },
        { id: 'v-other', name: '홍길동', type: 'vacation', startDate: '2026-10-20', endDate: '2026-10-21' },
    ];
    assert.deepEqual(planImportFirestore([pass('병장 홍길동', '9.4~9.7')], existing, Y).deleteIds, []);
    assert.deepEqual(planImportFirestore([vac('병장 홍길동', '9.8', '9.11')], existing, Y).deleteIds, ['v-same']);
});

test('a batch without dates deletes nothing', () => {
    const existing: ExistingDoc[] = [{ id: 'x', name: '홍길동', type: 'pass', startDate: '2026-09-04', endDate: '2026-09-07' }];
    assert.deepEqual(planImportFirestore([{ name: '병장 홍길동', type: '당직', date: '9.4' }], existing, Y).deleteIds, []);
});

test('a pass across New Year is stored as Dec → Jan of the next year', () => {
    const plan = planImportFirestore([pass('병장 홍길동', '12.28~1.3')], [], '2026-12-26');
    assert.deepEqual(plan.adds[0], { name: '홍길동', type: 'pass', startDate: '2026-12-28', endDate: '2027-01-03', reason: '일반 투데이' });
});

test('December dates uploaded in January keep last year', () => {
    const plan = planImportFirestore([pass('병장 홍길동', '12.31'), vac('병장 홍길동', '1.4', '1.6')], [], '2027-01-02');
    assert.deepEqual(plan.adds.map(a => [a.startDate, a.endDate]), [['2026-12-31', '2026-12-31'], ['2027-01-04', '2027-01-06']]);
});

test('a stay weekend spanning New Year (12/31~1/1) is ordered correctly', () => {
    const plan = planImportFirestore([{ name: '병장 김철수', type: '잔류', stayStart: '12.31', stayEnd: '1.1' }], [], '2026-12-31');
    assert.deepEqual([plan.adds[0].startDate, plan.adds[0].endDate], ['2026-12-31', '2027-01-01']);
});
