import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertCircle, X } from 'lucide-react';
import { useDutySync } from '../../hooks/duty/useDutySync';
import { isBlc30Days } from '../../utils/calendar.utils';
import { useDutyState } from '../../hooks/duty/useDutyState';
import { useDutyTemplate } from '../../hooks/duty/useDutyTemplate';
import { DutySidebar } from './DutySidebar';
import { DutyHeader } from './DutyHeader';
import { DutyCalendarGrid } from './DutyCalendarGrid';
import { DutyTemplateGrid } from './DutyTemplateGrid';
import { DutyAutoDistributeModal } from './DutyAutoDistributeModal';
import { db } from '../../lib/firebase';
import { doc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';
import type { AssignedDuty } from '../../utils/duty/dutyAutoDistribute';
import { getActiveSectionsFor } from '../../utils/duty/dutyAutoDistribute';
import { exportCalendarImage } from '../../utils/duty/exportCalendarImage';

interface DutySchedulerWorkspaceProps {
    onClose: () => void;
}

export default function DutySchedulerWorkspace({ onClose }: DutySchedulerWorkspaceProps) {
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    const {
        events, members, ktaTemplate, blcTemplate, personalRestrictions, loading,
        extraBefore, extraAfter,
        ktaDayLabels, setKtaDayLabels, restrictions, setRestrictions,
        blcDayLabels, setBlcDayLabels, blcRestrictions, setBlcRestrictions,
        monthlyDayLabels,
        dutyHolidays, handleAddDutyHoliday, handleDeleteDutyHoliday,
        ktaSections, setKtaSections, blcSections, setBlcSections
    } = useDutySync(showToast);

    const [isMonthlyLabelsModalOpen, setIsMonthlyLabelsModalOpen] = useState(false);
    const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
    const [isAutoDistributeModalOpen, setIsAutoDistributeModalOpen] = useState(false);

    const {
        currentDate, setCurrentDate,
        viewMode, setViewMode,
        restrictionBrush, setRestrictionBrush,
        selectedMember, setSelectedMember,
        duties, setDuties,
        currentMonthDuties, dutyStats,
        dutiesInitialized,
        togglePersonalRestriction,
        handleCellClick: baseHandleCellClick, handleClearDate, handleClearMonth,
        handleConfirmDuties,
        markCurrentMonthAsEdited,
        configs, lockedMembers,
        updateConfig, toggleLock
    } = useDutyState({ events, members, personalRestrictions, dutyHolidays, showToast });







    const [isForceAssignMode, setIsForceAssignMode] = useState(false);
    const [exportPreviewUrl, setExportPreviewUrl] = useState<string | null>(null);

    const {
        handleToggleRestriction,
        handleToggleBlcRestriction,
        handleSaveTemplateSettings,
        handleSaveBlcTemplateSettings
    } = useDutyTemplate({
        ktaTemplate, blcTemplate,
        restrictions, blcRestrictions,
        ktaDayLabels, blcDayLabels,
        extraBefore, extraAfter,
        setRestrictions, setBlcRestrictions,
        showToast,
        ktaSections,
        blcSections
    });

    const handleToggleSectionMapping = (mode: 'kta' | 'blc', section: string) => {
        if (mode === 'kta') {
            setKtaSections(prev =>
                prev.includes(section)
                    ? prev.filter(s => s !== section)
                    : [...prev, section]
            );
        } else {
            setBlcSections(prev =>
                prev.includes(section)
                    ? prev.filter(s => s !== section)
                    : [...prev, section]
            );
        }
    };

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const currentMonthBlcEvent = events.find(e => e.type === 'blc' && e.memo?.includes('Day 0') && new Date(e.startDate).getMonth() === month && new Date(e.startDate).getFullYear() === year);
    const isBlc30 = currentMonthBlcEvent ? isBlc30Days(currentMonthBlcEvent.batch || '') : false;

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    const handleAddMonthlyLabel = async (dayNum: number, labelText: string) => {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        try {
            await setDoc(doc(db, 'settings', 'monthlyDayLabels'), {
                [dateStr]: labelText
            }, { merge: true });
            showToast(`${dayNum}일에 레이블 '${labelText}'이 등록되었습니다.`);
        } catch (e) {
            console.error("Error saving monthly day label:", e);
            showToast("레이블 저장 중 오류가 발생했습니다.", "error");
        }
    };

    const handleDeleteMonthlyLabel = async (dateStr: string) => {
        try {
            await updateDoc(doc(db, 'settings', 'monthlyDayLabels'), {
                [dateStr]: deleteField()
            });
            showToast("레이블이 삭제되었습니다.");
        } catch (e) {
            console.error("Error deleting monthly day label:", e);
            showToast("레이블 삭제 중 오류가 발생했습니다.", "error");
        }
    };



    const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
    const firstDayIndex = () => new Date(year, month, 1).getDay();

    const getCalendarDays = () => {
        const days = [];
        const startDayIdx = firstDayIndex();
        const monthDaysCount = daysInMonth(year, month);
        const prevMonthDaysCount = daysInMonth(year, month - 1);

        for (let i = startDayIdx - 1; i >= 0; i--) {
            const prevD = prevMonthDaysCount - i;
            const prevM = month === 0 ? 11 : month - 1;
            const prevY = month === 0 ? year - 1 : year;
            days.push({
                dayNumber: prevD,
                dateStr: `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(prevD).padStart(2, '0')}`,
                isCurrentMonth: false
            });
        }
        for (let d = 1; d <= monthDaysCount; d++) {
            days.push({
                dayNumber: d,
                dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                isCurrentMonth: true
            });
        }
        const totalCells = Math.ceil(days.length / 7) * 7;
        const nextMonthCells = totalCells - days.length;
        for (let d = 1; d <= nextMonthCells; d++) {
            const nextM = month === 11 ? 0 : month + 1;
            const nextY = month === 11 ? year + 1 : year;
            days.push({
                dayNumber: d,
                dateStr: `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                isCurrentMonth: false
            });
        }
        return days;
    };

    const getDutyForDate = (dateStr: string) => duties.find((d: CalendarEvent) => d.startDate === dateStr);
    const isHolidayDate = (dateStr: string) => events.some((e: CalendarEvent) => e.type === 'holiday' && e.holidayType !== 'duty' && dateStr >= e.startDate && dateStr <= e.endDate);

    const parseLocalDate = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    };

    const getKtaBlcEventsForDate = (dateStr: string) => {
        const ktaBlcEvents: CalendarEvent[] = [];
        const blcDay0s = events.filter((e: CalendarEvent) => e.type === 'blc' && e.memo?.includes('Day 0'));

        blcDay0s.forEach((day0: CalendarEvent) => {
            const start = parseLocalDate(day0.startDate);
            const batch = day0.batch || "";
            let dayCount = 0;
            let current = new Date(start);

            if (day0.startDate === dateStr) {
                ktaBlcEvents.push({ id: `blc-day0-${day0.id}`, type: 'blc', startDate: day0.startDate, endDate: day0.startDate, memo: `Day 0 (${batch})`, batch });
            }

            const limit = isBlc30Days(batch) ? 30 : 22;
            while (dayCount < limit) {
                current.setDate(current.getDate() + 1);
                const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                const isSunday = current.getDay() === 0;

                if (!isSunday && !isHolidayDate(currentStr)) {
                    dayCount++;
                    if (dayCount === limit && currentStr === dateStr) {
                        const isDuringPoday = currentStr >= '2026-06-19' && currentStr <= '2026-06-22';
                        if (!isDuringPoday) {
                            ktaBlcEvents.push({ id: `dynamic-blc-grad-${batch}`, type: 'blc', startDate: currentStr, endDate: currentStr, memo: `Graduation (${batch})`, batch });
                        }
                    }
                }
            }
        });

        const ktaEvents = events.filter((e: CalendarEvent) => e.type === 'kta');
        ktaEvents.forEach((e: CalendarEvent) => {
            if (e.startDate === dateStr) {
                if (e.memo?.includes('Day 0') || e.memo?.includes('Graduation') || e.memo?.includes('수료') || e.memo?.includes('🎓') || e.memo?.includes('수료포데이')) {
                    ktaBlcEvents.push(e);
                }
            }
        });

        const baseBlcEvents = events.filter((e: CalendarEvent) => e.type === 'blc');
        baseBlcEvents.forEach((e: CalendarEvent) => {
            if (e.startDate <= dateStr && e.endDate >= dateStr) {
                if (e.memo?.includes('수료포데이')) {
                    ktaBlcEvents.push(e);
                }
            }
        });

        return ktaBlcEvents;
    };

    const getBlcActiveDay = (day0DateStr: string, targetDateStr: string, batch?: string) => {
        const start = parseLocalDate(day0DateStr);
        const target = parseLocalDate(targetDateStr);

        if (start.getTime() === target.getTime()) return 0;

        if (target > start) {
            let dayCount = 0;
            let current = new Date(start);
            const limit = (batch && isBlc30Days(batch)) ? 30 : 22;
            while (current < target) {
                current.setDate(current.getDate() + 1);
                if (dayCount < limit) {
                    const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                    const isSunday = current.getDay() === 0;
                    if (!isSunday && !isHolidayDate(currentStr)) {
                        dayCount++;
                    }
                } else {
                    dayCount++;
                }
            }
            return dayCount;
        } else {
            // 입소일(Day 0) 이전의 날짜는 단순 달력 일수 차이(음수)로 계산합니다.
            // 입소 전이기 때문에 주말/공휴일 제외 규칙을 적용하지 않습니다.
            const diffTime = target.getTime() - start.getTime();
            return Math.round(diffTime / (1000 * 60 * 60 * 24));
        }
    };

    const isMemberEligibleForDuty = (member: CalendarMember) => {
        if (member.role === 'runner') return false;

        const stats = dutyStats[member.name] || { weekday: 0, friSun: 0, sat: 0 };
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
        const isSK = member.sections?.includes('SK') || false;
        const isCompleted = isSK || !!member.dutyCompleted || (stats.weekday >= criteriaWeekday && stats.friSun >= criteriaFriSun && stats.sat >= criteriaSat);

        if (isCompleted) return false;
        return true;
    };

    const getConsecutiveRestrictionReason = (memberName: string, dateStr: string, allDuties: CalendarEvent[]) => {
        const targetMember = members.find(m => m.name === memberName);
        if (!targetMember) return null;

        let reason: string | null = null;

        allDuties.some((d: CalendarEvent) => {
            if (d.type !== 'duty' || !d.memo) return false;

            const dutyMember = members.find(m => m.name === d.memo);
            if (!dutyMember) return false;

            const date1 = new Date(dateStr + 'T00:00:00');
            const date2 = new Date(d.startDate + 'T00:00:00');
            const diffTime = date2.getTime() - date1.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

            if (dutyMember.name === targetMember.name) {
                if (diffDays === -2 || diffDays === -1 || diffDays === 1 || diffDays === 2) {
                    reason = '개인: 앞뒤 이틀 내 당직 있음';
                    return true;
                }
            }

            if (dutyMember.sections && targetMember.sections) {
                if (diffDays === -1 || diffDays === 1) {
                    const targetActiveOnDate = getActiveSectionsFor(targetMember, dateStr, events);
                    const dutyMemberActiveOnDutyDate = getActiveSectionsFor(dutyMember, d.startDate, events);
                    const hasIntersection = Array.from(targetActiveOnDate).some(s => dutyMemberActiveOnDutyDate.has(s));
                    if (hasIntersection) {
                        reason = '같은 섹션: 연달아 당직 불가';
                        return true;
                    }
                }
            }

            return false;
        });

        return reason;
    };

    const getMemberDutyRestrictionReason = (member: CalendarMember, dateStr: string) => {
        if (member.role === 'runner') return null;

        // 신병보호기간 체크 (전입일 포함 15일 동안은 배정 차단)
        if (member.joinDate) {
            const join = parseLocalDate(member.joinDate);
            const current = parseLocalDate(dateStr);
            const diffTime = current.getTime() - join.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays < 15) {
                return '신병보호기간';
            }
        }

        const stats = dutyStats[member.name] || { weekday: 0, friSun: 0, sat: 0 };
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
        const isSK = member.sections?.includes('SK') || false;
        const isCompleted = isSK || !!member.dutyCompleted || (stats.weekday >= criteriaWeekday && stats.friSun >= criteriaFriSun && stats.sat >= criteriaSat);

        if (isCompleted) return 'completed';

        const consecutiveReason = getConsecutiveRestrictionReason(member.name, dateStr, duties);
        if (consecutiveReason) return consecutiveReason;

        // BLC 수료포데이 당직 불가 체크 (13-16 포데이라면 12-16 당직 불가)
        if (member.sections?.includes('BLC')) {
            const hasBlcFourDayRestriction = events.some(e => {
                if (e.type !== 'blc' || !e.memo?.includes('수료포데이')) return false;
                const start = parseLocalDate(e.startDate);
                const startMinus1 = new Date(start);
                startMinus1.setDate(startMinus1.getDate() - 1);
                const startMinus1Str = `${startMinus1.getFullYear()}-${String(startMinus1.getMonth() + 1).padStart(2, '0')}-${String(startMinus1.getDate()).padStart(2, '0')}`;
                return dateStr >= startMinus1Str && dateStr <= e.endDate;
            });
            if (hasBlcFourDayRestriction) {
                return 'BLC 수료포데이';
            }
        }

        const memberBlcSections = member.sections?.filter(sec => blcSections.includes(sec)) || [];
        if (memberBlcSections.length > 0) {
            const blcDay0s = events.filter((e: CalendarEvent) => e.type === 'blc' && e.memo?.includes('Day 0'));
            for (const day0 of blcDay0s) {
                const diffDays = getBlcActiveDay(day0.startDate, dateStr, day0.batch);
                const is30 = day0.batch ? isBlc30Days(day0.batch) : false;
                const minDay = is30 ? -2 : -1;
                const maxDay = is30 ? 30 : 26;
                // BLC 템플릿 유효 범위 내에서만 판단 (30일 기수: Day -2 ~ Day 30, 22일 기수: Day -1 ~ Day 26)
                if (diffDays >= minDay && diffDays <= maxDay) {
                    const dayRestriction = blcRestrictions[diffDays];
                    if (dayRestriction) {
                        for (const sec of memberBlcSections) {
                            if (dayRestriction[sec]) return `BLC 일정으로 제한 (Day ${diffDays})`;
                        }
                        if (memberBlcSections.includes('BLC') && dayRestriction['blc']) return `BLC 일정으로 제한 (Day ${diffDays})`;
                        if (memberBlcSections.includes('S3') && dayRestriction['s3']) return `BLC 일정으로 제한 (Day ${diffDays})`;
                        if (memberBlcSections.includes('PAO') && dayRestriction['pao']) return `BLC 일정으로 제한 (Day ${diffDays})`;
                    }
                }
            }
        }

        const memberKtaSections = member.sections?.filter(sec => ktaSections.includes(sec)) || [];
        if (memberKtaSections.length > 0) {
            const ktaEvents = events.filter((e: CalendarEvent) => e.type === 'kta' && e.memo?.includes('Day 0'));
            for (const e of ktaEvents) {
                const startKta = parseLocalDate(e.startDate);
                const currentDay = parseLocalDate(dateStr);
                const diffTime = currentDay.getTime() - startKta.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                // KTA 템플릿 유효 범위 (Day -3 ~ Day 24) 내에서만 판단
                if (diffDays >= -3 && diffDays <= 24) {
                    const restriction = restrictions[diffDays];
                    if (restriction) {
                        for (const sec of memberKtaSections) {
                            if (restriction[sec]) return `KTA 일정으로 제한 (Day ${diffDays})`;
                        }
                        if (memberKtaSections.includes('KTA') && restriction['kta']) return `KTA 일정으로 제한 (Day ${diffDays})`;
                        if (memberKtaSections.includes('MEDIC') && restriction['medic']) return `KTA 일정으로 제한 (Day ${diffDays})`;
                        if (memberKtaSections.includes('PAO') && restriction['pao']) return `KTA 일정으로 제한 (Day ${diffDays})`;
                    }
                }
            }
        }

        if (personalRestrictions[dateStr]?.includes(member.name)) {
            return '개인 사정 불가';
        }

        return null;
    };

    const handleCellClick = (dateStr: string, directMemberName?: string) => {
        const targetMemberName = directMemberName || selectedMember?.name;

        if (viewMode === 'actual' && restrictionBrush === 'personal') {
            if (targetMemberName) {
                const memberObj = members.find(m => m.name === targetMemberName);
                if (memberObj) {
                    const reason = getMemberDutyRestrictionReason(memberObj, dateStr);
                    // 개인 사정 불가 이외의 강력한 제한(BLC, KTA, 신병보호 등)이 이미 걸려있다면 설정 차단
                    if (reason && reason !== '개인 사정 불가') {
                        showToast(`${targetMemberName} 대원은 이미 타 일정(${reason})으로 제한되어 있어 개인 일정을 설정할 수 없습니다.`, "error");
                        return;
                    }
                }
            }
            baseHandleCellClick(dateStr, directMemberName);
            return;
        }

        if (targetMemberName) {
            const memberObj = members.find(m => m.name === targetMemberName);
            if (memberObj) {
                const reason = getMemberDutyRestrictionReason(memberObj, dateStr);
                if (reason) {
                    if (isForceAssignMode) {
                        showToast(`[강제 배정] 제한 사유가 있는 ${targetMemberName} 대원을 강제 배정했습니다 (${reason}).`, "success");
                        setIsForceAssignMode(false);
                    } else {
                        if (reason === 'completed') {
                            showToast(`${targetMemberName} 대원은 이미 당직 요건을 채웠거나 완료된 상태입니다.`, "error");
                            return;
                        }
                        if (reason === 'runner') {
                            showToast(`${targetMemberName} 대원은 러너이므로 당직 배정이 불가능합니다.`, "error");
                            return;
                        }
                        showToast(`${targetMemberName} 대원은 당직 배정이 제한되어 있습니다 (${reason}).`, "error");
                        return;
                    }
                }
            }
        }

        baseHandleCellClick(dateStr, directMemberName);
    };

    return (
        <div className="fixed inset-0 z-50 flex bg-slate-950 text-slate-100 overflow-hidden font-sans h-full w-full">
            {toast && (
                <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3.5 rounded-2xl shadow-2xl transition-all border animate-in slide-in-from-bottom-6 duration-300 pointer-events-none max-w-sm ${toast.type === 'success'
                    ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/80 border-rose-500/30 text-rose-300'
                    }`}>
                    {toast.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    <span className="text-sm font-bold text-center w-full">{toast.message}</span>
                </div>
            )}

            <DutySidebar
                configs={configs}
                viewMode={viewMode}
                loading={loading || !dutiesInitialized}
                members={members}
                dutyStats={dutyStats}
                restrictionBrush={restrictionBrush}
                setRestrictionBrush={setRestrictionBrush}
                ktaDayLabels={ktaDayLabels}
                setKtaDayLabels={setKtaDayLabels}
                blcDayLabels={blcDayLabels}
                setBlcDayLabels={setBlcDayLabels}
                handleSaveTemplateSettings={handleSaveTemplateSettings}
                handleSaveBlcTemplateSettings={handleSaveBlcTemplateSettings}
                showToast={showToast}
                dutyHolidays={dutyHolidays}
                handleAddDutyHoliday={handleAddDutyHoliday}
                handleDeleteDutyHoliday={handleDeleteDutyHoliday}
                ktaSections={ktaSections}
                blcSections={blcSections}
                handleToggleSectionMapping={handleToggleSectionMapping}
                currentDate={currentDate}
                onOpenAutoDistributeModal={() => setIsAutoDistributeModalOpen(true)}
                onOpenMonthlyLabelsModal={() => setIsMonthlyLabelsModalOpen(true)}
                selectedMember={selectedMember}
                setSelectedMember={setSelectedMember}
            />

            <main className="flex-1 bg-slate-950 flex flex-col min-w-0 h-full overflow-hidden">
                <DutyHeader
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    year={year}
                    month={month}
                    prevMonth={prevMonth}
                    nextMonth={nextMonth}
                    handleClearMonth={handleClearMonth}
                    onClose={onClose}
                    onOpenInfoModal={() => setIsInfoModalOpen(true)}
                    onConfirmDuties={handleConfirmDuties}
                    onExportImage={() => {
                        const dataUrl = exportCalendarImage({
                            year,
                            month,
                            calendarDays: getCalendarDays(),
                            duties,
                            events,
                            dutyHolidays,
                            ktaDayLabels,
                            blcDayLabels,
                            monthlyDayLabels
                        });
                        if (dataUrl) {
                            setExportPreviewUrl(dataUrl);
                        }
                    }}
                    isForceAssignMode={isForceAssignMode}
                    setIsForceAssignMode={setIsForceAssignMode}
                />

                {viewMode !== 'blc-template' && (
                    <div className="grid grid-cols-7 border-b border-slate-850 bg-slate-900/20 text-center py-3.5 text-xs font-black tracking-wide text-slate-400 shrink-0">
                        {(viewMode === 'kta-template' ? ["월", "화", "수", "목", "금", "토", "일"] : ["일", "월", "화", "수", "목", "금", "토"]).map((name) => {
                            const isBlue = name === "금" || name === "일";
                            const isRed = name === "토";
                            return (
                                <div
                                    key={name}
                                    className={isBlue ? 'text-sky-400 font-black' : isRed ? 'text-rose-400 font-black' : ''}
                                >
                                    {name}요일
                                </div>
                            );
                        })}
                    </div>
                )}

                {viewMode === 'actual' ? (
                    <DutyCalendarGrid
                        calendarDays={getCalendarDays()}
                        members={members}
                        events={events}
                        currentMonthDuties={currentMonthDuties}
                        ktaDayLabels={ktaDayLabels}
                        blcDayLabels={blcDayLabels}
                        monthlyDayLabels={monthlyDayLabels}
                        currentDate={currentDate}
                        getKtaBlcEventsForDate={getKtaBlcEventsForDate}
                        getDutyForDate={getDutyForDate}
                        isMemberEligibleForDuty={isMemberEligibleForDuty}
                        getMemberDutyRestrictionReason={getMemberDutyRestrictionReason}
                        handleCellClick={handleCellClick}
                        handleClearDate={handleClearDate}
                        togglePersonalRestriction={togglePersonalRestriction}
                        dutyHolidays={dutyHolidays}
                        selectedMember={selectedMember}
                        isForceAssignMode={isForceAssignMode}
                    />
                ) : (
                    <DutyTemplateGrid
                        viewMode={viewMode}
                        ktaTemplate={ktaTemplate}
                        blcTemplate={blcTemplate}
                        restrictions={restrictions}
                        blcRestrictions={blcRestrictions}
                        restrictionBrush={restrictionBrush}
                        handleToggleRestriction={handleToggleRestriction}
                        handleToggleBlcRestriction={handleToggleBlcRestriction}
                        ktaDayLabels={ktaDayLabels}
                        setKtaDayLabels={setKtaDayLabels}
                        blcDayLabels={blcDayLabels}
                        setBlcDayLabels={setBlcDayLabels}
                        ktaSections={ktaSections}
                        blcSections={blcSections}
                        isBlc30={isBlc30}
                    />
                )}
            </main>

            <MonthlyLabelsModal
                isOpen={isMonthlyLabelsModalOpen}
                onClose={() => setIsMonthlyLabelsModalOpen(false)}
                year={year}
                month={month}
                monthlyDayLabels={monthlyDayLabels}
                onAddLabel={handleAddMonthlyLabel}
                onDeleteLabel={handleDeleteMonthlyLabel}
            />

            <DutyInfoModal
                isOpen={isInfoModalOpen}
                onClose={() => setIsInfoModalOpen(false)}
            />

            {isAutoDistributeModalOpen && (
                <DutyAutoDistributeModal
                    isOpen={isAutoDistributeModalOpen}
                    onClose={() => setIsAutoDistributeModalOpen(false)}
                    year={year}
                    month={month}
                    members={members}
                    dutyStats={dutyStats}
                    allDuties={duties}
                    allEvents={events}
                    personalRestrictions={personalRestrictions}
                    dutyHolidays={dutyHolidays}
                    restrictions={restrictions}
                    blcRestrictions={blcRestrictions}
                    ktaSections={ktaSections}
                    blcSections={blcSections}
                    currentDate={currentDate}
                    configs={configs}
                    updateConfig={updateConfig}
                    lockedMembers={lockedMembers}
                    toggleLock={toggleLock}
                    onApply={(assignments: AssignedDuty[]) => {
                        markCurrentMonthAsEdited();
                        const newDuties = assignments.map(a => ({
                            id: `auto-${a.dateStr}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                            type: 'duty' as const,
                            startDate: a.dateStr,
                            endDate: a.dateStr,
                            memo: a.memberName
                        }));
                        setDuties(prev => [...prev, ...newDuties]);
                        showToast(`자동 분배 완료! ${assignments.length}개 날짜에 당직이 배정되었습니다. 💫`);
                    }}
                />
            )}

            {exportPreviewUrl && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-4xl w-full flex flex-col gap-4 shadow-2xl relative">
                        {/* Header */}
                        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div>
                                <h3 className="text-base font-black text-slate-200">당직표 이미지 내보내기 미리보기</h3>
                                <p className="text-xs text-slate-500 font-bold mt-0.5">
                                    {year}년 {month + 1}월 당직표
                                </p>
                            </div>
                            <button
                                onClick={() => setExportPreviewUrl(null)}
                                className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Image Preview Container */}
                        <div className="bg-slate-950 rounded-2xl border border-slate-800 p-2 flex justify-center items-center">
                            <img
                                src={exportPreviewUrl}
                                alt="당직표 미리보기"
                                className="max-w-full max-h-[68vh] object-contain rounded-lg shadow-lg"
                            />
                        </div>

                        {/* Footer Actions */}
                        <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                            <button
                                onClick={() => setExportPreviewUrl(null)}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-750 hover:border-slate-700 text-slate-300 text-xs font-black rounded-xl transition-all cursor-pointer"
                            >
                                취소
                            </button>
                            <a
                                href={exportPreviewUrl}
                                download={`당직표_${year}년_${month + 1}월.png`}
                                onClick={() => setExportPreviewUrl(null)}
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-lg shadow-indigo-600/10"
                            >
                                이미지 다운로드
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface MonthlyLabelsModalProps {
    isOpen: boolean;
    onClose: () => void;
    year: number;
    month: number;
    monthlyDayLabels: Record<string, string>;
    onAddLabel: (day: number, text: string) => Promise<void>;
    onDeleteLabel: (dateStr: string) => Promise<void>;
}

function MonthlyLabelsModal({
    isOpen, onClose, year, month, monthlyDayLabels, onAddLabel, onDeleteLabel
}: MonthlyLabelsModalProps) {
    const [dayInput, setDayInput] = useState('');
    const [labelInput, setLabelInput] = useState('');

    if (!isOpen) return null;

    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const filteredLabels = Object.entries(monthlyDayLabels)
        .filter(([dateStr]) => dateStr.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        const dNum = parseInt(dayInput, 10);
        const txt = labelInput.trim();
        if (isNaN(dNum) || dNum < 1 || dNum > 31) {
            alert("올바른 날짜(1~31)를 입력해주세요.");
            return;
        }
        if (!txt) {
            alert("레이블 텍스트를 입력해주세요.");
            return;
        }
        await onAddLabel(dNum, txt);
        setDayInput('');
        setLabelInput('');
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-[450px] bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 relative text-left">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">📅</span>
                        <h3 className="text-sm font-black text-slate-200 tracking-wider">
                            {year}년 {month + 1}월 날짜별 레이블 편집
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-350 text-xs font-black transition-colors px-2 py-1 hover:bg-slate-800 rounded-lg cursor-pointer"
                    >
                        닫기
                    </button>
                </div>

                <form onSubmit={handleAdd} className="space-y-3">
                    <label className="text-xs font-black text-slate-400 tracking-wider block">🏷️ 날짜 레이블 추가</label>
                    <div className="flex gap-2.5">
                        <input
                            type="number"
                            min="1"
                            max="31"
                            placeholder="일(1~31)"
                            value={dayInput}
                            onChange={(e) => setDayInput(e.target.value)}
                            className="w-24 shrink-0 py-2.5 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                            required
                        />
                        <input
                            type="text"
                            placeholder="레이블 명칭 (예: 당직교대)"
                            value={labelInput}
                            onChange={(e) => setLabelInput(e.target.value)}
                            className="flex-1 min-w-0 py-2.5 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-550 active:scale-[0.98] text-white rounded-xl text-xs font-black transition-all cursor-pointer text-center shadow-lg shadow-indigo-500/15"
                    >
                        추가하기
                    </button>
                </form>

                <div className="space-y-2 pt-2 border-t border-slate-800/60">
                    <label className="text-xs font-black text-slate-400 tracking-wider block">📋 등록된 레이블 목록 ({filteredLabels.length})</label>

                    {filteredLabels.length === 0 ? (
                        <p className="text-[11px] text-slate-600 text-center py-6 font-bold">이번 달에 등록된 날짜 레이블이 없습니다.</p>
                    ) : (
                        <div className="max-h-48 overflow-y-auto space-y-2 custom-scrollbar pr-1 w-full">
                            {filteredLabels.map(([dateStr, label]) => {
                                const day = parseInt(dateStr.split('-')[2], 10);
                                return (
                                    <div key={dateStr} className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-850 w-full hover:border-slate-800 transition-colors">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <span className="text-xs font-black text-indigo-400 shrink-0">{day}일</span>
                                            <span className="text-[11px] font-black text-slate-200 truncate">{label}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onDeleteLabel(dateStr)}
                                            className="text-[10px] font-black text-rose-500 hover:text-rose-400 px-2 py-1 bg-rose-950/20 hover:bg-rose-950/20 border border-rose-900/30 rounded-lg transition-all shrink-0 cursor-pointer"
                                        >
                                            삭제
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

interface DutyInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
}

function DutyInfoModal({ isOpen, onClose }: DutyInfoModalProps) {
    if (!isOpen) return null;

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

    const hardRules = [
        "이틀 텀(2-day gap) 근무 제한: 동일한 인원은 당직을 선 후 최소 이틀의 텀을 두어야 합니다.\n(예: 1일 근무 시 2, 3일 제한, 4일부터 가능)",
        "미배정 당직 방지: 모든 당직일에는 반드시 인원이 배정되어야 합니다.\n(위반 시 하루당 오류 패널티 1,000,000점 부과)",
        "목표치(고정) 준수: 배분 모달에서 자물쇠로 잠근(고정) 목표치는 반드시 준수합니다.\n(위반 시 미배정 수준의 높은 오류 패널티 100,000,000점 부과)",
        "동일 섹션 연속 근무 금지: 동일한 섹션의 인원들이 연속으로(2일 연속) 당직을 서는 것은 차단됩니다.\n(단, S6 섹션은 예외로 항상 제외되며, KTA/MEDIC/BLC는 비기수 기간에 연속 근무가 가능합니다.)",
        "월 최소 1회 권장: 대상 인원이 당직을 월 1회도 서지 않는 경우(0회)를 방지합니다.\n(위반 시 인원당 오류 패널티 500,000점 부과)",
        "신병 보호기간 및 개인 제한: 전입일 포함 15일간의 신병 보호기간에는 배정되지 않습니다.",
        `당직 완료 기준: 특정 당직 누적 횟수가 완료 기준(평당: ${criteriaWeekday}회, 금일당: ${criteriaFriSun}회, 토당: ${criteriaSat}회)을 충족하면, 해당 당직은 더 이상 배정되지 않습니다.`
    ];

    const softRules = [
        "목표치 준수 (미고정): 자물쇠를 잠그지 않은 설정 목표 수치를 최대한 맞춰 배정합니다.\n[선호 가중치: 1순위 - 편차 제곱당 200,000점]",
        "기본 2회 균등 배정: 특별히 설정하거나 고정하지 않은 대상자들은 한 달에 모두 2회씩 당직을 서도록 유도합니다.\n[선호 가중치: 2순위 - 편차 제곱당 30,000점]",
        "누적 페이스(Pace) 조율: 입대일 및 동기들 간 누적 횟수의 균등성을 유지하고, 페이스에 맞춰 고르게 분배합니다.\n[선호 가중치: 3순위 - 요일 편차 제곱당 2,000점 / 전체 편차 제곱당 1,000점]",
        "동일 섹션 연속 근무 최소화: 동일 섹션 인원들의 연속 당직 배정을 최대한 방지합니다.\n[선호 가중치: 4순위 - 연속 2일 발생 건당 1,000점]"
    ];

    return createPortal(
        <div
            onClick={onClose}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
        >
            <style>{`
                .info-modal-scrollbar::-webkit-scrollbar {
                    width: 8px;
                }
                .info-modal-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .info-modal-scrollbar::-webkit-scrollbar-thumb {
                    background: #2a2d3a;
                    border-radius: 4px;
                }
                .info-modal-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #3f4255;
                }
            `}</style>
            <div
                onClick={(e) => e.stopPropagation()}
                className="w-[680px] max-h-[85vh] flex flex-col bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-200 relative text-left"
            >
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-850 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">ℹ️</span>
                        <h3 className="text-sm font-black text-slate-200 tracking-wider">
                            당직 작성 자동 적용 규칙 및 오류치 가중치 안내
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-350 text-xs font-black transition-colors px-2.5 py-1 hover:bg-slate-850 rounded-lg cursor-pointer"
                    >
                        닫기
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto pr-1 info-modal-scrollbar space-y-6 pt-3 min-h-0">
                    <p className="text-xs text-slate-400 font-bold leading-relaxed mb-2">
                        NCOA 당직 작성을 원활하게 진행할 수 있도록 자동 배정 알고리즘(점수가 낮을수록 최적)이 아래 규칙과 오류치 가중치(Cost)를 바탕으로 동작합니다:
                    </p>

                    <div className="space-y-3">
                        <h4 className="text-sm font-black text-rose-400 border-b border-rose-500/20 pb-1">A. 필수 규칙 (절대 위반 불가 / 매우 높은 패널티)</h4>
                        <ul className="space-y-3.5 pl-1">
                            {hardRules.map((rule, idx) => {
                                const parts = rule.split(": ");
                                const title = parts[0];
                                const desc = parts.slice(1).join(": ");
                                return (
                                    <li key={idx} className="flex items-start gap-2 text-xs font-bold leading-relaxed text-slate-300">
                                        <span className="text-rose-400 mt-0.5 shrink-0">•</span>
                                        <div>
                                            <strong className="text-rose-300 font-black block mb-0.5">{title}</strong>
                                            <span className="text-[11px] text-slate-455 block whitespace-pre-line">{desc}</span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className="space-y-3">
                        <h4 className="text-sm font-black text-sky-400 border-b border-sky-500/20 pb-1">B. 선호 사항 (오류치/패널티 최소화 대상)</h4>
                        <ul className="space-y-3.5 pl-1">
                            {softRules.map((rule, idx) => {
                                const parts = rule.split(": ");
                                const title = parts[0];
                                const desc = parts.slice(1).join(": ");
                                return (
                                    <li key={idx} className="flex items-start gap-2 text-xs font-bold leading-relaxed text-slate-300">
                                        <span className="text-sky-400 mt-0.5 shrink-0">•</span>
                                        <div>
                                            <strong className="text-sky-300 font-black block mb-0.5">{title}</strong>
                                            <span className="text-[11px] text-slate-455 block whitespace-pre-line">{desc}</span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
