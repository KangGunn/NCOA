/**
 * 주간 출타 편집 화면의 외박/휴가 사유 버튼.
 *
 * - 외박: 버튼은 사유 이름만 고르고, 일수는 기간을 세어 'N데이'(원데이~파이브데이, 그 이상은 'N데이')로 붙인다.
 *   예) '일반 투데이', 'KTA 01-27기 수료 쓰리데이', '01-27기 DBIDS 투데이'
 * - 휴가: 사유 이름 + 'N일'. 예) '연가 4일'
 *
 * 외부 의존성이 없는 순수 함수만 둔다 (tests/movement.reason-options.test.ts).
 */
import { addDaysIso } from './movement.edit-validation.ts';

/** 모든 인원 공통 휴가 사유. '포상휴가'는 종류를 골라 '교육유공 포상휴가'처럼 저장한다. */
export const REWARD_VACATION = '포상휴가';
export const VACATION_REASONS = ['연가', REWARD_VACATION];
export const REWARD_VACATION_KINDS = ['교육유공', '모범카투사', '선임병장'];

/** 외박 사유 순서: 일반 → Staff Duty → 당직 휴일 → 섹션별 → 생일 → KOM */
export const PASS_REASONS_FIRST = ['일반', 'Staff Duty'];
export const PASS_REASONS_LAST = ['생일', 'KOM'];

/** 수료 외의 섹션별 사유 */
const SECTION_EXTRA_PASS_REASONS: Record<string, string[]> = {
    KTA: ['DBIDS'],
    MEDIC: ['PRT DEMO'],
};

/** 섹션 키 목록 (역할 문자열에서 섹션을 찾을 때 사용) */
const KNOWN_SECTION_KEYS = ['KTA', 'MEDIC', 'BLC', 'RSO', 'PAO', 'S3', 'S6'];

/**
 * 인원의 수료 사유 하나를 정한다. 여러 섹션이면 우선순위(PAO → RSO → 단일 S3 → 단일 S6 → BLC → KTA·MEDIC).
 * S3·S6는 HQ 아래 그 부섹션 하나만 있을 때만 해당하므로, HQ를 제외한 섹션이 S3(또는 S6) 하나여야 한다.
 */
export function getGraduationReason(sectionKeys: string[]): string | null {
    const subSections = sectionKeys.filter(key => key !== 'HQ');
    const single = subSections.length === 1 ? subSections[0] : null;
    if (sectionKeys.includes('PAO')) return 'KTA/PAO 수료';
    if (sectionKeys.includes('RSO')) return 'KTA/RSO 수료';
    if (single === 'S3') return 'BLC/S3 수료';
    if (single === 'S6') return 'BLC/S6 수료';
    if (sectionKeys.includes('BLC')) return 'BLC 수료';
    if (sectionKeys.includes('KTA') || sectionKeys.includes('MEDIC')) return 'KTA 수료';
    return null;
}

/** 인원의 섹션별 외박 사유: 수료 하나 + DBIDS/PRT DEMO */
export function getSectionPassReasons(sectionKeys: string[]): string[] {
    const out: string[] = [];
    const graduation = getGraduationReason(sectionKeys);
    if (graduation) out.push(graduation);
    sectionKeys.forEach(key => (SECTION_EXTRA_PASS_REASONS[key] || []).forEach(r => {
        if (!out.includes(r)) out.push(r);
    }));
    return out;
}

export type BatchType = 'kta' | 'blc';

/** 기수를 골라야 하는 사유와 그 기수 종류 */
export const BATCH_TYPE_BY_REASON: Record<string, BatchType> = {
    'KTA 수료': 'kta',
    'KTA/RSO 수료': 'kta',
    'KTA/PAO 수료': 'kta',
    'DBIDS': 'kta',
    'PRT DEMO': 'kta',
    'BLC 수료': 'blc',
    'BLC/S3 수료': 'blc',
    'BLC/S6 수료': 'blc',
};

/** 기수를 이름 앞에 쓰는 사유 */
const BATCH_FIRST_REASONS = ['DBIDS', 'PRT DEMO'];

export function getBatchType(option: string | null | undefined): BatchType | null {
    return option ? BATCH_TYPE_BY_REASON[option] || null : null;
}

/** 인원의 섹션 목록과 역할에서 사유 버튼용 섹션 키를 뽑는다 ('S-3' → 'S3', 역할에 섹션 이름이 있으면 포함). */
export function getMemberSectionKeys(sections: string[] | undefined | null, role?: string | null): string[] {
    const keys = new Set<string>();
    (sections || []).forEach(s => {
        const key = (s || '').trim().toUpperCase().replace(/^S-(\d)$/, 'S$1');
        if (key) keys.add(key);
    });
    const roleUpper = (role || '').trim().toUpperCase();
    KNOWN_SECTION_KEYS.forEach(key => {
        if (roleUpper && roleUpper.includes(key)) keys.add(key);
    });
    return [...keys];
}

