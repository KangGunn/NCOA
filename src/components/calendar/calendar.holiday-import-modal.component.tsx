import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileUp, Loader2, AlertTriangle, Check } from 'lucide-react';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import type { CalendarEvent } from '../../types/calendar/calendar.type';
import {
    parseHolidayScheduleText,
    groupHolidayRuns,
    compareWithExisting,
    weekdayOf,
    toDisplayHolidayName,
    type ParsedHolidaySchedule,
    type HolidayRun,
    type ImportStatus
} from '../../utils/calendar/holiday-pdf.parse';

interface HolidayImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** 캘린더의 모든 일정 (기존 당직 휴일과 비교용) */
    events: CalendarEvent[];
}

const WEEKDAY_KO: Record<string, string> = {
    SUNDAY: '일', MONDAY: '월', TUESDAY: '화', WEDNESDAY: '수', THURSDAY: '목', FRIDAY: '금', SATURDAY: '토'
};

const formatDay = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number);
    return `${m}/${d}(${WEEKDAY_KO[weekdayOf(iso)]})`;
};

/** 연휴를 구분하는 키 (주말 포함 옵션을 바꿔도 같은 연휴면 같은 키) */
const runKey = (run: HolidayRun) => run.rows[0].iso;

type Phase = 'idle' | 'reading' | 'ready' | 'saving' | 'done';

/**
 * USFK 휴일표 PDF를 올리면 KATUSA 열이 YES인 휴일을 연휴로 묶어 보여 주고,
 * 고른 연휴를 캘린더 당직 휴일로 추가한다.
 */
