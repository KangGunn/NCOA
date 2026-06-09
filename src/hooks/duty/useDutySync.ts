import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
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

    // Derived dutyHolidays from events
    const dutyHolidays = events
        .filter(e => e.type === 'holiday' && e.holidayType === 'duty')
        .map(e => ({
            id: e.id,
            name: e.memo,
            startDate: e.startDate,
            endDate: e.endDate
        }));

    // KTA Template 연관 상태
    const [extraBefore, setExtraBefore] = useState<number>(0);
    const [extraAfter, setExtraAfter] = useState<number>(0);
    const [ktaDayLabels, setKtaDayLabels] = useState<Record<number, string>>({});
    const [restrictions, setRestrictions] = useState<Record<number, Record<string, boolean>>>({});
    const [ktaSections, setKtaSections] = useState<string[]>([]);

    // BLC Template 연관 상태
    const [blcDayLabels, setBlcDayLabels] = useState<Record<number, string>>({});
    const [blcRestrictions, setBlcRestrictions] = useState<Record<number, Record<string, boolean>>>({});
    const [blcSections, setBlcSections] = useState<string[]>([]);

    // 월간 날짜별 커스텀 레이블 상태
    const [monthlyDayLabels, setMonthlyDayLabels] = useState<Record<string, string>>({});

    // 브러시 적용 섹션 매핑 설정 상태
    const [dutyBrushSections, setDutyBrushSections] = useState<Record<string, string>>({
        kta: 'KTA',
        medic: 'MEDIC',
        paoKta: 'PAO',
        blc: 'BLC',
        s3: 'S3',
        paoBlc: 'PAO'
    });

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
                
                if (Array.isArray(data.sections)) {
                    setKtaSections(data.sections);
                } else {
                    setKtaSections(['KTA', 'MEDIC', 'PAO']);
                }

                if (Array.isArray(data.restrictions)) {
                    const loadedRestrictions: Record<number, Record<string, boolean>> = {};
                    data.restrictions.forEach((r: any) => {
                        const dayRest: Record<string, boolean> = {};
                        if (r.restMap) {
                            Object.assign(dayRest, r.restMap);
                        } else {
                            // 하위 호환 (대소문자 둘 다 지원)
                            dayRest['KTA'] = !!r.ktaRestricted;
                            dayRest['kta'] = !!r.ktaRestricted;
                            dayRest['MEDIC'] = !!r.medicRestricted;
                            dayRest['medic'] = !!r.medicRestricted;
                            dayRest['PAO'] = !!r.paoRestricted;
                            dayRest['pao'] = !!r.paoRestricted;
                        }
                        loadedRestrictions[r.day] = dayRest;
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
                
                if (Array.isArray(data.sections)) {
                    setBlcSections(data.sections);
                } else {
                    setBlcSections(['BLC', 'S3', 'PAO']);
                }

                if (Array.isArray(data.restrictions)) {
                    const loadedRestrictions: Record<number, Record<string, boolean>> = {};
                    data.restrictions.forEach((r: any) => {
                        const dayRest: Record<string, boolean> = {};
                        if (r.restMap) {
                            Object.assign(dayRest, r.restMap);
                        } else {
                            // 하위 호환 (대소문자 둘 다 지원)
                            dayRest['BLC'] = !!r.blcRestricted;
                            dayRest['blc'] = !!r.blcRestricted;
                            dayRest['S3'] = !!r.s3Restricted;
                            dayRest['s3'] = !!r.s3Restricted;
                            dayRest['PAO'] = !!r.paoRestricted;
                            dayRest['pao'] = !!r.paoRestricted;
                        }
                        loadedRestrictions[r.day] = dayRest;
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

        // 월간 날짜 레이블 실시간 구독 추가
        const unsubMonthlyDayLabels = onSnapshot(doc(db, 'settings', 'monthlyDayLabels'), (snapshot) => {
            if (snapshot.exists()) {
                setMonthlyDayLabels(snapshot.data() as Record<string, string>);
            } else {
                setMonthlyDayLabels({});
            }
        }, (error) => {
            console.error("Monthly day labels fetch error:", error);
        });

        // 브러시 적용 섹션 설정 실시간 구독 추가
        const unsubDutyBrushSections = onSnapshot(doc(db, 'settings', 'dutyBrushSections'), (snapshot) => {
            if (snapshot.exists()) {
                setDutyBrushSections(prev => ({
                    ...prev,
                    ...snapshot.data()
                }));
            }
        }, (error) => {
            console.error("Duty brush sections fetch error:", error);
        });

        return () => {
            unsubSchedules();
            unsubMembers();
            unsubKtaTemplate();
            unsubBlcTemplate();
            unsubPersonalRestrictions();
            unsubMonthlyDayLabels();
            unsubDutyBrushSections();
        };
    }, [showToast]);

    const handleAddDutyHoliday = async (name: string, startDate: string, endDate: string) => {
        try {
            const user = auth.currentUser;
            await addDoc(collection(db, "schedules"), {
                uid: user?.uid || "",
                type: 'holiday',
                holidayType: 'duty',
                startDate,
                endDate,
                memo: name.trim(),
                createdAt: serverTimestamp()
            });
            showToast(`'${name}' 휴일이 추가되었습니다.`);
        } catch (e) {
            console.error("Error adding duty holiday:", e);
            showToast("휴일 추가 중 오류가 발생했습니다.", "error");
        }
    };

    const handleDeleteDutyHoliday = async (id: string) => {
        try {
            await deleteDoc(doc(db, "schedules", id));
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
        monthlyDayLabels, setMonthlyDayLabels,
        dutyBrushSections, setDutyBrushSections,
        dutyHolidays, handleAddDutyHoliday, handleDeleteDutyHoliday,
        ktaSections, setKtaSections, blcSections, setBlcSections
    };
}
