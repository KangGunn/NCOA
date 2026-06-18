/* eslint-disable @typescript-eslint/no-explicit-any */
import { CheckCircle2, Send } from 'lucide-react';
import { MovementGrid } from './movement.grid.component';
import type { MovementRecord } from '../../types/movement/movement.type';

interface MovementExcelViewProps {
    parsedData: any[];
    syncing: boolean;
    success: string | null;
    handleSync: () => void;
    cancelSync: () => void;
    getExcelTimelineAndData: () => { timeline: string[]; dataList: any[] };
    dbMembers: any[];
    baseDate?: Date;
}

export function MovementExcelView({
    parsedData,
    syncing,
    success,
    handleSync,
    cancelSync,
    getExcelTimelineAndData,
    dbMembers,
    baseDate
}: MovementExcelViewProps) {
    const { timeline, dataList } = getExcelTimelineAndData();

    // Construct temporary movements for hover tooltips prior to Firestore sync
    const tempMovements: MovementRecord[] = parsedData.flatMap((item: any) => {
        const cleanName = item.name.replace(/^(병장|상병|일병|이병)\s*/, '');
        const records: MovementRecord[] = [];
        const currentYear = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

        const toISODate = (monthDayStr: string) => {
            if (!monthDayStr) return '';
            const clean = monthDayStr.replace(/\(원데이\)/, '').trim();
            const parts = clean.split(/[./~]/).map(p => p.trim());
            if (parts.length < 2) return '';
            const m = parseInt(parts[0]);
            const d = parseInt(parts[1]);
            if (isNaN(m) || isNaN(d)) return '';
            return `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        };

        if (item.period && item.type === '외박') {
            const [startStr, endStr] = item.period.split('~').map((s: string) => s.trim());
            const startDate = toISODate(startStr);
            const endDate = endStr ? toISODate(endStr) : startDate;
            if (startDate && endDate) {
                records.push({
                    name: cleanName,
                    type: 'pass',
                    startDate,
                    endDate,
                    reason: item.reason || ''
                });
            }
        }

        if (item.vacation) {
            const startDate = toISODate(item.vacation.depart);
            const endDate = toISODate(item.vacation.return);
            if (startDate && endDate) {
                records.push({
                    name: cleanName,
                    type: 'vacation',
                    startDate,
                    endDate,
                    reason: item.vacation.reason || ''
                });
            }
        }

        return records;
    });

    return (
        <div className="space-y-4 animate-in zoom-in-95 duration-300">
            <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-center justify-between gap-3 text-green-700">
                <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <p className="font-bold whitespace-nowrap text-sm sm:text-base">
                        업로드 데이터 ({parsedData.length}건)
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => handleSync()}
                        disabled={syncing}
                        className="px-4 py-2 bg-green-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-green-200 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
                    >
                        {syncing ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Send className="w-4 h-4" />
                        )}
                        시트 동기화
                    </button>
                    <button
                        onClick={cancelSync}
                        className="px-4 py-2 bg-white text-gray-600 border border-gray-200 rounded-xl font-bold text-sm active:scale-95 transition-all whitespace-nowrap shrink-0"
                    >
                        취소
                    </button>
                </div>
            </div>

            {success && (
                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center gap-3 text-blue-600 animate-in slide-in-from-top-2">
                    <CheckCircle2 className="w-5 h-5" />
                    <p className="font-bold">{success}</p>
                </div>
            )}

            <MovementGrid
                timeline={timeline}
                dataList={dataList}
                dbMembers={dbMembers}
                baseDate={baseDate}
                movements={tempMovements}
            />
        </div>
    );
}