/** 외박 사유 버튼 목록 (중복 제거) */
export function getPassReasonOptions(sectionKeys: string[], holidayNames: string[] = []): string[] {
    const out: string[] = [];
    const add = (label: string) => {
        const trimmed = (label || '').trim();
        if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    };
    PASS_REASONS_FIRST.forEach(add);
    holidayNames.forEach(add);
    getSectionPassReasons(sectionKeys).forEach(add);
    PASS_REASONS_LAST.forEach(add);
    return out;
}

export function getVacationReasonOptions(): string[] {
    return [...VACATION_REASONS];
}

const PASS_DAY_WORDS: Record<number, string> = { 1: '원데이', 2: '투데이', 3: '쓰리데이', 4: '포데이', 5: '파이브데이' };

/** 외박 일수 표현: 1~5 → 원데이~파이브데이, 그 이상 → 'N데이' */
export function passDayWord(days: number): string {
    return PASS_DAY_WORDS[days] || `${days}데이`;
}

/** 직접 입력한 기수 정리: ' 01-27기 ' → '01-27' */
export function normalizeBatch(text: string | null | undefined): string {
    return (text || '').trim().replace(/\s*기$/, '').trim();
}

/** 직접 입력한 포상휴가 종류 정리: '골든타이거 포상휴가' → '골든타이거' */
export function normalizeRewardKind(text: string | null | undefined): string {
    return (text || '').trim().replace(/\s*포상(?:휴가)?$/, '').trim();
}

/** 사유 이름(+기수)을 일수 없이 조립한다: 'KTA 수료' + '01-27' → 'KTA 01-27기 수료', 'DBIDS' + '01-27' → '01-27기 DBIDS' */
export function composeReasonBase(option: string, rawBatch?: string | null): string {
    const batch = normalizeBatch(rawBatch);
    if (!batch) return option;
    // DBIDS·PRT DEMO는 기수를 앞에 쓴다 ('01-27기 DBIDS') — 패스지가 섹션 접두사(KTA)를 붙인다
    if (BATCH_FIRST_REASONS.includes(option)) return `${batch}기 ${option}`;
    if (option.endsWith(' 수료')) return `${option.slice(0, -' 수료'.length)} ${batch}기 수료`;
    return `${option} ${batch}기`;
}

/** '잔류'는 날짜 구분용으로만 기간을 쓰고, 일수 없이 '잔류'라고만 저장한다. */
export const STAY_REASON = '잔류';

/** 외박 사유: 이름(+기수) + 'N데이' ('잔류'는 일수 없이 그대로) */
export function composePassReason(option: string, batch: string | null | undefined, days: number): string {
    if (option === STAY_REASON) return STAY_REASON;
    const base = composeReasonBase(option, batch);
    return days > 0 ? `${base} ${passDayWord(days)}` : base;
}

/** 직접 입력한 외박 사유에도 기간 일수를 붙인다: 'Veteran's Day' + 4 → 'Veteran's Day 포데이' (끝에 적힌 일수는 새로 계산한 값으로) */
export function composeCustomPassReason(text: string, days: number): string {
    const base = stripDayCount(text);
    if (!base) return '';
    return days > 0 ? `${base} ${passDayWord(days)}` : base;
}

/** 휴가 사유: 이름 + 'N일' */
export function withDayCount(label: string, days: number): string {
    return days > 0 ? `${label} ${days}일` : label;
}

/** 휴가 사유: '연가 N일', 포상휴가는 '종류 포상휴가 N일' */
export function composeVacationReason(option: string, kind: string | null | undefined, days: number): string {
    const cleanKind = normalizeRewardKind(kind);
    const base = option === REWARD_VACATION && cleanKind ? `${cleanKind} ${REWARD_VACATION}` : option;
    return withDayCount(base, days);
}

const DAY_SUFFIX = /\s*(?:\d+(?:\.\d+)?\s*(?:일|데이)|(?:원|투|쓰리|포|파이브|식스|세븐|에잇|나인|텐)\s*데이)\s*$/;

/** 저장된 사유에서 끝의 일수 표현을 떼어 낸 이름 ('일반 투데이' → '일반', '연가 4일' → '연가') */
export function stripDayCount(reason: string): string {
    return (reason || '').trim().replace(DAY_SUFFIX, '').trim();
}

/**
 * 저장된 사유를 버튼 + 세부값(외박은 기수, 포상휴가는 종류)으로 되돌린다. 버튼으로 만들 수 없는 사유면 null.
 */
