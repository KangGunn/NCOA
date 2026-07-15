import { useState, useEffect, useRef, useMemo } from 'react';
import { db, auth } from '../../lib/firebase';
import { doc, setDoc, updateDoc, writeBatch, collection, serverTimestamp, onSnapshot } from 'firebase/firestore';
import type { CalendarEvent, CalendarMember, MemberConfig } from '../../types/calendar/calendar.type';

interface UseDutyStateProps {
    events: CalendarEvent[];
    members: CalendarMember[];
    personalRestrictions: Record<string, string[]>;
    dutyHolidays: any[];
    showToast: (message: string, type?: 'success' | 'error') => void;
}

export function useDutyState({ events, members, personalRestrictions, dutyHolidays, showToast }: UseDutyStateProps) {
    const [currentDate, setCurrentDate] = useState(() => {
        const today = new Date();
        return new Date(today.getFullYear(), today.getMonth() + 1, 1);
    });

    const [viewMode, setViewMode] = useState<'actual' | 'kta-template' | 'blc-template'>('actual');
    const [restrictionBrush, setRestrictionBrush] = useState<string | null>(null);
    const [selectedMember, setSelectedMember] = useState<CalendarMember | null>(null);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // 로컬 당직 샌드박스 상태
    const [draftDuties, setDraftDuties] = useState<CalendarEvent[]>([]);
    const [editedMonths, setEditedMonths] = useState<Set<string>>(new Set());
    const [draftConfigs, setDraftConfigs] = useState<Record<string, Record<string, MemberConfig>>>({});
    const [draftLockedMembers, setDraftLockedMembers] = useState<Record<string, Record<string, boolean>>>({});
    const [dutiesInitialized, setDutiesInitialized] = useState(false);
    const isConfirmingRef = useRef(false);

    // 임시 상태 Firestore 실시간 동기화 구독
    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'settings', 'dutyDraft'), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                setDraftDuties(data.duties || []);
                setEditedMonths(new Set(data.editedMonths || []));
                setDraftConfigs(data.configs || {});
                setDraftLockedMembers(data.lockedMembers || {});
                setDutiesInitialized(true);
            } else {
                setDraftDuties([]);
                setEditedMonths(new Set());
                setDraftConfigs({});
                setDraftLockedMembers({});
                if (events.length > 0) {
                    setDutiesInitialized(true);
                }
            }
        }, (error) => {
            console.error("Error subscribing to dutyDraft:", error);
        });
        return () => unsub();
    }, [events]);

    const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const configs = useMemo(() => draftConfigs[currentMonthKey] || {}, [draftConfigs, currentMonthKey]);
    const lockedMembers = useMemo(() => draftLockedMembers[currentMonthKey] || {}, [draftLockedMembers, currentMonthKey]);

    // 전체 당직 목록 (편집중인 달은 임시 데이터, 편집하지 않는 달은 실제 DB 데이터 결합)
    const duties = useMemo(() => {
        const dbDuties = events.filter((e: CalendarEvent) => e.type === 'duty');
        
        const nonEditedDbDuties = dbDuties.filter(d => {
            const [yStr, mStr] = d.startDate.split('-');
            const monthKey = `${yStr}-${mStr}`;
            return !editedMonths.has(monthKey);
        });

        const editedDraftDuties = draftDuties.filter(d => {
            const [yStr, mStr] = d.startDate.split('-');
            const monthKey = `${yStr}-${mStr}`;
            return editedMonths.has(monthKey);
        });

        return [...editedDraftDuties, ...nonEditedDbDuties];
    }, [events, draftDuties, editedMonths]);

    const updateDraftInFirestore = async (
        newDraftDuties: CalendarEvent[], 
        newEditedMonths: Set<string>,
        newConfigs = draftConfigs,
        newLockedMembers = draftLockedMembers
    ) => {
        try {
            await setDoc(doc(db, 'settings', 'dutyDraft'), {
                duties: newDraftDuties,
                editedMonths: Array.from(newEditedMonths),
                configs: newConfigs,
                lockedMembers: newLockedMembers,
                updatedAt: serverTimestamp()
            });
        } catch (e) {
            console.error("Failed to save draft to Firestore:", e);
            showToast("임시 당직 데이터를 공유하는데 실패했습니다.", "error");
        }
    };

    const updateConfig = async (memberName: string, patch: Partial<MemberConfig>) => {
        const currentMonthConfigs = draftConfigs[currentMonthKey] || {};
        const memberConfig = currentMonthConfigs[memberName] || { weekday: '', friSun: '', sat: '', free: '' };
        
        const nextMonthConfigs = {
            ...currentMonthConfigs,
            [memberName]: { ...memberConfig, ...patch }
        };
        const nextDraftConfigs = {
            ...draftConfigs,
            [currentMonthKey]: nextMonthConfigs
        };

        await updateDraftInFirestore(draftDuties, editedMonths, nextDraftConfigs, draftLockedMembers);
    };

    const toggleLock = async (memberName: string) => {
        const currentMonthLocked = draftLockedMembers[currentMonthKey] || {};
        const isLocked = !!currentMonthLocked[memberName];

        const nextMonthLocked = {
            ...currentMonthLocked,
            [memberName]: !isLocked
        };
        const nextDraftLockedMembers = {
            ...draftLockedMembers,
            [currentMonthKey]: nextMonthLocked
        };

        await updateDraftInFirestore(draftDuties, editedMonths, draftConfigs, nextDraftLockedMembers);
    };

    const getMarkedMonths = (currentSet: Set<string>) => {
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        if (!currentSet.has(monthKey)) {
            const next = new Set(currentSet);
            next.add(monthKey);
            return next;
        }
        return currentSet;
    };

    const setDuties = (valOrFunc: CalendarEvent[] | ((prev: CalendarEvent[]) => CalendarEvent[])) => {
        let nextDuties: CalendarEvent[] = [];
        if (typeof valOrFunc === 'function') {
            nextDuties = valOrFunc(duties);
        } else {
            nextDuties = valOrFunc;
        }

        const otherMonthsDraftDuties = draftDuties.filter(d => {
            const [yStr, mStr] = d.startDate.split('-');
            const monthKey = `${yStr}-${mStr}`;
            return monthKey !== currentMonthKey;
        });

        const thisMonthDuties = nextDuties.filter(d => {
            const [yStr, mStr] = d.startDate.split('-');
            const monthKey = `${yStr}-${mStr}`;
            return monthKey === currentMonthKey;
        });

        const nextDraftDuties = [...otherMonthsDraftDuties, ...thisMonthDuties];
        const nextEditedMonths = getMarkedMonths(editedMonths);
        updateDraftInFirestore(nextDraftDuties, nextEditedMonths);
    };

    const currentMonthDuties = duties.filter((e: CalendarEvent) => {
        if (e.type !== 'duty') return false;
        const [yStr, mStr] = e.startDate.split('-');
        const eYear = parseInt(yStr, 10);
        const eMonth = parseInt(mStr, 10) - 1;
        return eYear === year && eMonth === month;
    });

    const getPrevDateStr = (dateStr: string) => {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const getDutyType = (dateStr: string): 'weekday' | 'friSun' | 'sat' => {
        // 1. 연휴 시작 전날 -> 금일당 ('friSun')
        const isDayBeforeHolidayStart = dutyHolidays.some(h => dateStr === getPrevDateStr(h.startDate));
        if (isDayBeforeHolidayStart) {
            return 'friSun';
        }

        // 2. 연휴 마지막 날 -> 금일당 ('friSun')
        const isHolidayLastDay = dutyHolidays.some(h => dateStr === h.endDate);
        if (isHolidayLastDay) {
            return 'friSun';
        }

        // 3. 연휴 그 사이 -> 토당 ('sat')
        const isHolidayBetween = dutyHolidays.some(h => dateStr >= h.startDate && dateStr < h.endDate);
        if (isHolidayBetween) {
            return 'sat';
        }

        // 4. 일반적인 주말 및 금요일 판단
        const d = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = d.getDay(); // 0: Sun, 5: Fri, 6: Sat

        if (dayOfWeek === 6) {
            return 'sat'; // 토요일 -> 토당
        }
        if (dayOfWeek === 0 || dayOfWeek === 5) {
            return 'friSun'; // 금요일, 일요일 -> 금일당
        }

        // 5. 일반 평일 -> 평당 ('weekday')
        return 'weekday';
    };

    const isDateAffectedByDonsa = (dateStr: string, allEvents: CalendarEvent[]): boolean => {
        const donsaHolidays = allEvents.filter(e => e.type === 'holiday' && e.holidayType === 'duty' && e.memo?.toUpperCase().includes('DONSA'));
        const isDayBeforeDonsaStart = donsaHolidays.some(h => dateStr === getPrevDateStr(h.startDate));
        const isDonsaLastDay = donsaHolidays.some(h => dateStr === h.endDate);
        const isDonsaBetween = donsaHolidays.some(h => dateStr >= h.startDate && dateStr < h.endDate);
        return isDayBeforeDonsaStart || isDonsaLastDay || isDonsaBetween;
    };

    const isDateDuringKtaPeriod = (dateStr: string, eventsList: CalendarEvent[]) => {
        const ktaDay0s = eventsList.filter(e => e.type === 'kta' && e.memo?.includes('Day 0'));
        const ktaGrads = eventsList.filter(e => e.type === 'kta' && (e.memo?.includes('Graduation') || e.memo?.includes('수료') || e.memo?.includes('🎓')));

        return ktaDay0s.some(day0 => {
            const grad = ktaGrads.find(g => {
                if (day0.batch && g.batch) {
                    return g.batch === day0.batch && g.startDate >= day0.startDate;
                }
                const d0Time = new Date(day0.startDate + 'T00:00:00').getTime();
                const gTime = new Date(g.startDate + 'T00:00:00').getTime();
                return gTime >= d0Time && (gTime - d0Time) <= 30 * 24 * 60 * 60 * 1000;
            });

            if (grad) {
                return dateStr >= day0.startDate && dateStr <= grad.startDate;
            }
            return false;
        });
    };

    // 각 대원별 누적 당직 근무 횟수 통계 (평당/금일당/토당 세분화)
    const dutyStats = members.reduce((acc: Record<string, {
        total: number;
        weekday: number;
        friSun: number;
        sat: number;
        currentMonthWeekday?: number;
        currentMonthFriSun?: number;
        currentMonthSat?: number;
    }>, member: CalendarMember) => {


        const baselineWeekday = member.baselineWeekday || 0;
        const baselineFriSun = member.baselineFriSun || 0;
        const baselineSat = member.baselineSat || 0;

        let extraWeekday = 0;
        let extraFriSun = 0;
        let extraSat = 0;

        let currentMonthWeekday = 0;
        let currentMonthFriSun = 0;
        let currentMonthSat = 0;

        const targetMonth = currentDate.getMonth() + 1; // 1-indexed selected month in planner

        const CURRENT_YEAR = 2026;
        const START_MONTH = 4; // April

        // 1. 이전 달까지의 누적치는 DB 실제 저장 데이터(events)에서 계산
        const dbDuties = events.filter((e: CalendarEvent) => e.type === 'duty' && e.memo === member.name && e.startDate.startsWith(`${CURRENT_YEAR}-`));

        // 2. 이번 달(현재 플래너 대상 월)은 로컬 샌드박스 상태(duties)에서 계산
        const currentMonthDutiesLocal = duties.filter((d: CalendarEvent) => d.memo === member.name && d.startDate.startsWith(`${CURRENT_YEAR}-`) && parseInt(d.startDate.split('-')[1], 10) === targetMonth);

        dbDuties.forEach((d: CalendarEvent) => {
            const parts = d.startDate.split('-');
            const eventMonth = parseInt(parts[1], 10);
            const eventYear = parseInt(parts[0], 10);

            if (eventYear === CURRENT_YEAR && eventMonth >= START_MONTH && eventMonth < targetMonth) {
                const isKtaOrMedicMember = member.sections?.includes('KTA') || member.sections?.includes('MEDIC');
                let dutyType = d.customDutyType || getDutyType(d.startDate);
                if (!d.customDutyType && isKtaOrMedicMember && isDateDuringKtaPeriod(d.startDate, events) && !isDateAffectedByDonsa(d.startDate, events)) {
                    const dObj = new Date(d.startDate + 'T00:00:00');
                    const dayOfWeek = dObj.getDay();
                    if (dayOfWeek === 6) {
                        dutyType = 'sat';
                    } else if (dayOfWeek === 0 || dayOfWeek === 5) {
                        dutyType = 'friSun';
                    } else {
                        dutyType = 'weekday';
                    }
                }

                if (dutyType === 'weekday') {
                    extraWeekday++;
                } else if (dutyType === 'friSun') {
                    extraFriSun++;
                } else if (dutyType === 'sat') {
                    extraSat++;
                }
            }
        });

        currentMonthDutiesLocal.forEach((d: CalendarEvent) => {
            const isKtaOrMedicMember = member.sections?.includes('KTA') || member.sections?.includes('MEDIC');
            let dutyType = d.customDutyType || getDutyType(d.startDate);
            if (!d.customDutyType && isKtaOrMedicMember && isDateDuringKtaPeriod(d.startDate, events) && !isDateAffectedByDonsa(d.startDate, events)) {
                const dObj = new Date(d.startDate + 'T00:00:00');
                const dayOfWeek = dObj.getDay();
                if (dayOfWeek === 6) {
                    dutyType = 'sat';
                } else if (dayOfWeek === 0 || dayOfWeek === 5) {
                    dutyType = 'friSun';
                } else {
                    dutyType = 'weekday';
                }
            }

            if (dutyType === 'weekday') {
                extraWeekday++;
                currentMonthWeekday++;
            } else if (dutyType === 'friSun') {
                extraFriSun++;
                currentMonthFriSun++;
            } else if (dutyType === 'sat') {
                extraSat++;
                currentMonthSat++;
            }
        });

        const weekday = baselineWeekday + extraWeekday;
        const friSun = baselineFriSun + extraFriSun;
        const sat = baselineSat + extraSat;
        const total = weekday + friSun + sat;

        acc[member.name] = {
            total,
            weekday,
            friSun,
            sat,
            currentMonthWeekday,
            currentMonthFriSun,
            currentMonthSat
        };
        return acc;
    }, {} as Record<string, {
        total: number;
        weekday: number;
        friSun: number;
        sat: number;
        currentMonthWeekday?: number;
        currentMonthFriSun?: number;
        currentMonthSat?: number;
    }>);

    // 개인 제한 토글
    const togglePersonalRestriction = async (dateStr: string, memberName: string) => {
        try {
            const currentList = personalRestrictions[dateStr] || [];
            const nextList = currentList.includes(memberName)
                ? currentList.filter(n => n !== memberName)
                : [...currentList, memberName];

            await setDoc(doc(db, 'settings', 'personalRestrictions'), {
                [dateStr]: nextList
            }, { merge: true });
        } catch (e) {
            console.error("Error toggling personal restriction:", e);
            showToast("제한 설정 저장 중 오류가 발생했습니다.", "error");
        }
    };

    // 대원 당직 완료 토글
    const toggleMemberDutyCompleted = async (e: React.MouseEvent, memberId: string, memberName: string, currentStatus: boolean) => {
        e.stopPropagation();
        try {
            await updateDoc(doc(db, 'members', memberId), {
                dutyCompleted: !currentStatus
            });
            showToast(`${memberName} 대원의 당직 완료 상태를 ${!currentStatus ? '설정' : '해제'}했습니다. 💾`);
        } catch (err) {
            console.error("Error toggling dutyCompleted status:", err);
            showToast("상태 변경 중 오류가 발생했습니다.", "error");
        }
    };

    const markCurrentMonthAsEdited = () => {
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        if (!editedMonths.has(monthKey)) {
            const thisMonthDuties = duties.filter(d => {
                const [yStr, mStr] = d.startDate.split('-');
                return `${yStr}-${mStr}` === monthKey;
            });
            const nextDraftDuties = [...draftDuties, ...thisMonthDuties];
            const nextEditedMonths = getMarkedMonths(editedMonths);
            updateDraftInFirestore(nextDraftDuties, nextEditedMonths);
        }
    };

    // 단일 날짜 당직 배정 및 로컬 샌드박스 처리
    const handleCellClick = (dateStr: string, directMemberName?: string) => {
        if (viewMode === 'actual' && restrictionBrush === 'personal') {
            if (directMemberName) {
                togglePersonalRestriction(dateStr, directMemberName);
            } else if (selectedMember) {
                togglePersonalRestriction(dateStr, selectedMember.name);
            } else {
                showToast("불가 처리할 대원을 대원 명단에서 선택해주세요.", "error");
            }
            return;
        }

        const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        const otherMonthsDraftDuties = draftDuties.filter(d => {
            const [yStr, mStr] = d.startDate.split('-');
            return `${yStr}-${mStr}` !== currentMonthKey;
        });

        const thisMonthDuties = duties.filter(d => {
            const [yStr, mStr] = d.startDate.split('-');
            return `${yStr}-${mStr}` === currentMonthKey;
        });

        const existingDuty = thisMonthDuties.find((d: CalendarEvent) => d.startDate === dateStr);
        const targetMemberName = directMemberName || selectedMember?.name;

        let nextThisMonthDuties = [...thisMonthDuties];

        if (targetMemberName) {
            if (!existingDuty) {
                const newLocalDuty: CalendarEvent = {
                    id: `local-duty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    type: 'duty',
                    startDate: dateStr,
                    endDate: dateStr,
                    memo: targetMemberName
                };
                nextThisMonthDuties.push(newLocalDuty);
            } else if (existingDuty.memo !== targetMemberName) {
                nextThisMonthDuties = nextThisMonthDuties.map((d: CalendarEvent) =>
                    d.id === existingDuty.id ? { ...d, memo: targetMemberName } : d
                );
            }
        } else if (!selectedMember && existingDuty && !directMemberName) {
            nextThisMonthDuties = nextThisMonthDuties.filter((d: CalendarEvent) => d.id !== existingDuty.id);
        }

        const nextDraftDuties = [...otherMonthsDraftDuties, ...nextThisMonthDuties];
        const nextEditedMonths = getMarkedMonths(editedMonths);
        updateDraftInFirestore(nextDraftDuties, nextEditedMonths);
    };

    const handleClearDate = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        
        const otherMonthsDraftDuties = draftDuties.filter(d => {
            const [yStr, mStr] = d.startDate.split('-');
            return `${yStr}-${mStr}` !== currentMonthKey;
        });

        const thisMonthDuties = duties.filter(d => {
            const [yStr, mStr] = d.startDate.split('-');
            return `${yStr}-${mStr}` === currentMonthKey;
        }).filter((d: CalendarEvent) => d.id !== id);

        const nextDraftDuties = [...otherMonthsDraftDuties, ...thisMonthDuties];
        const nextEditedMonths = getMarkedMonths(editedMonths);
        updateDraftInFirestore(nextDraftDuties, nextEditedMonths);
    };

    const handleClearMonth = () => {
        if (currentMonthDuties.length === 0) {
            showToast("이번 달에 삭제할 당직 일정이 없습니다.");
            return;
        }

        if (confirm(`⚠️ [경고] ${year}년 ${month + 1}월에 배정된 총 ${currentMonthDuties.length}개의 당직 일정을 전부 지우시겠습니까? (이 변경은 임시 화면에만 적용되며 실제 DB에는 반영되지 않습니다)`)) {
            const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
            const otherMonthsDraftDuties = draftDuties.filter(d => {
                const [yStr, mStr] = d.startDate.split('-');
                return `${yStr}-${mStr}` !== currentMonthKey;
            });

            const nextEditedMonths = getMarkedMonths(editedMonths);
            updateDraftInFirestore(otherMonthsDraftDuties, nextEditedMonths);
            showToast(`[임시] ${month + 1}월의 당직표가 초기화되었습니다.`);
        }
    };

    const handleSyncFromDB = () => {
        const actualDutiesThisMonth = events.filter((e: CalendarEvent) => {
            if (e.type !== 'duty') return false;
            const [yStr, mStr] = e.startDate.split('-');
            const eYear = parseInt(yStr, 10);
            const eMonth = parseInt(mStr, 10) - 1;
            return eYear === year && eMonth === month;
        });

        if (confirm(`📅 실제 캘린더 DB에 저장된 ${year}년 ${month + 1}월의 당직 일정 ${actualDutiesThisMonth.length}건을 플래너에 불러오시겠습니까?\n(현재 플래너에 임시 작성 중인 당월 정보는 덮어씌워집니다)`)) {
            const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
            const otherMonthsDraftDuties = draftDuties.filter(d => {
                const [yStr, mStr] = d.startDate.split('-');
                return `${yStr}-${mStr}` !== currentMonthKey;
            });

            const nextEditedMonths = new Set(editedMonths);
            nextEditedMonths.delete(currentMonthKey);

            updateDraftInFirestore(otherMonthsDraftDuties, nextEditedMonths);
            showToast("실제 캘린더 당직 데이터를 성공적으로 가져왔습니다!");
        }
    };

    const handleConfirmDuties = async () => {
        if (!dutiesInitialized || isConfirmingRef.current) return;

        const sandboxDutiesThisMonth = duties.filter((d: CalendarEvent) => {
            if (d.type !== 'duty') return false;
            const [yStr, mStr] = d.startDate.split('-');
            const eYear = parseInt(yStr, 10);
            const eMonth = parseInt(mStr, 10) - 1;
            return eYear === year && eMonth === month;
        });

        if (sandboxDutiesThisMonth.length === 0) {
            if (!confirm(`⚠️ 현재 ${year}년 ${month + 1}월에 배정된 당직이 없습니다. 기존 실제 DB의 해당 월 당직을 모두 삭제하시겠습니까?`)) {
                return;
            }
        } else {
            if (!confirm(`📅 ${year}년 ${month + 1}월의 당직 일정 ${sandboxDutiesThisMonth.length}건을 확정하여 실제 캘린더 DB에 반영하시겠습니까?\n(기존 해당 월의 실제 당직 일정은 모두 삭제 후 새로 덮어씌워집니다)`)) {
                return;
            }
        }

        isConfirmingRef.current = true;
        try {
            const dbDutiesThisMonth = events.filter((e: CalendarEvent) => {
                if (e.type !== 'duty') return false;
                const [yStr, mStr] = e.startDate.split('-');
                const eYear = parseInt(yStr, 10);
                const eMonth = parseInt(mStr, 10) - 1;
                return eYear === year && eMonth === month;
            });

            const batch = writeBatch(db);

            // Delete existing actual duties
            dbDutiesThisMonth.forEach(d => {
                batch.delete(doc(db, "schedules", d.id));
            });

            // Add new duties
            const user = auth.currentUser;
            const uid = user?.uid || "";

            sandboxDutiesThisMonth.forEach(d => {
                const newDocRef = doc(collection(db, "schedules"));
                batch.set(newDocRef, {
                    uid,
                    type: 'duty',
                    startDate: d.startDate,
                    endDate: d.endDate,
                    memo: d.memo,
                    createdAt: serverTimestamp()
                });
            });

            await batch.commit();

            const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
            const otherMonthsDraftDuties = draftDuties.filter(d => {
                const [yStr, mStr] = d.startDate.split('-');
                return `${yStr}-${mStr}` !== currentMonthKey;
            });

            const nextEditedMonths = new Set(editedMonths);
            nextEditedMonths.delete(currentMonthKey);

            await updateDraftInFirestore(otherMonthsDraftDuties, nextEditedMonths);

            showToast(`${year}년 ${month + 1}월 당직이 실제 캘린더 DB에 성공적으로 반영되었습니다! 🎉`, "success");
        } catch (e) {
            console.error("Error confirming duties:", e);
            showToast("당직 확정 중 오류가 발생했습니다.", "error");
        } finally {
            isConfirmingRef.current = false;
        }
    };

    return {
        currentDate, setCurrentDate,
        viewMode, setViewMode,
        restrictionBrush, setRestrictionBrush,
        selectedMember, setSelectedMember,
        duties, setDuties,
        currentMonthDuties, dutyStats,
        dutiesInitialized,
        togglePersonalRestriction,
        toggleMemberDutyCompleted,
        handleCellClick, handleClearDate, handleClearMonth,
        handleConfirmDuties,
        handleSyncFromDB,
        markCurrentMonthAsEdited,
        configs, lockedMembers,
        updateConfig, toggleLock
    };
}
