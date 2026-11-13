import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestYearDate, rangeEndDate, toIsoDate } from '../src/utils/movement/movement.year.ts';

const ref = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

test('dates near New Year get the right year whether uploaded in December or January', () => {
    assert.equal(toIsoDate(nearestYearDate(12, 28, ref(2026, 12, 20))), '2026-12-28');
    assert.equal(toIsoDate(nearestYearDate(1, 3, ref(2026, 12, 20))), '2027-01-03');
    assert.equal(toIsoDate(nearestYearDate(12, 28, ref(2027, 1, 5))), '2026-12-28');
    assert.equal(toIsoDate(nearestYearDate(1, 3, ref(2027, 1, 5))), '2027-01-03');
    assert.equal(toIsoDate(nearestYearDate(9, 4, ref(2026, 9, 1))), '2026-09-04');
});

test('a range ending in January after a December start rolls into the next year', () => {
    const start = nearestYearDate(12, 28, ref(2026, 12, 20));
    assert.equal(toIsoDate(rangeEndDate(start, 1, 3)), '2027-01-03');
    assert.equal(toIsoDate(rangeEndDate(nearestYearDate(9, 4, ref(2026, 9, 1)), 9, 7)), '2026-09-07');
});
