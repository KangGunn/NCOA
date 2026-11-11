/**
 * 패스지 'Table'과 외특 탭 인원 카드가 함께 쓰는 섹션 판정 및 정렬 기준.
 * 외부 의존성이 없는 순수 함수만 둔다 (단위 테스트에서 바로 import 가능).
 */

/** Table에서 섹션이 나열되는 순서. 목록에 없는 섹션은 맨 뒤로 간다. */
export const TABLE_SECTION_ORDER = ['BLC', 'MEDIC', 'KTA', 'RSO', 'HQ'];

/** 섹션 정보가 없는 인원의 주 섹션 값 */
export const UNKNOWN_SECTION = '—';

export interface TableSectionInfo {
    mainSec: string;
    subSec: string;
}

/** DB 인원의 sections 배열로 Table의 주 섹션 / 부 섹션(HQ S-1 등)을 정한다. */
export function getTableSectionInfo(sections: string[] | undefined | null): TableSectionInfo {
    const secs = sections || [];
    let mainSec = UNKNOWN_SECTION;
    let subSec = '';
    if (secs.includes('KTA')) {
        mainSec = 'KTA';
    } else if (secs.includes('BLC')) {
        mainSec = 'BLC';
    } else {
        const hqSub = secs.find((s) => /^S\d$/.test(s));
        if (hqSub) {
            mainSec = 'HQ';
            subSec = hqSub.replace('S', 'S-');
        } else if (secs.includes('HQ')) {
            mainSec = 'HQ';
            subSec = secs.find((s) => s !== 'HQ') || '';
        } else if (secs.length > 0) {
            mainSec = secs[0];
        }
    }
    return { mainSec, subSec };
}

/** 화면에 표시할 섹션 그룹 이름 (예: 'KTA', 'HQ S-1', '섹션 미지정') */
export function getTableSectionLabel(info: TableSectionInfo): string {
    if (info.mainSec === UNKNOWN_SECTION) return '섹션 미지정';
    if (info.mainSec === 'HQ') return info.subSec ? `HQ ${info.subSec}` : 'HQ';
    return info.mainSec;
}

const RANK_TO_ENGLISH: Record<string, string> = {
    '병장': 'SGT', '상병': 'CPL', '일병': 'PFC', '이병': 'PV2',
    'SGT': 'SGT', 'CPL': 'CPL', 'PFC': 'PFC', 'PV2': 'PV2', 'PVT': 'PVT'
};

/**
 * 계급 문자열(예: '상병 3호봉')을 영문 약어로 바꾼다.
 * 계급 문자열에서 찾지 못하면 표시 이름 앞의 계급(예: '병장 홍길동')을 쓰고, 그것도 없으면 'PFC'.
 */
export function toEnglishRank(rankStr: string, displayName: string): string {
    const keys = Object.keys(RANK_TO_ENGLISH);
    const matchedRankKey = keys.find((key) => rankStr.startsWith(key)) || '';
    if (RANK_TO_ENGLISH[matchedRankKey]) return RANK_TO_ENGLISH[matchedRankKey];
    const nameKey = keys.find((key) => displayName.startsWith(key));
    return nameKey ? RANK_TO_ENGLISH[nameKey] : 'PFC';
}

export interface TableOrderKey {
    mainSec: string;
    subSec: string;
    enlistmentDate?: string;
    rankEnglish: string;
    englishName: string;
}

const RANK_PRIORITY: Record<string, number> = { 'SGT': 1, 'CPL': 2, 'PFC': 3, 'PV2': 4, 'PVT': 5 };

/** 섹션 순서 → (HQ면) 부 섹션 → 입대일 → 계급 → 영문 이름 순으로 정렬한다. */
export function compareTableOrder(a: TableOrderKey, b: TableOrderKey): number {
    const idxA = TABLE_SECTION_ORDER.indexOf(a.mainSec);
    const idxB = TABLE_SECTION_ORDER.indexOf(b.mainSec);
    const orderA = idxA === -1 ? 999 : idxA;
    const orderB = idxB === -1 ? 999 : idxB;
    if (orderA !== orderB) return orderA - orderB;

    if (a.mainSec === 'HQ' && b.mainSec === 'HQ' && a.subSec !== b.subSec) {
        return a.subSec.localeCompare(b.subSec);
    }

    const enlistA = a.enlistmentDate || '';
    const enlistB = b.enlistmentDate || '';
    if (enlistA && enlistB) {
        if (enlistA !== enlistB) return enlistA < enlistB ? -1 : 1;
    } else if (enlistA) {
        return -1;
    } else if (enlistB) {
        return 1;
    }

    const pA = RANK_PRIORITY[a.rankEnglish] || 99;
    const pB = RANK_PRIORITY[b.rankEnglish] || 99;
    if (pA !== pB) return pA - pB;

    return a.englishName.localeCompare(b.englishName);
}
