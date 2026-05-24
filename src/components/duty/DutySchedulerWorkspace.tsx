import { useState, useCallback } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { useDutySync } from '../../hooks/duty/useDutySync';
import { useDutyState } from '../../hooks/duty/useDutyState';
import { useDutyTemplate } from '../../hooks/duty/useDutyTemplate';
import { DutySidebar } from './DutySidebar';
import { DutyHeader } from './DutyHeader';
import { DutyCalendarGrid } from './DutyCalendarGrid';
import { DutyTemplateGrid } from './DutyTemplateGrid';
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
        dutyHolidays, handleAddDutyHoliday, handleDeleteDutyHoliday
    } = useDutySync(showToast);

    const {
        currentDate, setCurrentDate,
        viewMode, setViewMode,
        restrictionBrush, setRestrictionBrush,
        selectedMember, setSelectedMember,
        currentMonthDuties, dutyStats,
        togglePersonalRestriction,
        toggleMemberDutyCompleted,
        handleCellClick, handleClearDate, handleClearMonth
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
        showToast
    });

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

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

    const getDutyForDate = (dateStr: string) => currentMonthDuties.find((d: CalendarEvent) => d.startDate === dateStr);
    const getHolidayForDate = (dateStr: string) => dutyHolidays.find((h: any) => dateStr >= h.startDate && dateStr <= h.endDate);
    const isHolidayDate = (dateStr: string) => events.some((e: CalendarEvent) => e.type === 'holiday' && dateStr >= e.startDate && dateStr <= e.endDate);

    const getKtaBlcEventsForDate = (dateStr: string) => {
        const ktaBlcEvents: CalendarEvent[] = [];
        const blcDay0s = events.filter((e: CalendarEvent) => e.type === 'blc' && e.memo?.includes('Day 0'));
        
        blcDay0s.forEach((day0: CalendarEvent) => {
            const start = new Date(day0.startDate);
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

    const parseLocalDate = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
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
                const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                const isSunday = current.getDay() === 0;
                if (!isSunday && !isHolidayDate(currentStr)) dayCount++;
            }
            return dayCount;
        } else {
            let dayCount = 0;
            let current = new Date(start);
            while (current > target) {
                current.setDate(current.getDate() - 1);
                const nextStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                const nextSunday = current.getDay() === 0;
                if (!nextSunday && !isHolidayDate(nextStr)) dayCount--;
            }
            return dayCount;
        }
    };

    const isMemberEligibleForDuty = (member: CalendarMember, dateStr: string) => {
        if (member.role === 'runner') return false;
        if (member.dutyCompleted) return false;

        const name = member.name;
        if (personalRestrictions[dateStr]?.includes(name)) return false;

        const isBlc = member.sections?.includes('BLC');
        const isS3 = member.sections?.includes('S3');
        const isPao = member.sections?.includes('PAO');

        if (isBlc || isS3 || isPao) {
            const blcDay0s = events.filter((e: CalendarEvent) => e.type === 'blc' && e.memo?.includes('Day 0'));
            for (const day0 of blcDay0s) {
                const diffDays = getBlcActiveDay(day0.startDate, dateStr);
                if (isBlc && blcRestrictions[diffDays]?.blc) return false;
                if (isS3 && blcRestrictions[diffDays]?.s3) return false;
                if (isPao && blcRestrictions[diffDays]?.pao) return false;
            }
        }

        const isKta = member.sections?.includes('KTA');
        const isMedic = member.sections?.includes('MEDIC');

        if (isKta || isMedic || isPao) {
            const ktaEvents = events.filter((e: CalendarEvent) => e.type === 'kta' && e.memo?.includes('Day 0'));
            for (const e of ktaEvents) {
                const startKta = parseLocalDate(e.startDate);
                const currentDay = parseLocalDate(dateStr);
                const diffTime = currentDay.getTime() - startKta.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                const restriction = restrictions[diffDays];
                if (restriction) {
                    if (isKta && restriction.kta) return false;
                    if (isMedic && restriction.medic) return false;
                    if (isPao && restriction.pao) return false;
                }
            }
        }
        return true;
    };

    return (
        <div className="fixed inset-0 z-50 flex bg-slate-950 text-slate-100 overflow-hidden font-sans h-full w-full">
            {toast && (
                <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3.5 rounded-2xl shadow-2xl transition-all border animate-in slide-in-from-bottom-6 duration-300 pointer-events-none max-w-sm ${
                    toast.type === 'success' 
                        ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-300' 
                        : 'bg-rose-950/80 border-rose-500/30 text-rose-300'
                }`}>
                    {toast.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    <span className="text-sm font-bold text-center w-full">{toast.message}</span>
                </div>
            )}

            <DutySidebar
                viewMode={viewMode}
                loading={loading}
                members={members}
                dutyStats={dutyStats}
                selectedMember={selectedMember}
                setSelectedMember={setSelectedMember}
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
            />

            <main className="flex-1 bg-slate-950 flex flex-col min-w-0 h-full overflow-hidden">
                <DutyHeader
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    setRestrictionBrush={setRestrictionBrush}
                    restrictionBrush={restrictionBrush}
                    year={year}
                    month={month}
                    prevMonth={prevMonth}
                    nextMonth={nextMonth}
                    handleClearMonth={handleClearMonth}
                    onClose={onClose}
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
                        personalRestrictions={personalRestrictions}
                        ktaDayLabels={ktaDayLabels}
                        blcDayLabels={blcDayLabels}
                        getHolidayForDate={getHolidayForDate}
                        getKtaBlcEventsForDate={getKtaBlcEventsForDate}
                        getDutyForDate={getDutyForDate}
                        isMemberEligibleForDuty={isMemberEligibleForDuty}
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
                    />
                )}
            </main>
        </div>
    );
}
