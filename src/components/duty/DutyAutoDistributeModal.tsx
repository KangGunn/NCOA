import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Wand2, X, ChevronRight, AlertTriangle, CheckCircle2, RefreshCw, Lock, Unlock } from 'lucide-react';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';
import { calculateRank, getExpectedDischargeDate } from '../../lib/rankUtils';
import {
    runAutoDistribute,
    type MemberDutyTarget,
    type AssignedDuty,
    type DistributeWarning,
    type DutyType,
    type RuleViolation
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
    const [configs, setConfigs] = useState<Record<string, MemberConfig>>(() => {
        try {
            const saved = localStorage.getItem(`ncoa_duty_auto_configs_${year}_${month}`);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            console.error(e);
            return {};
        }
    });
    const [lockedMembers, setLockedMembers] = useState<Record<string, boolean>>(() => {
        try {
            const saved = localStorage.getItem(`ncoa_duty_auto_locked_${year}_${month}`);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            console.error(e);
            return {};
        }
    });
    const [result, setResult] = useState<{ assignments: AssignedDuty[]; warnings: DistributeWarning[]; violations: RuleViolation[] } | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const cancelTokenRef = useRef({ isCancelled: false });
    const [progressInfo, setProgressInfo] = useState<{
        progress: number;
        message: string;
        costBreakdown?: { label: string; cost: number }[];
    } | null>(null);
    const [elapsedTime, setElapsedTime] = useState(0);

    useEffect(() => {
        let interval: any;
        if (isRunning) {
            setElapsedTime(0);
            interval = setInterval(() => {
                setElapsedTime(prev => prev + 1);
            }, 1000);
        } else {
            setElapsedTime(0);
        }
        return () => clearInterval(interval);
    }, [isRunning]);

    useEffect(() => {
        try {
            localStorage.setItem(`ncoa_duty_auto_configs_${year}_${month}`, JSON.stringify(configs));
        } catch (e) {
            console.error("Failed to save configs to localStorage:", e);
        }
    }, [configs, year, month]);

    useEffect(() => {
        try {
            localStorage.setItem(`ncoa_duty_auto_locked_${year}_${month}`, JSON.stringify(lockedMembers));
        } catch (e) {
            console.error("Failed to save lockedMembers to localStorage:", e);
        }
    }, [lockedMembers, year, month]);

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

    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const preAssigned = useMemo(() => {
        return allDuties.filter(d => d.type === 'duty' && d.startDate.startsWith(monthPrefix));
    }, [allDuties, monthPrefix]);

    // 배정 가능 대원 (러너 제외, SK 제외, 당직완료 제외, 전역자 제외, 아직 전입 안 한 대원 제외)
    const eligibleMembers = useMemo(() => {
        const criteriaWeekday = (() => {
            const saved = localStorage.getItem('ncoa_criteria_weekday');
            return saved ? parseInt(saved, 10) : 13;
        })();
        const criteriaFriSun = (() => {
            const saved = localStorage.getItem('ncoa_criteria_frisun');
            return saved ? parseInt(saved, 10) : 9;
        })();
        const criteriaSat = (() => {
            const saved = localStorage.getItem('ncoa_criteria_sat');
            return saved ? parseInt(saved, 10) : 6;
        })();

        return members.filter(m => {
            if (m.role === 'runner') return false;

            const isSK = m.sections?.includes('SK') || false;
            if (isSK) return false;

            // 누적 통계 기준 완료 체크
            const stats = dutyStats[m.name] || { total: 0, weekday: 0, friSun: 0, sat: 0 };
            const isCompleted = !!m.dutyCompleted || (stats.weekday >= criteriaWeekday && stats.friSun >= criteriaFriSun && stats.sat >= criteriaSat);
            if (isCompleted) return false;

            // 이미 전역한 사람: 전역일이 이번 달 1일 이전
            const dischargeStr = getDischargeStr(m);
            if (dischargeStr && dischargeStr < firstDayStr) return false;
            // 이번 달 마지막 날 이전에 전입하지 않은 신병 제외
            if (m.joinDate && lastDayStr < m.joinDate) return false;
            return true;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [members, year, month, dutyStats]);

    const getConfig = (memberName: string): MemberConfig =>
        configs[memberName] ?? EMPTY_CONFIG;

    const updateConfig = (memberName: string, patch: Partial<MemberConfig>) => {
        setConfigs(prev => ({
            ...prev,
            [memberName]: { ...getConfig(memberName), ...patch }
        }));
    };

    const toggleLock = (memberName: string) => {
        setLockedMembers(prev => ({
            ...prev,
            [memberName]: !prev[memberName]
        }));
    };



    const totalTarget = useMemo(() => {
        let sum = 0;
        for (const m of eligibleMembers) {
            const cfg = getConfig(m.name);
            const parsed = parseInt(cfg.free, 10);
            const fr = (cfg.free === '' || isNaN(parsed)) ? null : parsed;
            sum += (fr !== null ? fr : 2);
        }
        return sum;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [configs, eligibleMembers]);

    const handleRun = async () => {
        setIsRunning(true);
        cancelTokenRef.current = { isCancelled: false };
        try {
            const parseVal = (val: string) => {
                if (val === undefined || val === null || val.trim() === '') return null;
                const parsed = parseInt(val, 10);
                return isNaN(parsed) ? null : parsed;
            };

            const targets: MemberDutyTarget[] = [];
            for (const m of eligibleMembers) {
                const cfg = getConfig(m.name);
                const w = parseVal(cfg.weekday);
                const f = parseVal(cfg.friSun);
                const s = parseVal(cfg.sat);
                const fr = parseVal(cfg.free);
                if (w !== null || f !== null || s !== null || fr !== null || lockedMembers[m.name]) {
                    targets.push({
                        memberName: m.name,
                        weekday: w,
                        friSun: f,
                        sat: s,
                        free: fr,
                        isLocked: !!lockedMembers[m.name]
                    });
                }
            }

            const criteriaWeekday = (() => {
                const saved = localStorage.getItem('ncoa_criteria_weekday');
                return saved ? parseInt(saved, 10) : 13;
            })();
            const criteriaFriSun = (() => {
                const saved = localStorage.getItem('ncoa_criteria_frisun');
                return saved ? parseInt(saved, 10) : 9;
            })();
            const criteriaSat = (() => {
                const saved = localStorage.getItem('ncoa_criteria_sat');
                return saved ? parseInt(saved, 10) : 6;
            })();

            await new Promise(r => setTimeout(r, 50));

            const historicalStats = Object.keys(dutyStats).reduce((acc, name) => {
                const s = dutyStats[name];
                acc[name] = {
                    total: Math.max(0, s.total - (s.currentMonthWeekday || 0) - (s.currentMonthFriSun || 0) - (s.currentMonthSat || 0)),
                    weekday: Math.max(0, s.weekday - (s.currentMonthWeekday || 0)),
                    friSun: Math.max(0, s.friSun - (s.currentMonthFriSun || 0)),
                    sat: Math.max(0, s.sat - (s.currentMonthSat || 0)),
                };
                return acc;
            }, {} as typeof dutyStats);

            const res = await runAutoDistribute({
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
                dutyStats: historicalStats,
                currentDate,
                criteria: {
                    weekday: criteriaWeekday,
                    friSun: criteriaFriSun,
                    sat: criteriaSat
                },
                onProgress: (info) => {
                    setProgressInfo(info);
                },
                cancelToken: cancelTokenRef.current
            });

            setProgressInfo(null);
            setResult(res);
            setStep('preview');
        } catch (e: any) {
            console.error("Auto distribute failed:", e);
            alert("자동 배정 중 오류가 발생했습니다: " + (e.message || e));
        } finally {
            setIsRunning(false);
        }
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

    const isOverBudget = totalTarget > daysInMonth;

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-[740px] max-h-[90vh] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
                {/* 로딩/진행률 오버레이 */}
                {isRunning && (
                    <div className="absolute inset-0 z-[210] flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 p-8 text-center">
                        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-6">
                            <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                        </div>
                        <h3 className="text-sm font-black text-slate-200 mb-2">당직 자동 분배 분석 중...</h3>
                        <p className="text-[11px] font-bold text-slate-400 max-w-md mb-4 leading-relaxed">
                            수많은 대원 조합과 이틀 연속 당직 금지, KTA/BLC 제한일, 개인 선호 등 수십 가지 제약 조건을 동시에 연산 중입니다.
                        </p>
                        <div className="text-[10px] font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-full mb-6 inline-flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                            경과 시간: {elapsedTime >= 60 ? `${Math.floor(elapsedTime / 60)}분 ${elapsedTime % 60}초` : `${elapsedTime}초`}
                        </div>
                        
                        {/* 진행률 바 */}
                        <div className="w-96 space-y-2">
                            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                                <div 
                                    className="h-full bg-gradient-to-r from-indigo-500 to-sky-400 rounded-full transition-all duration-300"
                                    style={{ width: `${progressInfo?.progress ?? 0}%` }}
                                />
                            </div>
                            <div className="flex justify-between items-center text-[9px] font-black text-slate-500 gap-4">
                                <span className="truncate text-left flex-1" title={progressInfo?.message || '탐색 준비 중...'}>
                                    {progressInfo?.message || '탐색 준비 중...'}
                                </span>
                                <span className="tabular-nums shrink-0">{progressInfo?.progress ?? 0}%</span>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                cancelTokenRef.current.isCancelled = true;
                            }}
                            className="mt-6 px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-xs font-black text-white rounded-xl shadow-lg hover:shadow-rose-900/20 transition-all cursor-pointer flex items-center gap-1.5"
                        >
                            <span>🛑</span> 최적 결과 적용하고 탐색 중지
                        </button>

                        {/* 실시간 위반 내역 및 벌점 (내림차순) */}
                        {progressInfo?.costBreakdown && progressInfo.costBreakdown.filter(item => item.cost > 0).length > 0 && (
                            <div className="mt-6 w-[620px] bg-slate-950/40 border border-slate-800/60 rounded-2xl p-4 text-left flex flex-col overflow-hidden max-h-[300px] animate-in fade-in duration-300">
                                <div className="text-[9px] font-black text-slate-500 mb-2 border-b border-slate-800 pb-1.5 flex justify-between shrink-0 tracking-wider">
                                    <span>실시간 위반 내역 (오류치 내림차순)</span>
                                    <span>가중 벌점</span>
                                </div>
                                <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-[9px] scrollbar-thin">
                                    {progressInfo.costBreakdown
                                        .filter(item => item.cost > 0)
                                        .map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-start gap-4 text-slate-300 border-b border-slate-800/20 pb-1">
                                                <span className="text-slate-400 font-bold break-all pr-2">{item.label}</span>
                                                <span className="shrink-0 font-black text-rose-500 tabular-nums">
                                                    {item.cost >= 1000000000 
                                                        ? `${(item.cost / 1000000000).toFixed(0)}억` 
                                                        : item.cost >= 100000000 
                                                            ? `${(item.cost / 100000000).toFixed(0)}억` 
                                                            : item.cost >= 10000 
                                                                ? `${Math.round(item.cost / 10000).toLocaleString()}만` 
                                                                : item.cost.toLocaleString()}
                                                </span>
                                            </div>
                                        ))
                                    }
                                </div>
                            </div>
                        )}
                    </div>
                )}

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
                            이번 달 전체 배정 목표 합계 (전체 {daysInMonth}일 기준)
                        </span>
                        <div className="flex items-center gap-2">
                            <span className={`text-sm font-black tabular-nums ${isOverBudget ? 'text-rose-400' : 'text-indigo-300'}`}>
                                {totalTarget}
                            </span>
                            <span className="text-[11px] font-black text-slate-600">/ {daysInMonth}일</span>
                            {isOverBudget && (
                                <span className="text-[10px] font-black text-rose-400 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    목표 합계가 이번 달 일수를 초과합니다
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* 본문 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
                    {step === 'configure' ? (
                        <ConfigureStep
                            eligibleMembers={eligibleMembers}
                            dutyStats={dutyStats}
                            getConfig={getConfig}
                            updateConfig={updateConfig}
                            currentDate={currentDate}
                            lockedMembers={lockedMembers}
                            toggleLock={toggleLock}
                        />
                    ) : (
                        <PreviewStep
                            assignments={result?.assignments ?? []}
                            preAssigned={preAssigned}
                            warnings={result?.warnings ?? []}
                            violations={result?.violations ?? []}
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
    lockedMembers: Record<string, boolean>;
    toggleLock: (name: string) => void;
}

const FIELD_LABELS: { key: keyof MemberConfig; label: string; color: string }[] = [
    { key: 'weekday', label: '평당', color: 'text-slate-300' },
    { key: 'friSun', label: '금일당', color: 'text-sky-400' },
    { key: 'sat', label: '토당', color: 'text-rose-400' },
    { key: 'free', label: '총합', color: 'text-indigo-400' },
];

function ConfigureStep({ eligibleMembers, dutyStats, getConfig, updateConfig, currentDate, lockedMembers, toggleLock }: ConfigureStepProps) {
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
                    <span className="text-[10px] font-black text-slate-500 tracking-wider w-8 text-center">고정</span>
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
                const isLocked = !!lockedMembers[member.name];

                return (
                    <div
                        key={member.id}
                        className={`flex items-center justify-between gap-4 px-4 py-3 bg-slate-950/50 border rounded-2xl hover:border-slate-700 transition-colors ${isLocked ? 'border-amber-500/40 bg-amber-950/5' : 'border-slate-800'
                            }`}
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

                        {/* 입력 필드 및 자물쇠 */}
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={() => toggleLock(member.name)}
                                className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center w-8 h-8 ${isLocked
                                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25'
                                        : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400 hover:bg-slate-800'
                                    }`}
                                title={isLocked ? '설정 횟수 고정됨' : '설정 횟수 고정하기'}
                            >
                                {isLocked ? (
                                    <Lock className="w-3.5 h-3.5" />
                                ) : (
                                    <Unlock className="w-3.5 h-3.5" />
                                )}
                            </button>
                            {FIELD_LABELS.map(f => (
                                <input
                                    key={f.key}
                                    type="number"
                                    min="0"
                                    max="31"
                                    value={cfg[f.key]}
                                    onChange={e => updateConfig(member.name, { [f.key]: e.target.value })}
                                    placeholder="-"
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
    preAssigned: CalendarEvent[];
    warnings: DistributeWarning[];
    violations: RuleViolation[];
    year: number;
    month: number;
    daysInMonth: number;
}

function PreviewStep({ assignments, preAssigned, warnings, violations, year, month, daysInMonth }: PreviewStepProps) {
    const unassigned = warnings.filter(w => w.type === 'unassigned');
    const hardViolations = violations.filter(v => v.level === 'hard');
    const softViolations = violations.filter(v => v.level === 'soft');

    const byDate = new Map<string, AssignedDuty>();
    for (const a of assignments) byDate.set(a.dateStr, a);

    const preAssignedByDate = new Map<string, CalendarEvent>();
    for (const p of preAssigned) preAssignedByDate.set(p.startDate, p);

    const allDates: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
        allDates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const firstDow = new Date(year, month, 1).getDay();

    const formatViolationDates = (dates?: string[]) => {
        if (!dates || dates.length === 0) return '';
        return dates.map(ds => {
            const d = parseLocalDateSimple(ds);
            return `${d.getDate()}일(${dayNames[d.getDay()]})`;
        }).join(', ');
    };

    return (
        <div className="p-5 space-y-5">
            {/* 규칙 브리핑 섹션 */}
            <div className="grid grid-cols-2 gap-4">
                {/* 필수 규칙 (Hard Constraints) 현황 */}
                <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-2xl flex flex-col min-h-[160px]">
                    <div className="flex items-center justify-between border-b border-slate-800/60 pb-2 mb-2 shrink-0">
                        <span className="text-[10px] font-black text-slate-300">필수 규칙 준수 현황</span>
                        {hardViolations.length === 0 ? (
                            <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-black rounded-lg">모두 준수함</span>
                        ) : (
                            <span className="px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[8px] font-black rounded-lg">{hardViolations.length}건 예외</span>
                        )}
                    </div>
                    {hardViolations.length === 0 ? (
                        <p className="text-[10px] text-slate-500 font-bold leading-relaxed flex-1 flex items-center justify-center text-center">
                            이틀 텀, KTA/BLC 제한일, 개인 제한일, 월 최대 3회 및 고정 배정 설정을 모두 만족합니다.
                        </p>
                    ) : (
                        <div className="space-y-1.5 flex-1 overflow-y-auto custom-scrollbar max-h-[140px] pr-1">
                            {hardViolations.map((v, idx) => (
                                <div key={idx} className="flex flex-col gap-0.5 px-2.5 py-1.5 bg-rose-950/20 border border-rose-500/10 rounded-xl text-[10px] leading-normal text-rose-200">
                                    <div className="font-black">{v.message}</div>
                                    {v.dates && v.dates.length > 0 && (
                                        <div className="text-[8px] font-black text-rose-400">위치: {formatViolationDates(v.dates)}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 선호 사항 (Soft Constraints) 조정 현황 */}
                <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-2xl flex flex-col min-h-[160px]">
                    <div className="flex items-center justify-between border-b border-slate-800/60 pb-2 mb-2 shrink-0">
                        <span className="text-[10px] font-black text-slate-300">선호 사항 조정 현황</span>
                        {softViolations.length === 0 ? (
                            <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-black rounded-lg">모두 준수함</span>
                        ) : (
                            <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-black rounded-lg">{softViolations.length}건 조정됨</span>
                        )}
                    </div>
                    {softViolations.length === 0 ? (
                        <p className="text-[10px] text-slate-500 font-bold leading-relaxed flex-1 flex items-center justify-center text-center">
                            섹션 연속 배정 회피, 누적 및 전역일 기준 개인별 페이스, 설정 목표치를 모두 만족합니다.
                        </p>
                    ) : (
                        <div className="space-y-1.5 flex-1 overflow-y-auto custom-scrollbar max-h-[140px] pr-1">
                            {softViolations.map((v, idx) => (
                                <div key={idx} className="flex flex-col gap-0.5 px-2.5 py-1.5 bg-slate-900/60 border border-slate-800/60 rounded-xl text-[10px] leading-normal text-slate-300">
                                    <div className="font-bold">{v.message}</div>
                                    {v.dates && v.dates.length > 0 && (
                                        <div className="text-[8px] font-black text-amber-500">위치: {formatViolationDates(v.dates)}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 기존 미배정 / 경고 영역 간소화 유지 */}
            {unassigned.length > 0 && (
                <div className="p-3.5 bg-amber-950/40 border border-amber-500/25 rounded-2xl">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="text-[10px] font-black text-amber-300">미배정 날짜 ({unassigned.length}일) — 후보가 없어 자동 결정 불가</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {unassigned.map(w => {
                            const d = parseLocalDateSimple(w.dateStr!);
                            return (
                                <span key={w.dateStr} className="px-2 py-0.5 bg-amber-950/60 border border-amber-500/30 text-amber-300 rounded-lg text-[9px] font-black">
                                    {month + 1}/{d.getDate()}({dayNames[d.getDay()]})
                                </span>
                            );
                        })}
                    </div>
                </div>
            )}

            {violations.length === 0 && (
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
                        const p = preAssignedByDate.get(dateStr);
                        const d = parseLocalDateSimple(dateStr);
                        const dow = d.getDay();
                        const isUnassigned = unassigned.some(w => w.dateStr === dateStr);

                        return (
                            <div
                                key={dateStr}
                                className={`rounded-xl p-1.5 text-center border transition-all min-h-[52px] flex flex-col items-center justify-center ${a
                                    ? 'bg-indigo-950/50 border-indigo-500/40'
                                    : p
                                        ? 'bg-slate-800/40 border-slate-700/60 opacity-80'
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
                                {p && (
                                    <>
                                        <div className="text-[8px] font-bold text-slate-300 leading-tight truncate w-full text-center px-0.5 flex items-center justify-center gap-0.5" title={p.memo}>
                                            <Lock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                                            <span>{p.memo}</span>
                                        </div>
                                        <div className="text-[7px] font-black text-slate-500">
                                            (고정)
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