export function matchReasonOption(reason: string, options: string[]): { option: string; detail: string | null } | null {
    const base = stripDayCount(reason);
    const direct = options.find(option => option === base);
    if (direct) return { option: direct, detail: null };

    for (const option of BATCH_FIRST_REASONS) {
        const m = new RegExp(`^(\\S+)기\\s*${option}$`, 'i').exec(base);
        if (m && options.includes(option)) return { option, detail: m[1] };
    }

    const graduation = /^(.*?)\s+(\S+)기\s*수료$/.exec(base);
    if (graduation) {
        const option = `${graduation[1].trim()} 수료`;
        if (options.includes(option)) return { option, detail: graduation[2] };
    }

    const reward = new RegExp(`^(.+?)\\s*${REWARD_VACATION}$`).exec(base);
    if (reward && options.includes(REWARD_VACATION)) return { option: REWARD_VACATION, detail: reward[1].trim() };
    return null;
}

export interface BatchEventLike {
    type?: string;
    memo?: string;
    startDate?: string;
    batch?: string;
}

/**
 * 고를 수 있는 기수: 캘린더의 'Day 0' 일정 중 외박 출발일 기준 3개월 전부터 출발일 전날까지 시작한 기수 (최근 순).
 * KTA·BLC는 각자 자기 일정(type 'kta' / 'blc')의 기수만 본다.
 * 기수 번호는 일정의 batch 값, 없으면 메모의 'MM-DD' 형식.
 */
/** 기수 버튼으로 보여 줄 기간 (외박 출발일 기준 몇 개월 전까지) */
export const BATCH_LOOKBACK_MONTHS = 3;

export function getBatchOptions(events: BatchEventLike[], type: BatchType, departIso: string): string[] {
    if (!departIso) return [];
    const [y, m, d] = departIso.split('-').map(Number);
    const windowStart = new Date(Date.UTC(y, m - 1 - BATCH_LOOKBACK_MONTHS, d));
    const fromIso = `${windowStart.getUTCFullYear()}-${String(windowStart.getUTCMonth() + 1).padStart(2, '0')}-${String(windowStart.getUTCDate()).padStart(2, '0')}`;
    const toIso = addDaysIso(departIso, -1);

    const found: { batch: string; start: string }[] = [];
    events
        .filter(e => e.type === type && (e.memo || '').includes('Day 0') && e.startDate)
        .filter(e => e.startDate! >= fromIso && e.startDate! <= toIso)
        .forEach(e => {
            const batch = (e.batch || '').trim() || ((e.memo || '').match(/(\d{1,2}-\d{1,2})/) || [])[1] || '';
            if (batch && !found.some(f => f.batch === batch)) found.push({ batch, start: e.startDate! });
        });
    return found.sort((a, b) => b.start.localeCompare(a.start)).map(f => f.batch);
}

