export interface CalendarEvent {
    id: string;
    type: 'duty' | 'kta' | 'blc' | 'holiday';
    startDate: string;
    endDate: string;
    memo: string;
    batch?: string;
    ktaType?: 'A' | 'B';
    holidayType?: 'blc' | 'duty';
    customDutyType?: 'weekday' | 'friSun' | 'sat';
}

export interface PenaltyItem {
    id: string;
    type: 'weekday' | 'friSun' | 'sat';
    date?: string;
    reason: string;
    createdAt?: string;
}

export interface CalendarMember {
    id: string;
    name: string;
    enlistmentDate: string;
    role?: 'member' | 'runner' | 'holdover';
    rank?: string;
    sections?: string[];
    dutyCompleted?: boolean;
    baselineWeekday?: number;
    baselineFriSun?: number;
    baselineSat?: number;
    earlyPromotion?: number;
    joinDate?: string;
    dutyOffset?: number;
    penalties?: PenaltyItem[];
}

export interface ScheduleTemplateDay {
    day: number;
    events: string[];
}

export interface MemberConfig {
    weekday: string;
    friSun: string;
    sat: string;
    free: string;
}
