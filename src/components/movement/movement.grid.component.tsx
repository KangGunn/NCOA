import { useState, useEffect } from 'react';
import { History, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { MovementRecord } from '../../types/movement/movement.type';
import { extractPureMemberName } from '../../utils/movement.utils';
import { MovementHistoryModal } from './movement.history-modal.component';
import { MovementEditModal } from './movement.edit-modal.component';

export interface DbMember {
    name: string;
    enlistmentDate?: string;
    englishName?: string;
    rank?: string;
    sections?: string[];
    phoneNumber?: string;
}

interface MovementGridProps {
    timeline: string[];
    dataList: { name: string; dayStatuses: Record<string, string> }[];
    dbMembers: DbMember[];
    baseDate?: Date;
    movements?: MovementRecord[];
    sheetWeeks?: any[];
    allowVacationPassLink?: boolean;
}

export function MovementGrid({ timeline, dataList, dbMembers, baseDate, movements = [], sheetWeeks = [], allowVacationPassLink = false }: MovementGridProps) {
    const [activeCardIndex, setActiveCardIndex] = useState<number | null>(null);
    const [historyMember, setHistoryMember] = useState<{ name: string; fullName: string } | null>(null);
    const [editingMember, setEditingMember] = useState<{
        name: string;
        fullName: string;
        dayStatuses: Record<string, string>;
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

    const sortedEntries = [...dataList].sort((a, b) => {
        const cleanA = extractPureMemberName(a.name);
        const cleanB = extractPureMemberName(b.name);

        const memA = dbMembers.find(m => m.name === cleanA);
        const memB = dbMembers.find(m => m.name === cleanB);

        if (memA?.enlistmentDate && memB?.enlistmentDate) {
            if (memA.enlistmentDate !== memB.enlistmentDate) {
                return memA.enlistmentDate < memB.enlistmentDate ? -1 : 1;
            }
        } else if (memA?.enlistmentDate) {
            return -1;
        } else if (memB?.enlistmentDate) {
            return 1;
        }

        const rankPriority: Record<string, number> = { '병장': 1, '상병': 2, '일병': 3, '이병': 4 };
        const rA = Object.keys(rankPriority).find(r => a.name.includes(r)) || '';
        const rB = Object.keys(rankPriority).find(r => b.name.includes(r)) || '';
        const pA = rankPriority[rA] || 99;
        const pB = rankPriority[rB] || 99;

        if (pA !== pB) return pA - pB;
        return a.name.localeCompare(b.name);
    });

    return (
        <div className="grid gap-2">
            {sortedEntries.map((member, idx) => {
                const cleanName = extractPureMemberName(member.name);
                
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

                // Collect all movements for this member that overlap with the current timeline view
                // For passes (외박) / stay (잔류), they must contain at least one weekend day within the visible timeline
                // For vacation (휴가), it must belong to the current week based on vacation-pass-link rules
                const memberMovements = movements.filter(mov => {
                    if (mov.name !== cleanName) return false;
                    
                    return timeline.some(dateStr => {
                        const [m, d] = dateStr.split('.').map(Number);
                        const isoDate = `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        const isOverlapping = isoDate >= mov.startDate && isoDate <= mov.endDate;
                        if (!isOverlapping) return false;
                        
                        if (mov.type === 'pass' || mov.type === 'stay') {
                            return coreTimeline.includes(dateStr);
                        }

                        if (mov.type === 'vacation') {
                            return shouldIncludeVacationInWeek(mov.startDate, mov.endDate);
                        }
                        
                        return true;
                    });
                });

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
                                if (!existingVac.reason) {
                                    existingVac.reason = '연가';
                                }
                            } else {
                                memberMovements.push({
                                    id: `synth-vac-${cleanName}`,
                                    name: cleanName,
                                    type: 'vacation',
                                    startDate: contiguousStart,
                                    endDate: contiguousEnd,
                                    reason: '연가'
                                });
                            }
                        }
                    }
                }

                const hasReason = memberMovements.length > 0;

                return (
                    <div 
                        key={idx} 
                        className="bg-white border border-gray-100 rounded-xl px-2 sm:px-3 py-0 shadow-sm transition-all flex items-center gap-2 sm:gap-4 relative h-[56px]"
                    >
                        <div className="w-20 sm:w-24 shrink-0 flex items-center">
                            <span className="text-xs sm:text-sm font-black text-gray-900 truncate block">{member.name}</span>
                        </div>

                        <div className="flex-1 flex items-stretch overflow-visible pb-1 no-scrollbar pt-3 h-full">
                            <div 
                                className={cn(
                                    "inline-flex items-center gap-1 overflow-visible relative h-full group/timeline",
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
                                                    .filter(m => m.type === 'vacation' || m.reason);

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
                                                        const dayPattern = /(\d+(\.\d+)?\s*(데이|일)|(원|투|쓰리|포|파이브|식스|세븐|에잇|나인|텐)\s*데이)/ig;
                                                        cleanReason = cleanReason.replace(dayPattern, '').trim();
                                                        cleanReason = cleanReason.replace(/사용/gi, '').trim();
                                                        cleanReason = cleanReason.replace(/,/gi, '').trim();
                                                        if (!cleanReason) cleanReason = '연가';

                                                        let linkStr = '외휴연계 X';
                                                        if (isLinked) {
                                                            linkStr = '외휴연계 O';
                                                        } else if (isVacPassLinked) {
                                                            linkStr = allowVacationPassLink ? '휴외연계 O' : '휴외연계 X';
                                                        }

                                                        displayReason = `${cleanReason} ${totalDays}일, ${linkStr}`;
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
                                    const yesterdayStr = tIdx > 0 ? timeline[tIdx - 1] : null;
                                    const yesterdayStatus = yesterdayStr ? (member.dayStatuses[yesterdayStr] || 'none') : 'none';
                                    if (yesterdayStatus === 'duty') {
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
                                        if (tomorrowStr && (member.dayStatuses[tomorrowStr] === 'pass' || member.dayStatuses[tomorrowStr] === 'pass-depart')) return true;
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
                                                "w-4 h-4 rounded-sm transition-all duration-300",
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

                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const rankMatch = member.name.match(/^(병장|상병|일병|이병)\s*(.*)$/);
                                    const formattedName = rankMatch ? `${rankMatch[2]} ${rankMatch[1]}` : member.name;
                                    setHistoryMember({ name: cleanName, fullName: formattedName });
                                }}
                                className="flex items-center justify-center p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
                                title="출타 히스토리"
                            >
                                <History className="w-4 h-4" />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const rankMatch = member.name.match(/^(병장|상병|일병|이병)\s*(.*)$/);
                                    const formattedName = rankMatch ? `${rankMatch[2]} ${rankMatch[1]}` : member.name;
                                    setEditingMember({
                                        name: cleanName,
                                        fullName: formattedName,
                                        dayStatuses: { ...member.dayStatuses }
                                    });
                                }}
                                className="flex items-center justify-center p-1.5 rounded-lg bg-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
                                title="출타 및 잔디 수정"
                            >
                                <Pencil className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
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
            {editingMember && (
                <MovementEditModal
                    memberName={editingMember.name}
                    fullNameWithRank={editingMember.fullName}
                    timeline={timeline}
                    initialDayStatuses={editingMember.dayStatuses}
                    movements={movements}
                    baseDate={baseDate}
                    sheetWeeks={sheetWeeks}
                    onClose={() => setEditingMember(null)}
                    onSaveSuccess={(updatedStatuses) => {
                        const target = dataList.find(d => {
                            const c = d.name.replace(/^(병장|상병|일병|이병)\s*/, '');
                            return c === editingMember.name;
                        });
                        if (target) {
                            target.dayStatuses = { ...target.dayStatuses, ...updatedStatuses };
                        }
                    }}
                />
            )}
        </div>
    );
}
