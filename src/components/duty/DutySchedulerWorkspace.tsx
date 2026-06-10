import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertCircle } from 'lucide-react';
import { useDutySync } from '../../hooks/duty/useDutySync';
import { useDutyState } from '../../hooks/duty/useDutyState';
import { useDutyTemplate } from '../../hooks/duty/useDutyTemplate';
import { DutySidebar } from './DutySidebar';
import { DutyHeader } from './DutyHeader';
import { DutyCalendarGrid } from './DutyCalendarGrid';
import { DutyTemplateGrid } from './DutyTemplateGrid';
import { db } from '../../lib/firebase';
import { doc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

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

    const {
        currentDate, setCurrentDate,
        viewMode, setViewMode,
        restrictionBrush, setRestrictionBrush,
        selectedMember,
        duties,
        currentMonthDuties, dutyStats,
        dutiesInitialized,
        togglePersonalRestriction,
        toggleMemberDutyCompleted,
        handleCellClick: baseHandleCellClick, handleClearDate, handleClearMonth
    } = useDutyState({ events, members, personalRestrictions, dutyHolidays, showToast });







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
    const isHolidayDate = (dateStr: string) => events.some((e: CalendarEvent) => e.type === 'holiday' && dateStr >= e.startDate && dateStr <= e.endDate);

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

            while (dayCount < 22) {
                current.setDate(current.getDate() + 1);
                const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                const isSunday = current.getDay() === 0;

                if (!isSunday && !isHolidayDate(currentStr)) {
                    dayCount++;
                    if (dayCount === 22 && currentStr === dateStr) {
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
                if (e.memo?.includes('Day 0') || e.memo?.includes('Graduation') || e.memo?.includes('수료') || e.memo?.includes('🎓')) {
                    ktaBlcEvents.push(e);
                }
            }
        });

        return ktaBlcEvents;
    };

    const getBlcActiveDay = (day0DateStr: string, targetDateStr: string) => {
        const start = parseLocalDate(day0DateStr);
        const target = parseLocalDate(targetDateStr);

        if (start.getTime() === target.getTime()) return 0;

        if (target > start) {
            let dayCount = 0;
            let current = new Date(start);
            while (current < target) {
                current.setDate(current.getDate() + 1);
                if (dayCount < 22) {
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
                    const hasSharedSection = dutyMember.sections.some(sec => targetMember.sections?.includes(sec));
                    if (hasSharedSection) {
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
        if (member.role === 'runner') return 'runner';
        
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

        if (personalRestrictions[dateStr]?.includes(member.name)) {
            return '개인 사정 불가';
        }

        const consecutiveReason = getConsecutiveRestrictionReason(member.name, dateStr, duties);
        if (consecutiveReason) return consecutiveReason;

        const memberBlcSections = member.sections?.filter(sec => blcSections.includes(sec)) || [];
        if (memberBlcSections.length > 0) {
            const blcDay0s = events.filter((e: CalendarEvent) => e.type === 'blc' && e.memo?.includes('Day 0'));
            for (const day0 of blcDay0s) {
                const diffDays = getBlcActiveDay(day0.startDate, dateStr);
                // BLC 템플릿 유효 범위 (Day -1 ~ Day 26) 내에서만 판단
                if (diffDays >= -1 && diffDays <= 26) {
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

        return null;
    };

    const handleCellClick = (dateStr: string, directMemberName?: string) => {
        const targetMemberName = directMemberName || selectedMember?.name;
        
        if (viewMode === 'actual' && restrictionBrush === 'personal') {
            baseHandleCellClick(dateStr, directMemberName);
            return;
        }

        if (targetMemberName) {
            const memberObj = members.find(m => m.name === targetMemberName);
            if (memberObj) {
                const reason = getMemberDutyRestrictionReason(memberObj, dateStr);
                if (reason) {
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
                viewMode={viewMode}
                loading={loading || !dutiesInitialized}
                members={members}
                dutyStats={dutyStats}
                toggleMemberDutyCompleted={toggleMemberDutyCompleted}
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
                    onOpenMonthlyLabelsModal={() => setIsMonthlyLabelsModalOpen(true)}
                    onOpenInfoModal={() => setIsInfoModalOpen(true)}
                />

                {viewMode !== 'blc-template' && (
                    <div className="grid grid-cols-7 border-b border-slate-850 bg-slate-900/20 text-center py-3.5 text-xs font-black tracking-wide text-slate-400 shrink-0">
                        {(viewMode === 'kta-template' ? ["월", "화", "수", "목", "금", "토", "일"] : ["일", "월", "화", "수", "목", "금", "토"]).map((name, i) => {
                            const isSunday = viewMode === 'kta-template' ? i === 6 : i === 0;
                            const isSaturday = viewMode === 'kta-template' ? i === 5 : i === 6;
                            return (
                                <div
                                    key={name}
                                    className={isSunday ? 'text-rose-500 font-black' : isSaturday ? 'text-sky-500 font-black' : ''}
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

    const rules = [
        "이틀 텀(3일 간격) 근무 제한: 동일한 대원은 당직을 선 후 최소 이틀의 텀을 두어야 합니다. (예: 1일 근무 시 2, 3일 제한, 4일부터 가능)",
        "동일 섹션 연속 제한: 당직 배정자의 부서/섹션을 공유하는 인원은 그 전날과 다음날에 자동으로 당직 대상에서 제외됩니다.",
        "수동 개인 제한 (우클릭): 개별 대원의 버튼을 우클릭하여 특정 날짜에 근무 불가 상태를 임시 지정할 수 있습니다. (가운데 붉은 취소선 표시)",
        "KTA/BLC 교육생 제한: KTA 또는 BLC 파견 훈련 기간에는 설정된 템플릿의 일자별 섹션 제한 규칙에 의해 배정이 자동으로 제한됩니다."
    ];

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-[480px] bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 relative text-left">
                <div className="flex items-center justify-between pb-3 border-b border-slate-850">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">ℹ️</span>
                        <h3 className="text-sm font-black text-slate-200 tracking-wider">
                            당직 작성 자동 적용 규칙 안내
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-350 text-xs font-black transition-colors px-2 py-1 hover:bg-slate-850 rounded-lg cursor-pointer"
                    >
                        닫기
                    </button>
                </div>

                <div className="space-y-4 pt-2">
                    <p className="text-xs text-slate-400 font-bold leading-relaxed mb-2">
                        NCOA 당직 작성을 원활하게 진행할 수 있도록 아래 규칙들이 백그라운드에서 자동으로 계산 및 적용되고 있습니다:
                    </p>
                    <ul className="space-y-3.5">
                        {rules.map((rule, idx) => {
                            const [title, desc] = rule.split(": ");
                            return (
                                <li key={idx} className="flex items-start gap-2 text-xs font-bold leading-relaxed text-slate-300">
                                    <span className="text-indigo-400 mt-0.5 shrink-0">•</span>
                                    <div>
                                        <strong className="text-indigo-300 font-black block mb-0.5">{title}</strong>
                                        <span className="text-[11px] text-slate-450">{desc}</span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </div>,
        document.body
    );
}
