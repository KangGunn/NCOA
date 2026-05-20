export interface SheetEvent {
    memo: string;
    startDate: string;
    endDate: string;
    type: string;
    isDepartDay?: boolean;
    isConsecutive?: boolean;
    dateText?: string;
}

export interface Stats {
    total: number;
    present: number;
    absent: number;
    dutyCount: number;
    vacationCount: number;
    passCount: number;
}

export interface EveningData {
    duties: string[];
    vacations: any[];
    passes: any[];
    recoveries: string[];
    tomorrowDuties: string[];
    tomorrowDeparts: string[];
}

export interface MorningData {
    duties: string[];
    recoveries: string[];
    vacations: string[];
    passes: string[];
    tomorrowStr: string;
    presentMembers: string[];
}

export interface RollCallData {
    stats: Stats;
    evening: EveningData;
    morning: MorningData;
    sheetEvents: SheetEvent[];
}
