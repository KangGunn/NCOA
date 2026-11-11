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
    composeCustomPassReason,
    composeStayReason,
    parseStayReason,
    getStayTaskLabel,
    dutyDayLabel,
    dutyReductionPrefix,
    splitDutyReductionPrefix,
    fitPassAroundDuty,
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
    assert.equal(composePassReason('PRT DEMO', '01-27', 2), '01-27기 PRT DEMO 투데이');
    // 직접 입력한 기수 ('기'를 붙여 써도 한 번만)
    assert.equal(composePassReason('BLC 수료', ' 12-26기 ', 2), 'BLC 12-26기 수료 투데이');
    assert.equal(composePassReason('생일', null, 0), '생일');
    // 잔류는 날짜만 구분용, 일수 없이 '잔류'
    assert.equal(composePassReason('잔류', null, 2), '잔류');
    assert.equal(composePassReason('잔류', null, 0), '잔류');
    assert.equal(withDayCount('연가', 4), '연가 4일');
});

test('saved reasons map back to button + 기수', () => {
    const options = ['일반', 'Staff Duty', 'KTA 수료', 'DBIDS', '생일'];
    assert.deepEqual(matchReasonOption('일반 투데이', options), { option: '일반', detail: null });
    assert.deepEqual(matchReasonOption('KTA 01-27기 수료 쓰리데이', options), { option: 'KTA 수료', detail: '01-27' });
    assert.deepEqual(matchReasonOption('01-27기 DBIDS 투데이', options), { option: 'DBIDS', detail: '01-27' });
    assert.deepEqual(matchReasonOption('01-27기 PRT DEMO 투데이', [...options, 'PRT DEMO']), { option: 'PRT DEMO', detail: '01-27' });
    assert.equal(matchReasonOption('01-27기 DBIDS Compensation 쓰리데이', options), null);
    assert.equal(stripDayCount('연가 4일'), '연가');
});

test('기수 type per reason', () => {
    assert.equal(getBatchType('KTA 수료'), 'kta');
    assert.equal(getBatchType('DBIDS'), 'kta');
    assert.equal(getBatchType('BLC/S6 수료'), 'blc');
    assert.equal(getBatchType('일반'), null);
    assert.equal(getBatchType('PRT DEMO'), 'kta');
});

test('기수 options: Day 0 within 3 months before departure, newest first, KTA and BLC separately', () => {
    const events = [
        { type: 'kta', memo: 'KTA Day 0', startDate: '2026-08-12', batch: '08-26' },   // 3개월보다 이전 → 제외
        { type: 'kta', memo: 'KTA Day 0', startDate: '2026-08-13', batch: '09-26' },   // 출발일(11/13) 3개월 전 당일 → 포함
        { type: 'kta', memo: 'KTA 01-27 Day 0', startDate: '2026-10-20' },              // memo에서 기수 추출
        { type: 'kta', memo: 'KTA Day 0', startDate: '2026-11-13', batch: '02-27' },   // 출발일 당일 → 제외
        { type: 'kta', memo: 'KTA Graduation', startDate: '2026-11-09', batch: '01-27' },
        { type: 'blc', memo: 'BLC Day 0', startDate: '2026-10-01', batch: '09-26' },
    ];
    assert.deepEqual(getBatchOptions(events, 'kta', '2026-11-13'), ['01-27', '09-26']);
    assert.deepEqual(getBatchOptions(events, 'blc', '2026-11-13'), ['09-26']);
    assert.deepEqual(getBatchOptions(events, 'kta', ''), []);
});

test('weekend inside a period', () => {
    // 2026-11-11(수) ~ 11-17(화) → 토 11/14, 일 11/15
    const core = ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'];
    assert.deepEqual(findWeekendInRange(core), { start: '2026-11-14', end: '2026-11-15' });
    assert.equal(findWeekendInRange(['2026-11-11']), null);
});

test('duty reduction prefix uses the weekday shorthand', () => {
    assert.equal(dutyDayLabel('2026-11-21'), '토당');
    assert.equal(dutyReductionPrefix(['2026-11-21']), '토당으로 인한');
    assert.equal(dutyReductionPrefix(['2026-11-21', '2026-11-20']), '금당, 토당으로 인한');
    assert.equal(dutyReductionPrefix([]), '');
});

test('saved reasons with a duty cause are split back', () => {
    assert.deepEqual(splitDutyReductionPrefix('토당으로 인한 일반 원데이'), { cause: '토당', rest: '일반 원데이' });
    assert.deepEqual(splitDutyReductionPrefix('금당, 토당으로 인한 Staff Duty 원데이'), { cause: '금당, 토당', rest: 'Staff Duty 원데이' });
    assert.deepEqual(splitDutyReductionPrefix('일요일 당직으로 인한 일반 원데이'), { cause: '일요일 당직', rest: '일반 원데이' });
    assert.deepEqual(splitDutyReductionPrefix('당직근무로 인한 일반 원데이'), { cause: '당직근무', rest: '일반 원데이' });
    // 당직이 아닌 원인은 그대로 둔다
    assert.equal(splitDutyReductionPrefix('DBIDS로 인한 일반 원데이'), null);
    assert.equal(splitDutyReductionPrefix('일반 투데이'), null);
});

