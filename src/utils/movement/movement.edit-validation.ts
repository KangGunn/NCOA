/**
 * 주간 출타 편집 화면의 저장 전 충돌 검증.
 * 외부 의존성이 없는 순수 함수만 둔다 (tests/movement.edit-validation.test.ts).
 *
 * 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다.
 */

export type EditField =
    | 'passStart'
    | 'passEnd'
    | 'passReason'
    | 'vacationStart'
    | 'vacationEnd'
    | 'vacationReason';

/** error: 저장을 막는다. warning: 표시만 하고 한 번 확인하면 저장할 수 있다. */
export type IssueSeverity = 'error' | 'warning';

export type IssueCode =
    | 'pass-start-missing'
    | 'pass-end-missing'
    | 'pass-range-inverted'
    | 'pass-reason-missing'
    | 'pass-reason-days-mismatch'
    | 'pass-batch-missing'
    | 'pass-duty-reduction-missing'
    | 'stay-reason-missing'
    | 'pass-duty-overlap'
    | 'vacation-start-missing'
    | 'vacation-end-missing'
    | 'vacation-range-inverted'
    | 'vacation-reason-missing'
    | 'vacation-reason-days-mismatch'
    | 'vacation-kind-missing'
    | 'vacation-duty-overlap'
    | 'pass-vacation-overlap'
    | 'pass-overlaps-existing'
    | 'vacation-overlaps-existing'
    | 'vacation-pass-link-disabled';

export interface EditIssue {
    code: IssueCode;
    severity: IssueSeverity;
    /** 빨간색(또는 경고색)으로 강조할 입력 항목 */
    fields: EditField[];
    message: string;
}

export interface ExistingMovement {
    type: 'pass' | 'vacation' | 'stay';
    startDate: string;
    endDate: string;
    reason?: string;
}

