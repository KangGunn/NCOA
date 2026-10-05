/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Copy, AlertTriangle } from 'lucide-react';
import { MovementGrid } from './movement.grid.component';
import { MovementPreviewModal } from './movement.preview-modal.component';
import { extractDayCountFromText, applyDutySchedulesToDataList, extractPureMemberName } from '../../utils/movement.utils';
import { calculateRank } from '../../lib/rankUtils';

interface MovementSheetViewProps {
    sheetWeeks: any[];
    currentWeekIndex: number;
    setCurrentWeekIndex: React.Dispatch<React.SetStateAction<number>>;
    dbMembers: any[];
    baseDate?: Date;
    movements: any[];
    dutySchedules?: any[];
}

export function MovementSheetView({
    sheetWeeks,
    currentWeekIndex,
    setCurrentWeekIndex,
    dbMembers,
    baseDate,
    movements,
    dutySchedules = []
}: MovementSheetViewProps) {
    const [previewData, setPreviewData] = useState<{ html: string; text: string; enclosure: string; enclosureHtml: string; remarks: string; remarksHtml: string } | null>(null);

    if (sheetWeeks.length === 0) return null;

    const currentWeek = sheetWeeks[currentWeekIndex];
    const timeline = currentWeek ? (currentWeek.timeline || []) : [];

    // 저장된 당직자 목록(dutySchedules)을 실시간으로 읽어와 현재 주차 타임라인에 디스플레이 (시트에는 쓰지 않음)
    const displayDataList = useMemo(() => {
        return applyDutySchedulesToDataList(
            currentWeek?.data || [],
            timeline,
            dutySchedules,
            dbMembers,
            baseDate
        );
    }, [currentWeek?.data, timeline, dutySchedules, dbMembers, baseDate]);

    // Helper to check if a reason is eligible (has @@ reward type and is not excluded)
    const isEligibleReason = (reasonStr: string | undefined | null): boolean => {
        if (!reasonStr) return false;
        const trimmed = reasonStr.trim();
        const trimmedLower = trimmed.toLowerCase();

        // Explicitly exclude "잔류" or empty
        if (trimmedLower === '' || trimmedLower === '잔류' || trimmedLower.includes('잔류')) {
            return false;
        }

        let target = trimmed;
        let index = trimmed.lastIndexOf('으로 인한');
        let phraseLen = 5;
        if (index === -1) {
            index = trimmed.lastIndexOf('로 인한');
            phraseLen = 4;
        }
        if (index !== -1) {
            target = trimmed.substring(index + phraseLen).trim();
        }

        // Regex for N데이 / N일 at the end of the target string
        const dayPattern = /(\d+(\.\d+)?\s*(데이|일)|(원|투|쓰리|포|파이브|식스|세븐|에잇|나인|텐)\s*데이)$/i;

        const match = target.match(dayPattern);
        if (!match) {
            return false;
        }

        const remaining = target.substring(0, target.length - match[0].length).trim().toLowerCase();

        // If remaining is empty, or is just '일반' or '일반투데이', then @@ is missing or invalid
        if (remaining.length === 0 || remaining === '일반' || remaining === '일반투데이') {
            return false;
        }

        return true;
    };

    const formatReasonWithBatchPrefix = (reasonStr: string, dbMember?: any, isEnclosure: boolean = false): string => {
        if (!reasonStr) return reasonStr;

        const batchRegex = /(\d{1,2}-\d{1,2})\s*(?:기|Cycle|cycle|차)?/i;
        const match = reasonStr.match(batchRegex);
        if (!match) return reasonStr;

        const batchNum = match[1];
        const matchIndex = match.index || 0;
        const matchLength = match[0].length;

        const textBeforeBatch = reasonStr.substring(0, matchIndex).trim();
        const textAfterBatch = reasonStr.substring(matchIndex + matchLength).trim();

        const hasPrefix = /(KTA|BLC|PAO|S3|BLC\/S3)\s*$/i.test(textBeforeBatch);

        const sections: string[] = dbMember?.sections || [];
        let sectionPrefix = '';

        if (!hasPrefix) {
            if (sections.includes('S3') || sections.includes('S-3')) {
                sectionPrefix = 'BLC/S3';
            } else if (sections.includes('PAO')) {
                sectionPrefix = 'PAO';
            } else if (sections.includes('KTA')) {
                sectionPrefix = 'KTA';
            } else if (sections.includes('BLC')) {
                sectionPrefix = 'BLC';
            } else if (sections.length > 0) {
                const firstSec = sections[0].toUpperCase();
                if (firstSec === 'S3' || firstSec === 'S-3') {
                    sectionPrefix = 'BLC/S3';
                } else {
                    sectionPrefix = firstSec;
                }
            } else {
                sectionPrefix = 'BLC';
            }
        }

        const formattedSuffix = isEnclosure ? `${batchNum} Cycle` : `${batchNum}기`;
        const prefixStr = hasPrefix ? '' : `${sectionPrefix} `;
        const spaceAfter = textAfterBatch ? ' ' : '';

        return `${textBeforeBatch ? textBeforeBatch + ' ' : ''}${prefixStr}${formattedSuffix}${spaceAfter}${textAfterBatch}`;
    };

    const extractRewardType = (reasonStr: string, dbMember?: any, isEnclosure: boolean = false): string => {
        let target = reasonStr.trim();
        target = target.replace(/외휴연계\s*[OX]?/gi, '').trim();

        let index = target.lastIndexOf('으로 인한');
        let phraseLen = 5;
        if (index === -1) {
            index = target.lastIndexOf('로 인한');
            phraseLen = 4;
        }
        if (index !== -1) {
            target = target.substring(index + phraseLen).trim();
        }

        const dayPattern = /(\d+(\.\d+)?\s*(데이|일)|(원|투|쓰리|포|파이브|식스|세븐|에잇|나인|텐)\s*데이)/ig;
        target = target.replace(dayPattern, '').trim();
        target = target.replace(/사용/gi, '').trim();
        target = target.replace(/,/gi, '').trim();

        target = target || '포상';

        if (isEnclosure && target === '생일') {
            target = 'Birthday';
        }

        if (isEnclosure) {
            target = target.replace(/수료/g, '').trim();
        }

        target = target.replace(/PRT\s*DEMO/gi, 'PRT Demo');

        if (dbMember) {
            target = formatReasonWithBatchPrefix(target, dbMember, isEnclosure);
        }

        return target;
    };

    // Helper to collect contiguous date blocks overlapping with weekend within core timeline (Wed~Tue)
    // If bridgeStatuses is provided (e.g. ['duty', 'recovery']), dates with those statuses connect blocks continuously
    const getWeekendBlocks = (
        memberObj: any, 
        allowedStatuses: string[], 
        bridgeStatuses: string[] = [], 
        searchTimeline: string[] = timeline.slice(0, 7)
    ) => {
        const combinedAllowed = [...allowedStatuses, ...bridgeStatuses];
        const activeDates = searchTimeline.filter((dateStr: string) => {
            const status = memberObj.dayStatuses[dateStr] || 'none';
            return combinedAllowed.includes(status);
        });

        const yearVal = baseDate ? baseDate.getFullYear() : new Date().getFullYear();
        const blocks: Date[][] = [];
        let currentBlock: Date[] = [];
        activeDates.forEach((dateStr: string) => {
            const [m, d] = dateStr.split('.').map(Number);
            const dateObj = new Date(yearVal, m - 1, d, 12, 0, 0, 0);
            if (currentBlock.length === 0) {
                currentBlock.push(dateObj);
            } else {
                const prevDate = currentBlock[currentBlock.length - 1];
                const diffDays = Math.round((dateObj.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
                if (diffDays === 1) {
                    currentBlock.push(dateObj);
                } else {
                    // Only push if the block contains at least one allowed status (not just bridge)
                    const hasAllowed = currentBlock.some(d => {
                        const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                        return allowedStatuses.includes(memberObj.dayStatuses[dStr] || '');
                    });
                    if (hasAllowed) {
                        blocks.push(currentBlock);
                    }
                    currentBlock = [dateObj];
                }
            }
        });
        if (currentBlock.length > 0) {
            const hasAllowed = currentBlock.some(d => {
                const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                return allowedStatuses.includes(memberObj.dayStatuses[dStr] || '');
            });
            if (hasAllowed) {
                blocks.push(currentBlock);
            }
        }

        return blocks;
    };

    // Helper to find overlapping movement with eligible reason
    const findMatchingMovement = (memberMovements: any[], block: Date[], expectedType: 'pass' | 'vacation') => {
        if (block.length === 0) return null;
        const yearVal = baseDate ? baseDate.getFullYear() : new Date().getFullYear();
        const startD = block[0];
        const endD = block[block.length - 1];

        const startM = startD.getMonth() + 1;
        const startDay = startD.getDate();
        const endM = endD.getMonth() + 1;
        const endDay = endD.getDate();

        const blockStartIso = `${yearVal}-${String(startM).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
        const blockEndIso = `${yearVal}-${String(endM).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

        return memberMovements.find(mov => {
            if (mov.type !== expectedType) return false;
            if (expectedType === 'pass' && !isEligibleReason(mov.reason)) return false;
            return (mov.startDate <= blockEndIso && mov.endDate >= blockStartIso);
        });
    };

    const isInCoreTimeline = (dateIsoStr: string, coreTimelineList: string[]) => {
        if (!dateIsoStr) return false;
        const parts = dateIsoStr.split('-');
        if (parts.length < 3) return false;
        const m = parseInt(parts[1]);
        const d = parseInt(parts[2]);
        const mDStr = `${m}.${d}`;
        return coreTimelineList.includes(mDStr);
    };

    const overlapsTimeline = (mov: any, timelineList: string[]) => {
        if (!mov || !timelineList || timelineList.length === 0) return false;
        const yearVal = baseDate ? baseDate.getFullYear() : new Date().getFullYear();
        const [firstM, firstD] = timelineList[0].split('.').map(Number);
        const [lastM, lastD] = timelineList[timelineList.length - 1].split('.').map(Number);
        const tStartIso = `${yearVal}-${String(firstM).padStart(2, '0')}-${String(firstD).padStart(2, '0')}`;
        const tEndIso = `${yearVal}-${String(lastM).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
        return mov.startDate <= tEndIso && mov.endDate >= tStartIso;
    };

    // Validate day counts for the active week
    const activeWeekWarnings: { name: string; message: string }[] = [];
    if (currentWeek && currentWeek.data) {
        const dataList = currentWeek.data || [];
        dataList.forEach((member: any) => {
            const cleanName = member.name.replace(/^(병장|상병|일병|이병)\s*/, '');
            const memberMovements = movements.filter(mov => mov.name === cleanName);

            // 1. Check Pass blocks (bridged by duty/recovery across consecutive pass days)
            const coreTimeline = timeline.slice(0, 7);
            const passBlocks = getWeekendBlocks(member, ['pass', 'pass-depart', 'recovery-pass-depart'], ['duty', 'recovery']);
            if (passBlocks.length > 0) {
                const processedMovIds = new Set<string>();

                passBlocks.forEach(block => {
                    // Only count actual pass days (exclude depart, duty, recovery)
                    const passDays = block.filter(d => {
                        const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                        const status = member.dayStatuses[dStr] || '';
                        return status === 'pass';
                    });

                    if (passDays.length > 0) {
                        const matchedMov = findMatchingMovement(memberMovements, passDays, 'pass');
                        if (matchedMov && isInCoreTimeline(matchedMov.startDate, coreTimeline)) {
                            const movId = `${matchedMov.startDate}_${matchedMov.endDate}_${matchedMov.reason}`;
                            if (processedMovIds.has(movId)) return;
                            processedMovIds.add(movId);

                            const rawPassCount = extractDayCountFromText(matchedMov.reason);
                            const hasLinked = Object.values(member.dayStatuses).includes('linked');
                            const passDayCount = rawPassCount !== null ? (rawPassCount - (hasLinked ? 1 : 0)) : null;

                            if (passDayCount !== null && passDayCount !== passDays.length) {
                                activeWeekWarnings.push({
                                    name: cleanName,
                                    message: `외박 사유(${passDayCount + (hasLinked ? 1 : 0)}일)와 입력된 기간(${passDays.length}일)이 일치하지 않습니다.`
                                });
                            }
                        }
                    }
                });
            }

            // 2. Check Vacation blocks
            // Vacation can occur across the entire visible timeline
            const vacationBlocks = getWeekendBlocks(member, ['vacation', 'linked'], [], timeline);
            if (vacationBlocks.length > 0) {
                const processedVacationIds = new Set<string>();
                vacationBlocks.forEach(block => {
                    const vacationDays = block.filter(d => {
                        const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                        const status = member.dayStatuses[dStr] || '';
                        return status === 'vacation' || status === 'linked';
                    });

                    if (vacationDays.length === 0) return;

                    const matchedMov = findMatchingMovement(memberMovements, vacationDays, 'vacation');
                    if (matchedMov && overlapsTimeline(matchedMov, timeline)) {
                        const vacId = `${matchedMov.startDate}_${matchedMov.endDate}_${matchedMov.reason}`;
                        if (processedVacationIds.has(vacId)) return;
                        processedVacationIds.add(vacId);

                        const vacationDayCount = extractDayCountFromText(matchedMov.reason);
                        const movStart = new Date(matchedMov.startDate);
                        const movEnd = new Date(matchedMov.endDate);
                        const totalMovDays = Math.round((movEnd.getTime() - movStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

                        // 1) Movement record vs Reason text
                        if (vacationDayCount !== null && vacationDayCount !== totalMovDays) {
                            activeWeekWarnings.push({
                                name: cleanName,
                                message: `휴가 사유(${vacationDayCount}일)와 실제로 저장된 기간(${totalMovDays}일)이 일치하지 않습니다.`
                            });
                        }

                        // 2) Sheet table cells (잔디 칸수) vs Reason text / Expected days in timeline
                        const yearVal = baseDate ? baseDate.getFullYear() : new Date().getFullYear();
                        const [firstM, firstD] = timeline[0].split('.').map(Number);
                        const [lastM, lastD] = timeline[timeline.length - 1].split('.').map(Number);
                        const tStartDate = new Date(yearVal, firstM - 1, firstD, 12, 0, 0, 0);
                        const tEndDate = new Date(yearVal, lastM - 1, lastD, 12, 0, 0, 0);

                        const overlapStart = movStart > tStartDate ? movStart : tStartDate;
                        const overlapEnd = movEnd < tEndDate ? movEnd : tEndDate;
                        const expectedTimelineDays = Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);

                        const isFullyInTimeline = movStart >= tStartDate && movEnd <= tEndDate;
                        const expectedCount = isFullyInTimeline && vacationDayCount !== null ? vacationDayCount : expectedTimelineDays;

                        if (vacationDays.length !== expectedCount) {
                            const reasonLabel = vacationDayCount !== null && isFullyInTimeline
                                ? `휴가 사유(${vacationDayCount}일)`
                                : `휴가 기간(${expectedCount}일)`;
                            activeWeekWarnings.push({
                                name: cleanName,
                                message: `${reasonLabel}와 입력된 기간(${vacationDays.length}일)이 일치하지 않습니다.`
                            });
                        }
                    }
                });
            }
        });
    }

    const handleCopyTable = async () => {
        try {
            const dataList = displayDataList;

            // Sort logic matching MovementGrid
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

            // Map rows with details
            const finalRows = sortedEntries.map((member) => {
                const cleanName = extractPureMemberName(member.name);
                const dbMember = dbMembers.find(m => m.name === cleanName);

                const englishName = dbMember?.englishName || cleanName;
                const phoneNumber = dbMember?.phoneNumber || '—';

                const rankMap: Record<string, string> = {
                    '병장': 'SGT', '상병': 'CPL', '일병': 'PFC', '이병': 'PV2',
                    'SGT': 'SGT', 'CPL': 'CPL', 'PFC': 'PFC', 'PV2': 'PV2', 'PVT': 'PVT'
                };
                const dbRankStr = dbMember?.enlistmentDate
                    ? calculateRank(new Date(dbMember.enlistmentDate), dbMember.earlyPromotion || 0, baseDate || new Date())
                    : (dbMember?.rank || '');
                const matchedRankKey = Object.keys(rankMap).find(key => dbRankStr.startsWith(key)) || '';
                const rankEnglish = rankMap[matchedRankKey] || (Object.keys(rankMap).find(key => member.name.startsWith(key)) ? rankMap[Object.keys(rankMap).find(key => member.name.startsWith(key))!] : 'PFC');

                const sections = dbMember?.sections || [];
                let mainSec = '—';
                let subSec = '';
                if (sections.includes('KTA')) {
                    mainSec = 'KTA';
                } else if (sections.includes('BLC')) {
                    mainSec = 'BLC';
                } else {
                    const hqSub = sections.find((s: string) => /^S\d$/.test(s));
                    if (hqSub) {
                        mainSec = 'HQ';
                        subSec = hqSub.replace('S', 'S-');
                    } else if (sections.includes('HQ')) {
                        mainSec = 'HQ';
                        subSec = sections.find((s: string) => s !== 'HQ') || '';
                    } else if (sections.length > 0) {
                        mainSec = sections[0];
                    }
                }

                const memberMovements = movements.filter(mov => mov.name === cleanName);
                const coreTimeline = timeline.slice(0, 7); // Wed ~ Tue
                const remarksList: string[] = [];
                // Group pass dates that share the same reason / context for clean Remarks (e.g. 2 DAY PASS (9.4, 9.7) or 1 DAY PASS (9.4), 1 DAY PASS (9.7))
                const passSegments: { dates: Date[]; reason: string }[] = [];
                memberMovements.forEach(mov => {
                    const movStart = new Date(mov.startDate);
                    const movEnd = new Date(mov.endDate);

                    if (mov.type === 'pass') {
                        const overlapDates: Date[] = [];
                        let curr = new Date(movStart);
                        while (curr <= movEnd) {
                            const m = curr.getMonth() + 1;
                            const d = curr.getDate();
                            const dStr = `${m}.${d}`;
                            if (coreTimeline.includes(dStr)) {
                                overlapDates.push(new Date(curr));
                            }
                            curr.setDate(curr.getDate() + 1);
                        }

                        if (overlapDates.length > 0) {
                            passSegments.push({
                                dates: overlapDates,
                                reason: mov.reason || ''
                            });
                        }
                    }
                });

                if (passSegments.length === 1) {
                    const dates = passSegments[0].dates;
                    const count = dates.length;
                    const start = dates[0];
                    const end = dates[dates.length - 1];
                    const sM = start.getMonth() + 1;
                    const sD = start.getDate();
                    const eM = end.getMonth() + 1;
                    const eD = end.getDate();
                    if (count === 1) {
                        remarksList.push(`1 DAY PASS (${sM}.${sD})`);
                    } else {
                        remarksList.push(`${count} DAY PASS (${sM}.${sD}-${eM}.${eD})`);
                    }
                } else if (passSegments.length > 1) {
                    // Check if they share the same reward type / reason (e.g. split pass from same holiday)
                    const totalPassDays = passSegments.reduce((sum, seg) => sum + seg.dates.length, 0);
                    const allDates = passSegments.flatMap(seg => seg.dates);
                    const dateStrings = allDates.map(d => `${d.getMonth() + 1}.${d.getDate()}`).join(', ');
                    remarksList.push(`${totalPassDays} DAY PASS (${dateStrings})`);
                }

                const remarks = remarksList.join(', ');

                if (!remarks) return null;

                return {
                    no: 0,
                    koreanName: cleanName,
                    englishName,
                    rankEnglish,
                    mainSec,
                    subSec,
                    remarks,
                    phoneNumber,
                    dbMember
                };
            }).filter(Boolean) as any[];

            // Sort by mainSec, then by seniority (enlistment date), then rank, then name
            const sectionOrder = ['BLC', 'MEDIC', 'KTA', 'RSO', 'HQ'];
            finalRows.sort((a, b) => {
                const idxA = sectionOrder.indexOf(a.mainSec);
                const idxB = sectionOrder.indexOf(b.mainSec);
                const orderA = idxA === -1 ? 999 : idxA;
                const orderB = idxB === -1 ? 999 : idxB;

                if (orderA !== orderB) return orderA - orderB;

                // Sort HQ sub-sections S-1 to S-6
                if (a.mainSec === 'HQ' && b.mainSec === 'HQ') {
                    if (a.subSec !== b.subSec) {
                        return a.subSec.localeCompare(b.subSec);
                    }
                }

                const enlistA = a.dbMember?.enlistmentDate || '';
                const enlistB = b.dbMember?.enlistmentDate || '';
                if (enlistA && enlistB) {
                    if (enlistA !== enlistB) return enlistA < enlistB ? -1 : 1;
                } else if (enlistA) {
                    return -1;
                } else if (enlistB) {
                    return 1;
                }

                const rankPriority: Record<string, number> = { 'SGT': 1, 'CPL': 2, 'PFC': 3, 'PV2': 4, 'PVT': 5 };
                const pA = rankPriority[a.rankEnglish] || 99;
                const pB = rankPriority[b.rankEnglish] || 99;
                if (pA !== pB) return pA - pB;

                return a.englishName.localeCompare(b.englishName);
            });

            finalRows.forEach((row, i) => {
                row.no = i + 1;
            });

            // Count rowspans for mainSec
            const rowSpans: number[] = [];
            let i = 0;
            while (i < finalRows.length) {
                let count = 1;
                while (i + count < finalRows.length && finalRows[i + count].mainSec === finalRows[i].mainSec) {
                    count++;
                }
                rowSpans.push(count);
                i += count;
            }

            // Precompute subSec rowspans for HQ rows
            const subSecRowSpans = new Array(finalRows.length).fill(0);
            let j = 0;
            while (j < finalRows.length) {
                if (finalRows[j].mainSec === 'HQ') {
                    let count = 1;
                    while (j + count < finalRows.length &&
                           finalRows[j + count].mainSec === 'HQ' &&
                           finalRows[j + count].subSec === finalRows[j].subSec) {
                        count++;
                    }
                    subSecRowSpans[j] = count;
                    j += count;
                } else {
                    j++;
                }
            }

            // Build HTML table string
            let html = `<table style="border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 10pt; width: 16.29cm; text-align: center; font-weight: normal; margin: 0 auto;">
  <thead>
    <tr style="font-weight: normal; height: 0.53cm;">
      <td style="border: 1px solid #000; border-top: 1.5pt solid #000; width: 0.87cm; height: 0.53cm; font-weight: normal; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;"></td>
      <td style="border: 1px solid #000; border-top: 1.5pt solid #000; width: 4.02cm; height: 0.53cm; font-weight: normal; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">Name</td>
      <td style="border: 1px solid #000; border-top: 1.5pt solid #000; width: 1.35cm; height: 0.53cm; font-weight: normal; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">Rank</td>
      <td style="border: 1px solid #000; border-top: 1.5pt solid #000; width: 2.22cm; height: 0.53cm; font-weight: normal; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;" colspan="2">Section</td>
      <td style="border: 1px solid #000; border-top: 1.5pt solid #000; width: 4.52cm; height: 0.53cm; font-weight: normal; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">Remarks</td>
      <td style="border: 1px solid #000; border-top: 1.5pt solid #000; width: 3.31cm; height: 0.53cm; font-weight: normal; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">Phone Number</td>
    </tr>
  </thead>
  <tbody>`;

            let spanIndex = 0;
            let spanRemaining = 0;
            let subSecRemaining = 0;

            finalRows.forEach((row, rowIndex) => {
                html += `\n    <tr style="height: 0.53cm; font-weight: normal;">`;
                html += `\n      <td style="border: 1px solid #000; height: 0.53cm; width: 0.87cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.no}</td>`;
                html += `\n      <td style="border: 1px solid #000; height: 0.53cm; width: 4.02cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.englishName}</td>`;
                html += `\n      <td style="border: 1px solid #000; height: 0.53cm; width: 1.35cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.rankEnglish}</td>`;

                if (spanRemaining === 0) {
                    const span = rowSpans[spanIndex];
                    spanRemaining = span;
                    spanIndex++;

                    if (row.mainSec === 'HQ') {
                        html += `\n      <td rowspan="${span}" style="border: 1px solid #000; width: 1.11cm; font-weight: normal; vertical-align: middle; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.mainSec}</td>`;
                    } else {
                        html += `\n      <td colspan="2" rowspan="${span}" style="border: 1px solid #000; width: 2.22cm; font-weight: normal; vertical-align: middle; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.mainSec}</td>`;
                    }
                }
                spanRemaining--;

                if (row.mainSec === 'HQ') {
                    if (subSecRemaining === 0) {
                        const subSpan = subSecRowSpans[rowIndex];
                        subSecRemaining = subSpan;
                        html += `\n      <td rowspan="${subSpan}" style="border: 1px solid #000; width: 1.11cm; height: 0.53cm; vertical-align: middle; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.subSec}</td>`;
                    }
                    subSecRemaining--;
                }

                html += `\n      <td style="border: 1px solid #000; height: 0.53cm; width: 4.52cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.remarks}</td>`;
                html += `\n      <td style="border: 1px solid #000; height: 0.53cm; width: 3.31cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.phoneNumber}</td>`;
                html += `\n    </tr>`;
            });

            html += `\n  </tbody>\n</table>`;

            // Plain text fallback
            const plainText = finalRows.map(row => {
                const sec = row.mainSec === 'HQ' ? `HQ ${row.subSec}` : row.mainSec;
                return `${row.no}\t${row.englishName}\t${row.rankEnglish}\t${sec}\t${row.remarks}\t${row.phoneNumber}`;
            }).join('\n');

            const allRemarksDates: Date[] = [];

            // Helper to format date range to Korean style for remarks using DB movement
            const formatRemarksDateRange = (matchedMov: any, includeDepartDateForPass: boolean = false) => {
                const startD = new Date(matchedMov.startDate);
                if (includeDepartDateForPass) {
                    startD.setDate(startD.getDate() - 1);
                }
                const endD = new Date(matchedMov.endDate);

                allRemarksDates.push(new Date(startD));
                allRemarksDates.push(new Date(endD));

                const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                const startDayKo = dayNames[startD.getDay()];
                const endDayKo = dayNames[endD.getDay()];

                const sm = startD.getMonth() + 1;
                const sd = startD.getDate();
                const em = endD.getMonth() + 1;
                const ed = endD.getDate();

                if (startD.getTime() === endD.getTime()) {
                    return `${sm}/${sd}(${startDayKo})`;
                } else {
                    return `${sm}/${sd}(${startDayKo})~${em}/${ed}(${endDayKo})`;
                }
            };

            const yearVal = baseDate ? baseDate.getFullYear() : new Date().getFullYear();
            const coreTimeline = timeline.slice(0, 7);
            const coreIsoDates = coreTimeline.map((dateStr: string) => {
                const [m, d] = dateStr.split('.').map(Number);
                return `${yearVal}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            });

            const matchedHoliday = dutySchedules.find(s => {
                if (s.type !== 'holiday' || s.holidayType !== 'duty') return false;
                const hStart = s.startDate;
                const hEnd = s.endDate || s.startDate;
                return coreIsoDates.some((iso: string) => iso >= hStart && iso <= hEnd);
            });

            let holidayDays = 0;
            let holidayName = '';
            let holidayNameLower = '';
            if (matchedHoliday) {
                const hStart = new Date(matchedHoliday.startDate);
                const hEnd = new Date(matchedHoliday.endDate || matchedHoliday.startDate);
                holidayDays = Math.max(1, Math.round((hEnd.getTime() - hStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
                holidayName = (matchedHoliday.memo || 'Holiday').trim();
                holidayNameLower = holidayName.toLowerCase();
            }

            const enclosureItems: any[] = [];
            const remarksPassItems: any[] = [];
            const remarksVacationItems: any[] = [];

            sortedEntries.forEach((member) => {
                const cleanName = member.name.replace(/^(병장|상병|일병|이병)\s*/, '');
                const dbMember = dbMembers.find(m => m.name === cleanName);

                const enlistmentDate = dbMember?.enlistmentDate || '9999-12-31';
                const englishName = dbMember?.englishName || cleanName;
                const formattedEnglishName = englishName.toLowerCase().replace(/\b[a-z]/g, (letter: string) => letter.toUpperCase());

                const rankMap: Record<string, string> = {
                    '병장': 'SGT', '상병': 'CPL', '일병': 'PFC', '이병': 'PV2',
                    'SGT': 'SGT', 'CPL': 'CPL', 'PFC': 'PFC', 'PV2': 'PV2', 'PVT': 'PVT'
                };
                const dbRankStr = dbMember?.enlistmentDate
                    ? calculateRank(new Date(dbMember.enlistmentDate), dbMember.earlyPromotion || 0, baseDate || new Date())
                    : (dbMember?.rank || '');
                const matchedRankKey = Object.keys(rankMap).find(key => dbRankStr.startsWith(key)) || '';
                const rankEnglish = rankMap[matchedRankKey] || (Object.keys(rankMap).find(key => member.name.startsWith(key)) ? rankMap[Object.keys(rankMap).find(key => member.name.startsWith(key))!] : 'PFC');

                const rankMapKo: Record<string, string> = {
                    'SGT': '병장', 'CPL': '상병', 'PFC': '일병', 'PV2': '이병', 'PVT': '이병'
                };
                const rankKo = rankMapKo[rankEnglish] || '일병';

                const memberMovements = movements.filter(mov => mov.name === cleanName);

                // 1. Process PASS blocks
                const passBlocks = getWeekendBlocks(member, ['pass', 'pass-depart', 'recovery-pass-depart']);
                if (passBlocks.length > 0) {
                    const memberPassItems: { dateRangeKo: string; mov: any }[] = [];
                    let firstReason = '';
                    let totalPassDaysSum = 0;

                    passBlocks.forEach(block => {
                        const passDays = block.filter(d => {
                            const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                            const status = member.dayStatuses[dStr] || '';
                            return status !== 'pass-depart' && status !== 'recovery-pass-depart';
                        });

                        if (passDays.length > 0) {
                            const matchedMov = findMatchingMovement(memberMovements, passDays, 'pass');
                            if (matchedMov && isInCoreTimeline(matchedMov.startDate, coreTimeline)) {
                                const movStart = new Date(matchedMov.startDate);
                                const movEnd = new Date(matchedMov.endDate);
                                const movDays = Math.round((movEnd.getTime() - movStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                                totalPassDaysSum += movDays;
                                if (!firstReason) firstReason = matchedMov.reason || '';
                                const dateRangeKo = formatRemarksDateRange(matchedMov, true);
                                memberPassItems.push({ dateRangeKo, mov: matchedMov });
                            }
                        }
                    });

                    if (memberPassItems.length > 0) {
                        const reason = firstReason;
                        const rewardTypeEnclosure = extractRewardType(reason, dbMember, true);
                        let rewardTypeRemarks = extractRewardType(reason, dbMember, false);
                        const totalMovDays = totalPassDaysSum;

                        enclosureItems.push({
                            enlistmentDate,
                            koreanName: cleanName,
                            rankEnglish,
                            formattedName: formattedEnglishName,
                            count: totalMovDays,
                            typeStr: 'PASS',
                            reason: rewardTypeEnclosure
                        });

                        // Check if this pass should be included in 출타 특이사항
                        let shouldIncludeInRemarks = true;
                        if (matchedHoliday) {
                            const rawReasonLower = reason.toLowerCase();
                            const isHolidayReason = rawReasonLower.includes(holidayNameLower);
                            const isDutyReduced = /(월|화|수|목|금|토|일)\s*당으로\s*인한/i.test(reason) && isHolidayReason && totalMovDays < holidayDays;
                            const isGeneralPass = rawReasonLower.includes('일반');

                            if (isDutyReduced) {
                                rewardTypeRemarks = '당직근무';
                                shouldIncludeInRemarks = true;
                            } else if (isGeneralPass) {
                                rewardTypeRemarks = '일반';
                                shouldIncludeInRemarks = true;
                            } else if (isHolidayReason && totalMovDays >= holidayDays) {
                                shouldIncludeInRemarks = false;
                            }
                        }

                        if (shouldIncludeInRemarks) {
                            const combinedDateRangeKo = memberPassItems.map(p => p.dateRangeKo).join(', ');
                            remarksPassItems.push({
                                enlistmentDate,
                                koreanName: cleanName,
                                rankKo,
                                dateRangeKo: combinedDateRangeKo,
                                reason: rewardTypeRemarks,
                                count: totalMovDays,
                                typeStr: 'PASS'
                            });
                        }
                    }
                }

                // 2. Process VACATION blocks (only for remarks, excluded from enclosure)
                const vacationBlocks = getWeekendBlocks(member, ['vacation', 'linked']);
                if (vacationBlocks.length > 0) {
                    const block = vacationBlocks[0];
                    const matchedMov = findMatchingMovement(memberMovements, block, 'vacation');

                    if (matchedMov && isInCoreTimeline(matchedMov.startDate, coreTimeline)) {
                        const reason = matchedMov.reason;
                        const rewardType = extractRewardType(reason, dbMember, false);
                        const dateRangeKo = formatRemarksDateRange(matchedMov, false);
                        const movStart = new Date(matchedMov.startDate);
                        const movEnd = new Date(matchedMov.endDate);
                        const totalMovDays = Math.round((movEnd.getTime() - movStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

                        const isLinked = block.some(d => {
                            const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                            return member.dayStatuses[dStr] === 'linked';
                        });

                        remarksVacationItems.push({
                            enlistmentDate,
                            koreanName: cleanName,
                            rankKo,
                            dateRangeKo,
                            reason: rewardType,
                            count: totalMovDays,
                            typeStr: 'VACATION',
                            isLinked
                        });
                    }
                }
            });

            const sortItems = (items: any[]) => {
                items.sort((a, b) => {
                    if (a.enlistmentDate !== b.enlistmentDate) {
                        return a.enlistmentDate.localeCompare(b.enlistmentDate);
                    }
                    return a.koreanName.localeCompare(b.koreanName, 'ko');
                });
            };

            sortItems(enclosureItems);
            sortItems(remarksPassItems);
            sortItems(remarksVacationItems);

            let enclosureText = 'ENCLOSURE\n\n';
            let enclosureHtml = '<div style="font-family: Arial, \'Malgun Gothic\', \'맑은 고딕\', sans-serif; font-size: 12pt; line-height: 1.15; font-weight: normal;">ENCLOSURE</div><br>';

            if (matchedHoliday) {
                // Items whose reason does not contain the holiday name or '일반' are other compensation reasons
                const hasGeneralPassKatusas = enclosureItems.some(item => {
                    const rLower = (item.reason || '').toLowerCase();
                    return rLower.includes('일반');
                });

                const nonHolidayItems = enclosureItems.filter(item => {
                    const rLower = (item.reason || '').toLowerCase();
                    return !rLower.includes(holidayNameLower) && !rLower.includes('일반');
                });

                enclosureText += `• All KATUSAs would be on the ${holidayName} ${holidayDays} DAY PASS and exceptions are due to:\n\t• Staff Duty\n`;
                if (hasGeneralPassKatusas) {
                    enclosureText += `\t• 포데이 나가지 않는 인원들의 사유 작성\n`;
                }

                enclosureHtml += `<ul style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 12pt; line-height: 1.15; font-weight: normal; width: 16.51cm; margin: 0; padding-left: 1.27cm; list-style-type: disc; mso-line-height-rule: exactly;">
  <li style="margin: 0; padding: 0; line-height: 1.15; mso-line-height-rule: exactly;">
    All KATUSAs would be on the ${holidayName} ${holidayDays} DAY PASS and exceptions are due to:
    <ul style="margin: 0; padding-left: 1.27cm; list-style-type: circle; line-height: 1.15; mso-line-height-rule: exactly;">
      <li style="margin: 0; padding: 0; line-height: 1.15; mso-line-height-rule: exactly;">Staff Duty</li>${hasGeneralPassKatusas ? '\n      <li style="margin: 0; padding: 0; line-height: 1.15; mso-line-height-rule: exactly;">포데이 나가지 않는 인원들의 사유 작성</li>' : ''}
    </ul>
  </li>
</ul>`;

                if (nonHolidayItems.length > 0) {
                    enclosureText += `\n`;
                    enclosureHtml += `<br><table style="border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 12pt; font-weight: normal; border: none; width: 16.51cm; line-height: 1.15; mso-line-height-rule: exactly;">`;

                    nonHolidayItems.forEach((item, index) => {
                        const num = index + 1;
                        enclosureText += `${num}.\t${item.rankEnglish} ${item.formattedName} will receive a ${item.count} DAY ${item.typeStr} by using the ${item.reason} compensation.\n`;
                        enclosureHtml += `<tr style="vertical-align: top; border: none; line-height: 1.15; mso-line-height-rule: exactly;">`;
                        enclosureHtml += `<td style="width: 1.05cm; text-align: left; vertical-align: top; padding: 0 0.2cm 0 0; margin: 0; border: none; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.15; mso-line-height-rule: exactly;">${num}.</td>`;
                        enclosureHtml += `<td style="width: 15.46cm; text-align: left; vertical-align: top; padding: 0; margin: 0; border: none; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.15; mso-line-height-rule: exactly;">${item.rankEnglish} ${item.formattedName} will receive a ${item.count} DAY ${item.typeStr} by using the ${item.reason} compensation.</td>`;
                        enclosureHtml += `</tr>`;
                    });

                    enclosureHtml += `</table>`;
                }
            } else if (enclosureItems.length === 0) {
                enclosureText = 'ENCLOSURE\n\n(No eligible items)';
                enclosureHtml += '<div style="font-family: Arial, \'Malgun Gothic\', \'맑은 고딕\', sans-serif; font-size: 12pt; line-height: 1.15; font-weight: normal;">(No eligible items)</div>';
            } else {
                enclosureHtml += `<table style="border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 12pt; font-weight: normal; border: none; width: 16.51cm; line-height: 1.15; mso-line-height-rule: exactly;">`;
                enclosureItems.forEach((item, index) => {
                    const num = index + 1;
                    enclosureText += `${num}.\t${item.rankEnglish} ${item.formattedName} will receive a ${item.count} DAY ${item.typeStr} by using the ${item.reason} compensation.\n`;
                    enclosureHtml += `<tr style="vertical-align: top; border: none; line-height: 1.15; mso-line-height-rule: exactly;">`;
                    enclosureHtml += `<td style="width: 1.05cm; text-align: left; vertical-align: top; padding: 0 0.2cm 0 0; margin: 0; border: none; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.15; mso-line-height-rule: exactly;">${num}.</td>`;
                    enclosureHtml += `<td style="width: 15.46cm; text-align: left; vertical-align: top; padding: 0; margin: 0; border: none; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.15; mso-line-height-rule: exactly;">${item.rankEnglish} ${item.formattedName} will receive a ${item.count} DAY ${item.typeStr} by using the ${item.reason} compensation.</td>`;
                    enclosureHtml += `</tr>`;
                });
                enclosureHtml += `</table>`;
            }

            // Calculate overall min/max date range of remarks list
            let weekRangeStr = `(${currentWeek.startDate.replace('.', '/')}-${currentWeek.endDate.replace('.', '/')})`;
            if (allRemarksDates.length > 0) {
                const minDate = new Date(Math.min(...allRemarksDates.map(d => d.getTime())));
                const maxDate = new Date(Math.max(...allRemarksDates.map(d => d.getTime())));
                weekRangeStr = `(${minDate.getMonth() + 1}/${minDate.getDate()}~${maxDate.getMonth() + 1}/${maxDate.getDate()})`;
            }

            const formatReasonStr = (reason: string, count: number, typeStr?: string, isLinked?: boolean) => {
                if (typeStr === 'VACATION') {
                    return `${reason} ${count}일 사용, 외휴연계 ${isLinked ? 'O' : 'X'}`;
                }
                let cleanReason = reason.trim();
                if (cleanReason.includes('으로 인한') || cleanReason.includes('로 인한')) {
                    return cleanReason;
                }
                if (cleanReason === '당직근무' || cleanReason.includes('당직근무')) {
                    return `당직근무로 인한 ${count} 데이`;
                }
                if (cleanReason === '일반' || cleanReason.includes('일반')) {
                    return `(사유 작성)로 인한 일반 ${count} 데이`;
                }
                if (!cleanReason.includes('컴펜') && !cleanReason.toLowerCase().includes('compensation')) {
                    cleanReason = `${cleanReason} 컴펜`;
                }
                return `${cleanReason}으로 인한 ${count} 데이`;
            };

            const formatRankName = (name: string, rank: string, isHtml: boolean) => {
                const clean = name.replace(/\s+/g, '');
                if (clean.length === 2) {
                    if (isHtml) {
                        return `<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${clean}&emsp;&nbsp;${rank}</span>`;
                    }
                    return `${clean}　 ${rank}`;
                }
                if (isHtml) {
                    return `<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${clean}&nbsp;&nbsp;${rank}</span>`;
                }
                return `${clean}  ${rank}`;
            };

            // Format Plain Text Remarks
            let remarksText = `출타 특이사항 ${weekRangeStr}\n\n`;
            remarksText += `외박\n\n`;
            if (remarksPassItems.length === 0) {
                remarksText += `-   없음\n`;
            } else {
                remarksPassItems.forEach((item, index) => {
                    const num = index + 1;
                    const rankName = formatRankName(item.koreanName, item.rankKo, false);
                    const rankNameColon = `${rankName}:`;
                    const reasonStr = formatReasonStr(item.reason, item.count);
                    remarksText += `${num}.\t${rankNameColon}\t ${item.dateRangeKo}\t${reasonStr}\n`;
                });
            }

            remarksText += `\n\n휴가\n\n`;
            if (remarksVacationItems.length === 0) {
                remarksText += `-   없음\n`;
            } else {
                remarksVacationItems.forEach((item, index) => {
                    const num = index + 1;
                    const rankName = formatRankName(item.koreanName, item.rankKo, false);
                    const rankNameColon = `${rankName}:`;
                    const reasonStr = formatReasonStr(item.reason, item.count, item.typeStr, item.isLinked);
                    remarksText += `${num}.\t${rankNameColon}\t ${item.dateRangeKo}\t${reasonStr}\n`;
                });
            }

            let remarksHtml = `<div style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; line-height: 1.15; font-weight: normal;">`;
            remarksHtml += `<p align="center" style="font-size: 12pt; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; text-align: center; font-weight: normal; margin: 0 0 12pt 0; width: 100%;">출타 특이사항 ${weekRangeStr}</p>`;
            remarksHtml += `<div style="font-size: 12pt; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; margin-bottom: 6pt;">외박</div>`;

            if (remarksPassItems.length === 0) {
                remarksHtml += `-&nbsp;&nbsp;&nbsp;&nbsp;<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal;">없음</span><br><br>`;
            } else {
                remarksHtml += `<table style="border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; font-weight: normal; width: 18.0cm; border: none; margin-bottom: 12pt; line-height: 1.0; mso-line-height-rule: exactly;">`;
                remarksPassItems.forEach((item, index) => {
                    const num = index + 1;
                    const rankName = formatRankName(item.koreanName, item.rankKo, true);
                    const rankNameAndColon = `${rankName}:`;
                    const reasonStr = formatReasonStr(item.reason, item.count);

                    remarksHtml += `<tr style="height: 0.53cm; border: none; vertical-align: middle; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">`;
                    remarksHtml += `<td style="width: 0.8cm; height: 0.53cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly; white-space: nowrap;">${num}.</td>`;
                    remarksHtml += `<td style="width: 2.8cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly; white-space: nowrap;">${rankNameAndColon}</td>`;
                    remarksHtml += `<td style="width: 4.5cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly; white-space: nowrap;">&nbsp;${item.dateRangeKo}</td>`;
                    remarksHtml += `<td style="width: 9.9cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly; white-space: nowrap;">${reasonStr}</td>`;
                    remarksHtml += `</tr>`;
                });
                remarksHtml += `</table><br>`;
            }

            remarksHtml += `<div style="font-size: 12pt; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; margin-bottom: 6pt;">휴가</div>`;
            if (remarksVacationItems.length === 0) {
                remarksHtml += `-&nbsp;&nbsp;&nbsp;&nbsp;<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal;">없음</span><br>`;
            } else {
                remarksHtml += `<table style="border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; font-weight: normal; width: 18.0cm; border: none; line-height: 1.0; mso-line-height-rule: exactly;">`;
                remarksVacationItems.forEach((item, index) => {
                    const num = index + 1;
                    const rankName = formatRankName(item.koreanName, item.rankKo, true);
                    const rankNameAndColon = `${rankName}:`;
                    const reasonStr = formatReasonStr(item.reason, item.count, item.typeStr, item.isLinked);

                    remarksHtml += `<tr style="height: 0.53cm; border: none; vertical-align: middle; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">`;
                    remarksHtml += `<td style="width: 0.8cm; height: 0.53cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly; white-space: nowrap;">${num}.</td>`;
                    remarksHtml += `<td style="width: 2.8cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly; white-space: nowrap;">${rankNameAndColon}</td>`;
                    remarksHtml += `<td style="width: 4.5cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly; white-space: nowrap;">&nbsp;${item.dateRangeKo}</td>`;
                    remarksHtml += `<td style="width: 9.9cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">${reasonStr}</td>`;
                    remarksHtml += `</tr>`;
                });
                remarksHtml += `</table>`;
            }
            remarksHtml += `</div>`;

            setPreviewData({
                html,
                text: plainText,
                enclosure: enclosureText,
                enclosureHtml,
                remarks: remarksText,
                remarksHtml
            });
        } catch (err) {
            console.error('Clipboard copy error:', err);
            alert('표 복사 실패: ' + err);
        }
    };

    return (
        <div className="space-y-4 animate-in zoom-in-95 duration-300">
            {activeWeekWarnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-800 space-y-2 animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-2 font-bold text-amber-900">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                        <span>근무표 출타 기간과 등록된 사유의 일수가 일치하지 않는 항목이 있습니다:</span>
                    </div>
                    <ul className="list-disc pl-5 text-xs sm:text-sm space-y-1 text-amber-700">
                        {activeWeekWarnings.map((warning, idx) => (
                            <li key={idx}>
                                <span className="font-bold">{warning.name}</span>: {warning.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="flex flex-row items-center justify-between bg-white border border-gray-200 rounded-2xl p-2 sm:p-3 shadow-sm gap-2 sm:gap-4 overflow-visible">
                {/* Left: Copy Table button */}
                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={handleCopyTable}
                        className="flex items-center justify-center gap-1.5 px-2.5 sm:px-4 h-[44px] bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 rounded-xl text-xs sm:text-sm font-bold text-indigo-600 transition-all shadow-sm w-auto whitespace-nowrap"
                    >
                        <Copy className="w-4 h-4 shrink-0" />
                        <span>패스지</span>
                    </button>
                </div>

                {/* Center: Date Range */}
                <div className="text-[15px] sm:text-lg md:text-xl font-black text-gray-900 tracking-tight text-center whitespace-nowrap shrink-0">
                    {currentWeek.startDate} ~ {currentWeek.endDate}
                </div>

                {/* Right: Navigation buttons side-by-side */}
                <div className="flex items-center justify-center gap-1.5 shrink-0">
                    <button
                        onClick={() => setCurrentWeekIndex(i => Math.max(0, i - 1))}
                        disabled={currentWeekIndex === 0}
                        className="w-9 h-9 sm:w-11 sm:h-11 bg-gray-50 rounded-xl flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-gray-50 transition-all text-gray-600"
                    >
                        <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    <button
                        onClick={() => setCurrentWeekIndex(i => Math.min(sheetWeeks.length - 1, i + 1))}
                        disabled={currentWeekIndex === sheetWeeks.length - 1}
                        className="w-9 h-9 sm:w-11 sm:h-11 bg-gray-50 rounded-xl flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-gray-50 transition-all text-gray-600"
                    >
                        <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                </div>
            </div>

            {previewData && (
                <MovementPreviewModal
                    htmlContent={previewData.html}
                    plainTextContent={previewData.text}
                    enclosureContent={previewData.enclosure}
                    enclosureHtmlContent={previewData.enclosureHtml}
                    remarksContent={previewData.remarks}
                    remarksHtmlContent={previewData.remarksHtml}
                    onClose={() => setPreviewData(null)}
                />
            )}

            <MovementGrid
                timeline={currentWeek.timeline}
                dataList={displayDataList}
                dbMembers={dbMembers}
                baseDate={baseDate}
                movements={movements}
                sheetWeeks={sheetWeeks}
            />
        </div>
    );
}
