/**
 * 전입 예정 신병 판별.
 * 이름을 비워 두고 저장한 신병은 'S3 신병', 'BLC/S6 신병', '신병' 같은 자리 이름으로 저장된다.
 * 이름·영문 이름·전화번호가 모두 채워지면 서버가 시트에 행을 추가한다 (functions/src/utils/recruitSheet.util.ts와 같은 규칙).
 */

/** 시트에 행이 생기기 전 신병의 출타 기록 이름 (movements.name). 인원 문서 id로 구분한다. */
export const PENDING_RECRUIT_KEY_PREFIX = '신병#';

export function pendingRecruitKey(memberId: string): string {
    return `${PENDING_RECRUIT_KEY_PREFIX}${memberId}`;
}

/** 이름 칸을 비워 둬서 생긴 자리 이름인지 ('S3 신병', 'BLC/S6 신병', '신병') */
export function isPlaceholderRecruitName(name: string | undefined | null): boolean {
    return /(^|[\s/])신병$/.test((name || '').trim());
}

/** 이름(자리 이름이 아닌 실제 이름)·영문 이름·전화번호가 모두 채워졌는지 */
export function isRecruitProfileComplete(member: { name?: string; englishName?: string; phoneNumber?: string }): boolean {
    const name = (member.name || '').trim();
    return !!name && !isPlaceholderRecruitName(name)
        && !!(member.englishName || '').trim()
        && !!(member.phoneNumber || '').trim();
}
