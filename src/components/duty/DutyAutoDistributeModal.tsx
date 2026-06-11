import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Wand2, X, ChevronRight, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';
import { calculateRank, getExpectedDischargeDate } from '../../lib/rankUtils';
import {
    runAutoDistribute,
    type MemberDutyTarget,
    type AssignedDuty,
    type DistributeWarning,
    type DutyType
} from '../../utils/duty/dutyAutoDistribute';

interface DutyAutoDistributeModalProps {
    isOpen: boolean;
    onClose: () => void;
    year: number;
    month: number; // 0-indexed
    members: CalendarMember[];
    dutyStats: Record<string, {
        total: number;
        weekday: number;
        friSun: number;
        sat: number;
        currentMonthWeekday?: number;
        currentMonthFriSun?: number;
        currentMonthSat?: number;
    }>;
    allDuties: CalendarEvent[];
    allEvents: CalendarEvent[];
    personalRestrictions: Record<string, string[]>;
    dutyHolidays: any[];
    restrictions: Record<number, Record<string, boolean>>;
    blcRestrictions: Record<number, Record<string, boolean>>;
    ktaSections: string[];
    blcSections: string[];
    currentDate: Date;
    onApply: (assignments: AssignedDuty[]) => void;
}

type Step = 'configure' | 'preview';

interface MemberConfig {
    weekday: string;
    friSun: string;
    sat: string;
    free: string;
}

const EMPTY_CONFIG: MemberConfig = { weekday: '', friSun: '', sat: '', free: '' };

const DUTY_TYPE_LABELS: Record<DutyType, string> = {
    weekday: '평당',
    friSun: '금일당',
    sat: '토당'
};

const DUTY_TYPE_COLORS: Record<DutyType, string> = {
    weekday: 'text-slate-300',
    friSun: 'text-sky-400',
    sat: 'text-rose-400'
};

