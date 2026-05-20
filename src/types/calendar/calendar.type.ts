export interface CalendarEvent {
    id: string;
    type: 'duty' | 'kta' | 'blc' | 'holiday';
    startDate: string;
    endDate: string;
    memo: string;
    batch?: string;
    ktaType?: 'A' | 'B';
}

export interface CalendarMember {
    id: string;
    name: string;
    enlistmentDate: string;
    role?: 'member' | 'runner';
}

export interface ScheduleTemplateDay {
    day: number;
    events: string[];
}
