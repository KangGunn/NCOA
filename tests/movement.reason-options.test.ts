import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getMemberSectionKeys,
    getPassReasonOptions,
    getVacationReasonOptions,
    withDayCount,
    stripDayCount,
    matchReasonOption,
    passDayWord,
    composePassReason,
    getBatchType,
    getBatchOptions,
    findWeekendInRange,
    getSectionPassReasons,
    composeVacationReason,
} from '../src/utils/movement/movement.reason-options.ts';

test('section keys come from sections and role', () => {
    assert.deepEqual(getMemberSectionKeys(['HQ', 'S-3']), ['HQ', 'S3']);
    assert.deepEqual(getMemberSectionKeys([], 'MEDIC'), ['MEDIC']);
    assert.deepEqual(getMemberSectionKeys(undefined, ''), []);
});

test('pass option order: 일반, Staff Duty, holidays, section reasons, 생일, KOM', () => {
    assert.deepEqual(getPassReasonOptions(['KTA'], ['추석']), ['일반', 'Staff Duty', '추석', 'KTA 수료', 'DBIDS', '생일', 'KOM']);
    assert.deepEqual(getPassReasonOptions(['HQ']), ['일반', 'Staff Duty', '생일', 'KOM']);
});

test('one graduation reason per member, by the most specific section', () => {
    assert.deepEqual(getSectionPassReasons(['BLC']), ['BLC 수료']);
    assert.deepEqual(getSectionPassReasons(['KTA']), ['KTA 수료', 'DBIDS']);
    assert.deepEqual(getSectionPassReasons(['MEDIC']), ['KTA 수료', 'PRT DEMO']);
    assert.deepEqual(getSectionPassReasons(['KTA', 'RSO']), ['KTA/RSO 수료', 'DBIDS']);
    assert.deepEqual(getSectionPassReasons(['KTA', 'PAO']), ['KTA/PAO 수료', 'DBIDS']);
    // S3·S6는 부섹션 하나만 있을 때만 (HQ는 무시)
    assert.deepEqual(getSectionPassReasons(['S3']), ['BLC/S3 수료']);
    assert.deepEqual(getSectionPassReasons(['HQ', 'S3']), ['BLC/S3 수료']);
    assert.deepEqual(getSectionPassReasons(['HQ', 'S6']), ['BLC/S6 수료']);
    assert.deepEqual(getSectionPassReasons(['BLC', 'S3']), ['BLC 수료']);
    assert.deepEqual(getSectionPassReasons(['KTA', 'S6']), ['KTA 수료', 'DBIDS']);
    assert.deepEqual(getSectionPassReasons(['HQ', 'S1']), []);
});

test('vacation options: 연가 and 포상휴가 (with a kind)', () => {
    assert.deepEqual(getVacationReasonOptions(), ['연가', '포상휴가']);
    assert.equal(composeVacationReason('연가', null, 4), '연가 4일');
    assert.equal(composeVacationReason('포상휴가', '교육유공', 3), '교육유공 포상휴가 3일');
    assert.equal(composeVacationReason('포상휴가', '골든타이거 포상', 5), '골든타이거 포상휴가 5일');
    assert.deepEqual(matchReasonOption('모범카투사 포상휴가 4일', ['연가', '포상휴가']), { option: '포상휴가', detail: '모범카투사' });
    assert.deepEqual(matchReasonOption('연가 4일', ['연가', '포상휴가']), { option: '연가', detail: null });
});

test('pass reasons keep the N데이 wording', () => {
    assert.equal(passDayWord(1), '원데이');
    assert.equal(passDayWord(2), '투데이');
    assert.equal(passDayWord(5), '파이브데이');
    assert.equal(passDayWord(6), '6데이');
    assert.equal(composePassReason('일반', null, 2), '일반 투데이');
    assert.equal(composePassReason('KTA 수료', '01-27', 3), 'KTA 01-27기 수료 쓰리데이');
    assert.equal(composePassReason('KTA/RSO 수료', '01-27', 2), 'KTA/RSO 01-27기 수료 투데이');
    assert.equal(composePassReason('DBIDS', '01-27', 3), '01-27기 DBIDS 쓰리데이');
    // 직접 입력한 기수 ('기'를 붙여 써도 한 번만)
    assert.equal(composePassReason('BLC 수료', ' 12-26기 ', 2), 'BLC 12-26기 수료 투데이');
    assert.equal(composePassReason('생일', null, 0), '생일');
    assert.equal(withDayCount('연가', 4), '연가 4일');
});

test('saved reasons map back to button + 기수', () => {
    const options = ['일반', 'Staff Duty', 'KTA 수료', 'DBIDS', '생일'];
    assert.deepEqual(matchReasonOption('일반 투데이', options), { option: '일반', detail: null });
    assert.deepEqual(matchReasonOption('KTA 01-27기 수료 쓰리데이', options), { option: 'KTA 수료', detail: '01-27' });
    assert.deepEqual(matchReasonOption('01-27기 DBIDS 투데이', options), { option: 'DBIDS', detail: '01-27' });
    assert.equal(matchReasonOption('01-27기 DBIDS Compensation 쓰리데이', options), null);
    assert.equal(stripDayCount('연가 4일'), '연가');
});

test('기수 type per reason', () => {
    assert.equal(getBatchType('KTA 수료'), 'kta');
    assert.equal(getBatchType('DBIDS'), 'kta');
    assert.equal(getBatchType('BLC/S6 수료'), 'blc');
    assert.equal(getBatchType('일반'), null);
    assert.equal(getBatchType('PRT DEMO'), null);
});

test('기수 options: Day 0 within 6 months before departure, newest first', () => {
    const events = [
        { type: 'kta', memo: 'KTA Day 0', startDate: '2026-05-12', batch: '05-26' },   // 6개월보다 이전 → 제외
        { type: 'kta', memo: 'KTA Day 0', startDate: '2026-05-13', batch: '06-26' },   // 출발일(11/13) 6개월 전 당일 → 포함
        { type: 'kta', memo: 'KTA 01-27 Day 0', startDate: '2026-10-20' },              // memo에서 기수 추출
        { type: 'kta', memo: 'KTA Day 0', startDate: '2026-11-13', batch: '02-27' },   // 출발일 당일 → 제외
        { type: 'kta', memo: 'KTA Graduation', startDate: '2026-11-09', batch: '01-27' },
        { type: 'blc', memo: 'BLC Day 0', startDate: '2026-10-01', batch: '09-26' },
    ];
    assert.deepEqual(getBatchOptions(events, 'kta', '2026-11-13'), ['01-27', '06-26']);
    assert.deepEqual(getBatchOptions(events, 'blc', '2026-11-13'), ['09-26']);
    assert.deepEqual(getBatchOptions(events, 'kta', ''), []);
});

test('weekend inside a period', () => {
    // 2026-11-11(수) ~ 11-17(화) → 토 11/14, 일 11/15
    const core = ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'];
    assert.deepEqual(findWeekendInRange(core), { start: '2026-11-14', end: '2026-11-15' });
    assert.equal(findWeekendInRange(['2026-11-11']), null);
});
