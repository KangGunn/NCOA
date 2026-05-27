export interface CalendarEvent {
    id: string;
    type: 'duty' | 'kta' | 'blc' | 'holiday';
    startDate: string;
    endDate: string;
    memo: string;
    batch?: string;
    ktaType?: 'A' | 'B';
    holidayType?: 'blc' | 'duty';
}

export interface CalendarMember {
    id: string;
    name: string;
    enlistmentDate: string;
    role?: 'member' | 'runner';
    rank?: string;
    sections?: string[];
    dutyCompleted?: boolean;
    baselineWeekday?: number;
    baselineFriSun?: number;
    baselineSat?: number;
}

export interface ScheduleTemplateDay {
    day: number;
    events: string[];
}
