/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 전입 예정 신병의 시트 행 추가 규칙 (앱의 src/utils/member/member.recruit.ts와 같은 규칙).
 * - 이름을 비워 두고 저장한 신병은 'S3 신병', 'BLC/S6 신병', '신병' 같은 자리 이름으로 저장된다.
 * - 시트에 행이 생기기 전 주간 출타는 Firestore에 '신병#<인원 id>' 이름으로 저장하고, 시트에 쓸 칸은 인원 문서에 모아 둔다.
 * - 이름(실제 이름)·영문 이름·전화번호가 모두 채워지면 시트 인원 칸의 첫 빈 행에 '계급 이름'을 쓰고 모아 둔 칸을 반영한다.
 */

export const PENDING_RECRUIT_KEY_PREFIX = "신병#";

/** 시트 인원 칸: 3~22행 (0부터 세면 2~21). 집계 수식이 A3:A22를 고정으로 본다. */
export const MEMBER_ROW_FIRST = 2;
export const MEMBER_ROW_LAST = 21;

/** 전입일이 이보다 오래된 인원은 자동으로 시트에 넣지 않는다 (전역·전출로 시트에서 지운 인원을 되살리지 않도록) */
export const RECRUIT_JOIN_WINDOW_DAYS = 90;

export function pendingRecruitKey(memberId: string): string {
    return `${PENDING_RECRUIT_KEY_PREFIX}${memberId}`;
}

export function isPlaceholderRecruitName(name: string | undefined | null): boolean {
    return /(^|[\s/])신병$/.test((name || "").trim());
}

export function isRecruitProfileComplete(member: any): boolean {
    const name = (member?.name || "").trim();
    return !!name && !isPlaceholderRecruitName(name) &&
        !!(member?.englishName || "").trim() &&
        !!(member?.phoneNumber || "").trim();
}

/** 'YYYY-MM-DD' 두 날짜 사이 일수 (b - a) */
function daysBetween(aIso: string, bIso: string): number {
    const a = Date.UTC(Number(aIso.slice(0, 4)), Number(aIso.slice(5, 7)) - 1, Number(aIso.slice(8, 10)));
    const b = Date.UTC(Number(bIso.slice(0, 4)), Number(bIso.slice(5, 7)) - 1, Number(bIso.slice(8, 10)));
    return Math.round((b - a) / 86400000);
}

/**
 * 시트에 행을 추가해야 하는 신병인가: 일반 부대원(러너·유급생 제외), 전입일이 있고 최근(90일 안) 또는 앞으로,
 * 이름·영문 이름·전화번호가 모두 있고, 아직 행을 추가하지 않았다.
 */
export function needsSheetRow(member: any, todayIso: string): boolean {
    if (!member) return false;
    if (member.role === "runner" || member.role === "holdover") return false;
    if (member.sheetRowName) return false;
    const joinDate = (member.joinDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) return false;
    if (daysBetween(joinDate, todayIso) > RECRUIT_JOIN_WINDOW_DAYS) return false;
    return isRecruitProfileComplete(member);
}

/** 이름·영문 이름·전화번호·전입일·역할 중 하나라도 바뀌었거나 새로 만든 문서인가 (트리거가 자기 쓰기로 다시 돌지 않게) */
export function recruitProfileChanged(before: any, after: any): boolean {
    if (!before) return true;
    return ["name", "englishName", "phoneNumber", "joinDate", "role"].some((k) => (before[k] || "") !== (after?.[k] || ""));
}

/** 시트 인원 칸(3~22행)에서 이름이 비어 있는 첫 행 (0부터 센 번호). 없으면 -1 */
export function findFreeMemberRow(nameColumn: string[]): number {
    for (let i = MEMBER_ROW_FIRST; i <= MEMBER_ROW_LAST; i++) {
        if (!(nameColumn[i] || "").trim()) return i;
    }
    return -1;
}

export interface DeferredSheet {
    dayStatuses: Record<string, string>;
    cellUpdates: Record<string, string>;
}

/** 미뤄 둔 시트 칸에 새 저장분을 덧씌운다 (나중 저장이 같은 날짜를 이긴다) */
export function mergeDeferredSheet(prev: Partial<DeferredSheet> | undefined, next: Partial<DeferredSheet> | undefined): DeferredSheet {
    return {
        dayStatuses: { ...(prev?.dayStatuses || {}), ...(next?.dayStatuses || {}) },
        cellUpdates: { ...(prev?.cellUpdates || {}), ...(next?.cellUpdates || {}) },
    };
}
