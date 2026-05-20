import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { DragEndEvent } from '@dnd-kit/core';
import type { ScheduleTemplateDay } from '../../types/calendar/calendar.type';

export function useCalendarTemplate(
    ktaScheduleTemplate: ScheduleTemplateDay[],
    setKtaScheduleTemplate: React.Dispatch<React.SetStateAction<ScheduleTemplateDay[]>>,
    blcScheduleTemplate: ScheduleTemplateDay[],
    setBlcScheduleTemplate: React.Dispatch<React.SetStateAction<ScheduleTemplateDay[]>>
) {
    const [isKTAScheduleAdding, setIsKTAScheduleAdding] = useState(false);
    const [isKTASaving, setIsKTASaving] = useState(false);

    const [isBLCScheduleAdding, setIsBLCScheduleAdding] = useState(false);
    const [isBLCSaving, setIsBLCSaving] = useState(false);

    // ── KTA Handlers ──
    const handleKtaDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        const aParts = active.id.toString().split('-');
        const srcDay = parseInt(aParts[1], 10);
        const srcIdx = parseInt(aParts[2], 10);
        
        let tgtDay: number;
        const oId = over.id.toString();
        if (oId.startsWith('kta-day-')) tgtDay = parseInt(oId.replace('kta-day-', ''), 10);
        else tgtDay = parseInt(oId.split('-')[1], 10);
        
        if (srcDay === tgtDay || isNaN(tgtDay)) return;
        
        setKtaScheduleTemplate(prev => {
            const updated = prev.map(item => ({ ...item, events: [...item.events] }));
            const src = updated.find(i => i.day === srcDay);
            const tgt = updated.find(i => i.day === tgtDay);
            if (!src || !tgt || !src.events[srcIdx]) return prev;
            const [moved] = src.events.splice(srcIdx, 1);
            tgt.events.push(moved);
            tgt.events.sort((a, b) => (a.match(/^\d{4}/)?.[0] || '9999').localeCompare(b.match(/^\d{4}/)?.[0] || '9999'));
            return updated;
        });
    };

    const handleKtaTemplateChange = (day: number, eventIndex: number, value: string) => {
        setKtaScheduleTemplate(prev => prev.map(item => {
            if (item.day === day) {
                const newEvents = [...item.events];
                newEvents[eventIndex] = value;
                return { ...item, events: newEvents.filter((v, i) => v !== '' || i === eventIndex) };
            }
            return item;
        }));
    };

    const addEventToTemplate = (day: number) => {
        setKtaScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: [...item.events, ''] } : item
        ));
    };

    const removeEventFromTemplate = (day: number, index: number) => {
        setKtaScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: item.events.filter((_, i) => i !== index) } : item
        ));
    };

    const handleKtaSave = async () => {
        setIsKTASaving(true);
        try {
            await setDoc(doc(db, 'settings', 'ktaTemplate'), {
                schedules: ktaScheduleTemplate.map(s => ({
                    day: s.day,
                    events: s.events.filter(e => e.trim() !== '')
                }))
            });
            setIsKTAScheduleAdding(false);
        } catch (error) {
            console.error("Error saving KTA template:", error);
            alert("KTA 일정 저장 중 오류가 발생했습니다.");
        } finally {
            setIsKTASaving(false);
        }
    };

    // ── BLC Handlers ──
    const handleBlcDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        const aParts = active.id.toString().split('-');
        const srcDay = parseInt(aParts[1], 10);
        const srcIdx = parseInt(aParts[2], 10);
        
        let tgtDay: number;
        const oId = over.id.toString();
        if (oId.startsWith('blc-day-')) tgtDay = parseInt(oId.replace('blc-day-', ''), 10);
        else tgtDay = parseInt(oId.split('-')[1], 10);
        
        if (srcDay === tgtDay || isNaN(tgtDay)) return;
        
        setBlcScheduleTemplate(prev => {
            const updated = prev.map(item => ({ ...item, events: [...item.events] }));
            const src = updated.find(i => i.day === srcDay);
            const tgt = updated.find(i => i.day === tgtDay);
            if (!src || !tgt || !src.events[srcIdx]) return prev;
            const [moved] = src.events.splice(srcIdx, 1);
            tgt.events.push(moved);
            tgt.events.sort((a, b) => (a.match(/^\d{4}/)?.[0] || '9999').localeCompare(b.match(/^\d{4}/)?.[0] || '9999'));
            return updated;
        });
    };

    const handleBlcTemplateChange = (day: number, eventIndex: number, value: string) => {
        setBlcScheduleTemplate(prev => prev.map(item => {
            if (item.day === day) {
                const newEvents = [...item.events];
                newEvents[eventIndex] = value;
                return { ...item, events: newEvents.filter((v, i) => v !== '' || i === eventIndex) };
            }
            return item;
        }));
    };

    const addEventToBlcTemplate = (day: number) => {
        setBlcScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: [...item.events, ''] } : item
        ));
    };

    const removeEventFromBlcTemplate = (day: number, index: number) => {
        setBlcScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: item.events.filter((_, i) => i !== index) } : item
        ));
    };

    const handleBlcSave = async () => {
        setIsBLCSaving(true);
        try {
            await setDoc(doc(db, 'settings', 'blcTemplate'), {
                schedules: blcScheduleTemplate.map(s => ({
                    day: s.day,
                    events: s.events.filter(e => e.trim() !== '')
                }))
            });
            setIsBLCScheduleAdding(false);
        } catch (error) {
            console.error("Error saving BLC template:", error);
            alert("BLC 일정 저장 중 오류가 발생했습니다.");
        } finally {
            setIsBLCSaving(false);
        }
    };

    return {
        isKTAScheduleAdding, setIsKTAScheduleAdding,
        isKTASaving,
        handleKtaDragEnd,
        handleKtaTemplateChange,
        addEventToTemplate,
        removeEventFromTemplate,
        handleKtaSave,

        isBLCScheduleAdding, setIsBLCScheduleAdding,
        isBLCSaving,
        handleBlcDragEnd,
        handleBlcTemplateChange,
        addEventToBlcTemplate,
        removeEventFromBlcTemplate,
        handleBlcSave
    };
}