export interface MovementEditInput {
    hasPass: boolean;
    passStart: string;
    passEnd: string;
    passReason: string;
    /** 기수를 골라야 하는 사유(수료, DBIDS)를 골랐는데 기수가 비어 있음 */
    passBatchMissing?: boolean;
    /** 이번 기간에 당직이 있는데, 그 당직 때문에 외박 일수가 줄었는지 아직 고르지 않음 */
    passDutyReductionMissing?: boolean;
    /** 외박도 휴가도 없는 잔류 기간인데 잔류 사유(당직·사유 버튼)를 고르지 않음 */
    stayReasonMissing?: boolean;
    hasVacation: boolean;
    vacationStart: string;
    vacationEnd: string;
    vacationReason: string;
    /** '포상휴가'를 골랐는데 종류가 비어 있음 */
    vacationKindMissing?: boolean;
    /** 휴가 복귀일에 바로 외박을 출발하는 것(휴외연계) 허용 여부 (설정 탭) */
    allowVacationPassLink: boolean;
    /** 대상자의 당직 날짜 */
    dutyIsoDates: string[];
    /** 이번 저장으로 바뀌거나 지워지지 않고 남는 같은 대상자의 기존 기록 */
    otherMovements: ExistingMovement[];
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoToUtc(iso: string): number | null {
    const m = ISO_RE.exec(iso);
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 시작일과 종료일을 모두 포함한 일수. 형식이 잘못되었으면 0. */
export function countDaysInclusive(startIso: string, endIso: string): number {
    const s = isoToUtc(startIso);
    const e = isoToUtc(endIso);
    if (s === null || e === null) return 0;
    return Math.round((e - s) / DAY_MS) + 1;
}

export function addDaysIso(iso: string, days: number): string {
    const t = isoToUtc(iso);
    if (t === null) return '';
    const d = new Date(t + days * DAY_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** '2026-11-14' → '11/14' */
export function formatIsoShort(iso: string): string {
    const m = ISO_RE.exec(iso);
    if (!m) return iso;
    return `${Number(m[2])}/${Number(m[3])}`;
}

const KOREAN_PASS_DAYS: Record<string, number> = {
    '원': 1, '투': 2, '쓰리': 3, '포': 4, '파이브': 5,
    '식스': 6, '세븐': 7, '에잇': 8, '나인': 9, '텐': 10
};

/** 외박 사유의 'N일' / 'N데이' / '투데이' 등에서 일수를 읽는다. 없으면 null. */
export function extractPassDaysFromReason(reason: string): number | null {
    const num = reason.match(/(\d+)\s*(?:데이|day|일)/i);
    if (num) return parseInt(num[1], 10);
    const kor = reason.match(/(원|투|쓰리|포|파이브|식스|세븐|에잇|나인|텐)\s*데이/);
    if (kor) return KOREAN_PASS_DAYS[kor[1]];
    return null;
}

/** 휴가 사유의 'N일'에서 일수를 읽는다. 없으면 null. */
export function extractVacationDaysFromReason(reason: string): number | null {
    const m = reason.match(/(\d+(?:\.\d+)?)\s*일/);
    return m ? parseFloat(m[1]) : null;
}

/** start~end 안에 있는 당직 날짜 (중복 제거, 날짜순) */
function dutyDaysWithin(dutyIsoDates: string[], start: string, end: string): string[] {
    return [...new Set(dutyIsoDates)].filter(iso => iso >= start && iso <= end).sort();
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
    return aStart <= bEnd && bStart <= aEnd;
}

/**
 * 외박과 휴가가 겹치는지. 연계로 맞닿는 경우는 겹침이 아니다.
 * - 외휴연계: 외박 복귀일 = 휴가 출발일
 * - 휴외연계: 휴가 복귀일 = 외박 시작일
 */
function passVacationConflict(pStart: string, pEnd: string, vStart: string, vEnd: string): boolean {
    if (!rangesOverlap(pStart, pEnd, vStart, vEnd)) return false;
    // 외박과 휴가가 똑같은 하루뿐이면 연계가 아니라 겹침
    const sameSingleDay = pStart === pEnd && vStart === vEnd && pStart === vStart;
    if (sameSingleDay) return true;
    // 외휴연계: 외박 복귀일 = 휴가 출발일 (원데이 외박도 포함)
    if (pEnd === vStart) return false;
    // 휴외연계: 휴가 복귀일 = 외박 시작일
    if (vEnd === pStart) return false;
    return true;
}

function typeLabel(type: ExistingMovement['type']): string {
    return type === 'vacation' ? '휴가' : type === 'stay' ? '잔류' : '외박';
}

function rangeLabel(start: string, end: string): string {
    return start === end ? formatIsoShort(start) : `${formatIsoShort(start)}~${formatIsoShort(end)}`;
}

/** 저장 전에 입력값 전체를 검사해 문제 목록을 돌려준다. 문제가 없으면 빈 배열. */
export function validateMovementEdit(input: MovementEditInput): EditIssue[] {
    const issues: EditIssue[] = [];

    // 1. 외박
    const passRangeOk = input.hasPass && !!input.passStart && !!input.passEnd && input.passStart <= input.passEnd;
    if (input.hasPass) {
        if (!input.passStart) {
            issues.push({ code: 'pass-start-missing', severity: 'error', fields: ['passStart'], message: '외박 출발일을 입력하세요.' });
        }
        if (!input.passEnd) {
            issues.push({ code: 'pass-end-missing', severity: 'error', fields: ['passEnd'], message: '외박 복귀일을 입력하세요.' });
        }
        if (input.passStart && input.passEnd && input.passStart > input.passEnd) {
            issues.push({ code: 'pass-range-inverted', severity: 'error', fields: ['passStart', 'passEnd'], message: '외박 복귀일은 출발일 다음 날 이후여야 합니다.' });
        }
        const reason = input.passReason.trim();
        if (!reason) {
            issues.push({ code: 'pass-reason-missing', severity: 'error', fields: ['passReason'], message: '외박 사유를 선택하세요.' });
        } else if (input.passBatchMissing) {
            issues.push({ code: 'pass-batch-missing', severity: 'error', fields: ['passReason'], message: '기수를 선택하세요.' });
        } else if (input.passDutyReductionMissing) {
            issues.push({ code: 'pass-duty-reduction-missing', severity: 'error', fields: ['passReason'], message: '당직 때문에 외박 일수가 줄었는지 선택하세요.' });
        } else if (passRangeOk) {
            const expected = extractPassDaysFromReason(reason);
            const actual = countDaysInclusive(input.passStart, input.passEnd);
            if (expected !== null && expected !== actual) {
                issues.push({
                    code: 'pass-reason-days-mismatch',
                    severity: 'error',
                    fields: ['passReason', 'passStart', 'passEnd'],
                    message: `외박 기간은 ${actual}일인데 사유에는 ${expected}일로 되어 있습니다.`
                });
            }
        }
        if (passRangeOk) {
            // 외박하는 날에 당직이 있으면 안 된다.
            // 출발일(시작 전날)이 당직이면 안 된다. 당직 다음 날(리커버리)부터 시작하면 출발일이 당직이 되므로 불가.
            const departDay = addDaysIso(input.passStart, -1);
            const dutyDays = dutyDaysWithin(input.dutyIsoDates, departDay, input.passEnd);
            const dutyLabel = dutyDays
                .map(iso => (iso === departDay ? `출발일 ${formatIsoShort(iso)}` : formatIsoShort(iso)))
                .join(', ');
            if (dutyDays.length > 0) {
                issues.push({
                    code: 'pass-duty-overlap',
                    severity: 'error',
                    fields: ['passStart', 'passEnd'],
                    message: `외박 기간에 당직(${dutyLabel})이 있습니다. 날짜나 당직 일정을 바꾸세요.`
                });
            }
        }
    }

    // 잔류: 외박도 휴가도 없는 기간이면 사유를 골라야 한다
    if (input.stayReasonMissing) {
        issues.push({ code: 'stay-reason-missing', severity: 'error', fields: ['passReason'], message: '잔류 사유를 선택하세요. (당직 날짜 또는 사유 버튼)' });
    }

    // 2. 휴가
    const vacRangeOk = input.hasVacation && !!input.vacationStart && !!input.vacationEnd && input.vacationStart <= input.vacationEnd;
    if (input.hasVacation) {
        if (!input.vacationStart) {
            issues.push({ code: 'vacation-start-missing', severity: 'error', fields: ['vacationStart'], message: '휴가 출발일을 입력하세요.' });
        }
        if (!input.vacationEnd) {
            issues.push({ code: 'vacation-end-missing', severity: 'error', fields: ['vacationEnd'], message: '휴가 복귀일을 입력하세요.' });
        }
        if (input.vacationStart && input.vacationEnd && input.vacationStart > input.vacationEnd) {
            issues.push({ code: 'vacation-range-inverted', severity: 'error', fields: ['vacationStart', 'vacationEnd'], message: '휴가 출발일이 복귀일보다 늦습니다.' });
        }
        const reason = input.vacationReason.trim();
        if (!reason) {
            issues.push({ code: 'vacation-reason-missing', severity: 'error', fields: ['vacationReason'], message: '휴가 사유를 선택하세요.' });
        } else if (input.vacationKindMissing) {
            issues.push({ code: 'vacation-kind-missing', severity: 'error', fields: ['vacationReason'], message: '포상휴가 종류를 선택하세요.' });
        } else if (vacRangeOk) {
            const expected = extractVacationDaysFromReason(reason);
            const actual = countDaysInclusive(input.vacationStart, input.vacationEnd);
            if (expected !== null && expected !== actual) {
                issues.push({
                    code: 'vacation-reason-days-mismatch',
                    severity: 'error',
                    fields: ['vacationReason', 'vacationStart', 'vacationEnd'],
                    message: `휴가 기간은 ${actual}일인데 사유에는 ${expected}일로 되어 있습니다.`
                });
            }
        }
        if (vacRangeOk) {
            const dutyDays = dutyDaysWithin(input.dutyIsoDates, input.vacationStart, input.vacationEnd);
            if (dutyDays.length > 0) {
                issues.push({
                    code: 'vacation-duty-overlap',
                    severity: 'error',
                    fields: ['vacationStart', 'vacationEnd'],
                    message: `휴가 기간에 당직(${dutyDays.map(formatIsoShort).join(', ')})이 있습니다. 날짜나 당직 일정을 바꾸세요.`
                });
            }
        }
    }

    // 3. 외박 ↔ 휴가
    if (passRangeOk && vacRangeOk) {
        if (passVacationConflict(input.passStart, input.passEnd, input.vacationStart, input.vacationEnd)) {
            issues.push({
                code: 'pass-vacation-overlap',
                severity: 'error',
                fields: ['passStart', 'passEnd', 'vacationStart', 'vacationEnd'],
                message: `외박(${rangeLabel(input.passStart, input.passEnd)})과 휴가(${rangeLabel(input.vacationStart, input.vacationEnd)}) 기간이 겹칩니다.`
            });
        }

        const passDepart = addDaysIso(input.passStart, -1);
        const isVacationPassLink = input.vacationEnd === passDepart || input.vacationEnd === input.passStart;
        if (isVacationPassLink && !input.allowVacationPassLink) {
            issues.push({
                code: 'vacation-pass-link-disabled',
                severity: 'warning',
                fields: ['vacationEnd', 'passStart'],
                message: '휴가 복귀일에 외박을 출발합니다. 휴외연계가 꺼져 있어 시트에는 "휴가복귀/외박출발"로 기록됩니다.'
            });
        }
    }

    // 4. 남아 있는 다른 기록과의 충돌
    for (const other of input.otherMovements) {
        if (!other.startDate || !other.endDate) continue;
        const otherIsPass = other.type === 'pass' || other.type === 'stay';
        const label = `${typeLabel(other.type)}(${rangeLabel(other.startDate, other.endDate)})`;

        if (passRangeOk) {
            const conflict = otherIsPass
                ? rangesOverlap(input.passStart, input.passEnd, other.startDate, other.endDate)
                : passVacationConflict(input.passStart, input.passEnd, other.startDate, other.endDate);
            if (conflict) {
                issues.push({
                    code: 'pass-overlaps-existing',
                    severity: 'error',
                    fields: ['passStart', 'passEnd'],
                    message: `이미 등록된 ${label}과 외박 기간이 겹칩니다.`
                });
            }
        }

        if (vacRangeOk) {
            const conflict = otherIsPass
                ? passVacationConflict(other.startDate, other.endDate, input.vacationStart, input.vacationEnd)
                : rangesOverlap(input.vacationStart, input.vacationEnd, other.startDate, other.endDate);
            if (conflict) {
                issues.push({
                    code: 'vacation-overlaps-existing',
                    severity: 'error',
                    fields: ['vacationStart', 'vacationEnd'],
                    message: `이미 등록된 ${label}과 휴가 기간이 겹칩니다.`
                });
            }
        }
    }

    // 같은 문제가 여러 기록 때문에 두 번 이상 잡히면 한 번만 알린다
    const seen = new Set<string>();
    return issues.filter(issue => {
        const key = `${issue.code}|${issue.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function hasBlockingIssue(issues: EditIssue[]): boolean {
    return issues.some(issue => issue.severity === 'error');
}

/** 한 입력 항목에 걸린 문제들 (error가 warning보다 앞) */
export function getFieldIssues(issues: EditIssue[], field: EditField): EditIssue[] {
    return issues
        .filter(issue => issue.fields.includes(field))
        .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
