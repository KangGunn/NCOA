import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

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
    const [restrictionBrush, setRestrictionBrush] = useState<'kta' | 'medic' | 'personal' | 'blc' | 's3' | 'pao' | null>(null);
    const [selectedMember, setSelectedMember] = useState<CalendarMember | null>(null);
    
    // 로컬 당직 샌드박스 상태
    const [duties, setDuties] = useState<CalendarEvent[]>([]);
    const [dutiesInitialized, setDutiesInitialized] = useState(false);

    // 원본 데이터가 최초 로드될 때 샌드박스 초기화
    useEffect(() => {
        if (events.length > 0 && !dutiesInitialized) {
            const initialDuties = events.filter((e: CalendarEvent) => e.type === 'duty');
            setDuties(initialDuties);
            setDutiesInitialized(true);
            showToast("실제 당직 데이터를 로컬 샌드박스에 연동했습니다! (실제 DB는 수정되지 않습니다)");
        }
    }, [events, dutiesInitialized, showToast]);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const currentMonthDuties = duties.filter((e: CalendarEvent) => {
        if (e.type !== 'duty') return false;
        const eDate = new Date(e.startDate);
        return eDate.getFullYear() === year && eDate.getMonth() === month;
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

    // 각 대원별 누적 당직 근무 횟수 통계 (평당/금일당/토당 세분화)
    const dutyStats = members.reduce((acc: Record<string, { total: number; weekday: number; friSun: number; sat: number }>, member: CalendarMember) => {
        if (member.role === 'runner') {
            acc[member.name] = { total: 0, weekday: 0, friSun: 0, sat: 0 };
            return acc;
        }

        const baselineWeekday = member.baselineWeekday || 0;
        const baselineFriSun = member.baselineFriSun || 0;
        const baselineSat = member.baselineSat || 0;

        let extraWeekday = 0;
        let extraFriSun = 0;
        let extraSat = 0;

        const targetMonth = currentDate.getMonth() + 1; // 1-indexed selected month in planner
        const memberDuties = duties.filter((d: CalendarEvent) => d.memo === member.name && d.startDate.startsWith('2026-'));

        memberDuties.forEach((d: CalendarEvent) => {
            const parts = d.startDate.split('-');
            const eventMonth = parseInt(parts[1], 10);
            const eventYear = parseInt(parts[0], 10);

            if (eventYear === 2026 && eventMonth >= 4 && eventMonth <= targetMonth) {
                const dutyType = getDutyType(d.startDate);
                if (dutyType === 'weekday') extraWeekday++;
                else if (dutyType === 'friSun') extraFriSun++;
                else if (dutyType === 'sat') extraSat++;
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
            sat
        };
        return acc;
    }, {} as Record<string, { total: number; weekday: number; friSun: number; sat: number }>);

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

        const existingDuty = currentMonthDuties.find((d: CalendarEvent) => d.startDate === dateStr);
        const targetMemberName = directMemberName || selectedMember?.name;

        if (targetMemberName) {
            if (!existingDuty) {
                const newLocalDuty: CalendarEvent = {
                    id: `local-duty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    type: 'duty',
                    startDate: dateStr,
                    endDate: dateStr,
                    memo: targetMemberName
                };
                setDuties(prev => [...prev, newLocalDuty]);
            } else if (existingDuty.memo !== targetMemberName) {
                setDuties(prev => prev.map((d: CalendarEvent) => 
                    d.id === existingDuty.id ? { ...d, memo: targetMemberName } : d
                ));
            }
        } else if (!selectedMember && existingDuty && !directMemberName) {
            setDuties(prev => prev.filter((d: CalendarEvent) => d.id !== existingDuty.id));
        }
    };

    const handleClearDate = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDuties(prev => prev.filter((d: CalendarEvent) => d.id !== id));
    };

    const handleClearMonth = () => {
        if (currentMonthDuties.length === 0) {
            showToast("이번 달에 삭제할 당직 일정이 없습니다.");
            return;
        }

        if (confirm(`⚠️ [경고] ${year}년 ${month + 1}월에 배정된 총 ${currentMonthDuties.length}개의 당직 일정을 전부 지우시겠습니까? (이 변경은 임시 화면에만 적용되며 실제 DB에는 반영되지 않습니다)`)) {
            setDuties(prev => prev.filter((d: CalendarEvent) => {
                const eDate = new Date(d.startDate);
                return !(eDate.getFullYear() === year && eDate.getMonth() === month);
            }));
            showToast(`[임시] ${month + 1}월의 당직표가 초기화되었습니다.`);
        }
    };

    return {
        currentDate, setCurrentDate,
        viewMode, setViewMode,
        restrictionBrush, setRestrictionBrush,
        selectedMember, setSelectedMember,
        duties, setDuties,
        currentMonthDuties, dutyStats,
        togglePersonalRestriction,
        toggleMemberDutyCompleted,
        handleCellClick, handleClearDate, handleClearMonth
    };
}
