import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { useCalendarSync } from '../../hooks/calendar/calendar.sync.hook';
import { useCalendarSchedule } from '../../hooks/calendar/calendar.schedule.hook';
import { useCalendarTemplate } from '../../hooks/calendar/calendar.template.hook';
import { CalendarHeader } from '../calendar/calendar.header.component';
import { CalendarGrid } from '../calendar/calendar.grid.component';
import { EventModal } from '../calendar/calendar.event-modal.component';
import { BatchDutyModal } from '../calendar/calendar.batch-duty-modal.component';
import { KtaTemplateModal, BlcTemplateModal } from '../calendar/calendar.template-modals.component';
import {
    getKtaReferenceDate, getKtaReferenceBatch, getKtaReferenceType,
    getBlcReferenceDate, getBlcReferenceBatch
} from '../../utils/calendar.utils';

interface CalendarTabProps {
    baseDate?: Date;
}

export default function CalendarTab({ baseDate }: CalendarTabProps) {
    const [currentDate, setCurrentDate] = useState(new Date());

    useEffect(() => {
        if (baseDate) {
            setCurrentDate(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
        }
    }, [baseDate]);

    // 1. Data Sync Hook
    const {
        events, members, ktaScheduleTemplate, blcScheduleTemplate,
        setKtaScheduleTemplate, setBlcScheduleTemplate
    } = useCalendarSync();

    // 2. Schedule & State Hook
    const {
        isAdding, setIsAdding,
        selectedDate, setSelectedDate,
        activeAction, setActiveAction,
        editingBatch, setEditingBatch,
        isBatchDutyAdding, setIsBatchDutyAdding,
        isBatchSaving,
        dutyHistory, setDutyHistory,
        holidayName, setHolidayName,
        holidayStartDate, setHolidayStartDate,
        holidayEndDate, setHolidayEndDate,
        isHolidayNaming, setIsHolidayNaming,
        editingHoliday, setEditingHoliday,

        handleAutoKtaDay0, handleAutoBlcDay0, handleAddDuty, handleAddHoliday,
        handleUpdateHoliday, handleDeleteEvent, handleUpdateBatch, handleUpdateBlcBatch,
        handleReplace, handleRealSwap, openBatchDutyModal, handleBatchSaveDuties
    } = useCalendarSchedule(events, currentDate);

    // 3. Template & DnD Hook
    const {
        isKTAScheduleAdding, setIsKTAScheduleAdding, isKTASaving,
        handleKtaDragEnd, handleKtaTemplateChange, addEventToTemplate,
        removeEventFromTemplate, handleKtaSave,

        isBLCScheduleAdding, setIsBLCScheduleAdding, isBLCSaving,
        handleBlcDragEnd, handleBlcTemplateChange, addEventToBlcTemplate,
        removeEventFromBlcTemplate, handleBlcSave
    } = useCalendarTemplate(
        ktaScheduleTemplate, setKtaScheduleTemplate,
        blcScheduleTemplate, setBlcScheduleTemplate
    );

    // Stop scrolling when modals are open
    useEffect(() => {
        if (isAdding || isBatchDutyAdding || isKTAScheduleAdding || isBLCScheduleAdding) {
            document.documentElement.style.overflow = 'hidden';
            document.body.style.overflow = 'hidden';
        } else {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
        }
        return () => {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
        };
    }, [isAdding, isBatchDutyAdding, isKTAScheduleAdding, isBLCScheduleAdding]);

    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));

    const isHolidayDate = (dateStr: string) => {
        return events.some(e => e.type === 'holiday' && dateStr >= e.startDate && dateStr <= e.endDate);
    };

    return (
        <div className="w-full max-w-7xl mx-auto pb-20 animate-in fade-in duration-500">
            <CalendarHeader
                currentDate={currentDate}
                prevMonth={prevMonth}
                nextMonth={nextMonth}
            />

            <CalendarGrid
                currentDate={currentDate}
                baseDate={baseDate}
                events={events}
                onDateClick={(dateStr) => {
                    setSelectedDate(dateStr);
                    setIsAdding(true);
                }}
            />

            <div
                className="grid grid-cols-2 gap-2 mt-4 shrink-0"
            >
                <button
                    onClick={() => setIsKTAScheduleAdding(true)}
                    style={{ height: '44px' }}
                    className="col-span-1 px-4 bg-red-50 text-red-600 rounded-xl text-sm font-black hover:bg-red-100 transition-colors border border-red-100/50 flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                    <Settings className="w-3.5 h-3.5" />
                    <span>KTA 일정 템플릿</span>
                </button>
                <button
                    onClick={() => setIsBLCScheduleAdding(true)}
                    style={{ height: '44px' }}
                    className="col-span-1 px-4 bg-blue-50 text-blue-600 rounded-xl text-sm font-black hover:bg-blue-100 transition-colors border border-blue-100/50 flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                    <Settings className="w-3.5 h-3.5" />
                    <span>BLC 일정 템플릿</span>
                </button>
                <button
                    onClick={openBatchDutyModal}
                    style={{ height: '44px' }}
                    className="col-span-2 px-4 bg-yellow-50 text-yellow-600 rounded-xl text-sm font-black hover:bg-yellow-100 transition-colors border border-yellow-100/50 flex items-center justify-center whitespace-nowrap"
                >
                    당직 일괄 등록
                </button>
            </div>

            <EventModal
                events={events}
                members={members}
                currentDate={currentDate}
                selectedDate={selectedDate}
                isAdding={isAdding}
                setIsAdding={setIsAdding}
                setSelectedDate={setSelectedDate}
                activeAction={activeAction}
                setActiveAction={setActiveAction}
                editingBatch={editingBatch}
                setEditingBatch={setEditingBatch}
                editingHoliday={editingHoliday}
                setEditingHoliday={setEditingHoliday}
                isHolidayNaming={isHolidayNaming}
                setIsHolidayNaming={setIsHolidayNaming}
                holidayName={holidayName}
                setHolidayName={setHolidayName}
                holidayStartDate={holidayStartDate}
                setHolidayStartDate={setHolidayStartDate}
                holidayEndDate={holidayEndDate}
                setHolidayEndDate={setHolidayEndDate}

                handleAddHoliday={handleAddHoliday}
                handleUpdateHoliday={handleUpdateHoliday}
                handleAutoKtaDay0={handleAutoKtaDay0}
                handleAutoBlcDay0={handleAutoBlcDay0}
                handleAddDuty={handleAddDuty}
                handleDeleteEvent={handleDeleteEvent}
                handleUpdateBatch={handleUpdateBatch}
                handleUpdateBlcBatch={handleUpdateBlcBatch}
                handleReplace={handleReplace}
                handleRealSwap={handleRealSwap}
                isKTASaving={isKTASaving}
                isBLCSaving={isBLCSaving}
            />

            <BatchDutyModal
                isBatchDutyAdding={isBatchDutyAdding}
                setIsBatchDutyAdding={setIsBatchDutyAdding}
                currentDate={currentDate}
                members={members}
                dutyHistory={dutyHistory}
                setDutyHistory={setDutyHistory}
                handleBatchSaveDuties={handleBatchSaveDuties}
                isBatchSaving={isBatchSaving}
            />

            <KtaTemplateModal
                isKTAScheduleAdding={isKTAScheduleAdding}
                setIsKTAScheduleAdding={setIsKTAScheduleAdding}
                ktaScheduleTemplate={ktaScheduleTemplate}
                handleKtaDragEnd={handleKtaDragEnd}
                handleKtaTemplateChange={handleKtaTemplateChange}
                addEventToTemplate={addEventToTemplate}
                removeEventFromTemplate={removeEventFromTemplate}
                handleKtaSave={handleKtaSave}
                isKTASaving={isKTASaving}
                ktaReferenceBatch={getKtaReferenceBatch(events)}
                ktaReferenceType={getKtaReferenceType(events)}
                ktaReferenceDate={getKtaReferenceDate(events)}
            />

            <BlcTemplateModal
                isBLCScheduleAdding={isBLCScheduleAdding}
                setIsBLCScheduleAdding={setIsBLCScheduleAdding}
                blcScheduleTemplate={blcScheduleTemplate}
                handleBlcDragEnd={handleBlcDragEnd}
                handleBlcTemplateChange={handleBlcTemplateChange}
                addEventToBlcTemplate={addEventToBlcTemplate}
                removeEventFromBlcTemplate={removeEventFromBlcTemplate}
                handleBlcSave={handleBlcSave}
                isBLCSaving={isBLCSaving}
                blcReferenceBatch={getBlcReferenceBatch(events)}
                blcReferenceDate={getBlcReferenceDate(events)}
                isHolidayDate={isHolidayDate}
            />
        </div>
    );
}
