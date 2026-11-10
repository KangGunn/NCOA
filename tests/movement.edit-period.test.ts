import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    splitMemberDocs,
    computeEditedDayStatuses,
    buildCellUpdates,
    eachIsoDate,
    isoToMD,
    findRunStartingInWindow,
} from '../src/utils/movement/movement.edit-period.ts';
import type { CellUpdateContext, EditedState } from '../src/utils/movement/movement.edit-period.ts';

const timelineOf = (start: string, end: string) => eachIsoDate(start, end).map(iso => ({ iso, md: isoToMD(iso) }));
const noDuty = () => false;

const empty: EditedState = { hasPass: false, passStart: '', passEnd: '', hasVacation: false, vacationStart: '', vacationEnd: '' };

test('vacation that started in the previous period is retained, not owned', () => {
    const docs = [
        { id: 'v-prev', type: 'vacation', startDate: '2026-11-16', endDate: '2026-11-19' },
        { id: 'v-new', type: 'vacation', startDate: '2026-11-21', endDate: '2026-11-26' },
        { id: 'p-new', type: 'pass', startDate: '2026-11-21', endDate: '2026-11-22' },
    ];
    const split = splitMemberDocs(docs, { coreStart: '2026-11-18', coreEnd: '2026-11-24' });
    assert.equal(split.ownPass?.id, 'p-new');
    assert.equal(split.ownVac?.id, 'v-new');
    assert.deepEqual(split.retainedDocs.map(d => d.id), ['v-prev']);
});

test('vacation linked to this period pass (외휴연계) is owned even if it starts after the core window', () => {
    const docs = [
        { id: 'p', type: 'pass', startDate: '2026-11-23', endDate: '2026-11-25' },
        { id: 'v', type: 'vacation', startDate: '2026-11-25', endDate: '2026-11-28' },
    ];
    const split = splitMemberDocs(docs, { coreStart: '2026-11-18', coreEnd: '2026-11-24' });
    assert.equal(split.ownVac?.id, 'v');
    assert.deepEqual(split.retainedDocs, []);
});

test('next-period vacation is not owned', () => {
    const docs = [{ id: 'v-next', type: 'vacation', startDate: '2026-11-26', endDate: '2026-11-28' }];
    const split = splitMemberDocs(docs, { coreStart: '2026-11-18', coreEnd: '2026-11-24' });
    assert.equal(split.ownVac, null);
    assert.equal(split.retainedDocs.length, 1);
});

// 화면 1: 11.11~11.20 주차, 외박 11.14~15, 휴가 11.16~19. 휴가를 '없음'으로 바꾸면 11.18, 11.19도 비워야 한다.
const week1 = timelineOf('2026-11-11', '2026-11-20');
const week1Initial: Record<string, string> = {
    '11.13': 'pass-depart', '11.14': 'pass', '11.15': 'pass',
    '11.16': 'vacation', '11.17': 'vacation', '11.18': 'vacation', '11.19': 'vacation',
};
const week1Owned = [...eachIsoDate('2026-11-13', '2026-11-15'), ...eachIsoDate('2026-11-16', '2026-11-19')];

test('turning vacation off clears every owned vacation day, including after the core window', () => {
    const statuses = computeEditedDayStatuses(week1, week1Initial, {
        ...empty,
        hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15',
        ownedOriginalDates: week1Owned, retainedVacations: [], retainedPasses: [], isDutyOn: noDuty,
    });
    assert.equal(statuses['11.14'], 'pass');
    for (const md of ['11.16', '11.17', '11.18', '11.19']) assert.equal(statuses[md], 'none', md);
});

test('turning vacation off writes empty cells for all old vacation days (sheet)', () => {
    const ctx: CellUpdateContext = {
        ...empty,
        hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15',
        ownedOriginalDates: week1Owned, retainedVacations: [], retainedPasses: [], isDutyOn: noDuty,
        allowVacationPassLink: false,
    };
    const cells = buildCellUpdates(ctx);
    assert.deepEqual(cells, {
        '11.13': '외박출발', '11.14': '외박', '11.15': '외박복귀',
        '11.16': '', '11.17': '', '11.18': '', '11.19': '',
    });
});

