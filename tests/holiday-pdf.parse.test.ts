import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    parseHolidayScheduleText,
    groupHolidayRuns,
    identifyHoliday,
    cleanHolidayName,
    holidayMatchKey,
    compareWithExisting,
    toDisplayHolidayName,
} from '../src/utils/calendar/holiday-pdf.parse.ts';

// FY27 USFK 휴일표 PDF를 pdf.js로 읽은 텍스트 (헤더·제목·휴일 행만)
const FY27 = fs.readFileSync(new URL('./fixtures/usfk-fy27-holidays.txt', import.meta.url), 'utf8');

test('reads every row, the fiscal year and the KATUSA column', () => {
    const parsed = parseHolidayScheduleText(FY27);
    assert.equal(parsed.fiscalYear, 2027);
    assert.deepEqual(parsed.columns, ['US', 'ROK', 'KATUSA', 'DOD (US)', 'USFK (KN)', 'CFC (KN)', 'DOWEA (US)']);
    assert.equal(parsed.rows.length, 48);
    assert.deepEqual(parsed.unparsedLines, []);
    assert.equal(parsed.rows.filter(r => r.observed).length, 37);
    assert.equal(parsed.rows.filter(r => r.error).length, 0);
});

test('fixes the year typo 28-May-28 using the weekday and fiscal year', () => {
    const parsed = parseHolidayScheduleText(FY27);
    const memorial = parsed.rows.find(r => r.rawDate === '28-May-28')!;
    assert.equal(memorial.iso, '2027-05-28');
    assert.match(memorial.correction!, /2027-05-28/);
});

test('training holidays join the real holiday; EXERCISE / EOY training holidays keep their own name', () => {
    const known = new Set(['COLUMBUS', 'VETERANS', 'THANKSGIVING', 'CHRISTMAS', 'NEW YEARS']);
    assert.equal(identifyHoliday("VETERAN'S DAY (US) TRAINING HOLIDAY", known).key, 'VETERANS');
    assert.equal(identifyHoliday('VETERANS DAY', known).key, 'VETERANS');
    assert.equal(identifyHoliday('THANKSGIVING TRAINING HOLIDAY (US)', known).key, 'THANKSGIVING');
    assert.equal(identifyHoliday('EXERCISE TRAINING HOLIDAY', known).label, 'EXERCISE TRAINING HOLIDAY');
    assert.equal(identifyHoliday('EOY TRAINING HOLIDAY', known).label, 'EOY TRAINING HOLIDAY');
    // 아포스트로피를 빼먹어도 같은 휴일
    assert.equal(holidayMatchKey(cleanHolidayName("NEW YEAR'S DAY (US/ROK)")), holidayMatchKey(cleanHolidayName('NEW YEARS DAY (KN)')));
    assert.equal(cleanHolidayName('LUNAR NEW YEAR (ROK) ALT'), 'LUNAR NEW YEAR');
    assert.equal(cleanHolidayName('INDEPENDENCE DAY OBSERVED (US)'), 'INDEPENDENCE DAY');
    // 다른 휴일은 다른 키
    assert.notEqual(holidayMatchKey('INDEPENDENCE DAY'), holidayMatchKey('INDEPENDENCE MOVEMENT DAY'));
});

const summarize = (runs: { start: string; end: string; name: string; days: number }[]) =>
    runs.map(r => `${r.start}~${r.end} (${r.days}) ${r.name}`);

