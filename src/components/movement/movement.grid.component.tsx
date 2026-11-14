import { useState, useEffect, Fragment } from 'react';
import { History, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { calculateRank } from '../../lib/rankUtils';
import type { MovementRecord } from '../../types/movement/movement.type';
import { extractPureMemberName, getPeriodMovementsForMember, applyDutySchedulesToDataList } from '../../utils/movement.utils';
import {
    compareTableOrder,
    getTableSectionInfo,
    getTableSectionLabel,
    toEnglishRank,
    type TableOrderKey
} from '../../utils/movement/movement.table-order';
import { MovementHistoryModal } from './movement.history-modal.component';
import { MovementEditPage } from './movement.edit-page.component';
import { PENDING_RECRUIT_KEY_PREFIX } from '../../utils/member/member.recruit';


export interface DbMember {
    id?: string;
    name: string;
    enlistmentDate?: string;
    earlyPromotion?: number;
    englishName?: string;
    rank?: string;
    role?: string;
    sections?: string[];
    phoneNumber?: string;
}

interface MovementGridProps {
    timeline: string[];
    /**
     * noSheetRow: 시트에 이 인원의 행이 없음 (카드만 보여 주고 수정은 막는다)
     * pendingRecruit: 이름이 정해지지 않아 시트에 아직 없는 신병 ('전입 예정' 묶음)
     * memberId: 인원 DB id (이름만으로 인원을 찾을 수 없을 때)
     * movementKey: 출타 기록(movements.name)을 찾는 이름. 시트에 행이 없는 신병은 '신병#<인원 id>'
     */
    dataList: { name: string; dayStatuses: Record<string, string>; noSheetRow?: boolean; pendingRecruit?: boolean; memberId?: string; movementKey?: string }[];
    dbMembers: DbMember[];
    baseDate?: Date;
    movements?: MovementRecord[];
    sheetWeeks?: any[];
    allowVacationPassLink?: boolean;
    /** 캘린더 당직 일정 (편집 화면의 당직 겹침 검사용) */
    dutySchedules?: any[];
    onMemberScheduleUpdate?: (cleanName: string, updatedStatuses: Record<string, string>, savedMovement?: any) => void;
}

export function MovementGrid({ timeline, dataList, dbMembers, baseDate, movements = [], sheetWeeks = [], allowVacationPassLink = false, dutySchedules = [], onMemberScheduleUpdate }: MovementGridProps) {
    const [activeCardIndex, setActiveCardIndex] = useState<number | null>(null);
    const [historyMember, setHistoryMember] = useState<{ name: string; fullName: string } | null>(null);
    const [editingMember, setEditingMember] = useState<{
        name: string;
        fullName: string;
        sectionLabel: string;
        sections: string[];
        role: string;
        /** 지금 보고 있는 주차 기준으로 몇 주 앞/뒤를 편집 중인지 */
        weekOffset: number;
        /** 시트에 행이 아직 없는 신병의 인원 id (시트 반영을 미뤄 둔다) */
        pendingMemberId?: string;
    } | null>(null);

    useEffect(() => {
        const handleOutsideClick = () => {
            setActiveCardIndex(null);
        };
        document.addEventListener('click', handleOutsideClick);
        return () => {
            document.removeEventListener('click', handleOutsideClick);
        };
    }, []);

    useEffect(() => {
        if (activeCardIndex === null) return;
        const timer = setTimeout(() => {
            setActiveCardIndex(null);
        }, 1000);
        return () => clearTimeout(timer);
    }, [activeCardIndex]);

    const currentYear = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

    // 패스지 'Table'과 같은 기준(섹션 → HQ 부 섹션 → 입대일 → 계급 → 영문 이름)으로 정렬하고 섹션별로 묶는다.
    // 카드 묶음은 HQ S-1 ~ S-6을 'HQ' 하나로 (묶음 안에서는 S-1 → S-6 순서 유지). 전입 예정 신병은 맨 뒤 '전입 예정'.
    const keyedEntries = dataList.map((member) => {
        const cleanName = extractPureMemberName(member.name);
        const dbMember = member.memberId
            ? dbMembers.find(m => m.id === member.memberId)
            : dbMembers.find(m => m.name === cleanName);
        const rankStr = dbMember?.enlistmentDate
            ? calculateRank(new Date(dbMember.enlistmentDate), dbMember.earlyPromotion || 0, baseDate || new Date())
            : (dbMember?.rank || '');
        const sectionInfo = getTableSectionInfo(dbMember?.sections);
        const orderKey: TableOrderKey = {
            ...sectionInfo,
            // 카드에서는 HQ를 부 섹션(S-1~S-6) 구분 없이 입대일 → 계급 → 이름순 (패스지 Table은 부 섹션별 그대로)
            subSec: sectionInfo.mainSec === 'HQ' ? '' : sectionInfo.subSec,
            enlistmentDate: dbMember?.enlistmentDate,
            rankEnglish: toEnglishRank(rankStr, member.name),
            englishName: dbMember?.englishName || cleanName
        };
        // 전입 예정 신병도 자기 섹션에 배정한다 (섹션이 없으면 섹션 미지정)
        const sectionLabel = sectionInfo.mainSec === 'HQ' ? 'HQ' : getTableSectionLabel(sectionInfo);
        return { member, orderKey, sectionLabel, detailLabel: getTableSectionLabel(sectionInfo) };
    }).sort((a, b) => compareTableOrder(a.orderKey, b.orderKey));

    // 목록에 없는 섹션끼리 섞여 정렬되더라도 같은 섹션은 한 묶음으로 모은다 (처음 나온 순서 유지, '전입 예정'은 맨 뒤).
    const groupRank = new Map<string, number>();
    keyedEntries.forEach(entry => {
        if (!groupRank.has(entry.sectionLabel)) groupRank.set(entry.sectionLabel, groupRank.size);
    });
    const groupedEntries = keyedEntries
        .map((entry, order) => ({ entry, order }))
        .sort((a, b) => (groupRank.get(a.entry.sectionLabel)! - groupRank.get(b.entry.sectionLabel)!) || a.order - b.order)
        .map(({ entry }) => entry);
    const groupSizes = new Map<string, number>();
    groupedEntries.forEach(entry => groupSizes.set(entry.sectionLabel, (groupSizes.get(entry.sectionLabel) || 0) + 1));

    const sortedEntries = groupedEntries.map(entry => entry.member);

    return (
        <div className="grid gap-2">
            {sortedEntries.map((member, idx) => {
                // 출타 기록을 찾는 이름 (시트에 행이 없는 신병은 '신병#<인원 id>')
                const cleanName = member.movementKey || extractPureMemberName(member.name);
                const { sectionLabel, detailLabel } = groupedEntries[idx];
                const isGroupStart = idx === 0 || groupedEntries[idx - 1].sectionLabel !== sectionLabel;

                if (!timeline || timeline.length === 0) return null;

                const coreTimeline = timeline.slice(0, 7);
                const coreIsoDates = coreTimeline.map(dateStr => {
                    const [m, d] = dateStr.split('.').map(Number);
                    return `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                });
                const weekStartIso = coreIsoDates[0] || '';
                const weekEndIso = coreIsoDates[coreIsoDates.length - 1] || '';

                const timelineIsoDates = timeline.map(dateStr => {
                    const [m, d] = dateStr.split('.').map(Number);
                    return `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                });
                const timelineEndIso = timelineIsoDates[timelineIsoDates.length - 1] || '';

                // 휴외연계 후보인지 확인: 이 휴가의 마지막 날과 맞닿는 외박(departDate === vacEndDate)이 존재하는지
                const checkIsVacPassCandidate = (vacEndDate: string) => {
                    const hasPassInMovements = movements.some(m => {
                        if (m.name !== cleanName || m.type !== 'pass') return false;
                        const pStart = new Date(m.startDate);
                        pStart.setDate(pStart.getDate() - 1);
                        const pDepartIso = `${pStart.getFullYear()}-${String(pStart.getMonth() + 1).padStart(2, '0')}-${String(pStart.getDate()).padStart(2, '0')}`;
                        return vacEndDate === pDepartIso || vacEndDate === m.startDate;
                    });
                    if (hasPassInMovements) return true;

                    if (!vacEndDate) return false;
                    const [, m, d] = vacEndDate.split('-').map(Number);
                    const dStr = `${m}.${d}`;
                    if (member.dayStatuses[dStr] === 'vacation-pass-depart') return true;
                    if (sheetWeeks) {
                        for (const w of sheetWeeks) {
                            if (w.data && Array.isArray(w.data)) {
                                const row = w.data.find((r: any) => r.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim() === cleanName);
                                if (row?.dayStatuses?.[dStr] === 'vacation-pass-depart') return true;
                            }
                        }
                    }
                    return false;
                };

                const shouldIncludeVacationInWeek = (vStart: string, vEnd: string): boolean => {
                    if (!vStart || !vEnd) return false;
                    const isCandidate = checkIsVacPassCandidate(vEnd);

                    if (isCandidate) {
                        if (allowVacationPassLink) {
                            // 1. 휴외연계가 허용되면: 지금처럼 휴가를 뒤에 오는 주(외박이 있는 주)에 포함
                            return !!(weekStartIso && weekEndIso && vStart >= weekStartIso && vStart <= weekEndIso);
                        } else {
                            // 2. 휴외연계가 허용되지 않으면: 휴가는 앞에 오는 주(휴가 기간이 타임라인 끝에 포함된 주)에 포함
                            const isTailOfCurrentWeek = !!(weekEndIso && timelineEndIso && vStart > weekEndIso && vStart <= timelineEndIso);
                            return isTailOfCurrentWeek;
                        }
                    }

                    // 일반 휴가: 현재 주차 core timeline 내에서 시작하는 경우 포함
                    return !!(weekStartIso && weekEndIso && vStart >= weekStartIso && vStart <= weekEndIso);
                };

                // Collect all movements for this member that belong to the current period:
                // 1. 수요일부터 다음주 화요일 사이에 있는 외박과 그와 연계되는 휴가
                // 2. 외휴연계 혹은 휴외연계되지 않는 기간 내 휴가
                const { allPeriodMovements } = getPeriodMovementsForMember(
                    cleanName,
                    timeline,
                    currentYear,
                    movements,
                    member.dayStatuses
                );
                const memberMovements = [...allPeriodMovements];

                let contiguousStart = '';
                let contiguousEnd = '';

                const checkStatusOnDate = (date: Date): boolean => {
                    const m = date.getMonth() + 1;
                    const d = date.getDate();
                    const dateStr = `${m}.${d}`;
                    if (!sheetWeeks || sheetWeeks.length === 0) {
                        const st = member.dayStatuses[dateStr];
                        return st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart';
                    }
                    for (const week of sheetWeeks) {
                        if (week.data && Array.isArray(week.data)) {
                            const memberRow = week.data.find((row: any) => {
                                const clean = row.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim();
                                return clean === cleanName;
                            });
                            if (memberRow && memberRow.dayStatuses) {
                                const st = memberRow.dayStatuses[dateStr];
                                if (st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart') return true;
                            }
                        }
                    }
                    return false;
                };

                // 타임라인 내에 vacation이나 linked 또는 vacation-pass-depart가 있는지 확인
                const hasVacationOnTimeline = timeline.some(dStr => {
                    const st = member.dayStatuses[dStr];
                    return st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart';
                });

                // 만약 타임라인에 휴가/외휴연계/복귀외박출발 잔디가 있는데, memberMovements에 vacation이 없거나 범위가 좁다면 보강
                if (hasVacationOnTimeline) {
                    const existingVac = memberMovements.find(m => m.type === 'vacation');

                    const matchedTimelineDates = timeline.filter(dStr => {
                        const st = member.dayStatuses[dStr];
                        return st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart';
                    });

                    if (matchedTimelineDates.length > 0) {
                        const [firstM, firstD] = matchedTimelineDates[0].split('.').map(Number);
                        const [lastM, lastD] = matchedTimelineDates[matchedTimelineDates.length - 1].split('.').map(Number);
                        let sObj = new Date(currentYear, firstM - 1, firstD, 12, 0, 0, 0);
                        let eObj = new Date(currentYear, lastM - 1, lastD, 12, 0, 0, 0);

                        if (matchedTimelineDates[0] === timeline[0]) {
                            let prevD = new Date(sObj);
                            prevD.setDate(prevD.getDate() - 1);
                            while (checkStatusOnDate(prevD)) {
                                sObj = new Date(prevD);
                                prevD.setDate(prevD.getDate() - 1);
                            }
                        }

                        if (matchedTimelineDates[matchedTimelineDates.length - 1] === timeline[timeline.length - 1]) {
                            let nextD = new Date(eObj);
                            nextD.setDate(nextD.getDate() + 1);
                            while (checkStatusOnDate(nextD)) {
                                eObj = new Date(nextD);
                                nextD.setDate(nextD.getDate() + 1);
                            }
                        }

                        contiguousStart = `${sObj.getFullYear()}-${String(sObj.getMonth() + 1).padStart(2, '0')}-${String(sObj.getDate()).padStart(2, '0')}`;
                        contiguousEnd = `${eObj.getFullYear()}-${String(eObj.getMonth() + 1).padStart(2, '0')}-${String(eObj.getDate()).padStart(2, '0')}`;
                    }

                    if (contiguousStart && contiguousEnd) {
                        const shouldInclude = shouldIncludeVacationInWeek(contiguousStart, contiguousEnd);
                        if (!shouldInclude) {
                            const vacIdx = memberMovements.findIndex(m => m.type === 'vacation');
                            if (vacIdx !== -1) {
                                memberMovements.splice(vacIdx, 1);
                            }
                        } else {
                            if (existingVac) {
                                if (contiguousStart < existingVac.startDate) {
                                    existingVac.startDate = contiguousStart;
                                }
                                if (contiguousEnd > existingVac.endDate) {
                                    existingVac.endDate = contiguousEnd;
                                }
                                if (!existingVac.reason || existingVac.reason === '연가') {
                                    const sD = new Date(existingVac.startDate);
                                    const eD = new Date(existingVac.endDate);
                                    const days = Math.round((eD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                                    existingVac.reason = days > 0 ? `연가 ${days}일` : '연가';
                                }
                            } else {
                                const sD = new Date(contiguousStart);
                                const eD = new Date(contiguousEnd);
                                const days = Math.round((eD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                                memberMovements.push({
                                    id: `synth-vac-${cleanName}`,
                                    name: cleanName,
                                    type: 'vacation',
                                    startDate: contiguousStart,
                                    endDate: contiguousEnd,
                                    reason: days > 0 ? `연가 ${days}일` : '연가'
                                });
                            }
                        }
                    }
                }

                // 내용이 있는 출타만 센다. 사유 없는 잔류('잔류' 또는 빈 사유)는 비어 있는 것과 같으므로 카드를 눌러 입력할 수 있게 둔다.
                const hasReason = memberMovements.some(m => m.type !== 'stay' || (!!m.reason && m.reason.trim() !== '잔류'));

                // 출타 및 잔디 수정 화면 열기 (연필 버튼, 그리고 출타 내용이 없는 카드 자체)
                const openEditor = () => {
                    if (member.noSheetRow) return;
                    const rankMatch = member.name.match(/^(병장|상병|일병|이병)\s*(.*)$/);
                    const formattedName = rankMatch ? `${rankMatch[2]} ${rankMatch[1]}` : member.name;
                    const dbMember = member.memberId
                        ? dbMembers.find(m => m.id === member.memberId)
                        : dbMembers.find(m => m.name === cleanName);
                    setEditingMember({
                        name: cleanName,
                        fullName: formattedName,
                        sectionLabel: detailLabel === '섹션 미지정' ? '' : detailLabel,
                        sections: dbMember?.sections || [],
                        role: dbMember?.role || '',
                        weekOffset: 0,
                        pendingMemberId: member.memberId && cleanName.startsWith(PENDING_RECRUIT_KEY_PREFIX) ? member.memberId : undefined
                    });
                };
                // 출타 내용이 있으면 카드(잔디)를 눌러 내용을 보고, 없으면 카드 어디를 눌러도 바로 수정 화면
                const opensEditorOnCardTap = !hasReason && !member.noSheetRow;

                return (
                    <Fragment key={`${sectionLabel}-${member.name}-${idx}`}>
                    {isGroupStart && (
                        <div className={cn("flex items-center gap-2 px-1", idx > 0 && "pt-3")}>
                            <span className="text-[11px] sm:text-xs font-black text-gray-600 tracking-wide">{sectionLabel}</span>
                            <span className="text-[10px] sm:text-[11px] font-bold text-gray-400">{groupSizes.get(sectionLabel)}명</span>
                            <div className="flex-1 h-px bg-gray-200" />
                        </div>
                    )}
                    <div
                        className={cn(
                            "bg-white border border-gray-100 rounded-xl px-2 sm:px-3 py-0 shadow-sm transition-all flex items-center gap-1.5 min-[360px]:gap-2 sm:gap-4 relative h-[56px] min-w-0",
                            opensEditorOnCardTap && "cursor-pointer hover:border-gray-200 hover:bg-gray-50/60 active:bg-gray-100/70"
                        )}
                        onClick={opensEditorOnCardTap ? openEditor : undefined}
                        role={opensEditorOnCardTap ? 'button' : undefined}
                        tabIndex={opensEditorOnCardTap ? 0 : undefined}
                        aria-label={opensEditorOnCardTap ? `${member.name} 출타 및 잔디 수정` : undefined}
                        onKeyDown={opensEditorOnCardTap ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openEditor();
                            }
                        } : undefined}
                    >
                        {/*
                          화면이 좁으면 이름 칸이 먼저 줄어든다 (잔디와 버튼은 잘리지 않게 고정).
                          여백·크기를 줄여도 '병장 김원범'(약 60px)이 다 안 들어가면 단계적으로 줄인다:
                          319px 이하 → 히스토리 버튼 숨김, 289px 이하 → 계급 숨기고 이름만.
                        */}
                        {(() => {
                            const rankSplit = member.name.match(/^(병장|상병|일병|이병)\s*(.+)$/);
                            return (
                                <div className="w-20 sm:w-24 min-w-0 flex items-center">
                                    <span className="text-[11px] min-[360px]:text-xs sm:text-sm font-black text-gray-900 truncate block">
                                        {rankSplit ? (
                                            <>
                                                <span className="max-[289px]:hidden">{rankSplit[1]} </span>
                                                {rankSplit[2]}
                                            </>
                                        ) : member.name}
                                    </span>
                                </div>
                            );
                        })()}

                        <div className="flex-1 flex items-stretch overflow-visible pb-1 no-scrollbar pt-3 h-full">
                            <div 
                                className={cn(
                                    "inline-flex items-center gap-0.5 min-[360px]:gap-[3px] sm:gap-1 overflow-visible relative h-full group/timeline",
                                    hasReason && "cursor-pointer"
                                )}
                                onClick={(e) => {
                                    if (!hasReason) return;
                                    e.stopPropagation();
                                    setActiveCardIndex(prev => prev === idx ? null : idx);
                                }}
                            >
                                {/* Tooltip centered over the boxes */}
                                {hasReason && (
                                    <div className={cn(
                                        "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex-col items-center z-50 animate-in fade-in zoom-in-95 duration-100 pointer-events-none",
                                        activeCardIndex === idx ? "flex" : "hidden"
                                    )}>
                                        <div className="bg-gray-950 text-white text-[11px] font-medium rounded-lg py-1.5 px-2.5 whitespace-nowrap shadow-xl leading-tight text-center border border-gray-800 space-y-1">
                                            {(() => {
                                                const sorted = [...memberMovements]
                                                    .sort((a, b) => {
                                                        if (a.type === b.type) return a.startDate.localeCompare(b.startDate);
                                                        const order: Record<string, number> = { pass: 1, stay: 2, vacation: 3 };
                                                        return (order[a.type] || 9) - (order[b.type] || 9);
                                                    })
                                                    .filter(m => m.type === 'vacation' || m.reason)
                                                    .filter((mov, mIdx, arr) => {
                                                        if (mov.type === 'pass') {
                                                            const firstIdx = arr.findIndex(o => o.type === 'pass' && o.startDate === mov.startDate && o.endDate === mov.endDate);
                                                            return firstIdx === mIdx;
                                                        }
                                                        return true;
                                                    });

                                                // Group movements with identical type and reason
                                                const grouped: {
                                                    type: string;
                                                    reason: string;
                                                    dateLabels: string[];
                                                    items: MovementRecord[];
                                                }[] = [];

                                                sorted.forEach(mov => {
                                                    const dateLabel = mov.startDate === mov.endDate
                                                        ? mov.startDate.slice(5).replace('-', '.')
                                                        : `${mov.startDate.slice(5).replace('-', '.')} ~ ${mov.endDate.slice(5).replace('-', '.')}`;

                                                    const movReason = mov.reason || (mov.type === 'vacation' ? '연가' : mov.type === 'stay' ? '잔류' : '외박');
                                                    const existing = grouped.find(g => g.type === mov.type && g.reason.trim() === movReason.trim());
                                                    if (existing) {
                                                        if (!existing.dateLabels.includes(dateLabel)) {
                                                            existing.dateLabels.push(dateLabel);
                                                        }
                                                        existing.items.push(mov);
                                                    } else {
                                                        grouped.push({
                                                            type: mov.type,
                                                            reason: movReason,
                                                            dateLabels: [dateLabel],
                                                            items: [mov]
                                                        });
                                                    }
                                                });

                                                return grouped.map((group, gIdx) => {
                                                    const headerType = group.type === 'pass' ? '외박' : group.type === 'stay' ? '잔류' : '휴가';
                                                    const dateStr = group.dateLabels.join(', ');

                                                    let displayReason = group.reason || (group.type === 'vacation' ? '연가' : group.type === 'stay' ? '잔류' : '외박');
                                                    if (group.type === 'vacation') {
                                                        let totalDays = 0;
                                                        let isLinked = false;
                                                        let isVacPassLinked = false;
                                                        group.items.forEach(mov => {
                                                            const startD = new Date(mov.startDate);
                                                            const endD = new Date(mov.endDate);
                                                            totalDays = Math.max(totalDays, Math.round((endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)) + 1);
                                                            const tempDate = new Date(startD);
                                                            while (tempDate <= endD) {
                                                                const dStr = `${tempDate.getMonth() + 1}.${tempDate.getDate()}`;
                                                                if (member.dayStatuses[dStr] === 'linked') {
                                                                    isLinked = true;
                                                                }
                                                                if (member.dayStatuses[dStr] === 'vacation-pass-depart') {
                                                                    isVacPassLinked = true;
                                                                }
                                                                tempDate.setDate(tempDate.getDate() + 1);
                                                            }
                                                        });

                                                        if (!isVacPassLinked && !isLinked) {
                                                            group.items.forEach(vacMov => {
                                                                const passMov = memberMovements.find(m => m.type === 'pass');
                                                                if (passMov) {
                                                                    const pStart = new Date(passMov.startDate);
                                                                    pStart.setDate(pStart.getDate() - 1);
                                                                    const pDepartIso = `${pStart.getFullYear()}-${String(pStart.getMonth() + 1).padStart(2, '0')}-${String(pStart.getDate()).padStart(2, '0')}`;
                                                                    if (vacMov.endDate === pDepartIso || vacMov.endDate === passMov.startDate) {
                                                                        isVacPassLinked = true;
                                                                    }
                                                                }
                                                            });
                                                        }

                                                        let cleanReason = group.reason
                                                            .replace(/외휴연계\s*[OX]?/gi, '')
                                                            .replace(/휴외연계\s*[OX]?/gi, '')
                                                            .trim();
                                                        cleanReason = cleanReason.replace(/사용/gi, '').trim();
                                                        cleanReason = cleanReason.replace(/,/gi, '').trim();
                                                        if (!/\d+일/.test(cleanReason)) {
                                                            cleanReason = cleanReason ? `${cleanReason} ${totalDays}일` : `연가 ${totalDays}일`;
                                                        }

                                                        let linkStr = '';
                                                        if (isLinked) {
                                                            linkStr = '외휴연계 O';
                                                        } else if (isVacPassLinked) {
                                                            linkStr = allowVacationPassLink ? '휴외연계 O' : '';
                                                        } else {
                                                            linkStr = '외휴연계 X';
                                                        }

                                                        displayReason = linkStr ? `${cleanReason}, ${linkStr}` : cleanReason;
                                                    }

                                                    return (
                                                        <div key={gIdx} className={gIdx > 0 ? "border-t border-gray-800 pt-1 mt-1" : ""}>
                                                            <div className="text-[9px] text-gray-400 font-bold mb-0.5">
                                                                {headerType} ({dateStr})
                                                            </div>
                                                            <div className="text-gray-100 font-semibold">
                                                                {displayReason}
                                                            </div>
                                                        </div>
                                                    );
                                                });
                                            })()}
                                        </div>
                                        <div className="w-1.5 h-1.5 bg-gray-950 rotate-45 -mt-[3.5px] border-r border-b border-gray-800" />
                                    </div>
                                )}
                                {timeline.map((dateStr, tIdx) => {
                                let status = member.dayStatuses[dateStr] || 'none';
                                const [m, d] = dateStr.split('.').map(Number);
                                const isWeekend = new Date(currentYear, m - 1, d, 12, 0, 0, 0).getDay() % 6 === 0;

                                // Dynamically detect if we are departing for/on a pass on the recovery day (day after duty)
                                if (status === 'pass-depart' || status === 'pass') {
                                    let isYesterdayDuty = false;
                                    if (tIdx > 0) {
                                        const yesterdayStr = timeline[tIdx - 1];
                                        isYesterdayDuty = (member.dayStatuses[yesterdayStr] || 'none') === 'duty';
                                    } else {
                                        const yesterdayDate = new Date(currentYear, m - 1, d - 1, 12, 0, 0, 0);
                                        const yesterdayStr = `${yesterdayDate.getMonth() + 1}.${yesterdayDate.getDate()}`;
                                        if (member.dayStatuses[yesterdayStr] === 'duty') {
                                            isYesterdayDuty = true;
                                        } else if (sheetWeeks) {
                                            for (const w of sheetWeeks) {
                                                if (w.data && Array.isArray(w.data)) {
                                                    const r = w.data.find((row: any) => row.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim() === cleanName);
                                                    if (r?.dayStatuses?.[yesterdayStr] === 'duty') {
                                                        isYesterdayDuty = true;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if (isYesterdayDuty) {
                                        status = 'recovery-pass-depart';
                                    }
                                }

                                // Dynamically detect if departing for pass on vacation return date
                                // 휴외연계 허용 여부와 무관하게 점호 보고 포함 여부는 동일하므로, 휴가 복귀일과 외박 출발일이 겹치면 무조건 반반 잔디(vacation-pass-depart)로 표시
                                if (status !== 'linked' && status !== 'duty' && status !== 'recovery') {
                                    const curDateIso = `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

                                    // 1) 오늘이 휴가 복귀일인지 확인 (시트 상의 contiguousEnd, movements DB의 endDate, 또는 오늘이 휴가이고 내일이 휴가가 아님)
                                    const isVacationReturn = (contiguousEnd && curDateIso === contiguousEnd) || movements.some(mov =>
                                        mov.name === cleanName && mov.type === 'vacation' && mov.endDate === curDateIso
                                    ) || (
                                        (status === 'vacation' || status === 'vacation-pass-depart') && (() => {
                                            const nextD = new Date(currentYear, m - 1, d + 1, 12, 0, 0, 0);
                                            return !checkStatusOnDate(nextD);
                                        })()
                                    );

                                    // 2) 오늘이 외박 출발일인지 확인 (movements DB의 외박 출발일/시작일, 또는 내일 외박 잔디 여부)
                                    const isPassDepart = movements.some(mov => {
                                        if (mov.name !== cleanName || mov.type !== 'pass') return false;
                                        const pStartObj = new Date(mov.startDate);
                                        pStartObj.setDate(pStartObj.getDate() - 1);
                                        const pDepartIso = `${pStartObj.getFullYear()}-${String(pStartObj.getMonth() + 1).padStart(2, '0')}-${String(pStartObj.getDate()).padStart(2, '0')}`;
                                        return curDateIso === pDepartIso || curDateIso === mov.startDate;
                                    }) || (() => {
                                        const tomorrowStr = tIdx + 1 < timeline.length ? timeline[tIdx + 1] : null;
                                        // 내일이 외박이면 오늘 출발. 내일이 '외박출발'이면 출발은 내일이므로 오늘은 아니다.
                                        if (tomorrowStr && member.dayStatuses[tomorrowStr] === 'pass') return true;
                                        if (sheetWeeks) {
                                            const nextD = new Date(currentYear, m - 1, d + 1, 12, 0, 0, 0);
                                            const nextDStr = `${nextD.getMonth() + 1}.${nextD.getDate()}`;
                                            for (const w of sheetWeeks) {
                                                if (w.data && Array.isArray(w.data)) {
                                                    const r = w.data.find((row: any) => row.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim() === cleanName);
                                                    if (r?.dayStatuses?.[nextDStr] === 'pass') return true;
                                                }
                                            }
                                        }
                                        return false;
                                    })() || status === 'vacation-pass-depart';

                                    if (isVacationReturn && isPassDepart) {
                                        status = 'vacation-pass-depart';
                                    }
                                }

                                return (
                                    <div key={tIdx} className="flex flex-col items-center gap-1 relative">
                                        <div
                                            className={cn(
                                                "w-3 h-3 min-[360px]:w-3.5 min-[360px]:h-3.5 sm:w-4 sm:h-4 rounded-sm transition-all duration-300",
                                                status === 'none' && "bg-gray-100",
                                                status === 'pass' && "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.3)]",
                                                status === 'pass-depart' && "",
                                                status === 'vacation' && "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.3)]",
                                                status === 'duty' && "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]",
                                                status === 'recovery' && "bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.4)]",
                                                status === 'linked' && "shadow-[0_0_8px_rgba(59,130,246,0.4)]",
                                                status === 'recovery-pass-depart' && "shadow-[0_0_6px_rgba(250,204,21,0.4)]",
                                                status === 'vacation-pass-depart' && "shadow-[0_0_8px_rgba(249,115,22,0.4)]",
                                                isWeekend && "border-2 border-black"
                                            )}
                                            style={
                                                status === 'linked' ? {
                                                    background: 'linear-gradient(135deg, #3b82f6 50%, #f97316 50%)'
                                                } : status === 'vacation-pass-depart' ? {
                                                    background: 'linear-gradient(135deg, #f97316 50%, #3b82f6 50%)'
                                                } : status === 'pass-depart' ? {
                                                    background: 'linear-gradient(135deg, #f3f4f6 50%, #3b82f6 50%)'
                                                } : status === 'recovery-pass-depart' ? {
                                                    background: 'linear-gradient(135deg, #facc15 50%, #3b82f6 50%)'
                                                } : undefined
                                            }
                                        />
                                        {(() => {
                                            const isFirst = tIdx === 0;
                                            const isLast = tIdx === timeline.length - 1;
                                            const isSunday = new Date(currentYear, m - 1, d, 12, 0, 0, 0).getDay() === 0;
                                            const isMonthStart = d === 1;
                                            const today = baseDate || new Date();
                                            const isToday = today.getMonth() === m - 1 && today.getDate() === d;

                                            // Find index of Today in the timeline
                                            const todayIdx = timeline.findIndex(tStr => {
                                                const [tm, td] = tStr.split('.').map(Number);
                                                return today.getMonth() === tm - 1 && today.getDate() === td;
                                            });

                                            // Hide non-today labels if they are adjacent (within 1 day) to Today to prevent overlapping text (e.g. 6.21 and 6.22)
                                            if (!isToday && todayIdx !== -1 && Math.abs(tIdx - todayIdx) <= 1) {
                                                return null;
                                            }

                                            if (isFirst || isLast || isSunday || isMonthStart || isToday) {
                                                return (
                                                    <span className={cn(
                                                        "text-[8px] font-black absolute -top-4 whitespace-nowrap",
                                                        isToday ? "text-red-500 font-extrabold" : "text-gray-300"
                                                    )}>
                                                        {dateStr}
                                                    </span>
                                                );
                                            }
                                            return null;
                                        })()}
                                    </div>
                                );
                            })}
                            </div>
                        </div>

                        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const rankMatch = member.name.match(/^(병장|상병|일병|이병)\s*(.*)$/);
                                    const formattedName = rankMatch ? `${rankMatch[2]} ${rankMatch[1]}` : member.name;
                                    setHistoryMember({ name: cleanName, fullName: formattedName });
                                }}
                                className="flex max-[319px]:hidden items-center justify-center p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
                                title="출타 히스토리"
                            >
                                <History className="w-4 h-4" />
                            </button>
                            <button
                                disabled={!!member.noSheetRow}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openEditor();
                                }}
                                className="flex items-center justify-center p-1.5 rounded-lg bg-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                                title={member.noSheetRow ? '스프레드시트에 이 인원의 행이 없어 수정할 수 없습니다' : '출타 및 잔디 수정'}
                            >
                                <Pencil className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                    </Fragment>
                );
            })}
            {historyMember && (
                <MovementHistoryModal
                    memberName={historyMember.name}
                    fullNameWithRank={historyMember.fullName}
                    movements={movements}
                    onClose={() => setHistoryMember(null)}
                    baseDate={baseDate}
                    sheetWeeks={sheetWeeks}
                    timeline={timeline}
                />
            )}
            {editingMember && (() => {
                // 편집 중인 주차: 지금 보고 있는 주차에서 weekOffset만큼 앞/뒤
                const baseWeekIdx = sheetWeeks.findIndex((w: any) => (w.timeline || [])[0] === timeline[0]);
                const targetIdx = baseWeekIdx === -1 ? -1 : baseWeekIdx + editingMember.weekOffset;
                const targetWeek = editingMember.weekOffset !== 0 && targetIdx >= 0 ? sheetWeeks[targetIdx] : null;
                const editTimeline: string[] = targetWeek ? targetWeek.timeline : timeline;
                // 카드와 같은 방식으로 캘린더 당직/회복을 합친 그 주차의 잔디
                const weekRows = targetWeek
                    ? applyDutySchedulesToDataList(targetWeek.data || [], editTimeline, dutySchedules, dbMembers, baseDate, sheetWeeks)
                    : dataList;
                const rowKey = (r: any) => r.movementKey || extractPureMemberName(r.name);
                const memberRow = weekRows.find(r => rowKey(r) === editingMember.name);
                const canMove = (delta: number) => baseWeekIdx !== -1 && !!sheetWeeks[targetIdx + delta];
                const move = (delta: number) => () =>
                    setEditingMember(m => (m ? { ...m, weekOffset: m.weekOffset + delta } : m));

                return (
                <MovementEditPage
                    key={`${editingMember.name}-${editTimeline[0]}`}
                    memberName={editingMember.name}
                    fullNameWithRank={editingMember.fullName}
                    sectionLabel={editingMember.sectionLabel}
                    memberSections={editingMember.sections}
                    memberRole={editingMember.role}
                    pendingRecruitId={editingMember.pendingMemberId}
                    onPrevWeek={canMove(-1) ? move(-1) : undefined}
                    onNextWeek={canMove(1) ? move(1) : undefined}
                    dutySchedules={dutySchedules}
                    timeline={editTimeline}
                    initialDayStatuses={{ ...(memberRow?.dayStatuses || {}) }}
                    movements={movements}
                    baseDate={baseDate}
                    sheetWeeks={sheetWeeks}
                    onClose={() => setEditingMember(null)}
                    onSaveSuccess={(updatedStatuses, savedMovement) => {
                        if (!targetWeek) {
                            const target = dataList.find(d => rowKey(d) === editingMember.name);
                            if (target) {
                                target.dayStatuses = { ...target.dayStatuses, ...updatedStatuses };
                            }
                        }
                        onMemberScheduleUpdate?.(editingMember.name, updatedStatuses, savedMovement);
                    }}
                />
                );
            })()}
        </div>
    );
}