export function DutyAutoDistributeModal({
    isOpen, onClose,
    year, month,
    members, dutyStats,
    allDuties, allEvents,
    personalRestrictions, dutyHolidays,
    restrictions, blcRestrictions,
    ktaSections, blcSections,
    currentDate,
    onApply
}: DutyAutoDistributeModalProps) {
    const [step, setStep] = useState<Step>('configure');
    const [configs, setConfigs] = useState<Record<string, MemberConfig>>({});
    const [result, setResult] = useState<{ assignments: AssignedDuty[]; warnings: DistributeWarning[] } | null>(null);
    const [isRunning, setIsRunning] = useState(false);

    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // 전역 예정일 계산 (입대일 + 18개월)
    function getDischargeStr(member: CalendarMember): string | null {
        if (!member.enlistmentDate) return null;
        const enlist = new Date(member.enlistmentDate);
        if (isNaN(enlist.getTime())) return null;
        const d = getExpectedDischargeDate(enlist);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // 이번 달 마지막 날
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    // 이번 달 첫 날
    const firstDayStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;

    // 배정 가능 대원 (러너 제외, SK 제외, 당직완료 제외, 전역자 제외, 아직 전입 안 한 대원 제외)
    const eligibleMembers = useMemo(() => {
        return members.filter(m => {
            if (m.role === 'runner') return false;
            if (m.sections?.includes('SK')) return false;
            if (m.dutyCompleted) return false;
            // 이미 전역한 사람: 전역일이 이번 달 1일 이전
            const dischargeStr = getDischargeStr(m);
            if (dischargeStr && dischargeStr < firstDayStr) return false;
            // 이번 달 마지막 날 이전에 전입하지 않은 신병 제외
            if (m.joinDate && lastDayStr < m.joinDate) return false;
            return true;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [members, year, month]);

    const getConfig = (memberName: string): MemberConfig =>
        configs[memberName] ?? EMPTY_CONFIG;

    const updateConfig = (memberName: string, patch: Partial<MemberConfig>) => {
        setConfigs(prev => ({
            ...prev,
            [memberName]: { ...getConfig(memberName), ...patch }
        }));
    };

    // 전체 목표 합산 (이번 달 남은 일수 초과 여부 확인용)
    const preAssignedCount = useMemo(() => {
        const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
        return new Set(
            allDuties
                .filter(d => d.type === 'duty' && d.startDate.startsWith(monthPrefix))
                .map(d => d.startDate)
        ).size;
    }, [allDuties, year, month]);

    const [fixedInput, setFixedInput] = useState('');

    const fixedAssignments = useMemo(() => {
        const lines = fixedInput.split('\n').map(l => l.trim()).filter(l => l);
        const arr = [];
        for (const line of lines) {
            const parts = line.split(',').map(p => p.trim());
            if (parts.length !== 3) continue;
            const [dateStr, memberName, dutyType] = parts;
            if (!dateStr || !memberName || !dutyType) continue;
            arr.push({ dateStr, memberName, dutyType: dutyType as DutyType });
        }
        return arr;
    }, [fixedInput]);

    const availableDays = daysInMonth - preAssignedCount;

    const totalTarget = useMemo(() => {
        let sum = 0;
        for (const m of eligibleMembers) {
            const cfg = getConfig(m.name);
            sum += (parseInt(cfg.weekday || '0', 10) || 0)
                + (parseInt(cfg.friSun || '0', 10) || 0)
                + (parseInt(cfg.sat || '0', 10) || 0)
                + (parseInt(cfg.free || '0', 10) || 0);
        }
        return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [configs, eligibleMembers]);

    const handleRun = async () => {
        setIsRunning(true);
        const targets: MemberDutyTarget[] = [];
        for (const m of eligibleMembers) {
            const cfg = getConfig(m.name);
            const w = parseInt(cfg.weekday || '0', 10) || 0;
            const f = parseInt(cfg.friSun || '0', 10) || 0;
            const s = parseInt(cfg.sat || '0', 10) || 0;
            const fr = parseInt(cfg.free || '0', 10) || 0;
            if (w > 0 || f > 0 || s > 0 || fr > 0) {
                targets.push({ memberName: m.name, weekday: w, friSun: f, sat: s, free: fr });
            }
        }

        if (targets.length === 0 && fixedAssignments.length === 0) {
            alert('목표 횟수를 1 이상으로 설정하거나 고정 배정을 입력하세요.');
            setIsRunning(false);
            return;
        }

        await new Promise(r => setTimeout(r, 50));

        const res = runAutoDistribute({
            year, month,
            members,
            allDuties,
            allEvents,
            personalRestrictions,
            dutyHolidays,
            targets,
            restrictions,
            blcRestrictions,
            ktaSections,
            blcSections,
            fixedAssignments
        });

        setResult(res);
        setStep('preview');
        setIsRunning(false);
    };

    const handleApply = () => {
        if (!result) return;
        onApply(result.assignments);
        onClose();
    };

    const handleBack = () => {
        setStep('configure');
        setResult(null);
    };

    if (!isOpen) return null;

    const isOverBudget = totalTarget > availableDays;

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
            <div className="w-[740px] max-h-[90vh] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">

                {/* 헤더 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                            <Wand2 className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-sm font-black text-slate-200 tracking-wide">당직 자동 분배</h2>
                            <p className="text-[10px] text-slate-500 font-bold">
                                {year}년 {month + 1}월 · {step === 'configure' ? '목표 설정' : '결과 미리보기'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {step === 'preview' && (
                            <button
                                onClick={handleBack}
                                className="text-[11px] font-black text-slate-400 hover:text-slate-200 px-3 py-1.5 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-xl transition-all cursor-pointer"
                            >
                                ← 다시 설정
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* 목표 합계 배너 */}
                {step === 'configure' && (
                    <div className={`px-6 py-2.5 border-b shrink-0 flex items-center justify-between ${isOverBudget
                        ? 'bg-rose-950/30 border-rose-500/20'
                        : 'bg-slate-950/30 border-slate-800/50'
                        }`}>
                        <span className="text-[10px] font-black text-slate-500">
                            이번 달 전체 배정 목표 합계 (남은 일수 {availableDays}일 기준)
                        </span>
                        <div className="flex items-center gap-2">
                            <span className={`text-sm font-black tabular-nums ${isOverBudget ? 'text-rose-400' : 'text-indigo-300'}`}>
                                {totalTarget}
                            </span>
                            <span className="text-[11px] font-black text-slate-600">/ {availableDays}일</span>
                            {isOverBudget && (
                                <span className="text-[10px] font-black text-rose-400 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    목표 합계가 남은 일수를 초과합니다
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* 본문 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
                    {step === 'configure' ? (
                        <>
                            <ConfigureStep
                                eligibleMembers={eligibleMembers}
                                dutyStats={dutyStats}
                                getConfig={getConfig}
                                updateConfig={updateConfig}
                                currentDate={currentDate}
                            />
                            {/* 고정 배정 입력 영역 */}
                            <div className="p-4 border-t border-slate-800">
                                <label className="block text-sm font-black text-slate-400 mb-2">고정 배정 (한 줄에 "YYYY-MM-DD,대원명,dutyType" 형식)</label>
                                <textarea
                                    value={fixedInput}
                                    onChange={e => setFixedInput(e.target.value)}
                                    rows={3}
                                    className="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                                    placeholder="2026-06-15,홍길동,weekday"
                                />
                            </div>
                        </>
                    ) : (
                        <PreviewStep
                            assignments={result?.assignments ?? []}
                            warnings={result?.warnings ?? []}
                            year={year}
                            month={month}
                            daysInMonth={daysInMonth}
                        />
                    )}
                </div>

                {/* 푸터 */}
                <div className="px-6 py-4 border-t border-slate-800 shrink-0 flex items-center justify-between gap-3">
                    <p className="text-[10px] text-slate-600 font-bold">
                        {step === 'configure'
                            ? '목표 횟수가 모두 0인 대원은 자동 분배에서 제외됩니다.'
                            : `총 ${result?.assignments.length ?? 0}개 배정 완료 · 미배정 ${result?.warnings.filter(w => w.type === 'unassigned').length ?? 0}일`}
                    </p>
                    {step === 'configure' ? (
                        <button
                            onClick={handleRun}
                            disabled={isRunning}
                            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.97] text-white rounded-xl text-xs font-black transition-all shadow-lg shadow-indigo-500/20 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isRunning ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Wand2 className="w-3.5 h-3.5" />
                            )}
                            {isRunning ? '분배 중...' : '자동 분배 실행'}
                            {!isRunning && <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                    ) : (
                        <button
                            onClick={handleApply}
                            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.97] text-white rounded-xl text-xs font-black transition-all shadow-lg shadow-emerald-500/20 cursor-pointer"
                        >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            이 결과로 적용
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

// ── Configure Step ────────────────────────────────────────

interface ConfigureStepProps {
    eligibleMembers: CalendarMember[];
    dutyStats: DutyAutoDistributeModalProps['dutyStats'];
    getConfig: (name: string) => MemberConfig;
    updateConfig: (name: string, patch: Partial<MemberConfig>) => void;
    currentDate: Date;
}

const FIELD_LABELS: { key: keyof MemberConfig; label: string; color: string }[] = [
    { key: 'weekday', label: '평당', color: 'text-slate-300' },
    { key: 'friSun',  label: '금일당', color: 'text-sky-400' },
    { key: 'sat',     label: '토당', color: 'text-rose-400' },
    { key: 'free',    label: '자유', color: 'text-indigo-400' },
];

function ConfigureStep({ eligibleMembers, dutyStats, getConfig, updateConfig, currentDate }: ConfigureStepProps) {
    if (eligibleMembers.length === 0) {
        return (
            <div className="flex items-center justify-center py-20 text-slate-600 text-xs font-bold">
                배정 가능한 대원이 없습니다.
            </div>
        );
    }

    return (
        <div className="p-5 space-y-2.5">
            {/* 헤더 컬럼 */}
            <div className="grid grid-cols-[1fr_auto] gap-3 px-1 pb-1">
                <span className="text-[10px] font-black text-slate-500 tracking-wider">대원 (누적 당직)</span>
                <div className="flex items-center gap-4 pr-1">
                    {FIELD_LABELS.map(f => (
                        <span key={f.key} className={`text-[10px] font-black tracking-wider w-14 text-center ${f.color}`}>{f.label}</span>
                    ))}
                </div>
            </div>

            {eligibleMembers.map(member => {
                const stats = dutyStats[member.name] || { total: 0, weekday: 0, friSun: 0, sat: 0 };
                const cfg = getConfig(member.name);
                const rank = member.enlistmentDate
                    ? calculateRank(new Date(member.enlistmentDate), member.earlyPromotion || 0, currentDate)
                    : (member.rank || '대원');
                const curMonthTotal = (stats.currentMonthWeekday || 0) + (stats.currentMonthFriSun || 0) + (stats.currentMonthSat || 0);

                return (
                    <div
                        key={member.id}
                        className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-2xl hover:border-slate-700 transition-colors"
                    >
                        {/* 대원 정보 */}
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] font-black text-slate-200 truncate">{member.name}</span>
                                {curMonthTotal > 0 && (
                                    <span className="text-[9px] font-black text-emerald-400 shrink-0">+{curMonthTotal}회</span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-[9px] font-black">
                                <span className="text-slate-500">{rank}</span>
                                <span className="text-slate-700">·</span>
                                <span className="text-slate-500">평 {stats.weekday}</span>
                                <span className="text-sky-600">금일 {stats.friSun}</span>
                                <span className="text-rose-700">토 {stats.sat}</span>
                                <span className="text-slate-600">({stats.total}회)</span>
                            </div>
                        </div>

                        {/* 입력 필드 */}
                        <div className="flex items-center gap-2 shrink-0">
                            {FIELD_LABELS.map(f => (
                                <input
                                    key={f.key}
                                    type="number"
                                    min="0"
                                    max="31"
                                    value={cfg[f.key]}
                                    onChange={e => updateConfig(member.name, { [f.key]: e.target.value })}
                                    placeholder="0"
                                    className={`w-14 py-1.5 px-1 bg-slate-900 border border-slate-800 rounded-lg text-xs text-center font-black placeholder-slate-700 focus:outline-none focus:border-indigo-500 transition-colors ${f.color}`}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ── Preview Step ──────────────────────────────────────────

interface PreviewStepProps {
    assignments: AssignedDuty[];
    warnings: DistributeWarning[];
    year: number;
    month: number;
    daysInMonth: number;
}

function PreviewStep({ assignments, warnings, year, month, daysInMonth }: PreviewStepProps) {
    const unassigned = warnings.filter(w => w.type === 'unassigned');
    const shortfalls = warnings.filter(w => w.type === 'shortfall');

    const byDate = new Map<string, AssignedDuty>();
    for (const a of assignments) byDate.set(a.dateStr, a);

    const allDates: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
        allDates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const firstDow = new Date(year, month, 1).getDay();

    return (
        <div className="p-5 space-y-5">
            {/* 경고 섹션 */}
            {(unassigned.length > 0 || shortfalls.length > 0) && (
                <div className="space-y-2.5">
                    {unassigned.length > 0 && (
                        <div className="p-3.5 bg-amber-950/40 border border-amber-500/25 rounded-2xl">
                            <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span className="text-[11px] font-black text-amber-300">미배정 날짜 ({unassigned.length}일) — 후보가 없어 자동 결정 불가</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {unassigned.map(w => {
                                    const d = parseLocalDateSimple(w.dateStr!);
                                    return (
                                        <span key={w.dateStr} className="px-2 py-0.5 bg-amber-950/60 border border-amber-500/30 text-amber-300 rounded-lg text-[10px] font-black">
                                            {month + 1}/{d.getDate()}({dayNames[d.getDay()]})
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {shortfalls.length > 0 && (
                        <div className="p-3.5 bg-rose-950/30 border border-rose-500/20 rounded-2xl">
                            <div className="flex items-center gap-2 mb-2.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                <span className="text-[11px] font-black text-rose-300">목표 미달 대원 ({shortfalls.length}명)</span>
                            </div>
                            <div className="space-y-1.5">
                                {shortfalls.map(w => {
                                    const assignedTotal = (w.assignedWeekday ?? 0) + (w.assignedFriSun ?? 0) + (w.assignedSat ?? 0);
                                    const targetTotal = (w.targetWeekday ?? 0) + (w.targetFriSun ?? 0) + (w.targetSat ?? 0) + (w.targetFree ?? 0);
                                    return (
                                        <div key={w.memberName} className="flex items-center justify-between px-3 py-2 bg-rose-950/40 border border-rose-500/20 rounded-xl">
                                            <span className="text-[11px] font-black text-rose-200">{w.memberName}</span>
                                            <div className="flex items-center gap-3 text-[10px] font-black">
                                                <span className="text-slate-400">평 {w.assignedWeekday}/{w.targetWeekday}</span>
                                                <span className="text-sky-400">금일 {w.assignedFriSun}/{w.targetFriSun}</span>
                                                <span className="text-rose-400">토 {w.assignedSat}/{w.targetSat}</span>
                                                {(w.targetFree ?? 0) > 0 && (
                                                    <span className="text-indigo-400">자유 {Math.max(0, assignedTotal - ((w.targetWeekday ?? 0) + (w.targetFriSun ?? 0) + (w.targetSat ?? 0)))}/{w.targetFree}</span>
                                                )}
                                                <span className="text-slate-500">({assignedTotal}/{targetTotal})</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {unassigned.length === 0 && shortfalls.length === 0 && (
                <div className="flex items-center gap-2 p-3 bg-emerald-950/30 border border-emerald-500/20 rounded-2xl">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-[11px] font-black text-emerald-300">모든 목표를 달성했습니다! 🎉</span>
                </div>
            )}

            {/* 달력 결과 */}
            <div>
                <h3 className="text-[11px] font-black text-slate-400 tracking-wider mb-3">
                    배정 결과 — 새로 추가 {assignments.length}건
                </h3>
                <div className="grid grid-cols-7 gap-1">
                    {dayNames.map(n => (
                        <div key={n} className={`text-center text-[9px] font-black py-1 ${n === '일' ? 'text-rose-500' : n === '토' ? 'text-sky-500' : 'text-slate-500'}`}>{n}</div>
                    ))}

                    {Array.from({ length: firstDow }).map((_, i) => (
                        <div key={`empty-${i}`} />
                    ))}

                    {allDates.map(dateStr => {
                        const a = byDate.get(dateStr);
                        const d = parseLocalDateSimple(dateStr);
                        const dow = d.getDay();
                        const isUnassigned = unassigned.some(w => w.dateStr === dateStr);

                        return (
                            <div
                                key={dateStr}
                                className={`rounded-xl p-1.5 text-center border transition-all min-h-[52px] flex flex-col items-center justify-center ${a
                                    ? 'bg-indigo-950/50 border-indigo-500/40'
                                    : isUnassigned
                                        ? 'bg-amber-950/30 border-amber-500/30'
                                        : 'bg-slate-900/30 border-slate-800/40'
                                    }`}
                            >
                                <div className={`text-[9px] font-black mb-0.5 ${dow === 0 ? 'text-rose-400' : dow === 6 ? 'text-sky-400' : 'text-slate-500'}`}>
                                    {d.getDate()}
                                </div>
                                {a && (
                                    <>
                                        <div className="text-[8px] font-black text-indigo-200 leading-tight truncate w-full text-center px-0.5" title={a.memberName}>
                                            {a.memberName}
                                        </div>
                                        <div className={`text-[7px] font-black ${DUTY_TYPE_COLORS[a.dutyType]}`}>
                                            {DUTY_TYPE_LABELS[a.dutyType]}
                                        </div>
                                    </>
                                )}
                                {isUnassigned && (
                                    <div className="text-[8px] font-black text-amber-500">미배정</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function parseLocalDateSimple(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}