/** 기간에 들어 있는 첫 주말(토~일). 없으면 null. */
export function findWeekendInRange(isoDates: string[]): { start: string; end: string } | null {
    for (const iso of isoDates) {
        const [y, m, d] = iso.split('-').map(Number);
        if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6) {
            return { start: iso, end: addDaysIso(iso, 1) };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// 당직으로 외박 일수가 줄어든 경우

const WEEKDAY_KO_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

function weekdayIndexOf(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 당직 날짜 → '토당' 같은 줄임말 */
export function dutyDayLabel(iso: string): string {
    return `${WEEKDAY_KO_SHORT[weekdayIndexOf(iso)]}당`;
}

/** 외박 사유 앞에 붙일 축소 원인: ['2026-11-21'] → '토당으로 인한', 여러 날이면 '금당, 토당으로 인한' */
export function dutyReductionPrefix(dutyIsoDates: string[]): string {
    const labels = [...new Set([...dutyIsoDates].sort().map(dutyDayLabel))];
    return labels.length > 0 ? `${labels.join(', ')}으로 인한` : '';
}

const DUTY_CAUSE_TOKEN = /^(?:[월화수목금토일](?:요일)?\s*당(?:직)?(?:근무)?|당직(?:근무)?)$/;

/**
 * 저장된 외박 사유에서 당직 축소 원인을 떼어 낸다: '토당으로 인한 일반 원데이' → { rest: '일반 원데이' }.
 * 원인이 당직이 아니면(예: 'DBIDS로 인한 …') null.
 */
export function splitDutyReductionPrefix(reason: string): { cause: string; rest: string } | null {
    const m = /^(.+?)\s*(?:으로|로)\s*인한\s+(.+)$/.exec((reason || '').trim());
    if (!m) return null;
    const tokens = m[1].split(/\s*,\s*/).map(t => t.trim()).filter(Boolean);
    if (tokens.length === 0 || !tokens.every(t => DUTY_CAUSE_TOKEN.test(t))) return null;
    return { cause: m[1].trim(), rest: m[2].trim() };
}

/**
 * 버튼으로 채울 외박 기간에서 당직을 피한다: 당직인 날은 외박일이 될 수 없고, 출발일(시작 전날)도 당직이면 안 된다.
 * 당직 다음 날(리커버리)은 출발일이 당직이 되므로 외박 첫날이 될 수 없어, 리커버리 다음 날부터 시작한다.
 * 그 조건을 지키는 가장 긴 연속 구간(같으면 앞쪽)을 돌려준다. 남는 날이 없으면 null.
 */
export function fitPassAroundDuty(
    range: { start: string; end: string },
    isDuty: (iso: string) => boolean
): { start: string; end: string } | null {
    // 당직이 아닌 날이 이어진 구간들
    const segments: { start: string; end: string }[] = [];
    for (let d = range.start; d <= range.end; d = addDaysIso(d, 1)) {
        if (isDuty(d)) continue;
        const last = segments[segments.length - 1];
        if (last && last.end === addDaysIso(d, -1)) last.end = d;
        else segments.push({ start: d, end: d });
    }
    let best: { start: string; end: string } | null = null;
    let bestDays = 0;
    for (const seg of segments) {
        // 구간 바로 앞날이 당직이면 그날 출발할 수 없으므로 하루 늦게 시작
        const start = isDuty(addDaysIso(seg.start, -1)) ? addDaysIso(seg.start, 1) : seg.start;
        if (start > seg.end) continue;
        const days = Math.round((Date.parse(seg.end) - Date.parse(start)) / 86400000) + 1;
        if (days > bestDays) {
            best = { start, end: seg.end };
            bestDays = days;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// 잔류: 외박도 휴가도 없이 쉬는 날의 사유 (당직 요일 + 섹션별 업무 버튼 + 직접 입력)

export const STAY_TASK_LABELS = ['KTA 업무', 'BLC 업무', 'PAO 업무'];

/** 섹션에 따른 업무 버튼 하나. 수료 사유와 같은 우선순위(PAO → RSO → BLC → KTA·MEDIC). 해당하는 섹션이 없으면 null. */
export function getStayTaskLabel(sectionKeys: string[]): string | null {
    const grad = getGraduationReason(sectionKeys);
    if (!grad) return null;
    if (grad.startsWith('KTA/PAO')) return 'PAO 업무';
    if (grad.startsWith('BLC')) return 'BLC 업무';
    return 'KTA 업무'; // KTA 수료, KTA/RSO 수료
}

export interface StayChoice {
    /** 고른 당직 요일 라벨 (예: '토당') */
    dutyLabels: string[];
    /** 섹션 업무 버튼을 골랐는지 */
    task: boolean;
    custom: string;
    customOn: boolean;
}

/** 한국어 조사: '당'으로 끝나면 '으로', 받침이 있으면 '으로', 없으면 '로' */
function reasonParticle(text: string): string {
    if (/당$/.test(text)) return '으로';
    const code = text.charCodeAt(text.length - 1);
    if (code >= 0xac00 && code <= 0xd7a3) {
        const jong = (code - 0xac00) % 28;
        return jong === 0 || jong === 8 ? '로' : '으로';
    }
    return '로';
}

/** 잔류 사유 문자열: '토당으로 인한 잔류', 'KTA 업무로 인한 잔류', '토당, KTA 업무로 인한 잔류'. 고른 것이 없으면 그냥 '잔류'. */
export function composeStayReason(choice: StayChoice, periodDutyIso: string[], taskLabel: string | null): string {
    const dutyTokens = [...new Set([...periodDutyIso].sort().map(dutyDayLabel))].filter(l => choice.dutyLabels.includes(l));
    const tokens = [...dutyTokens];
    if (choice.task && taskLabel) tokens.push(taskLabel);
    const custom = choice.customOn ? choice.custom.trim() : '';
    if (custom) tokens.push(custom);
    if (tokens.length === 0) return STAY_REASON;
    const joined = tokens.join(', ');
    return `${joined}${reasonParticle(joined)} 인한 잔류`;
}

/** 저장된 잔류 사유를 고른 상태로 되돌린다. 'X로 인한 잔류' 형식이 아니면(예: 그냥 '잔류') 아무것도 고르지 않은 상태. */
export function parseStayReason(reason: string): StayChoice {
    const choice: StayChoice = { dutyLabels: [], task: false, custom: '', customOn: false };
    const m = /^(.+?)\s*(?:으로|로)\s*인한\s+잔류$/.exec((reason || '').trim());
    if (!m) return choice;
    for (const token of m[1].split(/\s*,\s*/).map(t => t.trim()).filter(Boolean)) {
        if (/^[월화수목금토일]당$/.test(token)) choice.dutyLabels.push(token);
        else if (STAY_TASK_LABELS.includes(token)) choice.task = true;
        else {
            choice.customOn = true;
            choice.custom = choice.custom ? `${choice.custom}, ${token}` : token;
        }
    }
    return choice;
}
