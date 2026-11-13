/**
 * 엑셀 업로드(반영 요청)의 Firestore 기록 계산. 순수 함수 — tests/movement.import.test.ts에서 바로 쓴다.
 */
export interface ImportMovement {
    name: string;
    type: string;
    /** 외박 항목: 'M.D', 'M.D~M.D', 'M.D (원데이)' */
    period?: string;
    reason?: string;
    /** 잔류 항목: 토요일~일요일 'M.D' */
    stayStart?: string;
    stayEnd?: string;
    detail?: string;
    vacation?: { depart: string; return: string; reason?: string };
    date?: string;
}

export interface ExistingDoc {
    id: string;
    name: string;
    type: string;
    startDate: string;
    endDate: string;
}

export interface ImportPlan {
    deleteIds: string[];
    adds: Record<string, unknown>[];
}

const cleanName = (name: string) => name.replace(/^(병장|상병|일병|이병)\s*/, "");

/** 연도 기준: 숫자면 그 연도, 'YYYY-MM-DD'면 그 날짜에서 가장 가까운 연도 (엑셀 댓글에는 연도가 없다) */
export type YearRef = number | string;

const pad = (n: number) => String(n).padStart(2, "0");

/** 'M.D' → 'YYYY-MM-DD'. '(원데이)' 표기는 무시한다. */
export function mdToIso(md: string, ref: YearRef): string {
    const parts = md.replace(/\(원데이\)/, "").trim().split(/[./~-]/).map((p) => p.trim());
    if (parts.length < 2) return "";
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(d)) return "";
    if (typeof ref === "number") return `${ref}-${pad(m)}-${pad(d)}`;
    const [ay, am, ad] = ref.split("-").map(Number);
    const anchor = Date.UTC(ay, am - 1, ad);
    let best = ay;
    for (const y of [ay - 1, ay + 1]) {
        if (Math.abs(Date.UTC(y, m - 1, d) - anchor) < Math.abs(Date.UTC(best, m - 1, d) - anchor)) best = y;
    }
    return `${best}-${pad(m)}-${pad(d)}`;
}

/** 시작~끝 구간. 끝이 시작보다 앞서면(연말을 넘는 기간) 끝을 다음 해로 */
function rangeIso(startMd: string, endMd: string, ref: YearRef): { start: string; end: string } | null {
    const start = mdToIso(startMd, ref);
    let end = mdToIso(endMd, ref);
    if (!start || !end) return null;
    if (end < start) end = `${Number(end.slice(0, 4)) + 1}${end.slice(4)}`;
    return { start, end };
}

function periodIso(period: string, ref: YearRef): { start: string; end: string } | null {
    const [s, e] = period.split(/[~-]/).map((x) => x.trim());
    return rangeIso(s, e || s, ref);
}

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart;

type Entry = { kind: "pass" | "stay" | "vacation"; start: string; end: string };

/** 항목 하나가 가진 기록 구간 (종류별) */
function entriesOf(m: ImportMovement, year: YearRef): Entry[] {
    const out: Entry[] = [];
    if (m.type === "외박" && m.period) {
        const p = periodIso(m.period, year);
        if (p) out.push({ kind: "pass", ...p });
    }
    if (m.type === "잔류" && m.stayStart && m.stayEnd) {
        const r = rangeIso(m.stayStart, m.stayEnd, year);
        if (r) out.push({ kind: "stay", ...r });
    }
    if (m.vacation) {
        const r = rangeIso(m.vacation.depart, m.vacation.return, year);
        if (r) out.push({ kind: "vacation", ...r });
    }
    return out;
}

export function planImportFirestore(movements: ImportMovement[], existing: ExistingDoc[], year: YearRef): ImportPlan {
    const deleteIds = new Set<string>();
    const hasRange = movements.some((m) => entriesOf(m, year).length > 0);

    if (hasRange) {
        existing.forEach((doc) => {
            const name = cleanName(doc.name);
            const sameName = movements.filter((m) => cleanName(m.name) === name);
            if (sameName.length === 0) return;
            const isVacationDoc = doc.type === "vacation";
            const all = sameName.flatMap((m) => entriesOf(m, year));

            // 1) 같은 종류끼리 겹치면 지운다 (휴가는 휴가끼리, 외박·잔류는 외박·잔류끼리)
            const sameKind = all.some((e) => (e.kind === "vacation") === isVacationDoc && overlaps(doc.startDate, doc.endDate, e.start, e.end));
            if (sameKind) {
                deleteIds.add(doc.id);
                return;
            }
            // 2) 외박·잔류 기록은 이 대원의 어떤 구간(휴가 포함)과 겹쳐도 지운다 (예전 동작과 같음)
            if (!isVacationDoc && all.some((e) => overlaps(doc.startDate, doc.endDate, e.start, e.end))) {
                deleteIds.add(doc.id);
            }
        });
    }

    const adds: Record<string, unknown>[] = [];
    movements.forEach((m) => {
        const name = cleanName(m.name);
        entriesOf(m, year).forEach((e) => {
            if (e.kind === "pass") adds.push({ name, type: "pass", startDate: e.start, endDate: e.end, reason: m.reason || "" });
            else if (e.kind === "stay") adds.push({ name, type: "stay", startDate: e.start, endDate: e.end, reason: m.detail || "잔류" });
            else adds.push({ name, type: "vacation", startDate: e.start, endDate: e.end, reason: m.vacation?.reason || "" });
        });
    });

    return { deleteIds: [...deleteIds], adds };
}
