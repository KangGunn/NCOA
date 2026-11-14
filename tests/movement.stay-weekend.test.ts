import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stayWeekendMD } from '../src/utils/movement/movement.stay-weekend.ts';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);

test('stay record is always the Saturday and Sunday of the anchor week', () => {
    // 2026-11-14 = 토, 11-15 = 일, 11-11 = 수, 11-13 = 금, 11-10 = 화
    assert.deepEqual(stayWeekendMD(d(2026, 11, 14)), { start: '11.14', end: '11.15' });
    assert.deepEqual(stayWeekendMD(d(2026, 11, 15)), { start: '11.14', end: '11.15' });
    assert.deepEqual(stayWeekendMD(d(2026, 11, 11)), { start: '11.14', end: '11.15' });
    assert.deepEqual(stayWeekendMD(d(2026, 11, 13)), { start: '11.14', end: '11.15' });
    assert.deepEqual(stayWeekendMD(d(2026, 11, 10)), { start: '11.7', end: '11.8' });
});

test('weekend crosses month and year boundaries', () => {
    assert.deepEqual(stayWeekendMD(d(2027, 1, 1)), { start: '1.2', end: '1.3' });
    assert.deepEqual(stayWeekendMD(d(2026, 10, 31)), { start: '10.31', end: '11.1' });
});
