import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMovementWrites, splitPeriodDocs, type MovementDoc } from '../functions/src/utils/movementSaveJob.util.ts';
import { splitMemberDocs } from '../src/utils/movement/movement.edit-period.ts';

const window = { coreStart: '2026-11-11', coreEnd: '2026-11-17' };
const pass = { type: 'pass' as const, startDate: '2026-11-14', endDate: '2026-11-15', reason: '일반 투데이' };
const vacation = { startDate: '2026-11-16', endDate: '2026-11-19', reason: '연가 4일' };

const docs: MovementDoc[] = [
    { id: 'p1', type: 'pass', startDate: '2026-11-14', endDate: '2026-11-15' },
    { id: 'p-dup', type: 'pass', startDate: '2026-11-15', endDate: '2026-11-15' },
    { id: 'v1', type: 'vacation', startDate: '2026-11-16', endDate: '2026-11-19' },
    { id: 'prev-vac', type: 'vacation', startDate: '2026-11-03', endDate: '2026-11-12' },
    { id: 'next-pass', type: 'pass', startDate: '2026-11-21', endDate: '2026-11-22' },
];

test('server split matches the app split (same period rules)', () => {
    const server = splitPeriodDocs(docs, window);
    const app = splitMemberDocs(docs, window);
    assert.deepEqual(server.ownPassDocs.map(d => d.id), app.ownPassDocs.map(d => d.id));
    assert.deepEqual(server.ownVacDocs.map(d => d.id), app.ownVacDocs.map(d => d.id));
    assert.equal(server.ownPass?.id, app.ownPass?.id);
    assert.equal(server.ownVac?.id, app.ownVac?.id);
});

test('existing period docs are updated, duplicates deleted, other periods untouched', () => {
    const plan = planMovementWrites(docs, { memberName: '김원범', periodWindow: window, pass, vacation });
    assert.deepEqual(plan.updates.map(u => u.id), ['p1', 'v1']);
    assert.equal(plan.updates[0].data.reason, '일반 투데이');
    assert.deepEqual(plan.creates, []);
    assert.deepEqual(plan.deletes, ['p-dup']);
});

test('new records are created when the period has none', () => {
    const plan = planMovementWrites([docs[3]], { memberName: '김원범', periodWindow: window, pass, vacation });
    assert.deepEqual(plan.creates, [
        { name: '김원범', ...pass },
        { name: '김원범', type: 'vacation', ...vacation },
    ]);
    assert.deepEqual(plan.deletes, []);
});

test('turning a switch off deletes only this period\'s records', () => {
    const plan = planMovementWrites(docs, { memberName: '김원범', periodWindow: window, pass: null, vacation: null });
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.deletes.sort(), ['p-dup', 'p1', 'v1']);
});

test('processing the same request twice gives the same result', () => {
    const job = { memberName: '김원범', periodWindow: window, pass: { ...pass, type: 'stay' as const, reason: '잔류' }, vacation: null };
    const first = planMovementWrites([], job);
    assert.equal(first.creates.length, 1);
    // 처음에 만든 문서가 있다고 보고 다시 처리하면 새로 만들지 않고 고친다
    const afterFirst: MovementDoc[] = [{ id: 'created', type: 'stay', startDate: pass.startDate, endDate: pass.endDate }];
    const second = planMovementWrites(afterFirst, job);
    assert.deepEqual(second.creates, []);
    assert.deepEqual(second.updates.map(u => u.id), ['created']);
});
