import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Save, AlertCircle, Check, Loader2, Calendar, PenLine, ChevronLeft, ChevronRight } from 'lucide-react';
import { doc, getDocs, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import axios from 'axios';
import { db } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import type { MovementRecord } from '../../types/movement/movement.type';
import { formatMDToISO, extractPureMemberName } from '../../utils/movement.utils';
import { useMovementSettings } from '../../hooks/movement/useMovementSettings';
import {
    getMemberSectionKeys,
    getPassReasonOptions,
    getVacationReasonOptions,
    matchReasonOption,
    composePassReason,
    composeVacationReason,
    normalizeBatch,
    normalizeRewardKind,
    getBatchType,
    getBatchOptions,
    findWeekendInRange,
    REWARD_VACATION,
    REWARD_VACATION_KINDS
} from '../../utils/movement/movement.reason-options';
import {
    validateMovementEdit,
    hasBlockingIssue,
    getFieldIssues,
    countDaysInclusive,
    addDaysIso,
    formatIsoShort,
    type EditField,
    type EditIssue,
    type ExistingMovement
} from '../../utils/movement/movement.edit-validation';
import {
    splitMemberDocs,
    findRun,
    findRunStartingInWindow,
    eachIsoDate,
    inRange,
    isoToMD,
    passOccupiedRange,
    computeEditedDayStatuses,
    buildCellUpdates,
    type DateRange,
    type StatusContext
} from '../../utils/movement/movement.edit-period';

/** 잔디에서 외박/휴가 구간을 이어 붙일 때 쓰는 상태 ('linked' = 외박 복귀일이자 휴가 출발일) */
const PASS_RUN_STATUSES = new Set(['pass', 'linked']);
const VACATION_RUN_STATUSES = new Set(['vacation', 'linked', 'vacation-pass-depart']);

interface MovementEditPageProps {
    memberName: string; // e.g. "이재영" (cleanName)
    fullNameWithRank: string; // e.g. "이재영 병장"
    /** 화면 상단에 보여 줄 섹션 이름 (예: 'KTA', 'HQ S-3') */
    sectionLabel?: string;
    /** 인원의 섹션 목록과 역할 (외박 사유 버튼을 고르는 데 사용) */
    memberSections?: string[];
    memberRole?: string;
    /** 앞뒤 기간으로 이동 (없으면 버튼 비활성) */
    onPrevWeek?: () => void;
    onNextWeek?: () => void;
    /** 캘린더 당직 일정 — 타임라인 밖 날짜의 당직도 겹침 검사에 쓴다 */
    dutySchedules?: any[];
    timeline: string[]; // e.g. ['9.30', '10.1', '10.2', ..., '10.9']
    initialDayStatuses: Record<string, string>;
    movements: MovementRecord[];
    baseDate?: Date;
    sheetWeeks?: any[];
    onClose: () => void;
    onSaveSuccess?: (updatedStatuses: Record<string, string>, savedMovement?: any) => void;
}

type Accent = 'blue' | 'orange';

const ACCENT = {
    blue: {
        ring: 'focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500',
        selected: 'bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-200',
        idle: 'bg-white border-gray-300 text-gray-700 hover:border-blue-400 hover:text-blue-700',
        toggleOn: 'bg-blue-600',
        badge: 'text-blue-700 bg-blue-50 border-blue-200',
        input: 'focus:ring-blue-500',
    },
    orange: {
        ring: 'focus-within:ring-2 focus-within:ring-orange-500 focus-within:border-orange-500',
        selected: 'bg-orange-500 border-orange-500 text-white shadow-sm shadow-orange-200',
        idle: 'bg-white border-gray-300 text-gray-700 hover:border-orange-400 hover:text-orange-700',
        toggleOn: 'bg-orange-500',
        badge: 'text-orange-700 bg-orange-50 border-orange-200',
        input: 'focus:ring-orange-500',
    },
} as const;

const fieldDomId = (field: EditField) => `movement-edit-${field}`;

/** 문구는 문제의 첫 번째 항목 아래에만 쓰고, 나머지 관련 항목은 테두리 색으로만 표시한다. */
function IssueText({ field, issues }: { field: EditField; issues: EditIssue[] }) {
    const own = issues.filter(issue => issue.fields[0] === field);
    if (own.length === 0) return null;
    return (
        <div className="mt-1.5 space-y-0.5">
            {own.map(issue => (
                <p
                    key={issue.code}
                    className={cn(
                        'text-[11px] sm:text-xs font-semibold leading-snug',
                        issue.severity === 'error' ? 'text-red-600' : 'text-amber-700'
                    )}
                >
                    {issue.message}
                </p>
            ))}
        </div>
    );
}

function issueTone(issues: EditIssue[]): 'error' | 'warning' | null {
    if (issues.some(i => i.severity === 'error')) return 'error';
    if (issues.length > 0) return 'warning';
    return null;
}

interface DateFieldProps {
    field: EditField;
    label: string;
    value: string;
    onChange: (value: string) => void;
    accent: Accent;
    issues: EditIssue[];
}

function DateField({ field, label, value, onChange, accent, issues }: DateFieldProps) {
    const tone = issueTone(issues);
    const formatDateDisplay = (isoStr: string) => {
        if (!isoStr) return '날짜 선택';
        const parts = isoStr.split('-');
        if (parts.length === 3) {
            const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            const dayKo = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
            return `${parseInt(parts[1], 10)}월 ${parseInt(parts[2], 10)}일 (${dayKo})`;
        }
        return isoStr;
    };

    return (
        <div id={fieldDomId(field)} className="min-w-0" data-invalid={tone === 'error' || undefined}>
            <label className={cn(
                'text-xs font-bold block mb-1.5',
                tone === 'error' ? 'text-red-600' : 'text-gray-600'
            )}>
                {label}
            </label>
            <div className={cn(
                'relative flex items-center justify-between w-full min-w-0 overflow-hidden px-3 py-2.5 bg-white border rounded-xl transition-all shadow-sm',
                tone === 'error'
                    ? 'border-red-500 bg-red-50 ring-2 ring-red-200'
                    : tone === 'warning'
                        ? 'border-amber-400 bg-amber-50'
                        : cn('border-gray-300', ACCENT[accent].ring)
            )}>
                <span className={cn(
                    'text-sm font-semibold truncate pointer-events-none select-none',
                    value ? (tone === 'error' ? 'text-red-700' : 'text-gray-900') : 'text-gray-400'
                )}>
                    {formatDateDisplay(value)}
                </span>
                <Calendar className={cn('w-4 h-4 shrink-0 ml-1 pointer-events-none', tone === 'error' ? 'text-red-400' : 'text-gray-400')} />
                <input
                    type="date"
                    value={value}
                    aria-invalid={tone === 'error'}
                    onChange={(e) => onChange(e.target.value)}
                    onClick={(e) => {
                        try {
                            e.currentTarget.showPicker?.();
                        } catch { /* showPicker 미지원 브라우저 */ }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0 p-0 border-0"
                    style={{ fontSize: '16px' }}
                />
            </div>
            <IssueText field={field} issues={issues} />
        </div>
    );
}

/**
 * 사유 선택 상태: 버튼 하나(option) 또는 직접 입력(custom).
 * 버튼에 따라 세부값(detail)을 더 고른다 — 외박 수료/DBIDS는 기수, 휴가 포상휴가는 종류. 세부값도 직접 입력할 수 있다.
 */
interface ReasonChoice {
    option: string | null;
    detail: string | null;
    detailCustom: boolean;
    custom: string;
    customActive: boolean;
}

const EMPTY_CHOICE: ReasonChoice = { option: null, detail: null, detailCustom: false, custom: '', customActive: false };

/** 저장된 사유를 선택 상태로 바꾼다 ('일반 투데이' → 버튼 '일반', 버튼으로 만들 수 없으면 직접 입력) */
function choiceFromReason(reason: string, options: string[]): ReasonChoice {
    const trimmed = (reason || '').trim();
    if (!trimmed) return EMPTY_CHOICE;
    const match = matchReasonOption(trimmed, options);
    return match
        ? { ...EMPTY_CHOICE, option: match.option, detail: match.detail }
        : { ...EMPTY_CHOICE, custom: trimmed, customActive: true };
}

/** 저장할 사유 문자열: 외박 버튼은 '이름(+기수) N데이', 휴가 버튼은 '(종류) 이름 N일', 직접 입력은 입력값 그대로 */
function reasonFromChoice(choice: ReasonChoice, days: number, kind: 'pass' | 'vacation'): string {
    if (choice.option) {
        return kind === 'pass'
            ? composePassReason(choice.option, choice.detail, days)
            : composeVacationReason(choice.option, choice.detail, days);
    }
    return choice.customActive ? choice.custom.trim() : '';
}

/** 고른 버튼에 딸린 세부값 선택 (기수, 포상휴가 종류) */
interface DetailConfig {
    label: string;
    options: string[];
    /** 버튼에 보일 글자 (예: '01-27' → '01-27기') */
    format: (value: string) => string;
    placeholder: string;
    /** 고를 버튼이 없을 때 안내 */
    emptyHint?: string;
}

interface ReasonPickerProps {
    field: EditField;
    options: string[];
    choice: ReasonChoice;
    onChoiceChange: (choice: ReasonChoice) => void;
    /** 저장될 사유 (버튼 선택 시 미리보기) */
    preview: string;
    /** 고른 버튼이 세부값을 필요로 할 때 (필요 없으면 null) */
    detail: DetailConfig | null;
    accent: Accent;
    customPlaceholder: string;
    issues: EditIssue[];
}

/** 자주 쓰는 사유는 버튼으로(일수는 기간으로 자동), 그 밖의 사유는 '직접 입력'으로 받는다. */
function ReasonPicker({ field, options, choice, onChoiceChange, preview, detail, accent, customPlaceholder, issues }: ReasonPickerProps) {
    const tone = issueTone(issues);
    // 목록에서 빠진 버튼(예: 다른 기간의 휴일 이름)도 선택된 채로 보여 준다
    const shownOptions = choice.option && !options.includes(choice.option) ? [...options, choice.option] : options;
    // 저장돼 있던 세부값이 지금 목록에 없으면 버튼으로 함께 보여 준다
    const detailOptions = detail
        ? (choice.detail && !choice.detailCustom && !detail.options.includes(choice.detail) ? [...detail.options, choice.detail] : detail.options)
        : [];
    const chipClass = (selected: boolean, dashed = false) => cn(
        'min-h-[40px] px-3.5 py-2 rounded-xl border text-sm font-bold transition-all active:scale-95',
        dashed && 'border-dashed flex items-center gap-1.5',
        selected ? ACCENT[accent].selected : ACCENT[accent].idle
    );
    const inputClass = cn(
        'mt-3 w-full text-sm px-3 py-2.5 bg-white border rounded-xl focus:outline-none focus:ring-2',
        tone === 'error' ? 'border-red-500 bg-red-50 focus:ring-red-300' : cn('border-gray-300', ACCENT[accent].input)
    );

    return (
        <div id={fieldDomId(field)} data-invalid={tone === 'error' || undefined}>
            <span className={cn('block text-xs font-bold mb-1.5', tone === 'error' ? 'text-red-600' : 'text-gray-600')}>사유</span>
            <div className={cn(
                'flex flex-wrap gap-2 rounded-xl transition-all',
                tone === 'error' && 'p-2 bg-red-50 ring-2 ring-red-300',
                tone === 'warning' && 'p-2 bg-amber-50 ring-1 ring-amber-300'
            )}>
                {shownOptions.map(option => (
                    <button
                        key={option}
                        type="button"
                        aria-pressed={choice.option === option}
                        // 다른 버튼으로 바꾸면 세부값은 다시 고른다
                        onClick={() => onChoiceChange(choice.option === option
                            ? choice
                            : { ...EMPTY_CHOICE, option, custom: choice.custom })}
                        className={chipClass(choice.option === option)}
                    >
                        {option}
                    </button>
                ))}
                <button
                    type="button"
                    aria-pressed={choice.customActive}
                    onClick={() => onChoiceChange({ ...EMPTY_CHOICE, custom: choice.custom, customActive: true })}
                    className={chipClass(choice.customActive, true)}
                >
                    <PenLine className="w-3.5 h-3.5" />
                    직접 입력
                </button>
            </div>

            {detail && choice.option && (
                <div className="mt-3">
                    <span className="block text-xs font-bold text-gray-600 mb-1.5">{detail.label}</span>
                    <div className="flex flex-wrap gap-2">
                        {detailOptions.map(value => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={!choice.detailCustom && choice.detail === value}
                                onClick={() => onChoiceChange({ ...choice, detail: value, detailCustom: false })}
                                className={chipClass(!choice.detailCustom && choice.detail === value)}
                            >
                                {detail.format(value)}
                            </button>
                        ))}
                        <button
                            type="button"
                            aria-pressed={choice.detailCustom}
                            onClick={() => onChoiceChange({ ...choice, detail: choice.detailCustom ? choice.detail : '', detailCustom: true })}
                            className={chipClass(choice.detailCustom, true)}
                        >
                            <PenLine className="w-3.5 h-3.5" />
                            직접 입력
                        </button>
                    </div>
                    {detailOptions.length === 0 && detail.emptyHint && !choice.detailCustom && (
                        <p className="mt-2 text-xs text-gray-500">{detail.emptyHint}</p>
                    )}
                    {choice.detailCustom && (
                        <input
                            type="text"
                            autoFocus={!choice.detail}
                            value={choice.detail || ''}
                            placeholder={detail.placeholder}
                            onChange={(e) => onChoiceChange({ ...choice, detail: e.target.value, detailCustom: true })}
                            className={inputClass}
                            style={{ fontSize: '16px' }}
                        />
                    )}
                </div>
            )}

            {choice.customActive && (
                <input
                    type="text"
                    autoFocus={!choice.custom}
                    value={choice.custom}
                    placeholder={customPlaceholder}
                    aria-invalid={tone === 'error'}
                    onChange={(e) => onChoiceChange({ ...EMPTY_CHOICE, custom: e.target.value, customActive: true })}
                    className={inputClass}
                    style={{ fontSize: '16px' }}
                />
            )}
            {choice.option && (
                <p className="mt-2 text-xs text-gray-500">
                    저장될 사유: <span className="font-bold text-gray-800">{preview}</span>
                </p>
            )}
            <IssueText field={field} issues={issues} />
        </div>
    );
}

interface MovementSectionProps {
    title: string;
    accent: Accent;
    enabled: boolean;
    onToggle: (enabled: boolean) => void;
    startField: EditField;
    endField: EditField;
    reasonField: EditField;
    startLabel: string;
    endLabel: string;
    start: string;
    end: string;
    reasonChoice: ReasonChoice;
    reasonPreview: string;
    onStartChange: (v: string) => void;
    onEndChange: (v: string) => void;
    onReasonChoiceChange: (choice: ReasonChoice) => void;
    options: string[];
    detail?: DetailConfig | null;
    customPlaceholder: string;
    issues: EditIssue[];
    footer?: ReactNode;
    /** 켜짐/꺼짐과 관계없이 항상 보여 줄 안내 (예: 다른 기간 휴가) */
    note?: ReactNode;
}

function MovementSection({
    title, accent, enabled, onToggle,
    startField, endField, reasonField, startLabel, endLabel,
    start, end, reasonChoice, reasonPreview, onStartChange, onEndChange, onReasonChoiceChange,
    options, detail = null, customPlaceholder, issues, footer, note
}: MovementSectionProps) {
    const sectionIssues = issues.filter(i => i.fields.some(f => f === startField || f === endField || f === reasonField));
    const tone = issueTone(sectionIssues);
    const days = start && end && start <= end ? countDaysInclusive(start, end) : 0;

    return (
        <section className={cn(
            'bg-white border rounded-2xl shadow-sm transition-colors',
            tone === 'error' ? 'border-red-400 ring-1 ring-red-200' : tone === 'warning' ? 'border-amber-300' : 'border-gray-200'
        )}>
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-gray-100">
                <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-base font-black text-gray-900">{title}</h3>
                    {enabled && days > 0 && (
                        <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', ACCENT[accent].badge)}>
                            {days}일
                        </span>
                    )}
                    {tone === 'error' && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => onToggle(!enabled)}
                    className="flex items-center gap-2 shrink-0"
                >
                    <span className={cn('text-xs font-bold', enabled ? 'text-gray-900' : 'text-gray-400')}>
                        {enabled ? '있음' : '없음'}
                    </span>
                    <span className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        enabled ? ACCENT[accent].toggleOn : 'bg-gray-200'
                    )}>
                        <span className={cn(
                            'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
                            enabled ? 'translate-x-5' : 'translate-x-0.5'
                        )} />
                    </span>
                </button>
            </div>

            {enabled ? (
                <div className="px-4 sm:px-5 py-4 space-y-5">
                    <div className="grid grid-cols-2 gap-3">
                        <DateField
                            field={startField}
                            label={startLabel}
                            value={start}
                            onChange={onStartChange}
                            accent={accent}
                            issues={getFieldIssues(issues, startField)}
                        />
                        <DateField
                            field={endField}
                            label={endLabel}
                            value={end}
                            onChange={onEndChange}
                            accent={accent}
                            issues={getFieldIssues(issues, endField)}
                        />
                    </div>
                    <ReasonPicker
                        field={reasonField}
                        options={options}
                        choice={reasonChoice}
                        onChoiceChange={onReasonChoiceChange}
                        preview={reasonPreview}
                        detail={detail}
                        accent={accent}
                        customPlaceholder={customPlaceholder}
                        issues={getFieldIssues(issues, reasonField)}
                    />
                    {footer}
                </div>
            ) : (
                <p className="px-4 sm:px-5 py-4 text-sm text-gray-400">이번 주 {title} 없음</p>
            )}
            {note && <div className="px-4 sm:px-5 pb-4">{note}</div>}
        </section>
    );
}

