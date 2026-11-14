import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isPlaceholderRecruitName,
    isRecruitProfileComplete,
    needsSheetRow,
    recruitProfileChanged,
    findFreeMemberRow,
    mergeDeferredSheet,
    pendingRecruitKey,
} from '../functions/src/utils/recruitSheet.util.ts';
import * as app from '../src/utils/member/member.recruit.ts';

test('자리 이름 판별: 섹션 신병, 신병만, 실제 이름', () => {
    for (const name of ['S3 신병', 'BLC/S6 신병', '신병', ' KTA 신병 ']) {
        assert.equal(isPlaceholderRecruitName(name), true, name);
        assert.equal(app.isPlaceholderRecruitName(name), true, name);
    }
    for (const name of ['강건', '김신병호', '', undefined]) {
        assert.equal(isPlaceholderRecruitName(name), false, String(name));
        assert.equal(app.isPlaceholderRecruitName(name), false, String(name));
    }
});

test('정보 완성: 실제 이름·영문 이름·전화번호가 모두 있어야 한다', () => {
    const full = { name: '강건', englishName: 'KANG, GUNN', phoneNumber: '010 1234 5678' };
    assert.equal(isRecruitProfileComplete(full), true);
    assert.equal(app.isRecruitProfileComplete(full), true);
    assert.equal(isRecruitProfileComplete({ ...full, name: 'S3 신병' }), false);
    assert.equal(isRecruitProfileComplete({ ...full, englishName: ' ' }), false);
    assert.equal(isRecruitProfileComplete({ ...full, phoneNumber: '' }), false);
});

test('시트 행 추가 대상: 최근 전입, 일반 부대원, 아직 행 없음', () => {
    const base = { name: '강건', englishName: 'KANG, GUNN', phoneNumber: '010', joinDate: '2026-11-20', role: 'member' };
    assert.equal(needsSheetRow(base, '2026-11-14'), true, '전입 전');
    assert.equal(needsSheetRow(base, '2027-01-10'), true, '전입 51일 뒤');
    assert.equal(needsSheetRow(base, '2027-03-01'), false, '전입 90일이 지남');
    assert.equal(needsSheetRow({ ...base, sheetRowName: '이병 강건' }, '2026-11-14'), false, '이미 추가함');
    assert.equal(needsSheetRow({ ...base, role: 'runner' }, '2026-11-14'), false);
    assert.equal(needsSheetRow({ ...base, joinDate: '' }, '2026-11-14'), false);
    assert.equal(needsSheetRow({ ...base, name: 'S3 신병' }, '2026-11-14'), false);
});

test('트리거는 정보가 바뀐 쓰기에만 반응한다', () => {
    const a = { name: 'S3 신병', englishName: '', phoneNumber: '', joinDate: '2026-11-20', role: 'member' };
    assert.equal(recruitProfileChanged(undefined, a), true, '새 문서');
    assert.equal(recruitProfileChanged(a, { ...a, pendingDayStatuses: { '11.29': 'pass' } }), false, '모아 둔 칸만 바뀜');
    assert.equal(recruitProfileChanged(a, { ...a, sheetRowError: 'x' }), false, '오류 기록만 바뀜');
    assert.equal(recruitProfileChanged(a, { ...a, phoneNumber: '010' }), true);
});

test('첫 빈 인원 행: 3~22행 중 이름이 빈 첫 행, 없으면 -1', () => {
    const col = ['', '', '병장 최인성', '병장 차희원', ''];
    assert.equal(findFreeMemberRow(col), 4);
    const full = ['', '', ...Array.from({ length: 20 }, (_, i) => `일병 대원${i}`), '병장 휴가'];
    assert.equal(findFreeMemberRow(full), -1, '23행(집계)은 인원 칸이 아니다');
    const gap = ['', '', '병장 최인성', ' ', '병장 차희원'];
    assert.equal(findFreeMemberRow(gap), 3, '공백뿐인 행도 빈 행');
});

test('미뤄 둔 칸 합치기: 나중 저장이 같은 날짜를 이긴다', () => {
    const merged = mergeDeferredSheet(
        { dayStatuses: { '11.28': 'pass-depart', '11.29': 'pass' }, cellUpdates: { '11.28': '외박출발', '11.29': '외박복귀' } },
        { dayStatuses: { '11.29': 'none' }, cellUpdates: { '11.29': '' } }
    );
    assert.deepEqual(merged.dayStatuses, { '11.28': 'pass-depart', '11.29': 'none' });
    assert.deepEqual(merged.cellUpdates, { '11.28': '외박출발', '11.29': '' });
    assert.deepEqual(mergeDeferredSheet(undefined, undefined), { dayStatuses: {}, cellUpdates: {} });
});

test('신병 출타 기록 키는 앱과 서버가 같다', () => {
    assert.equal(pendingRecruitKey('abc'), '신병#abc');
    assert.equal(app.pendingRecruitKey('abc'), pendingRecruitKey('abc'));
});
