export interface MovementRecord {
    id?: string;
    name: string;      // Member name (e.g., "강동민")
    type: 'pass' | 'vacation';
    startDate: string; // "YYYY-MM-DD"
    endDate: string;   // "YYYY-MM-DD"
    reason: string;    // Reason (e.g., "일반 투데이", "골든타이거 5일포상 외휴연계")
    createdAt?: any;
}
