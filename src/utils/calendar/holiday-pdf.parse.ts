/**
 * USFK 휴일표 PDF(예: 'USFK HOLIDAY SCHEDULE - FISCAL YEAR 2027')에서 읽은 텍스트를
 * 행으로 나누고, KATUSA 열이 YES인 휴일을 연휴 단위로 묶는다.
 * 외부 의존성이 없는 순수 함수만 둔다 (tests/holiday-pdf.parse.test.ts).
 *
 * PDF 텍스트 형식 (pdf.js 읽기 순서, 행마다 한 줄):
 *   DATE DAY HOLIDAY US ROK KATUSA DOD (US) USFK (KN) CFC (KN) DOWEA (US)
 *   9-Oct-26 FRIDAY COLUMBUS DAY (US) TRAINING HOLIDAY YES NO YES NO NO NO TWD
 */

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS: Record<string, number> = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
};
const DAY_MS = 24 * 60 * 60 * 1000;

export interface HolidayRow {
    /** 'YYYY-MM-DD' (연도를 고친 경우 고친 값) */
    iso: string;
    /** PDF에 적힌 요일 */
    weekday: string;
    /** PDF에 적힌 휴일 이름 그대로 */
    name: string;
    /** 관찰 기관 열 값들 (US, ROK, KATUSA, …) */
    flags: string[];
    /** KATUSA 열이 YES인지 */
    observed: boolean;
    /** PDF 원문 날짜 (예: '28-May-28') */
    rawDate: string;
    /** 날짜를 고쳤을 때 설명 */
    correction?: string;
    /** 날짜를 믿을 수 없어 뺀 이유 */
    error?: string;
}

export interface ParsedHolidaySchedule {
    fiscalYear: number | null;
    columns: string[];
    /** 읽은 행 전체 */
    rows: HolidayRow[];
    /** 'DD-Mon-YY 요일'로 시작했지만 형식을 읽지 못한 줄 */
    unparsedLines: string[];
}

// ---------------------------------------------------------------------------
// 날짜 도우미

