import { useState, useEffect, useMemo } from 'react';
import { X, Save, AlertCircle, Check, Loader2, Pencil, Calendar } from 'lucide-react';
import { doc, getDocs, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import axios from 'axios';
import { db } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import type { MovementRecord } from '../../types/movement/movement.type';
import { 
    formatMDToISO, 
    isPassInPeriod, 
    isVacationLinkedToPass, 
    getPeriodMovementsForMember 
} from '../../utils/movement.utils';
import { useMovementSettings } from '../../hooks/movement/useMovementSettings';

interface MovementEditModalProps {
    memberName: string; // e.g. "이재영" (cleanName)
    fullNameWithRank: string; // e.g. "병장 이재영"
    timeline: string[]; // e.g. ['9.30', '10.1', '10.2', ..., '10.9']
    initialDayStatuses: Record<string, string>;
    movements: MovementRecord[];
    baseDate?: Date;
    sheetWeeks?: any[];
    onClose: () => void;
    onSaveSuccess?: (updatedStatuses: Record<string, string>, savedMovement?: any) => void;
}

interface DateInputBoxProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    focusColor?: 'blue' | 'orange';
}

function DateInputBox({ label, value, onChange, focusColor = 'blue' }: DateInputBoxProps) {
    const focusRingClass = focusColor === 'orange'
        ? 'focus-within:ring-2 focus-within:ring-orange-500 focus-within:border-orange-500'
        : 'focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500';

    const formatDateDisplay = (isoStr: string) => {
        if (!isoStr) return '날짜 선택';
        const parts = isoStr.split('-');
        if (parts.length === 3) {
            return `${parts[0]}. ${parseInt(parts[1], 10)}. ${parseInt(parts[2], 10)}.`;
        }
        return isoStr;
    };

    return (
        <div className="min-w-0">
            <label className="text-[11px] font-semibold text-gray-600 block mb-1 truncate">
                {label}
            </label>
            <div className={cn(
                "relative flex items-center justify-between w-full min-w-0 overflow-hidden px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-300 rounded-xl transition-all shadow-sm",
                focusRingClass
            )}>
                <span className={cn(
                    "text-xs sm:text-sm font-medium truncate pointer-events-none select-none",
                    value ? "text-gray-800" : "text-gray-400"
                )}>
                    {formatDateDisplay(value)}
                </span>
                <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 shrink-0 ml-1 pointer-events-none" />
                <input
                    type="date"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onClick={(e) => {
                        try {
                            e.currentTarget.showPicker?.();
                        } catch {}
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0 p-0 border-0"
                    style={{ fontSize: '16px' }}
                />
            </div>
        </div>
    );
}

export function MovementEditModal({
    memberName,
    fullNameWithRank,
    timeline,
    initialDayStatuses,
    movements,
    baseDate,
    sheetWeeks = [],
    onClose,
    onSaveSuccess
}: MovementEditModalProps) {
    const { allowVacationPassLink } = useMovementSettings();
    const currentYear = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

    // Prevent body scrolling
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

    // Helper to check status on any date across current week and all sheetWeeks
    const checkStatusOnDate = (date: Date): { isVac: boolean; isPass: boolean } => {
        const m = date.getMonth() + 1;
        const d = date.getDate();
        const dateStr = `${m}.${d}`;

        if (initialDayStatuses[dateStr] !== undefined) {
            const st = initialDayStatuses[dateStr];
            return {
                isVac: st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart',
                isPass: st === 'pass' || st === 'pass-depart' || st === 'linked' || st === 'vacation-pass-depart'
            };
        }

        if (sheetWeeks && sheetWeeks.length > 0) {
            for (const week of sheetWeeks) {
                if (week.data && Array.isArray(week.data)) {
                    const row = week.data.find((r: any) => {
                        const c = r.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim();
                        return c === cleanName;
                    });
                    if (row && row.dayStatuses && row.dayStatuses[dateStr] !== undefined) {
                        const st = row.dayStatuses[dateStr];
                        return {
                            isVac: st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart',
                            isPass: st === 'pass' || st === 'pass-depart' || st === 'linked' || st === 'vacation-pass-depart'
                        };
                    }
                }
            }
        }

        return { isVac: false, isPass: false };
    };

    // 1. 수요일부터 다음주 화요일 사이에 있는 외박과 그와 연계되는 휴가
    // 2. 외휴연계 혹은 휴외연계되지 않는 기간 내 휴가
    const { thisPeriodPass, thisPeriodVacation } = getPeriodMovementsForMember(
        cleanName,
        timeline,
        currentYear,
        movements,
        initialDayStatuses
    );

    const existingPass = thisPeriodPass;
    const existingVacation = thisPeriodVacation;

    // Helper to find pass range strictly within coreTimeline (Wed~Tue) and expand if continuing across weeks
    const inferPassFromStatuses = () => {
        const matchedDates = coreTimeline.filter(dateStr => ['pass', 'linked', 'vacation-pass-depart'].includes(initialDayStatuses[dateStr]));
        if (matchedDates.length === 0) return { start: '', end: '' };

        const [fM, fD] = matchedDates[0].split('.').map(Number);
        const [lM, lD] = matchedDates[matchedDates.length - 1].split('.').map(Number);

        let sObj = new Date(currentYear, fM - 1, fD, 12, 0, 0, 0);
        let eObj = new Date(currentYear, lM - 1, lD, 12, 0, 0, 0);

        // Check if pass continues forward past coreTimeline across timeline and sheetWeeks
        let nextD = new Date(eObj);
        nextD.setDate(nextD.getDate() + 1);
        while (checkStatusOnDate(nextD).isPass) {
            eObj = new Date(nextD);
            nextD.setDate(nextD.getDate() + 1);
        }

        const formatIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        return {
            start: formatIso(sObj),
            end: formatIso(eObj)
        };
    };

    // Helper to find vacation range within timeline and expand across sheetWeeks boundaries
    const inferVacFromStatuses = () => {
        const matchedDates = timeline.filter(dateStr => ['vacation', 'linked', 'vacation-pass-depart'].includes(initialDayStatuses[dateStr]));
        if (matchedDates.length === 0) return { start: '', end: '' };

        const [fM, fD] = matchedDates[0].split('.').map(Number);
        const [lM, lD] = matchedDates[matchedDates.length - 1].split('.').map(Number);

        let sObj = new Date(currentYear, fM - 1, fD, 12, 0, 0, 0);
        let eObj = new Date(currentYear, lM - 1, lD, 12, 0, 0, 0);

        // Expand backward across sheetWeeks if vacation touches timeline start
        if (matchedDates[0] === timeline[0]) {
            let prevD = new Date(sObj);
            prevD.setDate(prevD.getDate() - 1);
            while (checkStatusOnDate(prevD).isVac) {
                sObj = new Date(prevD);
                prevD.setDate(prevD.getDate() - 1);
            }
        }

        // Expand forward across sheetWeeks if vacation touches timeline end
        if (matchedDates[matchedDates.length - 1] === timeline[timeline.length - 1]) {
            let nextD = new Date(eObj);
            nextD.setDate(nextD.getDate() + 1);
            while (checkStatusOnDate(nextD).isVac) {
                eObj = new Date(nextD);
                nextD.setDate(nextD.getDate() + 1);
            }
        }

        const formatIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        return {
            start: formatIso(sObj),
            end: formatIso(eObj)
        };
    };

    const inferredPass = inferPassFromStatuses();
    const inferredVac = inferVacFromStatuses();

    const initialPassStart = (existingPass && inferredPass.start && inferredPass.start < existingPass.startDate ? inferredPass.start : existingPass?.startDate) || inferredPass.start;
    const initialPassEnd = (existingPass && inferredPass.end && inferredPass.end > existingPass.endDate ? inferredPass.end : existingPass?.endDate) || inferredPass.end;
    const initialPassReason = existingPass?.reason || '';

    const initialVacStart = (existingVacation && inferredVac.start && inferredVac.start < existingVacation.startDate ? inferredVac.start : existingVacation?.startDate) || inferredVac.start;
    const initialVacEnd = (existingVacation && inferredVac.end && inferredVac.end > existingVacation.endDate ? inferredVac.end : existingVacation?.endDate) || inferredVac.end;
    let initialVacReason = existingVacation?.reason || '';
    if (initialVacStart && initialVacEnd) {
        const sD = new Date(initialVacStart);
        const eD = new Date(initialVacEnd);
        const days = Math.round((eD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const clean = initialVacReason.replace(/,?\s*외휴연계\s*[OX]?/gi, '').trim();
        if ((!clean || clean === '연가') && days > 0) {
            initialVacReason = `연가 ${days}일`;
        } else {
            initialVacReason = clean;
        }
    }

    // Pass states
    const [hasPass, setHasPass] = useState<boolean>(!!existingPass || !!inferredPass.start);
    const [passStart, setPassStart] = useState<string>(initialPassStart);
    const [passEnd, setPassEnd] = useState<string>(initialPassEnd);
    const [passReason, setPassReason] = useState<string>(initialPassReason);

    // Vacation states
    const [hasVacation, setHasVacation] = useState<boolean>(!!existingVacation || !!inferredVac.start);
    const [vacationStart, setVacationStart] = useState<string>(initialVacStart);
    const [vacationEnd, setVacationEnd] = useState<string>(initialVacEnd);
    const [vacationReason, setVacationReason] = useState<string>(initialVacReason);
    // Automatically calculate isLinked: true only if pass end date matches vacation start date
    const isLinked = !!(hasPass && hasVacation && passEnd && vacationStart && passEnd === vacationStart);

    const PASS_DAY_NAMES: Record<number, string> = {
        1: '원데이',
        2: '투데이',
        3: '쓰리데이',
        4: '포데이',
        5: '파이브데이',
    };

    const updatePassReasonForDays = (prev: string, days: number): string => {
        if (days <= 0) return prev;
        const targetWord = PASS_DAY_NAMES[days] || `${days}데이`;
        const dayRegex = /(원|투|쓰리|포|파이브)\s*데이/i;
        const numRegex = /\d+\s*(?:데이|Day|day)/i;

        if (dayRegex.test(prev)) {
            return prev.replace(dayRegex, targetWord);
        } else if (numRegex.test(prev)) {
            return prev.replace(numRegex, targetWord);
        } else if (!prev.trim() || prev.trim() === '외박') {
            return targetWord;
        } else if (/^(일반|포상|위로|보상)$/.test(prev.trim())) {
            return `${prev.trim()} ${targetWord}`;
        }
        return prev;
    };

    const handlePassStartChange = (newStart: string) => {
        setPassStart(newStart);
        if (newStart && passEnd) {
            const [sY, sM, sD] = newStart.split('-').map(Number);
            const [eY, eM, eD] = passEnd.split('-').map(Number);
            const sDate = new Date(sY, sM - 1, sD, 12, 0, 0, 0);
            const eDate = new Date(eY, eM - 1, eD, 12, 0, 0, 0);
            const days = Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            if (days > 0) {
                setPassReason(prev => updatePassReasonForDays(prev, days));
            }
        }
    };

    const handlePassEndChange = (newEnd: string) => {
        setPassEnd(newEnd);
        if (passStart && newEnd) {
            const [sY, sM, sD] = passStart.split('-').map(Number);
            const [eY, eM, eD] = newEnd.split('-').map(Number);
            const sDate = new Date(sY, sM - 1, sD, 12, 0, 0, 0);
            const eDate = new Date(eY, eM - 1, eD, 12, 0, 0, 0);
            const days = Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            if (days > 0) {
                setPassReason(prev => updatePassReasonForDays(prev, days));
            }
        }
    };

    const handleTogglePass = (checked: boolean) => {
        setHasPass(checked);
        if (checked && passStart && passEnd) {
            const [sY, sM, sD] = passStart.split('-').map(Number);
            const [eY, eM, eD] = passEnd.split('-').map(Number);
            const sDate = new Date(sY, sM - 1, sD, 12, 0, 0, 0);
            const eDate = new Date(eY, eM - 1, eD, 12, 0, 0, 0);
            const days = Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            if (days > 0) {
                setPassReason(prev => updatePassReasonForDays(prev, days));
            }
        }
    };

    const handleVacationStartChange = (newStart: string) => {
        setVacationStart(newStart);
        if (newStart && vacationEnd) {
            const sD = new Date(newStart);
            const eD = new Date(vacationEnd);
            const days = Math.round((eD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            if (days > 0) {
                setVacationReason(prev => {
                    const clean = prev.replace(/,?\s*외휴연계\s*[OX]?/gi, '').trim();
                    if (!clean || clean === '연가' || /^연가\s*\d+일/.test(clean)) {
                        return `연가 ${days}일`;
                    } else if (/\d+일/.test(clean)) {
                        return clean.replace(/\d+일/, `${days}일`);
                    }
                    return clean;
                });
            }
        }
    };

    const handleVacationEndChange = (newEnd: string) => {
        setVacationEnd(newEnd);
        if (vacationStart && newEnd) {
            const sD = new Date(vacationStart);
            const eD = new Date(newEnd);
            const days = Math.round((eD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            if (days > 0) {
                setVacationReason(prev => {
                    const clean = prev.replace(/,?\s*외휴연계\s*[OX]?/gi, '').trim();
                    if (!clean || clean === '연가' || /^연가\s*\d+일/.test(clean)) {
                        return `연가 ${days}일`;
                    } else if (/\d+일/.test(clean)) {
                        return clean.replace(/\d+일/, `${days}일`);
                    }
                    return clean;
                });
            }
        }
    };

    const handleToggleVacation = (checked: boolean) => {
        setHasVacation(checked);
        if (checked && vacationStart && vacationEnd) {
            const sD = new Date(vacationStart);
            const eD = new Date(vacationEnd);
            const days = Math.round((eD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            if (days > 0) {
                setVacationReason(prev => {
                    const clean = prev.replace(/,?\s*외휴연계\s*[OX]?/gi, '').trim();
                    if (!clean || clean === '연가') {
                        return `연가 ${days}일`;
                    }
                    return clean;
                });
            }
        }
    };

    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Helper for date to ISO
    const formatDateStr = (date: Date) => {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    // Helper to check if this member is assigned staff duty on a given date
    const isMemberDutyOnDate = (date: Date): boolean => {
        const m = date.getMonth() + 1;
        const d = date.getDate();
        const dateStr = `${m}.${d}`;

        if (initialDayStatuses[dateStr] === 'duty') {
            return true;
        }

        if (sheetWeeks && sheetWeeks.length > 0) {
            for (const week of sheetWeeks) {
                if (week.data && Array.isArray(week.data)) {
                    const row = week.data.find((r: any) => 
                        r.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim() === cleanName
                    );
                    if (row?.dayStatuses && row.dayStatuses[dateStr] === 'duty') {
                        return true;
                    }
                }
            }
        }

        return false;
    };

    // Real-time calculation of day statuses when settings change (memoized to prevent update loop)
    const dayStatuses = useMemo<Record<string, string>>(() => {
        const newStatuses: Record<string, string> = { ...initialDayStatuses };

        timeline.forEach((dateStr, tIdx) => {
            const dateIso = formatMDToISO(dateStr, currentYear, refMonth);

            let isPassDay = false;
            let isPassDepartDay = false;

            // Check pass
            if (hasPass && passStart && passEnd) {
                if (dateIso >= passStart && dateIso <= passEnd) {
                    isPassDay = true;
                } else {
                    // Check depart day (one day before passStart)
                    const startObj = new Date(passStart);
                    startObj.setDate(startObj.getDate() - 1);
                    const departIso = formatDateStr(startObj);
                    if (dateIso === departIso) {
                        isPassDepartDay = true;
                    }
                }
            }

            let isVacationDay = false;
            let isVacationReturnDay = false;

            // Check vacation
            if (hasVacation && vacationStart && vacationEnd) {
                if (dateIso >= vacationStart && dateIso <= vacationEnd) {
                    isVacationDay = true;
                    if (dateIso === vacationEnd) {
                        isVacationReturnDay = true;
                    }
                }
            }

            const initialStatus = initialDayStatuses[dateStr] || 'none';
            const isCoreDay = coreTimeline.includes(dateStr);

            if (isLinked && dateIso === vacationStart) {
                newStatuses[dateStr] = 'linked';
            } else if (isVacationReturnDay && (isPassDepartDay || (isPassDay && dateIso === passStart))) {
                newStatuses[dateStr] = 'vacation-pass-depart';
            } else if (isVacationDay) {
                newStatuses[dateStr] = 'vacation';
            } else if (isPassDay) {
                newStatuses[dateStr] = 'pass';
            } else if (isPassDepartDay) {
                let pDep = 'pass-depart';
                let isYesterdayDuty = false;
                if (tIdx > 0) {
                    const yesterdayStr = timeline[tIdx - 1];
                    isYesterdayDuty = initialDayStatuses[yesterdayStr] === 'duty';
                } else {
                    const [m, d] = dateStr.split('.').map(Number);
                    const yesterdayDate = new Date(currentYear, m - 1, d - 1, 12, 0, 0, 0);
                    const yesterdayStr = `${yesterdayDate.getMonth() + 1}.${yesterdayDate.getDate()}`;
                    if (initialDayStatuses[yesterdayStr] === 'duty') {
                        isYesterdayDuty = true;
                    } else if (sheetWeeks && sheetWeeks.length > 0) {
                        for (const week of sheetWeeks) {
                            if (week.data && Array.isArray(week.data)) {
                                const row = week.data.find((r: any) => r.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim() === cleanName);
                                if (row?.dayStatuses?.[yesterdayStr] === 'duty') {
                                    isYesterdayDuty = true;
                                    break;
                                }
                            }
                        }
                    }
                }
                if (isYesterdayDuty) {
                    pDep = 'recovery-pass-depart';
                }
                newStatuses[dateStr] = pDep;
            } else {
                // Not covered by edited pass or vacation
                if (initialStatus === 'duty' || initialStatus === 'recovery') {
                    newStatuses[dateStr] = initialStatus;
                } else if (!isCoreDay) {
                    // Preserve status outside core window (e.g. adjacent week's pass / pass-depart)
                    newStatuses[dateStr] = initialStatus;
                } else {
                    // Inside core window and not duty/recovery/pass/vacation:
                    newStatuses[dateStr] = 'none';
                }
            }
        });

        return newStatuses;
    }, [hasPass, passStart, passEnd, hasVacation, vacationStart, vacationEnd, isLinked, timeline, currentYear, initialDayStatuses, refMonth, coreTimeline, cleanName, sheetWeeks]);

    // Save changes to Firestore and Google Spreadsheet
    const handleSave = async () => {
        setErrorMessage(null);
        setSuccessMessage(null);

        // 1. 외박 검증: 시작/종료일 및 사유 기간 일치 확인
        if (hasPass) {
            if (!passStart || !passEnd) {
                setErrorMessage('외박 시작일과 종료일을 모두 입력해주세요.');
                return;
            }
            if (passStart > passEnd) {
                setErrorMessage('외박 시작일이 복귀일보다 늦을 수 없습니다.');
                return;
            }
            const [psY, psM, psD] = passStart.split('-').map(Number);
            const [peY, peM, peD] = passEnd.split('-').map(Number);
            const pSD = new Date(psY, psM - 1, psD, 12, 0, 0, 0);
            const pED = new Date(peY, peM - 1, peD, 12, 0, 0, 0);
            const passDays = Math.round((pED.getTime() - pSD.getTime()) / (1000 * 60 * 60 * 24)) + 1;

            const korMatch = passReason.match(/(원|투|쓰리|포|파이브)\s*데이/);
            const numMatch = passReason.match(/(\d+)\s*(?:데이|Day|day)/i);
            const passDayMap: Record<string, number> = { '원': 1, '투': 2, '쓰리': 3, '포': 4, '파이브': 5 };
            let expectedPassDays = 0;
            if (numMatch) expectedPassDays = parseInt(numMatch[1], 10);
            else if (korMatch) expectedPassDays = passDayMap[korMatch[1]];

            if (expectedPassDays > 0 && expectedPassDays !== passDays) {
                setErrorMessage(`외박 기간(${passDays}일)과 외박 사유에 입력된 기간(${expectedPassDays}일)이 일치하지 않습니다.`);
                return;
            }
        }

        // 2. 휴가 검증: 시작/종료일, 사유 기간 일치, 당직 중복 검사
        if (hasVacation) {
            if (!vacationStart || !vacationEnd) {
                setErrorMessage('휴가 시작일과 종료일을 모두 입력해주세요.');
                return;
            }
            if (vacationStart > vacationEnd) {
                setErrorMessage('휴가 시작일이 복귀일보다 늦을 수 없습니다.');
                return;
            }

            const [vsY, vsM, vsD] = vacationStart.split('-').map(Number);
            const [veY, veM, veD] = vacationEnd.split('-').map(Number);
            const vSD = new Date(vsY, vsM - 1, vsD, 12, 0, 0, 0);
            const vED = new Date(veY, veM - 1, veD, 12, 0, 0, 0);
            const vacationDays = Math.round((vED.getTime() - vSD.getTime()) / (1000 * 60 * 60 * 24)) + 1;

            // 사유에 적힌 일수와 선택 기간 일치 여부 확인
            const match = vacationReason.match(/(\d+(\.\d+)?)\s*일/);
            if (match) {
                const parsedDays = parseFloat(match[1]);
                if (parsedDays !== vacationDays) {
                    setErrorMessage(`휴가 기간(${vacationDays}일)과 휴가 사유에 적힌 기간(${parsedDays}일)이 일치하지 않습니다.`);
                    return;
                }
            }

            // 당직 근무와 겹치는지 검사
            const cur = new Date(vSD);
            while (cur <= vED) {
                if (isMemberDutyOnDate(cur)) {
                    const m = cur.getMonth() + 1;
                    const d = cur.getDate();
                    setErrorMessage(`${m}월 ${d}일에 당직근무가 편성되어 있어 휴가를 설정할 수 없습니다. 당직 일정을 먼저 변경해주세요.`);
                    return;
                }
                cur.setDate(cur.getDate() + 1);
            }
        }

        setSaving(true);

        try {
            // 1. Update Firestore movements
            const qExisting = query(
                collection(db, 'movements'),
                where('name', '==', cleanName)
            );
            const snapExisting = await getDocs(qExisting);
            const existingDocs = snapExisting.docs.map(d => ({ id: d.id, ...d.data() } as any));

            const batch = writeBatch(db);

            // Handle Pass Movement:
            // Match pass docs belonging to THIS period (Wednesday ~ next Tuesday)
            const periodPassDocs = existingDocs.filter(m => 
                (m.type === 'pass' || m.type === 'stay') && 
                isPassInPeriod(m, coreStartIso, coreEndIso)
            );
            const targetPassDoc = (existingPass?.id ? existingDocs.find(d => d.id === existingPass.id) : null) || periodPassDocs[0];

            if (hasPass && passStart && passEnd) {
                if (targetPassDoc) {
                    batch.update(doc(db, 'movements', targetPassDoc.id), {
                        startDate: passStart,
                        endDate: passEnd,
                        reason: passReason.trim(),
                        updatedAt: serverTimestamp()
                    });
                } else {
                    const newRef = doc(collection(db, 'movements'));
                    batch.set(newRef, {
                        name: cleanName,
                        type: 'pass',
                        startDate: passStart,
                        endDate: passEnd,
                        reason: passReason.trim(),
                        createdAt: serverTimestamp()
                    });
                }
                // Clean up any extra duplicate pass docs for this period from previous bugs
                periodPassDocs.forEach(d => {
                    if (targetPassDoc && d.id !== targetPassDoc.id) {
                        batch.delete(doc(db, 'movements', d.id));
                    }
                });
            } else if (periodPassDocs.length > 0) {
                periodPassDocs.forEach(d => {
                    batch.delete(doc(db, 'movements', d.id));
                });
            }

            // Handle Vacation Movement:
            // Match vacation docs belonging to THIS period
            const periodVacDocs = existingDocs.filter(m => {
                if (m.type !== 'vacation') return false;
                if (existingVacation?.id && m.id === existingVacation.id) return true;
                if (vacationStart && vacationEnd && m.startDate <= vacationEnd && m.endDate >= vacationStart) return true;
                // Check if linked to this period's pass
                if (hasPass && passStart && passEnd) {
                    const tempPass = { type: 'pass', startDate: passStart, endDate: passEnd } as any;
                    if (isVacationLinkedToPass(m, tempPass)) return true;
                }
                if (targetPassDoc && isVacationLinkedToPass(m, targetPassDoc)) return true;

                // Check if linked to another pass
                const otherPass = existingDocs.find(other => 
                    (other.type === 'pass' || other.type === 'stay') && 
                    !isPassInPeriod(other, coreStartIso, coreEndIso) && 
                    isVacationLinkedToPass(m, other)
                );
                if (otherPass) return false;

                // Unlinked vacation within the period
                return m.startDate <= periodEndIso && m.endDate >= periodStartIso;
            });
            const targetVacDoc = (existingVacation?.id ? existingDocs.find(d => d.id === existingVacation.id) : null)
                || periodVacDocs.find(d => d.startDate === vacationStart)
                || periodVacDocs[0];

            let finalVacReason = vacationReason.trim();
            if (hasVacation && vacationStart && vacationEnd) {
                const sD = new Date(vacationStart);
                const eD = new Date(vacationEnd);
                const days = Math.round((eD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)) + 1;

                let cleanReason = finalVacReason.replace(/,?\s*외휴연계\s*[OX]?/gi, '').trim();
                if ((!cleanReason || cleanReason === '연가') && days > 0) {
                    cleanReason = `연가 ${days}일`;
                }
                finalVacReason = cleanReason;

                if (targetVacDoc) {
                    batch.update(doc(db, 'movements', targetVacDoc.id), {
                        startDate: vacationStart,
                        endDate: vacationEnd,
                        reason: finalVacReason,
                        updatedAt: serverTimestamp()
                    });
                } else {
                    const newRef = doc(collection(db, 'movements'));
                    batch.set(newRef, {
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
                    const chosenVacId = targetVacDoc ? targetVacDoc.id : null;
                    if (!chosenVacId || d.id !== chosenVacId) {
                        batch.delete(doc(db, 'movements', d.id));
                    }
                });
            } else if (periodVacDocs.length > 0) {
                periodVacDocs.forEach(d => {
                    batch.delete(doc(db, 'movements', d.id));
                });
            }

            await batch.commit();

            // 2. Sync to Google Spreadsheet via Backend
            const toMD = (isoStr: string) => {
                if (!isoStr) return '';
                const parts = isoStr.split('-');
                if (parts.length < 3) return '';
                return `${parseInt(parts[1], 10)}.${parseInt(parts[2], 10)}`;
            };

            const cellUpdates: Record<string, string> = {};

            let passDepartMD = '';
            // 1. Pass cells
            if (hasPass && passStart && passEnd) {
                const [psY, psM, psD] = passStart.split('-').map(Number);
                const [peY, peM, peD] = passEnd.split('-').map(Number);
                const startD = new Date(psY, psM - 1, psD, 12, 0, 0, 0);
                const endD = new Date(peY, peM - 1, peD, 12, 0, 0, 0);

                // Depart day: 1 day before passStart
                const departD = new Date(startD);
                departD.setDate(departD.getDate() - 1);
                passDepartMD = `${departD.getMonth() + 1}.${departD.getDate()}`;
                cellUpdates[passDepartMD] = '외박출발';

                // Days from passStart to passEnd
                const cur = new Date(startD);
                while (cur <= endD) {
                    const md = `${cur.getMonth() + 1}.${cur.getDate()}`;
                    if (cur.getTime() === endD.getTime()) {
                        cellUpdates[md] = isLinked ? '휴가출발(연계)' : '외박복귀';
                    } else {
                        cellUpdates[md] = '외박';
                    }
                    cur.setDate(cur.getDate() + 1);
                }
            }

            // 2. Vacation cells
            if (hasVacation && vacationStart && vacationEnd) {
                const [vsY, vsM, vsD] = vacationStart.split('-').map(Number);
                const [veY, veM, veD] = vacationEnd.split('-').map(Number);
                const startD = new Date(vsY, vsM - 1, vsD, 12, 0, 0, 0);
                const endD = new Date(veY, veM - 1, veD, 12, 0, 0, 0);
                const isSingleDay = vacationStart === vacationEnd;

                const cur = new Date(startD);
                while (cur <= endD) {
                    const md = `${cur.getMonth() + 1}.${cur.getDate()}`;
                    if (cur.getTime() === startD.getTime()) {
                        if (!isLinked) {
                            cellUpdates[md] = isSingleDay ? '휴가' : '휴가출발';
                        }
                    } else if (cur.getTime() === endD.getTime()) {
                        cellUpdates[md] = '휴가복귀';
                    } else {
                        cellUpdates[md] = '휴가';
                    }
                    cur.setDate(cur.getDate() + 1);
                }

                // 휴외연계: 휴가 복귀하는 날 외박 출발한다면 (허용 시 '외박출발(연계)', 미허용 시 '외박 휴가복귀/외박출발')
                if (hasPass && passDepartMD) {
                    const vacEndMD = `${veM}.${veD}`;
                    if (vacEndMD === passDepartMD) {
                        cellUpdates[vacEndMD] = allowVacationPassLink ? '외박출발(연계)' : '외박 휴가복귀/외박출발';
                    }
                }
            }

            // dayStatuses 에 vacation-pass-depart 가 있는 경우에도 확실히 적용
            Object.entries(dayStatuses).forEach(([md, st]) => {
                if (st === 'vacation-pass-depart') {
                    cellUpdates[md] = allowVacationPassLink ? '외박출발(연계)' : '외박 휴가복귀/외박출발';
                }
            });

            // 3. Handle cleared days within core window
            coreTimeline.forEach(dateStr => {
                if (dayStatuses[dateStr] === 'none' && cellUpdates[dateStr] === undefined) {
                    cellUpdates[dateStr] = '';
                } else if (dayStatuses[dateStr] === 'duty' && cellUpdates[dateStr] === undefined) {
                    cellUpdates[dateStr] = '당직';
                }
            });

            const passDays = Object.entries(dayStatuses)
                .filter(([_, st]) => st === 'pass')
                .map(([d]) => d);

            const vacDays = Object.entries(dayStatuses)
                .filter(([_, st]) => st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart')
                .map(([d]) => d);

            passDepartMD = passDepartMD
                || Object.entries(dayStatuses).find(([_, st]) => st === 'pass-depart' || st === 'recovery-pass-depart' || st === 'vacation-pass-depart')?.[0]
                || (hasPass && passStart ? (() => {
                    const d = new Date(passStart);
                    d.setDate(d.getDate() - 1);
                    return `${d.getMonth() + 1}.${d.getDate()}`;
                })() : '');

            const passReturnMD = hasPass && passEnd ? toMD(passEnd) : (passDays[passDays.length - 1] || '');

            // Ensure name is cleanName so that backend row matching in sheet matches "차희원" without failing on "병장"
            const movementItem: any = {
                name: cleanName,
                type: hasPass ? '외박' : '잔류',
                depart: passDepartMD,
                return: passReturnMD,
                stayDays: passDays,
                period: hasPass && passStart && passEnd ? `${toMD(passStart)}~${toMD(passEnd)}` : '',
                reason: passReason || ''
            };

            if (hasVacation && vacationStart && vacationEnd) {
                movementItem.vacation = {
                    depart: toMD(vacationStart),
                    return: toMD(vacationEnd),
                    stayDays: vacDays,
                    isLinked: !!isLinked,
                    reason: vacationReason || ''
                };
            } else if (vacDays.length > 0) {
                movementItem.vacation = {
                    depart: vacDays[0],
                    return: vacDays[vacDays.length - 1],
                    stayDays: vacDays,
                    isLinked: !!isLinked,
                    reason: vacationReason || ''
                };
            }

            const baseUrl = 'https://asia-northeast3-seniorkatusa-aa594.cloudfunctions.net';

            // Send payload containing both movements array (compatible with production Cloud Functions) and memberUpdate
            const payload = {
                movements: [movementItem],
                memberUpdate: {
                    memberName: cleanName,
                    dayStatuses,
                    cellUpdates
                }
            };

            try {
                await axios.post(`${baseUrl}/updateMemberSchedule`, {
                    memberName: cleanName,
                    dayStatuses,
                    cellUpdates
                });
            } catch (postErr) {
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
                reason: passReason.trim(),
                updatedAt: new Date()
            } : null;

            // 3. Complete and notify
            onSaveSuccess?.(dayStatuses, savedMovement);
            setSuccessMessage('성공적으로 저장 및 스프레드시트에 반영되었습니다!');
            setTimeout(() => {
                onClose();
            }, 800);
        } catch (err: any) {
            console.error('Save error:', err);
            setErrorMessage(err.response?.data?.message || err.message || '저장 중 오류가 발생했습니다.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto"
            onClick={onClose}
        >
            <div 
                className="bg-white border border-gray-200 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-md sm:max-w-lg max-h-[calc(100dvh-2rem)] my-auto flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="shrink-0 flex items-center justify-between px-3.5 py-3 sm:px-5 sm:py-4 border-b border-gray-100 bg-slate-50/70">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                            <Pencil className="w-4 h-4" />
                        </div>
                        <div>
                            <h2 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                                <span>{fullNameWithRank}</span>
                                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                    주간 출타/잔디 편집
                                </span>
                            </h2>
                            <p className="text-[11px] text-gray-500">
                                {timeline[0]} ~ {timeline[timeline.length - 1]} 주간
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200/50 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 no-scrollbar">
                    {/* Error / Success Alerts */}
                    {errorMessage && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2.5 text-xs text-red-700 font-medium">
                            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                            <span>{errorMessage}</span>
                        </div>
                    )}
                    {successMessage && (
                        <div className="p-3 bg-green-50 border border-green-200 rounded-2xl flex items-center gap-2.5 text-xs text-green-700 font-bold">
                            <Check className="w-4 h-4 shrink-0 text-green-600" />
                            <span>{successMessage}</span>
                        </div>
                    )}

                    {/* Section 1: 외박 편집 */}
                    <div className="bg-slate-50/60 border border-slate-200/80 rounded-2xl p-3 sm:p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 font-bold text-sm text-gray-900 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={hasPass}
                                    onChange={(e) => handleTogglePass(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                                <span>외박 설정</span>
                            </label>
                            {hasPass && (
                                <span className="text-[11px] text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                                    외박 등록
                                </span>
                            )}
                        </div>

                        {hasPass && (
                            <div className="space-y-3 pt-1 animate-in fade-in duration-150">
                                <div className="grid grid-cols-2 gap-2">
                                    <DateInputBox
                                        label="외박 시작일"
                                        value={passStart}
                                        onChange={handlePassStartChange}
                                        focusColor="blue"
                                    />
                                    <DateInputBox
                                        label="외박 종료일 (복귀)"
                                        value={passEnd}
                                        onChange={handlePassEndChange}
                                        focusColor="blue"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                                        외박 사유
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="외박 사유 입력 (예: 일반 투데이, 포상 등)"
                                        value={passReason}
                                        onChange={(e) => setPassReason(e.target.value)}
                                        className="w-full text-xs sm:text-sm px-3 py-2 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Section 2: 휴가 편집 */}
                    <div className="bg-slate-50/60 border border-slate-200/80 rounded-2xl p-3 sm:p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 font-bold text-sm text-gray-900 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={hasVacation}
                                    onChange={(e) => handleToggleVacation(e.target.checked)}
                                    className="w-4 h-4 text-orange-600 rounded border-gray-300 focus:ring-orange-500"
                                />
                                <span>휴가 설정</span>
                            </label>
                            {hasVacation && (
                                <span className="text-[11px] text-orange-600 font-semibold bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                                    휴가 등록
                                </span>
                            )}
                        </div>

                        {hasVacation && (
                            <div className="space-y-3 pt-1 animate-in fade-in duration-150">
                                <div className="grid grid-cols-2 gap-2">
                                    <DateInputBox
                                        label="휴가 시작일 (출발)"
                                        value={vacationStart}
                                        onChange={handleVacationStartChange}
                                        focusColor="orange"
                                    />
                                    <DateInputBox
                                        label="휴가 종료일 (복귀)"
                                        value={vacationEnd}
                                        onChange={handleVacationEndChange}
                                        focusColor="orange"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                                        휴가 사유
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="휴가 사유 입력 (예: 연가 3일, 포상 등)"
                                        value={vacationReason}
                                        onChange={(e) => setVacationReason(e.target.value)}
                                        className="w-full text-xs sm:text-sm px-3 py-2 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                </div>
                                {isLinked && (
                                    <div className="pt-1 flex items-center gap-2 text-xs text-orange-800 font-bold bg-orange-100/70 border border-orange-200 px-3 py-2 rounded-xl animate-in fade-in duration-150">
                                        <span className="text-base leading-none">🔗</span>
                                        <span>외박 복귀일과 휴가 출발일이 일치하여 외휴연계가 자동 적용됩니다.</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Section 3: 잔디(출타 현황) 실시간 미리보기 - 외특 탭 스타일의 1줄 연속 표시 */}
                    <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-3 sm:p-4 space-y-2.5">
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-xs sm:text-sm text-gray-900 flex items-center gap-1.5">
                                <span>🌱 주간 출타 잔디 현황</span>
                            </h3>
                            <div className="text-[10px] sm:text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 flex items-center gap-1 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                <span>실시간 계산</span>
                            </div>
                        </div>

                        {/* Linked Single Row Grass Preview (No wrapping, fits mobile screen cleanly) */}
                        <div className="flex items-center justify-between gap-1 sm:gap-2 w-full py-1">
                            {timeline.map((dateStr) => {
                                const status = dayStatuses[dateStr] || 'none';
                                const [m, d] = dateStr.split('.').map(Number);
                                const dateObj = new Date(currentYear, m - 1, d, 12, 0, 0, 0);
                                const isWeekend = dateObj.getDay() % 6 === 0;
                                const isSunday = dateObj.getDay() === 0;

                                return (
                                    <div key={dateStr} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                                        <span className={cn(
                                            "text-[9px] sm:text-[11px] font-extrabold leading-none truncate tracking-tight",
                                            isSunday ? "text-red-500" : isWeekend ? "text-blue-600" : "text-gray-400"
                                        )}>
                                            {dateStr}
                                        </span>
                                        <div
                                            className={cn(
                                                "w-5 h-5 sm:w-6 sm:h-6 rounded-sm transition-all duration-200",
                                                status === 'none' && "bg-gray-100",
                                                status === 'pass' && "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.3)]",
                                                status === 'pass-depart' && "",
                                                status === 'vacation' && "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.3)]",
                                                status === 'duty' && "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]",
                                                status === 'recovery' && "bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.4)]",
                                                status === 'linked' && "shadow-[0_0_8px_rgba(59,130,246,0.4)]",
                                                status === 'recovery-pass-depart' && "shadow-[0_0_6px_rgba(250,204,21,0.4)]",
                                                status === 'vacation-pass-depart' && "shadow-[0_0_8px_rgba(249,115,22,0.4)]",
                                                isWeekend && "border-2 border-black"
                                            )}
                                            style={
                                                status === 'linked' ? {
                                                    background: 'linear-gradient(135deg, #3b82f6 50%, #f97316 50%)'
                                                } : status === 'vacation-pass-depart' ? {
                                                    background: 'linear-gradient(135deg, #f97316 50%, #3b82f6 50%)'
                                                } : status === 'pass-depart' ? {
                                                    background: 'linear-gradient(135deg, #f3f4f6 50%, #3b82f6 50%)'
                                                } : status === 'recovery-pass-depart' ? {
                                                    background: 'linear-gradient(135deg, #facc15 50%, #3b82f6 50%)'
                                                } : undefined
                                            }
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Footer Buttons */}
                <div className="shrink-0 flex items-center justify-end gap-2 px-3.5 py-2.5 sm:px-5 sm:py-3.5 border-t border-gray-100 bg-slate-50/70">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2 text-xs sm:text-sm font-bold text-gray-600 hover:bg-gray-200/60 rounded-xl transition-colors"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-5 py-2 text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 rounded-xl shadow-md shadow-blue-200 transition-all"
                    >
                        {saving ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>스프레드시트 반영 중...</span>
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                <span>저장 및 시트 반영</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