function GrassPreview({ timeline, dayStatuses, currentYear }: { timeline: string[]; dayStatuses: Record<string, string>; currentYear: number }) {
    return (
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="font-black text-sm text-gray-900">주간 출타 잔디</h3>
                <span className="text-[11px] font-semibold text-gray-400">입력값 기준 미리보기</span>
            </div>
            <div className="flex items-center justify-between gap-1 w-full">
                {timeline.map((dateStr) => {
                    const status = dayStatuses[dateStr] || 'none';
                    const [m, d] = dateStr.split('.').map(Number);
                    const dateObj = new Date(currentYear, m - 1, d, 12, 0, 0, 0);
                    const isWeekend = dateObj.getDay() % 6 === 0;
                    const isSunday = dateObj.getDay() === 0;

                    return (
                        <div key={dateStr} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                            <span className={cn(
                                'text-[9px] sm:text-[10px] font-extrabold leading-none truncate tracking-tight',
                                isSunday ? 'text-red-500' : isWeekend ? 'text-blue-600' : 'text-gray-400'
                            )}>
                                {dateStr}
                            </span>
                            <div
                                className={cn(
                                    'w-5 h-5 sm:w-6 sm:h-6 rounded-sm transition-all duration-200',
                                    status === 'none' && 'bg-gray-100',
                                    status === 'pass' && 'bg-blue-500',
                                    status === 'vacation' && 'bg-orange-500',
                                    status === 'duty' && 'bg-red-500',
                                    status === 'recovery' && 'bg-yellow-400',
                                    isWeekend && 'border-2 border-black'
                                )}
                                style={
                                    status === 'linked' ? { background: 'linear-gradient(135deg, #3b82f6 50%, #f97316 50%)' }
                                        : status === 'vacation-pass-depart' ? { background: 'linear-gradient(135deg, #f97316 50%, #3b82f6 50%)' }
                                            : status === 'pass-depart' ? { background: 'linear-gradient(135deg, #f3f4f6 50%, #3b82f6 50%)' }
                                                : status === 'recovery-pass-depart' ? { background: 'linear-gradient(135deg, #facc15 50%, #3b82f6 50%)' }
                                                    : undefined
                                }
                            />
                        </div>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />외박</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500" />휴가</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" />당직</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-yellow-400" />리커버리</span>
            </div>
        </section>
    );
}

const stripLinkTag = (reason: string) => reason.replace(/,?\s*외휴연계\s*[OX]?/gi, '').trim();

export function MovementEditPage({
    memberName,
    fullNameWithRank,
    sectionLabel,
    memberSections = [],
    memberRole = '',
    onPrevWeek,
    onNextWeek,
    dutySchedules = [],
    timeline,
    initialDayStatuses,
    movements,
    baseDate,
    sheetWeeks = [],
    onClose,
    onSaveSuccess
}: MovementEditPageProps) {
    const { allowVacationPassLink } = useMovementSettings();
    const currentYear = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

    // Prevent body scrolling behind the full-screen page
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
        };
    }, []);

    const refMonth = parseInt((timeline[0] || '1.1').split('.')[0], 10);
    const coreTimeline = useMemo(() => timeline.slice(0, 7), [timeline]); // Wed ~ Tue (7 days)
    const coreStartIso = formatMDToISO(coreTimeline[0] || '1.1', currentYear, refMonth);
    const coreEndIso = formatMDToISO(coreTimeline[coreTimeline.length - 1] || '1.1', currentYear, refMonth);
    const periodStartIso = formatMDToISO(timeline[0] || '1.1', currentYear, refMonth);
    const periodEndIso = formatMDToISO(timeline[timeline.length - 1] || '1.1', currentYear, refMonth);

    // Clean name without rank (e.g. "차희원")
    const cleanName = memberName.replace(/\s*(병장|상병|일병|이병)/g, '').trim();

    const findSheetRow = (week: any) =>
        week.data && Array.isArray(week.data)
            ? week.data.find((r: any) => r.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim() === cleanName)
            : null;

    const periodWindow = useMemo(() => ({ coreStart: coreStartIso, coreEnd: coreEndIso }), [coreStartIso, coreEndIso]);
    const timelineIso = timeline.map(md => ({ md, iso: formatMDToISO(md, currentYear, refMonth) }));

    // 날짜별 잔디 상태: 이번 타임라인은 initialDayStatuses, 그 밖의 날짜는 시트의 다른 주차 행에서 찾는다
    const statusOnIso = (iso: string): string => {
        const md = isoToMD(iso);
        if (initialDayStatuses[md] !== undefined) return initialDayStatuses[md];
        for (const week of sheetWeeks) {
            const st = findSheetRow(week)?.dayStatuses?.[md];
            if (st !== undefined) return st;
        }
        return 'none';
    };
    // 당직: 캘린더 당직 일정(우선) + 시트/잔디의 '당직' 칸
    const calendarDutyIsoDates = new Set(
        dutySchedules
            .filter((s: any) => (s.type === 'duty' || !s.type) && s.startDate && extractPureMemberName(s.memo) === cleanName)
            .map((s: any) => s.startDate as string)
    );
    const isDutyOn = (iso: string) => calendarDutyIsoDates.has(iso) || statusOnIso(iso) === 'duty';
    const isPassStatus = (iso: string) => PASS_RUN_STATUSES.has(statusOnIso(iso));
    const isVacStatus = (iso: string) => VACATION_RUN_STATUSES.has(statusOnIso(iso));

    // 이번 기간이 가진 기록: DB 기록 우선, 없으면 핵심 구간(수~화) 안에서 시작하는 잔디 구간으로 추정.
    // 이전 기간에 시작해 이어지는 휴가나 다음 기간 휴가는 여기서 편집하지 않는다.
    const memberDocs = movements.filter(m => m.name === cleanName);
    const split = splitMemberDocs(memberDocs, periodWindow);
    const ownPassRange: DateRange | null = split.ownPass
        ? { start: split.ownPass.startDate, end: split.ownPass.endDate }
        : findRunStartingInWindow(periodWindow, isPassStatus);
    const ownVacRange: DateRange | null = split.ownVac
        ? { start: split.ownVac.startDate, end: split.ownVac.endDate }
        : findRunStartingInWindow(periodWindow, isVacStatus);

    // 편집 전 이번 기간 기록이 차지하던 날 (외박 출발일 포함). 시트 잔디가 DB보다 길게 남아 있으면 그 부분도 포함.
    const ownedDateSet = new Set<string>();
    const addRange = (r: DateRange | null) => {
        if (r) eachIsoDate(r.start, r.end).forEach(d => ownedDateSet.add(d));
    };
    if (ownPassRange) {
        addRange(passOccupiedRange(ownPassRange));
        const run = findRun(ownPassRange.start, isPassStatus);
        if (run && run.start >= periodWindow.coreStart) addRange(run);
    }
    if (ownVacRange) {
        addRange(ownVacRange);
        const run = findRun(ownVacRange.start, isVacStatus);
        if (run && run.start >= periodWindow.coreStart) addRange(run);
    }
    const ownedOriginalDates = [...ownedDateSet].sort();

    // 다른 기간 기록 (그대로 둔다). DB에 없이 시트 잔디에만 있는 다른 기간 휴가도 포함.
    const toRange = (d: MovementRecord): DateRange => ({ start: d.startDate, end: d.endDate });
    const retainedVacations: DateRange[] = split.retainedDocs.filter(d => d.type === 'vacation').map(toRange);
    const retainedPasses: DateRange[] = split.retainedDocs.filter(d => d.type === 'pass' || d.type === 'stay').map(toRange);
    timelineIso.forEach(({ iso }) => {
        if (!isVacStatus(iso) || ownedDateSet.has(iso)) return;
        if (retainedVacations.some(v => inRange(iso, v))) return;
        const run = findRun(iso, isVacStatus);
        // DB 기록과 겹치는 시트 잔디(같은 휴가가 DB와 조금 다르게 남은 것)는 따로 세지 않는다
        if (run && !retainedVacations.some(v => v.start <= run.end && run.start <= v.end)) retainedVacations.push(run);
    });
    const otherPeriodVacations = retainedVacations
        .filter(v => v.start <= periodEndIso && v.end >= periodStartIso)
        .sort((a, b) => a.start.localeCompare(b.start));

    // 사유 버튼
    // - 외박: 일반 → Staff Duty → 상단 기간(타임라인)에 완전히 들어가는 당직 휴일 → 섹션별 → 생일 → KOM
    // - 휴가: 연가, 포상휴가(종류 선택)
    const sectionKeys = getMemberSectionKeys(memberSections, memberRole);
    const periodHolidays = dutySchedules
        .filter((s: any) => s.type === 'holiday' && s.holidayType === 'duty' && s.startDate
            && s.startDate >= periodStartIso && (s.endDate || s.startDate) <= periodEndIso)
        .map((s: any) => ({ name: (s.memo || '').trim() as string, start: s.startDate as string, end: (s.endDate || s.startDate) as string }))
        .filter(h => h.name);
    const passOptions = getPassReasonOptions(sectionKeys, periodHolidays.map(h => h.name));
    const vacationOptions = getVacationReasonOptions();
    const periodWeekend = findWeekendInRange(eachIsoDate(coreStartIso, coreEndIso));

    // 이번 기간에 입력된 외박·휴가가 없으면 외박을 '있음'으로 연다.
    // 다른 기간에서 이어지는 휴가(안내만 보이는 것)는 이번 기간 기록이 아니므로 여기서 세지 않는다.
    const isEmptyPeriod = !ownPassRange && !ownVacRange;
    const [hasPass, setHasPass] = useState<boolean>(!!ownPassRange || isEmptyPeriod);
    const [passStart, setPassStart] = useState<string>(ownPassRange?.start || '');
    const [passEnd, setPassEnd] = useState<string>(ownPassRange?.end || '');
    const [passChoice, setPassChoice] = useState<ReasonChoice>(() => choiceFromReason(split.ownPass?.reason || '', passOptions));

    const [hasVacation, setHasVacation] = useState<boolean>(!!ownVacRange);
    const [vacationStart, setVacationStart] = useState<string>(ownVacRange?.start || '');
    const [vacationEnd, setVacationEnd] = useState<string>(ownVacRange?.end || '');
    const [vacationChoice, setVacationChoice] = useState<ReasonChoice>(() =>
        choiceFromReason(stripLinkTag(split.ownVac?.reason || ''), vacationOptions)
    );

    // 외박 사유 버튼을 고르면: '일반'은 이번 기간 주말(토~일), 당직 휴일은 저장된 그 휴일 기간을 외박 날짜로 채운다
    const handlePassChoiceChange = (next: ReasonChoice) => {
        if (next.option && next.option !== passChoice.option) {
            const holiday = periodHolidays.find(h => h.name === next.option);
            const range = holiday
                ? { start: holiday.start, end: holiday.end }
                : next.option === '일반' ? periodWeekend : null;
            if (range) {
                setPassStart(range.start);
                setPassEnd(range.end);
            }
        }
        setPassChoice(next);
    };

    // 버튼으로 고른 사유는 기간을 세어 일수를 붙인다: 외박 'N데이'(원데이~파이브데이), 휴가 'N일'. 직접 입력은 그대로 — 저장 시 검증.
    const passDays = passStart && passEnd && passStart <= passEnd ? countDaysInclusive(passStart, passEnd) : 0;
    const vacationDays = vacationStart && vacationEnd && vacationStart <= vacationEnd ? countDaysInclusive(vacationStart, vacationEnd) : 0;
    const passReason = reasonFromChoice(passChoice, passDays, 'pass');
    const vacationReason = reasonFromChoice(vacationChoice, vacationDays, 'vacation');

    // 수료·DBIDS는 기수를 고른다 (외박 출발일 기준 6개월 안에 Day 0이 있는 기수, 또는 직접 입력)
    const passBatchType = getBatchType(passChoice.option);
    const passDepartIso = passStart ? addDaysIso(passStart, -1) : coreStartIso;
    const passDetail: DetailConfig | null = passBatchType ? {
        label: '기수',
        options: getBatchOptions(dutySchedules, passBatchType, passDepartIso),
        format: (batch) => `${batch}기`,
        placeholder: '기수 입력 (예: 01-27)',
        emptyHint: '외박 출발일 기준 6개월 안에 시작한 기수가 캘린더에 없습니다. 직접 입력하세요.'
    } : null;
    const passBatchMissing = !!passBatchType && !normalizeBatch(passChoice.detail);

    // 포상휴가는 종류를 고른다 (교육유공, 모범카투사, 선임병장, 또는 직접 입력) → '교육유공 포상휴가'
    const vacationDetail: DetailConfig | null = vacationChoice.option === REWARD_VACATION ? {
        label: '포상휴가 종류',
        options: REWARD_VACATION_KINDS,
        format: (kind) => kind,
        placeholder: '포상휴가 종류 입력 (예: 골든타이거)'
    } : null;
    const vacationKindMissing = vacationChoice.option === REWARD_VACATION && !normalizeRewardKind(vacationChoice.detail);

    // 저장하지 않은 변경이 있으면 다른 기간으로 넘어가기 전에 확인한다
    const formSnapshot = JSON.stringify([hasPass, passStart, passEnd, passReason, hasVacation, vacationStart, vacationEnd, vacationReason]);
    const [initialSnapshot] = useState(formSnapshot);
    const handleNavigate = (go?: () => void) => {
        if (!go || savingRef.current) return;
        if (formSnapshot !== initialSnapshot && !window.confirm('저장하지 않은 변경이 있습니다. 다른 기간으로 이동할까요?')) return;
        go();
    };

    // Automatically calculate isLinked: true only if pass end date matches vacation start date
    const isLinked = !!(hasPass && hasVacation && passEnd && vacationStart && passEnd === vacationStart);

    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    // 저장을 한 번 누른 뒤부터 입력이 바뀔 때마다 다시 검증해 강조를 갱신한다.
    const [validationActive, setValidationActive] = useState(false);
    // 경고만 있을 때는 한 번 보여 주고, 같은 경고 상태에서 다시 누르면 저장한다.
    const [confirmedWarningKey, setConfirmedWarningKey] = useState('');

    // 입력값 기준 잔디 상태 (원래 이번 기간 것이던 날은 핵심 구간 밖이라도 새 값이 없으면 비운다)
    const statusContext: StatusContext = {
        hasPass,
        passStart,
        passEnd,
        hasVacation,
        vacationStart,
        vacationEnd,
        ownedOriginalDates,
        retainedVacations,
        retainedPasses,
        isDutyOn
    };
    const dayStatuses = computeEditedDayStatuses(timelineIso, initialDayStatuses, statusContext);

    const runValidation = (): EditIssue[] => {
        // 이번 저장으로 바뀌지 않는 다른 기간 기록과 겹치는지 본다 (시트에만 있는 다른 기간 휴가 포함)
        const otherMovements: ExistingMovement[] = [
            ...split.retainedDocs,
            ...retainedVacations
                .filter(v => !split.retainedDocs.some(d => d.type === 'vacation' && d.startDate <= v.end && v.start <= d.endDate))
                .map(v => ({ type: 'vacation' as const, startDate: v.start, endDate: v.end }))
        ];

        // 입력된 기간 안의 당직 날짜
        const ranges: DateRange[] = [];
        if (hasPass && passStart && passEnd && passStart <= passEnd) ranges.push({ start: passStart, end: passEnd });
        if (hasVacation && vacationStart && vacationEnd && vacationStart <= vacationEnd) ranges.push({ start: vacationStart, end: vacationEnd });
        const dutyIsoDates = ranges.flatMap(r => eachIsoDate(r.start, r.end)).filter(isDutyOn);

        return validateMovementEdit({
            hasPass,
            passStart,
            passEnd,
            passReason,
            passBatchMissing,
            hasVacation,
            vacationStart,
            vacationEnd,
            vacationReason,
            vacationKindMissing,
            allowVacationPassLink,
            dutyIsoDates,
            otherMovements
        });
    };

    const issues = validationActive ? runValidation() : [];
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningIssues = issues.filter(i => i.severity === 'warning');
    const warningKey = warningIssues.map(i => `${i.code}:${i.message}`).join('|');
    const awaitingWarningConfirm = validationActive && errorCount === 0 && warningIssues.length > 0 && warningKey !== confirmedWarningKey;

    const scrollToFirstIssue = (list: EditIssue[]) => {
        const first = list.find(i => i.severity === 'error') || list[0];
        if (!first) return;
        requestAnimationFrame(() => {
            document.getElementById(fieldDomId(first.fields[0]))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    };

    // Save changes to Firestore and Google Spreadsheet
    const handleSave = async () => {
        // 저장 중에 버튼을 다시 눌러도 한 번만 처리 (state 갱신 전 연속 클릭 방지)
        if (savingRef.current) return;
        setSaveError(null);
        setSuccessMessage(null);

        const currentIssues = runValidation();
        setValidationActive(true);

        if (hasBlockingIssue(currentIssues)) {
            scrollToFirstIssue(currentIssues);
            return;
        }
        const currentWarningKey = currentIssues
            .filter(i => i.severity === 'warning')
            .map(i => `${i.code}:${i.message}`)
            .join('|');
        if (currentWarningKey && currentWarningKey !== confirmedWarningKey) {
            setConfirmedWarningKey(currentWarningKey);
            scrollToFirstIssue(currentIssues);
            return;
        }

        savingRef.current = true;
        setSaving(true);

        try {
            // 1. Update Firestore movements
            const snapExisting = await getDocs(query(collection(db, 'movements'), where('name', '==', cleanName)));
            const existingDocs = snapExisting.docs.map(d => ({ id: d.id, ...d.data() } as any));
            // 이번 기간이 가진 문서만 덮어쓰거나 지운다 (다른 기간 휴가/외박은 건드리지 않음)
            const savedSplit = splitMemberDocs(existingDocs, periodWindow);
            const periodPassDocs = savedSplit.ownPassDocs;
            const targetPassDoc = savedSplit.ownPass;
            const periodVacDocs = savedSplit.ownVacDocs;
            const targetVacDoc = savedSplit.ownVac;

            const batch = writeBatch(db);
            const finalPassReason = passReason.trim();
            const finalVacReason = vacationReason.trim();

            if (hasPass && passStart && passEnd) {
                if (targetPassDoc) {
                    batch.update(doc(db, 'movements', targetPassDoc.id), {
                        startDate: passStart,
                        endDate: passEnd,
                        reason: finalPassReason,
                        updatedAt: serverTimestamp()
                    });
                } else {
                    batch.set(doc(collection(db, 'movements')), {
                        name: cleanName,
                        type: 'pass',
                        startDate: passStart,
                        endDate: passEnd,
                        reason: finalPassReason,
                        createdAt: serverTimestamp()
                    });
                }
                // Clean up any extra duplicate pass docs for this period from previous bugs
                periodPassDocs.forEach(d => {
                    if (targetPassDoc && d.id !== targetPassDoc.id) batch.delete(doc(db, 'movements', d.id));
                });
            } else {
                periodPassDocs.forEach(d => batch.delete(doc(db, 'movements', d.id)));
            }

            if (hasVacation && vacationStart && vacationEnd) {
                if (targetVacDoc) {
                    batch.update(doc(db, 'movements', targetVacDoc.id), {
                        startDate: vacationStart,
                        endDate: vacationEnd,
                        reason: finalVacReason,
                        updatedAt: serverTimestamp()
                    });
                } else {
                    batch.set(doc(collection(db, 'movements')), {
                        name: cleanName,
                        type: 'vacation',
                        startDate: vacationStart,
                        endDate: vacationEnd,
                        reason: finalVacReason,
                        createdAt: serverTimestamp()
                    });
                }
                // Clean up any extra duplicate vacation docs for this period
                periodVacDocs.forEach(d => {
                    if (!targetVacDoc || d.id !== targetVacDoc.id) batch.delete(doc(db, 'movements', d.id));
                });
            } else {
                periodVacDocs.forEach(d => batch.delete(doc(db, 'movements', d.id)));
            }

            await batch.commit();

            // 2. Sync to Google Spreadsheet via Backend
            const toMD = (isoStr: string) => {
                if (!isoStr) return '';
                const parts = isoStr.split('-');
                if (parts.length < 3) return '';
                return `${parseInt(parts[1], 10)}.${parseInt(parts[2], 10)}`;
            };

            // 원래 이번 기간 것이던 날 중 새 값이 없는 날은 핵심 구간 밖(타임라인 뒤쪽, 다음 주)이라도 비운다
            const cellUpdates = buildCellUpdates({ ...statusContext, allowVacationPassLink });
            let passDepartMD = hasPass && passStart ? isoToMD(addDaysIso(passStart, -1)) : '';

            const passDays = Object.entries(dayStatuses).filter(([, st]) => st === 'pass').map(([d]) => d);
            const vacDays = Object.entries(dayStatuses)
                .filter(([, st]) => st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart')
                .map(([d]) => d);

            passDepartMD = passDepartMD
                || Object.entries(dayStatuses).find(([, st]) => st === 'pass-depart' || st === 'recovery-pass-depart' || st === 'vacation-pass-depart')?.[0]
                || (hasPass && passStart ? (() => {
                    const d = new Date(passStart);
                    d.setDate(d.getDate() - 1);
                    return `${d.getMonth() + 1}.${d.getDate()}`;
                })() : '');

            const passReturnMD = hasPass && passEnd ? toMD(passEnd) : (passDays[passDays.length - 1] || '');

            const movementItem: any = {
                name: cleanName,
                type: hasPass ? '외박' : '잔류',
                depart: passDepartMD,
                return: passReturnMD,
                stayDays: passDays,
                period: hasPass && passStart && passEnd ? `${toMD(passStart)}~${toMD(passEnd)}` : '',
                reason: finalPassReason
            };

            if (hasVacation && vacationStart && vacationEnd) {
                movementItem.vacation = {
                    depart: toMD(vacationStart),
                    return: toMD(vacationEnd),
                    stayDays: vacDays,
                    isLinked: !!isLinked,
                    reason: finalVacReason
                };
            } else if (vacDays.length > 0) {
                movementItem.vacation = {
                    depart: vacDays[0],
                    return: vacDays[vacDays.length - 1],
                    stayDays: vacDays,
                    isLinked: !!isLinked,
                    reason: finalVacReason
                };
            }

            const baseUrl = 'https://asia-northeast3-seniorkatusa-aa594.cloudfunctions.net';
            const payload = {
                movements: [movementItem],
                memberUpdate: { memberName: cleanName, dayStatuses, cellUpdates }
            };

            try {
                await axios.post(`${baseUrl}/updateMemberSchedule`, { memberName: cleanName, dayStatuses, cellUpdates });
            } catch {
                await axios.post(`${baseUrl}/syncMovementToSheet`, payload);
            }

            const savedMovement: any = (hasVacation && vacationStart && vacationEnd) ? {
                id: targetVacDoc ? targetVacDoc.id : `vac-${Date.now()}`,
                name: cleanName,
                type: 'vacation',
                startDate: vacationStart,
                endDate: vacationEnd,
                reason: finalVacReason,
                updatedAt: new Date()
            } : (hasPass && passStart && passEnd) ? {
                id: targetPassDoc ? targetPassDoc.id : `pass-${Date.now()}`,
                name: cleanName,
                type: 'pass',
                startDate: passStart,
                endDate: passEnd,
                reason: finalPassReason,
                updatedAt: new Date()
            } : null;

            onSaveSuccess?.(dayStatuses, savedMovement);
            setSuccessMessage('저장하고 스프레드시트에 반영했습니다.');
            // 성공 후 화면이 닫힐 때까지 버튼을 잠가 두 번 저장되지 않게 한다
            setSaved(true);
            setTimeout(() => onClose(), 800);
        } catch (err: any) {
            console.error('Save error:', err);
            setSaveError(err.response?.data?.message || err.message || '저장 중 오류가 발생했습니다.');
            savingRef.current = false;
        } finally {
            setSaving(false);
        }
    };

    const saveLabel = saved
        ? '저장 완료'
        : saving
        ? '스프레드시트 반영 중...'
        : awaitingWarningConfirm
            ? '경고 확인, 그대로 저장'
            : '저장 및 시트 반영';

    const page = (
        <div className="fixed inset-0 z-[100] flex flex-col bg-slate-50 animate-in fade-in duration-150">
            {/* Header */}
            <header className="shrink-0 bg-white border-b border-gray-200">
                <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 sm:px-6 h-14 sm:h-16">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="p-2 -ml-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                        aria-label="뒤로"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-base sm:text-lg font-black text-gray-900 truncate">{fullNameWithRank}</h2>
                        <p className="text-[11px] sm:text-xs text-gray-500 font-medium truncate">
                            주간 출타/잔디 편집{sectionLabel ? ` · ${sectionLabel}` : ''}
                        </p>
                    </div>
                    {/* 앞뒤 기간 이동 */}
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => handleNavigate(onPrevWeek)}
                            disabled={!onPrevWeek || saving}
                            aria-label="이전 기간"
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-600 bg-gray-50 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-sm sm:text-base font-black text-gray-900 tabular-nums whitespace-nowrap px-1">
                            {timeline[0]} ~ {timeline[timeline.length - 1]}
                        </span>
                        <button
                            type="button"
                            onClick={() => handleNavigate(onNextWeek)}
                            disabled={!onNextWeek || saving}
                            aria-label="다음 기간"
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-600 bg-gray-50 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </header>

            {/* Body */}
            <main className="flex-1 overflow-y-auto">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 grid gap-4 lg:gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
                    <div className="space-y-4 min-w-0">
                        {saveError && (
                            <div className="p-3 bg-red-50 border border-red-300 rounded-2xl flex items-start gap-2.5 text-sm text-red-700 font-semibold">
                                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                                <span>{saveError}</span>
                            </div>
                        )}
                        {successMessage && (
                            <div className="p-3 bg-green-50 border border-green-200 rounded-2xl flex items-center gap-2.5 text-sm text-green-700 font-bold">
                                <Check className="w-4 h-4 shrink-0 text-green-600" />
                                <span>{successMessage}</span>
                            </div>
                        )}

                        <MovementSection
                            title="외박"
                            accent="blue"
                            enabled={hasPass}
                            onToggle={setHasPass}
                            startField="passStart"
                            endField="passEnd"
                            reasonField="passReason"
                            startLabel="외박 시작일"
                            endLabel="복귀일"
                            start={passStart}
                            end={passEnd}
                            reasonChoice={passChoice}
                            reasonPreview={passReason}
                            onStartChange={setPassStart}
                            onEndChange={setPassEnd}
                            onReasonChoiceChange={handlePassChoiceChange}
                            options={passOptions}
                            detail={passDetail}
                            customPlaceholder="외박 사유 입력 (예: BLC 01-27기 컴펜 2일)"
                            issues={issues}
                        />

                        <MovementSection
                            title="휴가"
                            accent="orange"
                            enabled={hasVacation}
                            onToggle={setHasVacation}
                            startField="vacationStart"
                            endField="vacationEnd"
                            reasonField="vacationReason"
                            startLabel="휴가 출발일"
                            endLabel="복귀일"
                            start={vacationStart}
                            end={vacationEnd}
                            reasonChoice={vacationChoice}
                            reasonPreview={vacationReason}
                            onStartChange={setVacationStart}
                            onEndChange={setVacationEnd}
                            onReasonChoiceChange={setVacationChoice}
                            detail={vacationDetail}
                            options={vacationOptions}
                            customPlaceholder="휴가 사유 입력 (예: 포상 3일)"
                            issues={issues}
                            footer={isLinked ? (
                                <div className="flex items-center gap-2 text-xs text-orange-800 font-bold bg-orange-50 border border-orange-200 px-3 py-2 rounded-xl">
                                    <span>외박 복귀일과 휴가 출발일이 같아 외휴연계로 저장됩니다.</span>
                                </div>
                            ) : undefined}
                            note={otherPeriodVacations.length > 0 ? (
                                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 space-y-1">
                                    {otherPeriodVacations.map(v => (
                                        <p key={`${v.start}-${v.end}`} className="text-xs text-gray-600 leading-snug">
                                            <span className="font-bold text-gray-800">
                                                {formatIsoShort(v.start)}~{formatIsoShort(v.end)} 휴가
                                            </span>
                                            {' · '}
                                            {v.start < coreStartIso ? '이전 기간에 시작한 휴가' : '다음 기간에 시작하는 휴가'}
                                            라서 여기서는 바꾸지 않습니다.
                                        </p>
                                    ))}
                                </div>
                            ) : undefined}
                        />
                    </div>

                    <aside className="space-y-4 lg:sticky lg:top-0">
                        <GrassPreview timeline={timeline} dayStatuses={dayStatuses} currentYear={currentYear} />
                    </aside>
                </div>
            </main>

            {/* Footer */}
            <footer className="shrink-0 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]">
                <div className="max-w-5xl mx-auto flex items-center gap-2 px-4 sm:px-6 py-3">
                    <p className={cn(
                        'flex-1 min-w-0 text-xs font-bold truncate text-amber-700'
                    )}>
                        {awaitingWarningConfirm ? '노란색 경고가 맞으면 한 번 더 누르세요' : ''}
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 h-11 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving || saved}
                        className={cn(
                            'flex items-center gap-2 px-5 h-11 text-sm font-bold text-white rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50',
                            awaitingWarningConfirm ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
                        )}
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>{saveLabel}</span>
                    </button>
                </div>
            </footer>
        </div>
    );

    return createPortal(page, document.body);
}