test('auto-filled pass dates avoid duty days and duty departure days', () => {
    // 2026-11-21(토) ~ 22(일) 주말
    const weekend = { start: '2026-11-21', end: '2026-11-22' };
    const dutyOn = (...days: string[]) => (iso: string) => days.includes(iso);
    assert.deepEqual(fitPassAroundDuty(weekend, dutyOn()), weekend);
    // 일요일 당직 → 토요일만
    assert.deepEqual(fitPassAroundDuty(weekend, dutyOn('2026-11-22')), { start: '2026-11-21', end: '2026-11-21' });
    // 토요일 당직 → 일요일은 출발일(토)이 당직이라 불가 → 잔류
    assert.equal(fitPassAroundDuty(weekend, dutyOn('2026-11-21')), null);
    // 금요일 당직 → 토요일은 출발일(금)이 당직이라 불가 → 일요일만 (토요일 리커버리 다음 날 시작)
    assert.deepEqual(fitPassAroundDuty(weekend, dutyOn('2026-11-20')), { start: '2026-11-22', end: '2026-11-22' });
    // 4일 연휴(목~일) 첫날 목요일 당직 → 금은 출발일이 당직, 토~일
    assert.deepEqual(
        fitPassAroundDuty({ start: '2026-11-26', end: '2026-11-29' }, dutyOn('2026-11-26')),
        { start: '2026-11-28', end: '2026-11-29' }
    );
    // 금요일 당직이면 토는 출발일 당직이라 불가, 일요일(리커버리 다음 날) 하루만 가능 → 목 하루와 같아 앞쪽 (목)
    assert.deepEqual(
        fitPassAroundDuty({ start: '2026-11-26', end: '2026-11-29' }, dutyOn('2026-11-27')),
        { start: '2026-11-26', end: '2026-11-26' }
    );
});

test('custom 외박 reasons get the day count too', () => {
    assert.equal(composeCustomPassReason("Veteran's Day", 4), "Veteran's Day 포데이");
    assert.equal(composeCustomPassReason('Veterans Day 투데이', 3), 'Veterans Day 쓰리데이');
    assert.equal(composeCustomPassReason('금당으로 인한 Veteran\'s Day', 4), "금당으로 인한 Veteran's Day 포데이");
    assert.equal(composeCustomPassReason('   ', 2), '');
    assert.equal(composeCustomPassReason('Birthday', 0), 'Birthday');
});

test('잔류 reason: 당직 요일과 업무 버튼을 X로 인한 잔류 형식으로, 없으면 빈 값', () => {
    const none = { dutyLabels: [], task: false, custom: '', customOn: false };
    const duty = ['2026-11-21', '2026-11-22'];
    assert.equal(composeStayReason({ ...none, dutyLabels: ['토당'] }, duty, 'KTA 업무'), '토당으로 인한 잔류');
    assert.equal(composeStayReason({ ...none, task: true }, duty, 'KTA 업무'), 'KTA 업무로 인한 잔류');
    assert.equal(composeStayReason({ ...none, dutyLabels: ['일당', '토당'], task: true }, duty, 'BLC 업무'), '토당, 일당, BLC 업무로 인한 잔류');
    assert.equal(composeStayReason({ ...none, customOn: true, custom: '사정' }, duty, null), '사정으로 인한 잔류');
    assert.equal(composeStayReason({ ...none, task: true }, duty, null), '잔류');
    // 아무것도 고르지 않으면 그냥 '잔류'
    assert.equal(composeStayReason(none, duty, 'PAO 업무'), '잔류');
    assert.equal(composeStayReason({ ...none, customOn: true, custom: '  ' }, duty, null), '잔류');
    // 고른 당직 요일이 기간에 없으면 무시
    assert.equal(composeStayReason({ ...none, dutyLabels: ['금당'] }, duty, null), '잔류');
});

test('잔류 업무 버튼은 섹션에 따라 하나: KTA·MEDIC→KTA, BLC→BLC, PAO→PAO', () => {
    assert.equal(getStayTaskLabel(['KTA']), 'KTA 업무');
    assert.equal(getStayTaskLabel(['MEDIC']), 'KTA 업무');
    assert.equal(getStayTaskLabel(['BLC']), 'BLC 업무');
    assert.equal(getStayTaskLabel(['BLC', 'S3']), 'BLC 업무');
    assert.equal(getStayTaskLabel(['HQ', 'S6']), 'BLC 업무');
    assert.equal(getStayTaskLabel(['KTA', 'PAO']), 'PAO 업무');
    assert.equal(getStayTaskLabel(['HQ']), null);
});

test('잔류 reason round-trips; a plain 잔류 is not a choice', () => {
    assert.deepEqual(parseStayReason('토당으로 인한 잔류'), { dutyLabels: ['토당'], task: false, custom: '', customOn: false });
    assert.deepEqual(parseStayReason('토당, PAO 업무로 인한 잔류'), { dutyLabels: ['토당'], task: true, custom: '', customOn: false });
    assert.deepEqual(parseStayReason('사정으로 인한 잔류'), { dutyLabels: [], task: false, custom: '사정', customOn: true });
    assert.deepEqual(parseStayReason('잔류'), { dutyLabels: [], task: false, custom: '', customOn: false });
});