test('FY27 runs: consecutive days merge, Fri–Mon bridges the weekend, adjacent weekends included', () => {
    const runs = groupHolidayRuns(parseHolidayScheduleText(FY27), { includeAdjacentWeekends: true });
    assert.deepEqual(summarize(runs), [
        '2026-10-09~2026-10-12 (4) COLUMBUS DAY',
        "2026-11-10~2026-11-11 (2) VETERAN'S DAY",
        '2026-11-26~2026-11-29 (4) THANKSGIVING DAY',
        '2026-12-24~2026-12-27 (4) CHRISTMAS DAY',
        "2026-12-31~2027-01-03 (4) EOY TRAINING HOLIDAY + NEW YEAR'S DAY",
        '2027-01-15~2027-01-18 (4) DR. MARTIN LUTHER KING DAY',
        '2027-02-06~2027-02-09 (4) LUNAR NEW YEAR',
        "2027-02-12~2027-02-15 (4) WASHINGTON'S BIRTHDAY + SUPERBOWL LXI TRAINING HOLIDAY",
        '2027-03-27~2027-03-30 (4) EXERCISE TRAINING HOLIDAY',
        "2027-05-13~2027-05-13 (1) BUDDHA'S BIRTHDAY",
        '2027-05-28~2027-05-31 (4) MEMORIAL DAY',
        '2027-06-18~2027-06-21 (4) JUNETEENTH HOLIDAY',
        '2027-07-02~2027-07-05 (4) INDEPENDENCE DAY',
        '2027-09-03~2027-09-06 (4) LABOR DAY',
        '2027-09-10~2027-09-16 (7) EXERCISE TRAINING HOLIDAY + CHUSEOK',
    ]);
});

test('without adjacent weekends only the holiday days (and Fri–Mon bridges) are kept', () => {
    const runs = groupHolidayRuns(parseHolidayScheduleText(FY27), { includeAdjacentWeekends: false });
    const byName = Object.fromEntries(runs.map(r => [r.name, `${r.start}~${r.end}`]));
    assert.equal(byName['THANKSGIVING DAY'], '2026-11-26~2026-11-27');
    assert.equal(byName['EXERCISE TRAINING HOLIDAY'], '2027-03-29~2027-03-30');
    assert.equal(byName['COLUMBUS DAY'], '2026-10-09~2026-10-12');
});

test('two different holidays on consecutive days are joined with +', () => {
    const text = [
        'DATE DAY HOLIDAY US ROK KATUSA',
        '1-May-27 SATURDAY LABOR DAY (ROK) NO YES YES',
        "2-May-27 SUNDAY CHILDREN'S DAY (ROK) NO YES YES",
    ].join('\n');
    const runs = groupHolidayRuns(parseHolidayScheduleText(text), { includeAdjacentWeekends: false });
    assert.deepEqual(summarize(runs), ["2027-05-01~2027-05-02 (2) LABOR DAY + CHILDREN'S DAY"]);
});

test('a row split across two lines is still read', () => {
    const text = [
        'DATE DAY HOLIDAY US ROK KATUSA',
        '11-Nov-26 WEDNESDAY VETERANS',
        'DAY YES YES YES',
    ].join('\n');
    const parsed = parseHolidayScheduleText(text);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].name, 'VETERANS DAY');
    assert.equal(parsed.rows[0].observed, true);
});

test('a PDF without a KATUSA column is rejected', () => {
    assert.throws(() => parseHolidayScheduleText('DATE DAY HOLIDAY US ROK\n1-Jan-27 FRIDAY NEW YEAR NO NO'), /KATUSA/);
});

test('display names use the calendar style (title case, abbreviations kept)', () => {
    assert.equal(toDisplayHolidayName("VETERAN'S DAY"), "Veteran's Day");
    assert.equal(toDisplayHolidayName("EOY TRAINING HOLIDAY + NEW YEAR'S DAY"), "EOY Training Holiday + New Year's Day");
    assert.equal(toDisplayHolidayName('DR. MARTIN LUTHER KING DAY'), 'Dr. Martin Luther King Day');
    assert.equal(toDisplayHolidayName("WASHINGTON'S BIRTHDAY + SUPERBOWL LXI TRAINING HOLIDAY"), "Washington's Birthday + Superbowl LXI Training Holiday");
    assert.equal(toDisplayHolidayName('EXERCISE TRAINING HOLIDAY + CHUSEOK'), 'Exercise Training Holiday + Chuseok');
});

test('compare with existing duty holidays', () => {
    const existing = [{ startDate: '2026-11-26', endDate: '2026-11-29', memo: 'Thanksgiving Day' }];
    assert.equal(compareWithExisting({ start: '2026-11-26', end: '2026-11-29' }, existing).kind, 'exists');
    assert.equal(compareWithExisting({ start: '2026-11-26', end: '2026-11-27' }, existing).kind, 'overlap');
    assert.equal(compareWithExisting({ start: '2026-12-24', end: '2026-12-27' }, existing).kind, 'new');
});