export function HolidayImportModal({ isOpen, onClose, events }: HolidayImportModalProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [phase, setPhase] = useState<Phase>('idle');
    const [error, setError] = useState<string | null>(null);
    const [fileName, setFileName] = useState('');
    const [schedule, setSchedule] = useState<ParsedHolidaySchedule | null>(null);
    const [includeAdjacentWeekends, setIncludeAdjacentWeekends] = useState(true);
    const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
    const [checkedOverrides, setCheckedOverrides] = useState<Record<string, boolean>>({});
    const [savedCount, setSavedCount] = useState(0);

    const existingDutyHolidays = useMemo(
        () => events.filter(e => e.type === 'holiday' && e.holidayType === 'duty'),
        [events]
    );

    const runs = useMemo(
        () => (schedule ? groupHolidayRuns(schedule, { includeAdjacentWeekends }) : []),
        [schedule, includeAdjacentWeekends]
    );

    const items = runs.map(run => {
        const key = runKey(run);
        const status: ImportStatus = compareWithExisting(run, existingDutyHolidays);
        const checked = checkedOverrides[key] ?? status.kind === 'new';
        const name = nameOverrides[key] ?? toDisplayHolidayName(run.name);
        return { key, run, status, checked, name };
    });
    const selected = items.filter(item => item.checked && item.name.trim());
    const notes = schedule ? schedule.rows.filter(r => r.correction || r.error) : [];
    const observedCount = schedule ? schedule.rows.filter(r => r.observed).length : 0;

    const reset = () => {
        setPhase('idle');
        setError(null);
        setFileName('');
        setSchedule(null);
        setNameOverrides({});
        setCheckedOverrides({});
        setSavedCount(0);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleClose = () => {
        if (phase === 'saving') return;
        reset();
        onClose();
    };

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        reset();
        setFileName(file.name);
        setPhase('reading');
        try {
            const { extractPdfText } = await import('../../utils/calendar/holiday-pdf.extract');
            const text = await extractPdfText(file);
            const parsed = parseHolidayScheduleText(text);
            if (parsed.rows.length === 0) {
                throw new Error('휴일 행을 찾지 못했습니다. USFK 휴일표 PDF인지 확인하세요.');
            }
            setSchedule(parsed);
            setPhase('ready');
        } catch (e) {
            console.error('Holiday PDF parse error:', e);
            setError(e instanceof Error && e.message ? e.message : 'PDF를 읽지 못했습니다.');
            setPhase('idle');
        }
    };

    const handleSave = async () => {
        if (selected.length === 0 || phase === 'saving') return;
        setPhase('saving');
        setError(null);
        try {
            const batch = writeBatch(db);
            const uid = auth.currentUser?.uid || '';
            selected.forEach(item => {
                batch.set(doc(collection(db, 'schedules')), {
                    uid,
                    type: 'holiday',
                    holidayType: 'duty',
                    startDate: item.run.start,
                    endDate: item.run.end,
                    memo: item.name.trim(),
                    createdAt: serverTimestamp()
                });
            });
            await batch.commit();
            setSavedCount(selected.length);
            setPhase('done');
        } catch (e) {
            console.error('Holiday import save error:', e);
            setError(e instanceof Error && e.message ? e.message : '저장 중 오류가 발생했습니다.');
            setPhase('ready');
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-[2.5rem] p-6 sm:p-8 space-y-4 shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[90vh]">
                <div className="flex items-start justify-between gap-3 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-xl sm:text-2xl font-black text-gray-900">휴일표로 당직 휴일 추가</h2>
                        <p className="text-xs text-gray-500 font-bold mt-1">USFK 휴일표 PDF에서 KATUSA 열이 YES인 휴일을 읽습니다.</p>
                    </div>
                    <button onClick={handleClose} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors shrink-0" aria-label="닫기">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                />

                {error && (
                    <div className="shrink-0 p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2 text-sm text-red-700 font-semibold">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}

                {(phase === 'idle' || phase === 'reading') && (
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={phase === 'reading'}
                        className="shrink-0 w-full py-10 border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center gap-2 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors disabled:opacity-60"
                    >
                        {phase === 'reading' ? (
                            <>
                                <Loader2 className="w-7 h-7 animate-spin" />
                                <span className="text-sm font-bold">{fileName} 읽는 중…</span>
                            </>
                        ) : (
                            <>
                                <FileUp className="w-7 h-7" />
                                <span className="text-sm font-black">휴일표 PDF 선택</span>
                            </>
                        )}
                    </button>
                )}

                {phase === 'done' && (
                    <div className="shrink-0 py-8 flex flex-col items-center gap-3 text-center">
                        <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                            <Check className="w-6 h-6 text-green-600" />
                        </div>
                        <p className="text-base font-black text-gray-900">당직 휴일 {savedCount}개를 추가했습니다.</p>
                        <button onClick={handleClose} className="mt-2 px-6 h-11 rounded-xl bg-gray-900 text-white text-sm font-black">닫기</button>
                    </div>
                )}

                {schedule && (phase === 'ready' || phase === 'saving') && (
                    <>
                        <div className="shrink-0 space-y-2">
                            <p className="text-sm font-bold text-gray-700">
                                {schedule.fiscalYear ? `FY${schedule.fiscalYear} · ` : ''}KATUSA 휴일 {observedCount}일 → 연휴 {runs.length}개
                            </p>
                            <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={includeAdjacentWeekends}
                                    onChange={(e) => setIncludeAdjacentWeekends(e.target.checked)}
                                    className="w-4 h-4 rounded border-gray-300"
                                />
                                앞뒤 주말(토·일)도 연휴에 포함
                            </label>
                        </div>

                        {notes.length > 0 && (
                            <div className="shrink-0 p-3 bg-amber-50 border border-amber-200 rounded-2xl space-y-1">
                                {notes.map(r => (
                                    <p key={r.rawDate + r.name} className={cn('text-xs font-semibold', r.error ? 'text-red-700' : 'text-amber-800')}>
                                        {r.name}: {r.error || r.correction}
                                    </p>
                                ))}
                            </div>
                        )}

                        <div className="overflow-y-auto flex-1 min-h-[160px] space-y-2 pr-1">
                            {items.map(({ key, run, status, checked, name }) => (
                                <div
                                    key={key}
                                    className={cn(
                                        'rounded-2xl border p-3 space-y-2 transition-colors',
                                        checked ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white'
                                    )}
                                >
                                    <div className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => setCheckedOverrides(prev => ({ ...prev, [key]: e.target.checked }))}
                                            className="mt-1 w-4 h-4 rounded border-gray-300 shrink-0"
                                            aria-label={`${name} 추가`}
                                        />
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <input
                                                type="text"
                                                value={name}
                                                onChange={(e) => setNameOverrides(prev => ({ ...prev, [key]: e.target.value }))}
                                                className="w-full text-sm font-black text-gray-900 bg-transparent border-b border-transparent focus:border-blue-400 focus:outline-none"
                                                style={{ fontSize: '16px' }}
                                            />
                                            <p className="text-xs font-bold text-gray-600">
                                                {formatDay(run.start)}{run.end !== run.start ? ` ~ ${formatDay(run.end)}` : ''} · {run.days}일
                                            </p>
                                        </div>
                                    </div>
                                    {status.kind === 'exists' && (
                                        <p className="text-[11px] font-bold text-gray-500">이미 같은 기간의 당직 휴일 '{status.existing.memo}'이 있습니다.</p>
                                    )}
                                    {status.kind === 'overlap' && (
                                        <p className="text-[11px] font-bold text-amber-700">
                                            기존 당직 휴일과 기간이 겹칩니다: {status.existing.map(e => `'${e.memo}' ${formatDay(e.startDate)}~${formatDay(e.endDate || e.startDate)}`).join(', ')}
                                        </p>
                                    )}
                                    <p className="text-[11px] text-gray-400 leading-snug">
                                        {run.rows.map(r => `${formatDay(r.iso)} ${r.name}`).join(' · ')}
                                    </p>
                                </div>
                            ))}
                        </div>

                        <div className="shrink-0 flex items-center gap-2 pt-1">
                            <button
                                type="button"
                                onClick={() => {
                                    reset();
                                    fileInputRef.current?.click();
                                }}
                                disabled={phase === 'saving'}
                                className="px-4 h-11 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                            >
                                다른 파일
                            </button>
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={selected.length === 0 || phase === 'saving'}
                                className="flex-1 h-11 flex items-center justify-center gap-2 text-sm font-black text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-40 transition-colors"
                            >
                                {phase === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
                                선택한 {selected.length}개 당직 휴일 추가
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}
