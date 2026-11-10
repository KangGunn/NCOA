/* eslint-disable @typescript-eslint/no-explicit-any */
import { calculateRankFromEnlistment } from "./rank.util";

/** 시트 A열의 관등성명 형식: "병장 김원범" */
const NAME_WITH_RANK = /^(병장|상병|일병|이병)\s+(\S.*)$/;

export interface RankNameUpdate {
    /** 0부터 세는 시트 행 번호 */
    rowIdx: number;
    from: string;
    to: string;
}

/** 'YYYY-MM-DD'를 서버 시간대와 관계없이 그 날짜의 정오로 만든다 (계급 계산이 로컬 연/월/일을 쓰므로). */
export function dateFromIso(iso: string): Date | null {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec((iso || "").trim());
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/**
 * 시트 A열 이름 목록과 인원 DB로, asOf 날짜 기준 계급이 바뀐 행을 찾는다.
 * - "계급 이름" 형식이 아닌 행(날짜·제목·총원 같은 집계 행)은 건너뛴다.
 * - 인원 DB에 같은 이름이 없거나 두 명 이상이면 건너뛴다 (동명이인은 skipped에 남김).
 * - 러너(role === "runner")와 입대일이 없는 인원은 바꾸지 않는다.
 */
export function computeRankNameUpdates(
    nameColumn: string[],
    members: any[],
    asOf: Date,
    firstMemberRow = 2
): { updates: RankNameUpdate[]; skipped: string[] } {
    const updates: RankNameUpdate[] = [];
    const skipped: string[] = [];

    for (let rowIdx = firstMemberRow; rowIdx < nameColumn.length; rowIdx++) {
        const raw = (nameColumn[rowIdx] || "").trim();
        const match = NAME_WITH_RANK.exec(raw);
        if (!match) continue;

        const name = match[2].trim();
        const candidates = members.filter((m) => (m?.name || "").trim() === name);
        if (candidates.length === 0) continue;
        if (candidates.length > 1) {
            skipped.push(`${name}: 동명이인`);
            continue;
        }

        const member = candidates[0];
        if (member.role === "runner") continue;
        const enlistment = dateFromIso(member.enlistmentDate || "");
        if (!enlistment) continue;

        const rank = calculateRankFromEnlistment(enlistment, member.earlyPromotion || 0, asOf);
        const to = `${rank} ${name}`;
        if (to !== raw) {
            updates.push({ rowIdx, from: raw, to });
        }
    }

    return { updates, skipped };
}
