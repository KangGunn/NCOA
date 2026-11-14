/**
 * 유동병력 시트(NEW 탭) 셀 값 규칙. 서버에도 같은 내용이 있다: functions/src/utils/sheetCell.util.ts
 *
 * - 셀 값은 그날 일어난 일(외박복귀 → 휴가출발 → 휴가복귀 → 외박출발 순)을 '/'로 잇는다.
 *   시트 수식은 단어가 들어 있으면 세므로, 어떤 조합이든 출발과 복귀가 한 번씩 세어진다.
 * - 마지막 항목이 그날 밤 상태다: 외박·외박출발로 끝나면 외박, 휴가·휴가출발로 끝나면 휴가, 복귀로 끝나면 부대.
 * - 휴외연계(휴가 복귀일에 외박 출발)도 '휴가복귀/외박출발'로만 적는다. 연계 여부는 날짜로 알 수 있다.
 * - 외박복귀/휴가출발(외휴연계)은 점호에서 '휴가 출발 + 연계'로 읽는다.
 * - 외박 복귀일에 당일 휴가(외박복귀/휴가출발/휴가복귀)는 없는 일이라 드롭다운에 두지 않는다 (입력 단계에서 막는다).
 */

/** 시트 드롭다운 값 (scripts/sheet-counting-migrate.cjs와 같아야 한다) */
export const SHEET_CELL_VALUES = [
    '외박', '외박출발', '외박복귀',
    '휴가', '휴가출발', '휴가복귀',
    '외박복귀/휴가출발',
    '휴가복귀/외박출발',
    '휴가출발/휴가복귀', '휴가출발/휴가복귀/외박출발',
    '외박복귀/외박출발',
    '외출', '당직',
] as const;

/** 그날 밤 외박 중으로 세는 값 / 휴가 중으로 세는 값 (시트 23~30행 수식과 같다) */
export const AWAY_PASS_VALUES = ['외박', '외박출발', '외박복귀/외박출발', '휴가복귀/외박출발', '휴가출발/휴가복귀/외박출발'];
export const AWAY_VACATION_VALUES = ['휴가', '휴가출발', '외박복귀/휴가출발'];

export interface DayEvents {
    passReturn?: boolean;
    vacationDepart?: boolean;
    vacationReturn?: boolean;
    passDepart?: boolean;
    /** 외박 중인 날 (출발·복귀 사이) */
    passStay?: boolean;
    /** 휴가 중인 날 */
    vacationStay?: boolean;
}

/** 그날 일어난 일로 셀 값을 만든다. 아무 일도 없으면 '' */
export function composeSheetCell(e: DayEvents, _allowVacationPassLink: boolean): string {
    const tokens: string[] = [];
    if (e.passReturn) tokens.push('외박복귀');
    if (e.vacationDepart) tokens.push('휴가출발');
    if (e.vacationReturn) tokens.push('휴가복귀');
    if (e.passDepart) tokens.push('외박출발');
    if (tokens.length > 0) {
        // 연계 여부는 시트에 적지 않는다 (날짜로 알 수 있고, 허용 여부는 설정에서 본다)
        return tokens.join('/');
    }
    if (e.passStay) return '외박';
    if (e.vacationStay) return '휴가';
    return '';
}

/** 시트 셀 값 → 잔디 상태. 예전 값('휴가출발(연계)', '외박출발(연계)', '외박 휴가복귀/외박출발')도 읽는다. */
export function sheetCellToStatus(cell: string): string {
    const v = (cell || '').trim();
    if (!v) return 'none';
    if (v.includes('당직')) return 'duty';
    // 외휴연계: 외박 복귀일에 휴가 출발 (예전: '휴가출발(연계)')
    if (v.startsWith('외박복귀/휴가출발') || (v.includes('휴가출발') && v.includes('연계') && !v.includes('외박출발'))) return 'linked';
    // 휴가 복귀일에 외박 출발 (예전: '외박출발(연계)', '외박 휴가복귀/외박출발')
    if (v.includes('외박출발') && (v.includes('휴가') || v.includes('연계'))) return 'vacation-pass-depart';
    if (v.includes('휴가')) return 'vacation';
    if (v.includes('외박출발')) return 'pass-depart';
    if (v.includes('외박')) return 'pass';
    return 'none';
}

/** 시트 수식과 같은 방식으로 한 날짜 열을 센다 (테스트·확인용) */
export function countSheetColumn(cells: string[]) {
    const has = (t: string) => cells.filter(c => (c || '').includes(t)).length;
    return {
        passDepart: has('외박출발'),
        passReturn: has('외박복귀'),
        vacationDepart: has('휴가출발'),
        vacationReturn: has('휴가복귀'),
        awayPass: cells.filter(c => AWAY_PASS_VALUES.includes(c)).length,
        awayVacation: cells.filter(c => AWAY_VACATION_VALUES.includes(c)).length,
    };
}
