import { useState, useEffect } from 'react';
import { X, Save, AlertCircle, Check, Loader2, Pencil } from 'lucide-react';
import { doc, getDocs, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import axios from 'axios';
import { db } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import type { MovementRecord } from '../../types/movement/movement.type';

interface MovementEditModalProps {
    memberName: string; // e.g. "이재영" (cleanName)
    fullNameWithRank: string; // e.g. "병장 이재영"
    timeline: string[]; // e.g. ['9.30', '10.1', '10.2', ..., '10.9']
    initialDayStatuses: Record<string, string>;
    movements: MovementRecord[];
    baseDate?: Date;
    sheetWeeks?: any[];
    onClose: () => void;
    onSaveSuccess?: (updatedStatuses: Record<string, string>) => void;
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

    // Timeline start and end ISO calculation
    const [firstM, firstD] = (timeline[0] || '1.1').split('.').map(Number);
    const [lastM, lastD] = (timeline[timeline.length - 1] || '1.1').split('.').map(Number);
    const tStartIso = `${currentYear}-${String(firstM).padStart(2, '0')}-${String(firstD).padStart(2, '0')}`;
    const tEndIso = `${currentYear}-${String(lastM).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;

    // Clean name without rank (e.g. "차희원")
    const cleanName = memberName.replace(/\s*(병장|상병|일병|이병)/g, '').trim();
    const memberMovements = movements.filter(m => m.name === cleanName);

    // Helper to find contiguous status range across current timeline and adjacent sheetWeeks
    const inferContiguousDatesFromStatuses = (statusTypes: string[]) => {
        const matchedDates = timeline.filter(dateStr => statusTypes.includes(initialDayStatuses[dateStr]));
        if (matchedDates.length === 0) return { start: '', end: '' };

        const [fM, fD] = matchedDates[0].split('.').map(Number);
        const [lM, lD] = matchedDates[matchedDates.length - 1].split('.').map(Number);

        let startDateObj = new Date(currentYear, fM - 1, fD, 12, 0, 0, 0);
        let endDateObj = new Date(currentYear, lM - 1, lD, 12, 0, 0, 0);

        // Helper to check if a specific Date has one of statusTypes in sheetWeeks
        const checkStatusOnDate = (dateObj: Date): boolean => {
            if (!sheetWeeks || sheetWeeks.length === 0) return false;
            const m = dateObj.getMonth() + 1;
            const d = dateObj.getDate();
            const dateStr = `${m}.${d}`;

            for (const week of sheetWeeks) {
                if (week.data && Array.isArray(week.data)) {
                    const memberRow = week.data.find((row: any) => {
                        const clean = row.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim();
                        return clean === cleanName;
                    });
                    if (memberRow && memberRow.dayStatuses && statusTypes.includes(memberRow.dayStatuses[dateStr])) {
                        return true;
                    }
                }
            }
            return false;
        };

        // If the activity touches the first date of current timeline, trace backwards into previous weeks
        if (matchedDates[0] === timeline[0]) {
            let prevDate = new Date(startDateObj);
            prevDate.setDate(prevDate.getDate() - 1);
            while (checkStatusOnDate(prevDate)) {
                startDateObj = new Date(prevDate);
                prevDate.setDate(prevDate.getDate() - 1);
            }
        }

        // If the activity touches the last date of current timeline, trace forwards into subsequent weeks
        if (matchedDates[matchedDates.length - 1] === timeline[timeline.length - 1]) {
            let nextDate = new Date(endDateObj);
            nextDate.setDate(nextDate.getDate() + 1);
            while (checkStatusOnDate(nextDate)) {
                endDateObj = new Date(nextDate);
                nextDate.setDate(nextDate.getDate() + 1);
            }
        }

        const sYear = startDateObj.getFullYear();
        const sMonth = String(startDateObj.getMonth() + 1).padStart(2, '0');
        const sDay = String(startDateObj.getDate()).padStart(2, '0');

        const eYear = endDateObj.getFullYear();
        const eMonth = String(endDateObj.getMonth() + 1).padStart(2, '0');
        const eDay = String(endDateObj.getDate()).padStart(2, '0');

        return {
            start: `${sYear}-${sMonth}-${sDay}`,
            end: `${eYear}-${eMonth}-${eDay}`
        };
    };

    const inferredPass = inferContiguousDatesFromStatuses(['pass']);
    const inferredVac = inferContiguousDatesFromStatuses(['vacation', 'linked']);

    // Check existing movements overlapping either the timeline or contiguous range
    const existingPass = memberMovements.find(m => {
        if (m.type !== 'pass') return false;
        const checkStart = inferredPass.start || tStartIso;
        const checkEnd = inferredPass.end || tEndIso;
        return m.startDate <= checkEnd && m.endDate >= checkStart;
    });

    const existingVacation = memberMovements.find(m => {
        if (m.type !== 'vacation') return false;
        const checkStart = inferredVac.start || tStartIso;
        const checkEnd = inferredVac.end || tEndIso;
        return m.startDate <= checkEnd && m.endDate >= checkStart;
    });

    const initialPassStart = existingPass?.startDate || inferredPass.start;
    const initialPassEnd = existingPass?.endDate || inferredPass.end;
    const initialPassReason = existingPass?.reason || '';

    const initialVacStart = existingVacation?.startDate || inferredVac.start;
    const initialVacEnd = existingVacation?.endDate || inferredVac.end;
    let initialVacReason = existingVacation?.reason || '';
    if (!initialVacReason && initialVacStart && initialVacEnd) {
        const sD = new Date(initialVacStart);
        const eD = new Date(initialVacEnd);
        const days = Math.round((eD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        if (days > 0) {
            initialVacReason = `연가 ${days}일`;
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

    const [dayStatuses, setDayStatuses] = useState<Record<string, string>>(() => ({
        ...initialDayStatuses
    }));

    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Helper for date to ISO
    const formatDateStr = (date: Date) => {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    // Real-time calculation of day statuses when settings change
    useEffect(() => {
        const newStatuses: Record<string, string> = {};

        timeline.forEach((dateStr, tIdx) => {
            const [m, d] = dateStr.split('.').map(Number);
            const dateIso = `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

            let status = 'none';

            // Check pass
            if (hasPass && passStart && passEnd) {
                if (dateIso >= passStart && dateIso <= passEnd) {
                    status = 'pass';
                } else {
                    // Check depart day (one day before passStart)
                    const startObj = new Date(passStart);
                    startObj.setDate(startObj.getDate() - 1);
                    const departIso = formatDateStr(startObj);
                    if (dateIso === departIso) {
                        status = 'pass-depart';
                    }
                }
            }

            // Check vacation
            if (hasVacation && vacationStart && vacationEnd) {
                if (dateIso >= vacationStart && dateIso <= vacationEnd) {
                    if (isLinked && dateIso === vacationStart) {
                        status = 'linked';
                    } else {
                        status = 'vacation';
                    }
                }
            }

            // Check recovery-pass-depart: if departing for pass on day after duty
            if (status === 'pass-depart' || status === 'pass') {
                const yesterdayStr = tIdx > 0 ? timeline[tIdx - 1] : null;
                const yesterdayStatus = yesterdayStr ? initialDayStatuses[yesterdayStr] : null;
                if (yesterdayStatus === 'duty') {
                    status = 'recovery-pass-depart';
                }
            }

            // Preserve duty or recovery if not overridden
            const initialStatus = initialDayStatuses[dateStr];
            if (status === 'none' && (initialStatus === 'duty' || initialStatus === 'recovery')) {
                status = initialStatus;
            }

            newStatuses[dateStr] = status;
        });

        setDayStatuses(newStatuses);
    }, [hasPass, passStart, passEnd, hasVacation, vacationStart, vacationEnd, isLinked, timeline, currentYear, initialDayStatuses]);

    // Save changes to Firestore and Google Spreadsheet
    const handleSave = async () => {
        setSaving(true);
        setErrorMessage(null);
        setSuccessMessage(null);

        try {
            // 1. Update Firestore movements
            const qExisting = query(
                collection(db, 'movements'),
                where('name', '==', cleanName)
            );
            const snapExisting = await getDocs(qExisting);
            const existingDocs = snapExisting.docs.map(d => ({ id: d.id, ...d.data() } as any));

            const batch = writeBatch(db);

            // Handle Pass Movement
            const currentPassDoc = existingDocs.find(m => m.type === 'pass' && m.startDate <= tEndIso && m.endDate >= tStartIso);
            if (hasPass && passStart && passEnd) {
                if (currentPassDoc) {
                    batch.update(doc(db, 'movements', currentPassDoc.id), {
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
            } else if (currentPassDoc) {
                batch.delete(doc(db, 'movements', currentPassDoc.id));
            }

            // Handle Vacation Movement
            const currentVacDoc = existingDocs.find(m => m.type === 'vacation' && m.startDate <= tEndIso && m.endDate >= tStartIso);
            if (hasVacation && vacationStart && vacationEnd) {
                let finalVacReason = vacationReason.trim();
                if (isLinked) {
                    if (!finalVacReason.includes('외휴연계')) {
                        finalVacReason = finalVacReason ? `${finalVacReason}, 외휴연계 O` : '외휴연계 O';
                    }
                } else {
                    finalVacReason = finalVacReason.replace(/,?\s*외휴연계\s*[OX]?/gi, '').trim();
                }

                if (currentVacDoc) {
                    batch.update(doc(db, 'movements', currentVacDoc.id), {
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
            } else if (currentVacDoc) {
                batch.delete(doc(db, 'movements', currentVacDoc.id));
            }

            await batch.commit();

            // 2. Sync to Google Spreadsheet via Backend
            const toMD = (isoStr: string) => {
                if (!isoStr) return '';
                const parts = isoStr.split('-');
                if (parts.length < 3) return '';
                return `${parseInt(parts[1], 10)}.${parseInt(parts[2], 10)}`;
            };

            const passDays = Object.entries(dayStatuses)
                .filter(([_, st]) => st === 'pass')
                .map(([d]) => d);

            const vacDays = Object.entries(dayStatuses)
                .filter(([_, st]) => st === 'vacation' || st === 'linked')
                .map(([d]) => d);

            const passDepartMD = Object.entries(dayStatuses).find(([_, st]) => st === 'pass-depart' || st === 'recovery-pass-depart')?.[0]
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
                    dayStatuses
                }
            };

            try {
                await axios.post(`${baseUrl}/updateMemberSchedule`, {
                    memberName: cleanName,
                    dayStatuses
                });
            } catch (postErr) {
                await axios.post(`${baseUrl}/syncMovementToSheet`, payload);
            }

            // 3. Complete and notify
            onSaveSuccess?.(dayStatuses);
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
                                    onChange={(e) => setHasPass(e.target.checked)}
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
                                    <div>
                                        <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                                            외박 시작일
                                        </label>
                                        <input
                                            type="date"
                                            value={passStart}
                                            onChange={(e) => setPassStart(e.target.value)}
                                            className="w-full text-xs sm:text-sm px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                                            외박 종료일 (복귀)
                                        </label>
                                        <input
                                            type="date"
                                            value={passEnd}
                                            onChange={(e) => setPassEnd(e.target.value)}
                                            className="w-full text-xs sm:text-sm px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                                        />
                                    </div>
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
                                    onChange={(e) => setHasVacation(e.target.checked)}
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
                                    <div>
                                        <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                                            휴가 시작일 (출발)
                                        </label>
                                        <input
                                            type="date"
                                            value={vacationStart}
                                            onChange={(e) => setVacationStart(e.target.value)}
                                            className="w-full text-xs sm:text-sm px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                                            휴가 종료일 (복귀)
                                        </label>
                                        <input
                                            type="date"
                                            value={vacationEnd}
                                            onChange={(e) => setVacationEnd(e.target.value)}
                                            className="w-full text-xs sm:text-sm px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
                                        />
                                    </div>
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
                                                isWeekend && "border-2 border-black"
                                            )}
                                            style={
                                                status === 'linked' ? {
                                                    background: 'linear-gradient(135deg, #3b82f6 50%, #f97316 50%)'
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