function isoFromParts(y: number, m: number, d: number): string {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function utcOf(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

export function weekdayOf(iso: string): string {
    return WEEKDAYS[new Date(utcOf(iso)).getUTCDay()];
}

export function addDays(iso: string, days: number): string {
    const d = new Date(utcOf(iso) + days * DAY_MS);
    return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function isWeekend(iso: string): boolean {
    const w = weekdayOf(iso);
    return w === 'SATURDAY' || w === 'SUNDAY';
}

function isValidDate(y: number, m: number, d: number): boolean {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
// 텍스트 → 행

/** 헤더 'DATE DAY HOLIDAY ...' 뒤의 열 이름들 (예: US, ROK, KATUSA, DOD (US), …) */
function parseColumns(lines: string[]): string[] {
    for (const line of lines) {
        const m = /\bDATE\s+DAY\s+HOLIDAY\s+(.+)$/i.exec(line);
        if (!m) continue;
        const cols = m[1].toUpperCase().match(/[A-Z]+(?:\s*\([A-Z/]+\))?/g) || [];
        if (cols.length > 0) return cols.map(c => c.replace(/\s+/g, ' ').trim());
    }
    return [];
}

/**
 * PDF에서 꺼낸 텍스트(줄 단위)를 휴일 행으로 바꾼다.
 * @param observer 볼 열 이름 (기본 'KATUSA')
 */
export function parseHolidayScheduleText(text: string, observer = 'KATUSA'): ParsedHolidaySchedule {
    const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const fyMatch = /FISCAL\s+YEAR\s+(\d{4})/i.exec(text);
    const fiscalYear = fyMatch ? Number(fyMatch[1]) : null;
    const columns = parseColumns(lines);
    const observerIndex = columns.indexOf(observer.toUpperCase());
    if (observerIndex === -1) {
        throw new Error(`휴일표에서 '${observer}' 열을 찾지 못했습니다. USFK 휴일표 PDF인지 확인하세요.`);
    }

    const flagCount = columns.length;
    const dayAlt = WEEKDAYS.join('|');
    const rowStart = new RegExp(`^\\d{1,2}-[A-Za-z]{3}-\\d{2,4}\\s+(?:${dayAlt})\\b`, 'i');
    const rowRe = new RegExp(
        `^(\\d{1,2})-([A-Za-z]{3})-(\\d{2,4})\\s+(${dayAlt})\\s+(.+?)\\s+((?:[A-Z]+\\s+){${flagCount - 1}}[A-Z]+)$`,
        'i'
    );

    const rows: HolidayRow[] = [];
    const unparsedLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!rowStart.test(lines[i])) continue;
        // 한 행이 두세 줄로 나뉜 경우를 위해 다음 행 시작 전까지 붙여 본다
        let match: RegExpExecArray | null = null;
        let candidate = lines[i];
        for (let extra = 0; extra <= 2; extra++) {
            match = rowRe.exec(candidate);
            if (match) {
                i += extra;
                break;
            }
            const next = lines[i + extra + 1];
            if (!next || rowStart.test(next)) break;
            candidate = `${candidate} ${next}`;
        }
        if (!match) {
            unparsedLines.push(lines[i]);
            continue;
        }

        const [, dd, mon, yy, weekdayRaw, nameRaw, flagsRaw] = match;
        const month = MONTHS[mon.toUpperCase()];
        const day = Number(dd);
        const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
        const weekday = weekdayRaw.toUpperCase();
        const flags = flagsRaw.toUpperCase().split(/\s+/);
        const row: HolidayRow = {
            iso: '',
            weekday,
            name: nameRaw.trim(),
            flags,
            observed: flags[observerIndex] === 'YES',
            rawDate: `${dd}-${mon}-${yy}`,
        };

        if (!month || !isValidDate(year, month, day)) {
            row.error = `날짜 '${row.rawDate}'를 읽을 수 없습니다.`;
            rows.push(row);
            continue;
        }

        // 회계연도 범위(전년 10/1 ~ 9/30)와 요일로 연도 오타를 고친다 (예: '28-May-28 FRIDAY' → 2027-05-28)
        const inFiscalYear = (iso: string) =>
            fiscalYear === null || (iso >= `${fiscalYear - 1}-10-01` && iso <= `${fiscalYear}-09-30`);
        const iso = isoFromParts(year, month, day);
        if (weekdayOf(iso) === weekday && inFiscalYear(iso)) {
            row.iso = iso;
        } else {
            const candidates = fiscalYear === null ? [year - 1, year + 1] : [fiscalYear - 1, fiscalYear];
            const fixed = candidates
                .filter(y => isValidDate(y, month, day))
                .map(y => isoFromParts(y, month, day))
                .find(c => weekdayOf(c) === weekday && inFiscalYear(c));
            if (fixed) {
                row.iso = fixed;
                row.correction = `원본 날짜 '${row.rawDate}'는 요일(${weekday})과 맞지 않아 ${fixed}로 읽었습니다.`;
            } else {
                row.iso = iso;
                row.error = `날짜 '${row.rawDate}'와 요일(${weekday})이 맞지 않습니다.`;
            }
        }
        rows.push(row);
    }

    return { fiscalYear, columns, rows, unparsedLines };
}

// ---------------------------------------------------------------------------
// 휴일 이름 정리

/** 괄호 내용, 끝의 ALT / OBSERVED를 뺀 이름 (아포스트로피는 유지) */
export function cleanHolidayName(name: string): string {
    return name
        .toUpperCase()
        .replace(/[‘’`]/g, "'")
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/(?:\s+(?:ALT|OBSERVED))+$/, '')
        .trim();
}

/** 비교용 키: 아포스트로피·마침표를 빼고 DAY/HOLIDAY 같은 일반 단어를 뺀다 ('VETERAN'S DAY' = 'VETERANS DAY' → 'VETERANS') */
export function holidayMatchKey(cleanName: string): string {
    return cleanName
        .replace(/['.]/g, '')
        .split(/\s+/)
        .filter(word => word && word !== 'DAY' && word !== 'HOLIDAY')
        .join(' ');
}

const TRAINING_SUFFIX = ' TRAINING HOLIDAY';

interface HolidayIdentity {
    /** 같은 휴일끼리 같은 키 */
    key: string;
    /** 표시 후보 이름 */
    label: string;
    /** 실제 휴일 이름에서 온 것인지 (훈련휴일에서 뗀 이름이 아님) */
    primary: boolean;
}

/**
 * 휴일 하나의 정체: '○○ TRAINING HOLIDAY'는 ○○가 휴일표에 실제로 있는 휴일일 때만 ○○로 본다.
 * 'EXERCISE TRAINING HOLIDAY', 'EOY TRAINING HOLIDAY'처럼 앞부분이 휴일이 아니면 이름 전체가 휴일 이름이다.
 */
export function identifyHoliday(name: string, knownHolidayKeys: Set<string>): HolidayIdentity {
    const clean = cleanHolidayName(name);
    if (clean.endsWith(TRAINING_SUFFIX)) {
        const base = clean.slice(0, -TRAINING_SUFFIX.length).trim();
        const baseKey = holidayMatchKey(base);
        if (base && knownHolidayKeys.has(baseKey)) {
            return { key: baseKey, label: base, primary: false };
        }
    }
    return { key: holidayMatchKey(clean), label: clean, primary: !clean.endsWith(TRAINING_SUFFIX) };
}

/** 휴일표에 실제 휴일(훈련휴일이 아닌 행)로 나온 이름들의 키 */
export function collectKnownHolidayKeys(rows: HolidayRow[]): Set<string> {
    const keys = new Set<string>();
    rows.forEach(r => {
        const clean = cleanHolidayName(r.name);
        if (!clean.endsWith(TRAINING_SUFFIX)) keys.add(holidayMatchKey(clean));
    });
    return keys;
}

/** 같은 휴일의 여러 표기 중 대표 이름: 아포스트로피가 있는 표기 → 실제 휴일 행 표기 → 많이 나온 표기 */
function pickLabel(identities: HolidayIdentity[]): string {
    const counts = new Map<string, { n: number; primary: boolean; apostrophe: boolean; first: number }>();
    identities.forEach((id, i) => {
        const cur = counts.get(id.label);
        if (cur) {
            cur.n++;
            cur.primary = cur.primary || id.primary;
        } else {
            counts.set(id.label, { n: 1, primary: id.primary, apostrophe: id.label.includes("'"), first: i });
        }
    });
    return [...counts.entries()]
        .sort(([, a], [, b]) =>
            Number(b.apostrophe) - Number(a.apostrophe) ||
            Number(b.primary) - Number(a.primary) ||
            b.n - a.n ||
            a.first - b.first)[0][0];
}

// ---------------------------------------------------------------------------
// 연휴 묶기

export interface HolidayRun {
    start: string;
    end: string;
    /** 'LABOR DAY + CHILDREN'S DAY'처럼 서로 다른 휴일은 + 로 잇는다 */
    name: string;
    /** 이 연휴를 만든 PDF 행들 */
    rows: HolidayRow[];
    days: number;
}

export interface GroupOptions {
    /** 앞뒤로 붙은 토·일도 연휴에 넣는다 (예: 목·금 휴일 → 목~일) */
    includeAdjacentWeekends: boolean;
}

/**
 * KATUSA 휴일(observed)을 연휴로 묶는다.
 * - 이름이 달라도 날짜가 이어지면 하나의 연휴
 * - 금요일과 월요일 사이처럼 토·일만 끼어 있으면 주말까지 하나의 연휴
 * - includeAdjacentWeekends면 연휴 바로 앞뒤의 토·일도 포함
 */
export function groupHolidayRuns(schedule: ParsedHolidaySchedule, options: GroupOptions): HolidayRun[] {
    const known = collectKnownHolidayKeys(schedule.rows);
    const usable = schedule.rows
        .filter(r => r.observed && !r.error && r.iso)
        .sort((a, b) => a.iso.localeCompare(b.iso));

    const runs: { start: string; end: string; rows: HolidayRow[] }[] = [];
    for (const row of usable) {
        const last = runs[runs.length - 1];
        if (last) {
            let joinable = row.iso <= addDays(last.end, 1);
            if (!joinable) {
                // 사이에 낀 날이 모두 토·일이면 이어진 것으로 본다
                let d = addDays(last.end, 1);
                joinable = true;
                while (d < row.iso) {
                    if (!isWeekend(d)) {
                        joinable = false;
                        break;
                    }
                    d = addDays(d, 1);
                }
            }
            if (joinable) {
                if (row.iso > last.end) last.end = row.iso;
                last.rows.push(row);
                continue;
            }
        }
        runs.push({ start: row.iso, end: row.iso, rows: [row] });
    }

    if (options.includeAdjacentWeekends) {
        runs.forEach(run => {
            while (isWeekend(addDays(run.start, -1))) run.start = addDays(run.start, -1);
            while (isWeekend(addDays(run.end, 1))) run.end = addDays(run.end, 1);
        });
        // 주말을 넣어 서로 맞닿게 된 연휴는 합친다
        for (let i = runs.length - 1; i > 0; i--) {
            if (runs[i].start <= addDays(runs[i - 1].end, 1)) {
                runs[i - 1].end = runs[i].end > runs[i - 1].end ? runs[i].end : runs[i - 1].end;
                runs[i - 1].rows.push(...runs[i].rows);
                runs.splice(i, 1);
            }
        }
    }

    return runs.map(run => {
        // 휴일별로 묶어 날짜 순서대로 대표 이름을 잇는다
        const byKey = new Map<string, HolidayIdentity[]>();
        run.rows.forEach(r => {
            const id = identifyHoliday(r.name, known);
            const list = byKey.get(id.key);
            if (list) list.push(id);
            else byKey.set(id.key, [id]);
        });
        const name = [...byKey.values()].map(pickLabel).join(' + ');
        return {
            start: run.start,
            end: run.end,
            name,
            rows: run.rows,
            days: Math.round((utcOf(run.end) - utcOf(run.start)) / DAY_MS) + 1,
        };
    });
}

/** 대문자로 남길 약어 */
const KEEP_UPPER = new Set(['EOY', 'US', 'ROK', 'KN', 'KTA', 'BLC', 'USFK', 'CFC', 'UNC', 'DONSA']);

/**
 * 캘린더에 이미 있는 휴일 이름처럼 첫 글자만 대문자로: "VETERAN'S DAY" → "Veteran's Day".
 * 약어(EOY 등)와 로마 숫자(LXI 등)는 대문자 그대로, '+'로 이은 이름은 각각 바꾼다.
 */
export function toDisplayHolidayName(name: string): string {
    return name
        .split(' ')
        .map(word => {
            if (!word || word === '+') return word;
            const bare = word.replace(/[^A-Za-z]/g, '').toUpperCase();
            if (KEEP_UPPER.has(bare) || (/^[IVXLCDM]{2,}$/.test(bare) && bare.length <= 5)) return word.toUpperCase();
            const lower = word.toLowerCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
}

// ---------------------------------------------------------------------------
// 기존 당직 휴일과 비교

export interface ExistingHolidayLike {
    id?: string;
    startDate: string;
    endDate: string;
    memo?: string;
}

export type ImportStatus =
    | { kind: 'new' }
    | { kind: 'exists'; existing: ExistingHolidayLike }
    | { kind: 'overlap'; existing: ExistingHolidayLike[] };

/** 같은 기간의 당직 휴일이 이미 있으면 'exists', 기간이 겹치는 휴일이 있으면 'overlap' */
export function compareWithExisting(run: Pick<HolidayRun, 'start' | 'end'>, existing: ExistingHolidayLike[]): ImportStatus {
    const same = existing.find(e => e.startDate === run.start && (e.endDate || e.startDate) === run.end);
    if (same) return { kind: 'exists', existing: same };
    const overlapping = existing.filter(e => e.startDate <= run.end && (e.endDate || e.startDate) >= run.start);
    if (overlapping.length > 0) return { kind: 'overlap', existing: overlapping };
    return { kind: 'new' };
}
