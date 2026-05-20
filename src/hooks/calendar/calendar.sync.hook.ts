import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import type { CalendarEvent, CalendarMember, ScheduleTemplateDay } from '../../types/calendar/calendar.type';

export function useCalendarSync() {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [members, setMembers] = useState<CalendarMember[]>([]);
    const [ktaScheduleTemplate, setKtaScheduleTemplate] = useState<ScheduleTemplateDay[]>(
        Array.from({ length: 21 }, (_, i) => ({ day: i, events: [] }))
    );
    const [blcScheduleTemplate, setBlcScheduleTemplate] = useState<ScheduleTemplateDay[]>(
        Array.from({ length: 23 }, (_, i) => ({ day: i, events: [] }))
    );

    useEffect(() => {
        let unsubscribeSchedules: () => void = () => { };
        let unsubscribeMembers: () => void = () => { };
        let unsubscribeKta: () => void = () => { };
        let unsubscribeBlc: () => void = () => { };

        const authUnsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                // 1. Schedules
                const qSchedules = query(collection(db, "schedules"));
                unsubscribeSchedules = onSnapshot(qSchedules, (snapshot) => {
                    const data = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    })) as CalendarEvent[];
                    setEvents(data);
                });

                // 2. Members
                const qMembers = query(collection(db, 'members'));
                unsubscribeMembers = onSnapshot(qMembers, (snapshot) => {
                    const data = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    })) as CalendarMember[];
                    data.sort((a, b) => {
                        if (a.role === 'runner' && b.role !== 'runner') return 1;
                        if (a.role !== 'runner' && b.role === 'runner') return -1;
                        const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
                        const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
                        if (dateA !== dateB) return dateA < dateB ? -1 : 1;
                        const nameA = typeof a.name === 'string' ? a.name.trim() : '';
                        const nameB = typeof b.name === 'string' ? b.name.trim() : '';
                        if (nameA !== nameB) return nameA < nameB ? -1 : 1;
                        return 0;
                    });
                    setMembers(data);
                });

                // 3. KTA Template
                const qKta = doc(db, 'settings', 'ktaTemplate');
                unsubscribeKta = onSnapshot(qKta, (docSnap) => {
                    if (docSnap.exists()) {
                        const savedSchedules = docSnap.data().schedules || [];
                        setKtaScheduleTemplate(
                            Array.from({ length: 21 }, (_, i) => {
                                const found = savedSchedules.find((s: any) => s.day === i);
                                if (found) {
                                    const events = Array.isArray(found.events) ? found.events : (found.memo ? [found.memo] : []);
                                    return { day: i, events };
                                }
                                return { day: i, events: [] };
                            })
                        );
                    } else {
                        setKtaScheduleTemplate(Array.from({ length: 21 }, (_, i) => ({ day: i, events: [] })));
                    }
                });

                // 4. BLC Template
                const qBlc = doc(db, 'settings', 'blcTemplate');
                unsubscribeBlc = onSnapshot(qBlc, (docSnap) => {
                    if (docSnap.exists()) {
                        const savedSchedules = docSnap.data().schedules || [];
                        setBlcScheduleTemplate(
                            Array.from({ length: 23 }, (_, i) => {
                                const found = savedSchedules.find((s: any) => s.day === i);
                                if (found) {
                                    const events = Array.isArray(found.events) ? found.events : (found.memo ? [found.memo] : []);
                                    return { day: i, events };
                                }
                                return { day: i, events: [] };
                            })
                        );
                    } else {
                        setBlcScheduleTemplate(Array.from({ length: 23 }, (_, i) => ({ day: i, events: [] })));
                    }
                });
            } else {
                setEvents([]);
                setMembers([]);
                setKtaScheduleTemplate(Array.from({ length: 21 }, (_, i) => ({ day: i, events: [] })));
                setBlcScheduleTemplate(Array.from({ length: 23 }, (_, i) => ({ day: i, events: [] })));
            }
        });

        return () => {
            authUnsubscribe();
            unsubscribeSchedules();
            unsubscribeMembers();
            unsubscribeKta();
            unsubscribeBlc();
        };
    }, []);

    return {
        events,
        members,
        ktaScheduleTemplate,
        blcScheduleTemplate,
        setKtaScheduleTemplate, // Exposed for Template Hook DnD
        setBlcScheduleTemplate  // Exposed for Template Hook DnD
    };
}
