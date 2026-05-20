import { useState } from 'react';

export function useRollCallSchedule() {
    const [scheduleParticipants, setScheduleParticipants] = useState<Record<string, string[]>>({
        'HQ PT': [],
        'KTA 업무지원': [],
        'MEDIC 의무지원': [],
        'BLC 업무지원': []
    });
    const [customSchedules, setCustomSchedules] = useState<{ name: string; participants: string[] }[]>([]);

    const addCustomSchedule = (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (customSchedules.find(s => s.name === trimmed)) return;
        setCustomSchedules(prev => [...prev, { name: trimmed, participants: [] }]);
    };

    const removeCustomSchedule = (name: string) => {
        setCustomSchedules(prev => prev.filter(s => s.name !== name));
    };

    const toggleMember = (memberName: string, currentCategory: string) => {
        const isSelectedHere = (scheduleParticipants[currentCategory] || []).includes(memberName) ||
            (customSchedules.find(s => s.name === currentCategory)?.participants.includes(memberName));

        if (isSelectedHere) {
            // 현재 카테고리에서 제거
            if (scheduleParticipants[currentCategory]) {
                setScheduleParticipants(prev => ({
                    ...prev,
                    [currentCategory]: prev[currentCategory].filter(n => n !== memberName)
                }));
            } else {
                setCustomSchedules(prev => prev.map(s =>
                    s.name === currentCategory ? { ...s, participants: s.participants.filter(n => n !== memberName) } : s
                ));
            }
        } else {
            // 다른 모든 곳에서 제거하고 현재 카테고리에 추가 (반전 로직)
            setScheduleParticipants(prev => {
                const updated = { ...prev };
                Object.keys(updated).forEach(cat => {
                    updated[cat] = updated[cat].filter(n => n !== memberName);
                });
                // 고정 일정인 경우 여기서 바로 추가
                if (updated[currentCategory]) {
                    updated[currentCategory] = [...updated[currentCategory], memberName];
                }
                return updated;
            });

            setCustomSchedules(prev => prev.map(s => {
                const filteredParticipants = s.participants.filter(n => n !== memberName);
                // 임시 일정인 경우 여기서 바로 추가
                if (s.name === currentCategory) {
                    return { ...s, participants: [...filteredParticipants, memberName] };
                }
                return { ...s, participants: filteredParticipants };
            }));
        }
    };

    return {
        scheduleParticipants,
        customSchedules,
        addCustomSchedule,
        removeCustomSchedule,
        toggleMember
    };
}
