import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

export interface DutyHoliday {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
}

export function useDutySync(showToast: (message: string, type?: 'success' | 'error') => void) {
    // Firestore 원본 데이터
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [members, setMembers] = useState<CalendarMember[]>([]);
    const [ktaTemplate, setKtaTemplate] = useState<any>(null);
    const [blcTemplate, setBlcTemplate] = useState<any>(null);
    const [personalRestrictions, setPersonalRestrictions] = useState<Record<string, string[]>>({});
    const [dutyHolidays, setDutyHolidays] = useState<DutyHoliday[]>([]);
    
    // KTA Template 연관 상태
    const [extraBefore, setExtraBefore] = useState<number>(0);
    const [extraAfter, setExtraAfter] = useState<number>(0);
    const [ktaDayLabels, setKtaDayLabels] = useState<Record<number, string>>({});
    const [restrictions, setRestrictions] = useState<Record<number, { kta: boolean; medic: boolean; pao: boolean }>>({});
    
    // BLC Template 연관 상태
    const [blcDayLabels, setBlcDayLabels] = useState<Record<number, string>>({});
    const [blcRestrictions, setBlcRestrictions] = useState<Record<number, { blc: boolean; s3: boolean; pao: boolean }>>({});
    
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        const qSchedules = query(collection(db, "schedules"));
        const unsubSchedules = onSnapshot(qSchedules, (snapshot) => {
            const data = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            })) as CalendarEvent[];
            setEvents(data);
            setLoading(false);
        }, (error) => {
            console.error("Schedules fetch error:", error);
            showToast("일정 데이터를 불러오는데 실패했습니다.", "error");
        });

        const qMembers = query(collection(db, 'members'));
        const unsubMembers = onSnapshot(qMembers, (snapshot) => {
            const data = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            })) as CalendarMember[];
            
            // 1차 정렬: 당직 완료 여부 (완료된 사람은 맨 아래로)
            data.sort((a, b) => {
                const compA = !!a.dutyCompleted;
                const compB = !!b.dutyCompleted;
                if (compA !== compB) {
                    return compA ? 1 : -1;
                }
                
                // 2차 정렬: 러너는 기수정렬 아래로
                if (a.role === 'runner' && b.role !== 'runner') return 1;
                if (a.role !== 'runner' && b.role === 'runner') return -1;
                
                // 3차 정렬: 기수(입대일) 및 이름순
                const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
                const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
                if (dateA !== dateB) return dateA < dateB ? -1 : 1;
                return (a.name || '').localeCompare(b.name || '');
            });
            setMembers(data);
        }, (error) => {
            console.error("Members fetch error:", error);
        });

        // KTA Template 실시간 구독 추가
        const unsubKtaTemplate = onSnapshot(doc(db, 'settings', 'ktaTemplate'), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                setKtaTemplate(data);

                if (typeof data.extraBefore === 'number') setExtraBefore(data.extraBefore);
                if (typeof data.extraAfter === 'number') setExtraAfter(data.extraAfter);
                if (data.dayLabels) setKtaDayLabels(data.dayLabels);

                if (Array.isArray(data.restrictions)) {
                    const loadedRestrictions: Record<number, { kta: boolean; medic: boolean; pao: boolean }> = {};
                    data.restrictions.forEach((r: any) => {
                        loadedRestrictions[r.day] = {
                            kta: !!r.ktaRestricted,
                            medic: !!r.medicRestricted,
                            pao: !!r.paoRestricted
                        };
                    });
                    setRestrictions(loadedRestrictions);
                }
            }
        }, (error) => {
            console.error("KTA template fetch error:", error);
        });

        // BLC Template 실시간 구독 추가
        const unsubBlcTemplate = onSnapshot(doc(db, 'settings', 'blcTemplate'), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                setBlcTemplate(data);
                if (data.dayLabels) setBlcDayLabels(data.dayLabels);
                
                if (Array.isArray(data.restrictions)) {
                    const loadedRestrictions: Record<number, { blc: boolean; s3: boolean; pao: boolean }> = {};
                    data.restrictions.forEach((r: any) => {
                        loadedRestrictions[r.day] = {
                            blc: !!r.blcRestricted,
                            s3: !!r.s3Restricted,
                            pao: !!r.paoRestricted
                        };
                    });
                    setBlcRestrictions(loadedRestrictions);
                }
            }
        }, (error) => {
            console.error("BLC template fetch error:", error);
        });

        // 개인별 당직 제한 실시간 구독 추가
        const unsubPersonalRestrictions = onSnapshot(doc(db, 'settings', 'personalRestrictions'), (snapshot) => {
            if (snapshot.exists()) {
                setPersonalRestrictions(snapshot.data() as Record<string, string[]>);
            }
        }, (error) => {
            console.error("Personal restrictions fetch error:", error);
        });

        // 당직 전용 휴일 실시간 구독 추가
        const unsubDutyHolidays = onSnapshot(doc(db, 'settings', 'dutyHolidays'), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                if (Array.isArray(data.holidays)) {
                    setDutyHolidays(data.holidays);
                } else {
                    setDutyHolidays([]);
                }
            } else {
                setDutyHolidays([]);
            }
        }, (error) => {
            console.error("Duty holidays fetch error:", error);
        });

        return () => {
            unsubSchedules();
            unsubMembers();
            unsubKtaTemplate();
            unsubBlcTemplate();
            unsubPersonalRestrictions();
            unsubDutyHolidays();
        };
    }, [showToast]);

    const handleAddDutyHoliday = async (name: string, startDate: string, endDate: string) => {
        try {
            const newHoliday: DutyHoliday = {
                id: `duty-holiday-${Date.now()}`,
                name: name.trim(),
                startDate,
                endDate
            };
            const updated = [...dutyHolidays, newHoliday];
            await setDoc(doc(db, 'settings', 'dutyHolidays'), {
                holidays: updated
            });
            showToast(`'${name}' 휴일이 추가되었습니다.`);
        } catch (e) {
            console.error("Error adding duty holiday:", e);
            showToast("휴일 추가 중 오류가 발생했습니다.", "error");
        }
    };

    const handleDeleteDutyHoliday = async (id: string) => {
        try {
            const updated = dutyHolidays.filter(h => h.id !== id);
            await setDoc(doc(db, 'settings', 'dutyHolidays'), {
                holidays: updated
            });
            showToast("휴일이 삭제되었습니다.");
        } catch (e) {
            console.error("Error deleting duty holiday:", e);
            showToast("휴일 삭제 중 오류가 발생했습니다.", "error");
        }
    };

    return {
        events, members, ktaTemplate, blcTemplate, personalRestrictions, loading,
        extraBefore, setExtraBefore, extraAfter, setExtraAfter,
        ktaDayLabels, setKtaDayLabels, restrictions, setRestrictions,
        blcDayLabels, setBlcDayLabels, blcRestrictions, setBlcRestrictions,
        dutyHolidays, handleAddDutyHoliday, handleDeleteDutyHoliday
    };
}