test('shortening a vacation clears the dropped tail and moves 휴가복귀', () => {
    const cells = buildCellUpdates({
        ...empty,
        hasVacation: true, vacationStart: '2026-11-16', vacationEnd: '2026-11-17',
        ownedOriginalDates: eachIsoDate('2026-11-16', '2026-11-19'), retainedVacations: [], retainedPasses: [], isDutyOn: noDuty,
        allowVacationPassLink: false,
    });
    assert.deepEqual(cells, { '11.16': '휴가출발', '11.17': '휴가복귀', '11.18': '', '11.19': '' });
});

// 화면 3: 11.18~11.27 주차. 이전 기간 휴가(11.16~19)는 그대로 두고, 새 휴가 11.21~26만 쓴다.
test('new vacation next to a carried-over vacation leaves the old one alone', () => {
    const week = timelineOf('2026-11-18', '2026-11-27');
    const initial = { '11.18': 'vacation', '11.19': 'vacation' };
    const state = { ...empty, hasVacation: true, vacationStart: '2026-11-21', vacationEnd: '2026-11-26' };
    const retainedVacations = [{ start: '2026-11-16', end: '2026-11-19' }];

    const statuses = computeEditedDayStatuses(week, initial, {
        ...state, ownedOriginalDates: [], retainedVacations, retainedPasses: [], isDutyOn: noDuty,
    });
    assert.equal(statuses['11.18'], 'vacation');
    assert.equal(statuses['11.19'], 'vacation');
    assert.equal(statuses['11.20'] ?? 'none', 'none');
    assert.equal(statuses['11.21'], 'vacation');

    const cells = buildCellUpdates({
        ...state, ownedOriginalDates: [], retainedVacations, retainedPasses: [], isDutyOn: noDuty, allowVacationPassLink: false,
    });
    assert.equal(cells['11.18'], undefined);
    assert.equal(cells['11.19'], undefined);
    assert.equal(cells['11.21'], '휴가출발');
    assert.equal(cells['11.26'], '휴가복귀');
});

test('removing a pass that departed on a retained vacation return day restores 휴가복귀', () => {
    const week = timelineOf('2026-11-18', '2026-11-27');
    const initial = { '11.18': 'vacation', '11.19': 'vacation-pass-depart', '11.20': 'pass', '11.21': 'pass' };
    const ctx = {
        ...empty,
        ownedOriginalDates: eachIsoDate('2026-11-19', '2026-11-21'),
        retainedVacations: [{ start: '2026-11-16', end: '2026-11-19' }],
        retainedPasses: [],
        isDutyOn: noDuty,
    };
    const statuses = computeEditedDayStatuses(week, initial, ctx);
    assert.equal(statuses['11.19'], 'vacation');
    assert.equal(statuses['11.20'], 'none');
    assert.deepEqual(buildCellUpdates({ ...ctx, allowVacationPassLink: false }), { '11.19': '휴가복귀', '11.20': '', '11.21': '' });
});

test('pass departing on vacation return day uses the link cell value', () => {
    const cells = buildCellUpdates({
        ...empty,
        hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15',
        hasVacation: true, vacationStart: '2026-11-10', vacationEnd: '2026-11-13',
        ownedOriginalDates: [], retainedVacations: [], retainedPasses: [], isDutyOn: noDuty,
        allowVacationPassLink: true,
    });
    assert.equal(cells['11.13'], '외박출발(연계)');
    assert.equal(cells['11.12'], '휴가');
});

test('외휴연계 keeps 휴가출발(연계) on the pass return day', () => {
    const cells = buildCellUpdates({
        ...empty,
        hasPass: true, passStart: '2026-11-14', passEnd: '2026-11-15',
        hasVacation: true, vacationStart: '2026-11-15', vacationEnd: '2026-11-18',
        ownedOriginalDates: [], retainedVacations: [], retainedPasses: [], isDutyOn: noDuty,
        allowVacationPassLink: false,
    });
    assert.equal(cells['11.15'], '휴가출발(연계)');
    assert.equal(cells['11.16'], '휴가');
    assert.equal(cells['11.18'], '휴가복귀');
});

test('status run inference ignores runs that started before the window', () => {
    const vac = new Set(eachIsoDate('2026-11-16', '2026-11-19'));
    assert.equal(findRunStartingInWindow({ coreStart: '2026-11-18', coreEnd: '2026-11-24' }, iso => vac.has(iso)), null);
    const both = new Set([...vac, ...eachIsoDate('2026-11-21', '2026-11-23')]);
    assert.deepEqual(
        findRunStartingInWindow({ coreStart: '2026-11-18', coreEnd: '2026-11-24' }, iso => both.has(iso)),
        { start: '2026-11-21', end: '2026-11-23' }
    );
});
