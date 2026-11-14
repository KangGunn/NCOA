import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetEvents } from '../functions/src/utils/sheet.util.ts';

/** 한 사람의 11/12~11/18 셀로 점호 이벤트를 만든다 (오늘 = 11/15) */
function eventsFor(cells: Record<string, string>, today = '2026-11-15', tomorrow = '2026-11-16') {
    const days = ['12', '13', '14', '15', '16', '17', '18'].map(d => ({ dateStr: `2026-11-${d}`, m: 11, d: Number(d), cell: cells[`11.${d}`] || '' }));
    const data = [{ name: '홍길동', days }];
    return parseSheetEvents(data, data, data, today, tomorrow).filter((e: any) => e.startDate === today);
}

test('외휴연계 (외박복귀/휴가출발) is a vacation departure, not a returnee and not a pass departure', () => {
    const ev = eventsFor({ '11.13': '외박출발', '11.14': '외박', '11.15': '외박복귀/휴가출발', '11.16': '휴가', '11.17': '휴가복귀' });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].type, 'vacation');
    assert.equal(ev[0].isReturnDay, false);
    assert.equal(ev[0].isDepartDay, true);
    assert.equal(ev[0].dateText, '11.15~11.17');
});

test('휴외연계 (both labels) is a vacation return plus a pass departure, like the old label', () => {
    for (const cell of ['휴가복귀/외박출발', '휴가복귀(연계)/외박출발', '외박 휴가복귀/외박출발']) {
        const ev = eventsFor({ '11.13': '휴가출발', '11.14': '휴가', '11.15': cell, '11.16': '외박', '11.17': '외박복귀' });
        const vac = ev.find((e: any) => e.type === 'vacation');
        const pass = ev.find((e: any) => e.type === 'pass');
        assert.ok(vac && vac.isReturnDay, cell);
        assert.ok(pass && pass.isDepartDay, cell);
    }
});

test('당일 휴가 returns the same evening; with a pass departure it also departs on pass', () => {
    const one = eventsFor({ '11.15': '휴가출발/휴가복귀' });
    assert.equal(one.length, 1);
    assert.equal(one[0].isReturnDay, true);

    const thenPass = eventsFor({ '11.15': '휴가출발/휴가복귀/외박출발', '11.16': '외박', '11.17': '외박복귀' });
    assert.ok(thenPass.some((e: any) => e.type === 'vacation' && e.isReturnDay));
    assert.ok(thenPass.some((e: any) => e.type === 'pass' && e.isDepartDay));
});

test('외박 복귀일에 당일 휴가 (외박복귀/휴가출발/휴가복귀) returns that evening without a pass departure', () => {
    const ev = eventsFor({ '11.13': '외박출발', '11.14': '외박', '11.15': '외박복귀/휴가출발/휴가복귀' });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].type, 'vacation');
    assert.equal(ev[0].isReturnDay, true);
});

test('plain pass return still works', () => {
    const ev = eventsFor({ '11.13': '외박출발', '11.14': '외박', '11.15': '외박복귀' });
    assert.equal(ev[0].type, 'pass');
    assert.equal(ev[0].isReturnDay, true);
    assert.equal(ev[0].dateText, '11.14~11.15');
});

test('a same-day vacation (휴가출발/휴가복귀) is not a 외휴연계 departure', () => {
    const ev = eventsFor({ '11.15': '휴가출발/휴가복귀' });
    assert.equal(ev[0].isConsecutive, false);
});

test('외박복귀/휴가출발 is the 외휴연계 departure', () => {
    const ev = eventsFor({ '11.13': '외박출발', '11.14': '외박', '11.15': '외박복귀/휴가출발', '11.16': '휴가' });
    const vac = ev.find((e: any) => e.type === 'vacation');
    assert.equal(vac.isConsecutive, true);
});
