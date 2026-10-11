/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Copy, AlertTriangle } from 'lucide-react';
import { MovementGrid } from './movement.grid.component';
import { MovementPreviewModal } from './movement.preview-modal.component';
import { extractDayCountFromText, applyDutySchedulesToDataList, extractPureMemberName } from '../../utils/movement.utils';
import { calculateRank, compareMembersByHobong } from '../../lib/rankUtils';
import { isDateDuringKtaPeriod, isDateDuringBlcPeriod } from '../../utils/duty/dutyAutoDistribute';
import { useMovementSettings } from '../../hooks/movement/useMovementSettings';

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
    const { allowVacationPassLink } = useMovementSettings();
    const [previewData, setPreviewData] = useState<{ html: string; text: string; enclosure: string; enclosureHtml: string; remarks: string; remarksHtml: string } | null>(null);

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

    if (sheetWeeks.length === 0) return null;



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

    // 한국어 받침에 따라 '으로 인한' / '로 인한'을 붙여주는 헬퍼
    const attachKoreanRoParticle = (text: string, suffix: string = ' 인한'): string => {
        const trimmed = text.trim();
        if (!trimmed) return '';
        const lastChar = trimmed[trimmed.length - 1];
        const code = lastChar.charCodeAt(0);

        // 한글 완성형 음절 (가 ~ 힣: 0xAC00 ~ 0xD7A3)
        if (code >= 0xAC00 && code <= 0xD7A3) {
            const jongseongIndex = (code - 0xAC00) % 28;
            // 종성이 없거나(0), 종성이 'ㄹ'(8)인 경우에는 '로'
            if (jongseongIndex === 0 || jongseongIndex === 8) {
                return `${trimmed}로${suffix}`;
            }
            // 그 외 종성이 있는 경우(자음 받침)에는 '으로'
            return `${trimmed}으로${suffix}`;
        }

        // 영문 또는 숫자 등 기타 문자인 경우 발음 기준 종성 규칙
        const lower = trimmed.toLowerCase();
        // 영문 끝소리가 모음이나 L/R 로 끝나는 경우 '로' (예: Demo, Day, Duty 등)
        if (/[aeiouwyr]$/i.test(lower)) {
            return `${trimmed}로${suffix}`;
        }
        // 기본적으로는 받침이 있는 경우가 많으므로 '으로' (예: 컴펜 -> 컴펜으로)
        return `${trimmed}으로${suffix}`;
    };

    // (A)로 인한 (B) N데이 구조를 분해 및 정규화하는 통합 파서
    interface ParsedPassInfo {
        reductionCause: string;     // (A) 외박 기간이 줄어드는 사유 (예: '당직근무' 등)
        rewardReason: string;       // (B) 외박 사유 (예: 'BLC 01-27기 컴펜', 'Staff Duty 컴펜', '추석 컴펜', 'Birthday' 등)
        isPlainGeneral: boolean;    // (B)가 '일반'이거나 사유가 없는 기본 외박인지 여부
        isComp: boolean;            // (B)가 보상외박/컴펜 사유인지 여부
        parsedDays: number;         // N데이에서 추출한 일수 (없으면 0)
    }

    const parsePassReason = (
        reasonStr: string | undefined | null, 
        dbMember?: any, 
        isEnclosure: boolean = false,
        isVacation: boolean = false
    ): ParsedPassInfo => {
        if (!reasonStr) {
            return { reductionCause: '', rewardReason: '', isPlainGeneral: true, isComp: false, parsedDays: 0 };
        }

        let raw = reasonStr.trim().replace(/외휴연계\s*[OX]?/gi, '').trim();

        // 1. (A)와 뒷부분 분리: ~(으)로 인한
        let causePart = '';
        let remainder = raw;
        let index = raw.lastIndexOf('으로 인한');
        let phraseLen = 5;
        if (index === -1) {
            index = raw.lastIndexOf('로 인한');
            phraseLen = 4;
        }

        if (index !== -1) {
            causePart = raw.substring(0, index).trim();
            remainder = raw.substring(index + phraseLen).trim();
        }

        // 만약 causePart에 '컴펜'이나 'compensation'이 포함되어 있다면 이것은 (A) 원인이 아니라 외박 사유(B)임!
        if (causePart && (causePart.includes('컴펜') || causePart.toLowerCase().includes('compensation'))) {
            remainder = `${causePart} ${remainder}`.trim();
            causePart = '';
        }

        // 2. N (일수) 추출
        let parsedDays = 0;
        const numDayMatch = remainder.match(/(\d+(\.\d+)?)\s*(?:데이|일)/i);
        const koreanDayMap: Record<string, number> = {
            '원': 1, '투': 2, '쓰리': 3, '포': 4, '파이브': 5,
            '식스': 6, '세븐': 7, '에잇': 8, '나인': 9, '텐': 10
        };
        const korDayMatch = remainder.match(/(원|투|쓰리|포|파이브|식스|세븐|에잇|나인|텐)\s*데이/i);

        if (numDayMatch) {
            parsedDays = Math.round(parseFloat(numDayMatch[1]));
        } else if (korDayMatch) {
            parsedDays = koreanDayMap[korDayMatch[1]] || 0;
        }

        // 일수 표현 및 기타 부가 표현 제거
        const dayPattern = /(\d+(\.\d+)?\s*(데이|일)|(원|투|쓰리|포|파이브|식스|세븐|에잇|나인|텐)\s*데이)/ig;
        let targetB = remainder.replace(dayPattern, '').replace(/사용/gi, '').replace(/,/gi, '').trim();

        // 3. (A) 원인 정규화
        let normalizedCause = '';
        if (causePart) {
            const causeLower = causePart.toLowerCase();
            if (/([월화수목금토일]요일\s*당직|[월화수목금토일]\s*당|당직근무|당직)/i.test(causePart)) {
                normalizedCause = '당직근무';
            } else if (causeLower.includes('dbids') || causePart.includes('디비즈')) {
                normalizedCause = 'KTA 업무';
            } else if (causeLower.includes('prt demo') || causeLower.includes('prtdemo') || (causeLower.includes('prt') && causeLower.includes('demo'))) {
                // PRT Demo 컴펜 사용한 건 (A)에 포함되어선 안 됨!
                const isPrtComp = causeLower.includes('컴펜') || causeLower.includes('compensation') || raw.toLowerCase().includes('컴펜') || raw.toLowerCase().includes('compensation');
                if (!isPrtComp) {
                    normalizedCause = 'MEDIC 업무';
                }
            } else {
                normalizedCause = causePart;
            }
        }

        // 4. (B) 외박 사유 정규화
        // targetB에서 당직 관련 키워드 제거 (단, staff duty는 컴펜 사유이므로 보존)
        targetB = targetB.replace(/([월화수목금토일]요일\s*당직|[월화수목금토일]\s*당|당직근무|당직)/gi, '').trim();
        targetB = targetB.replace(/staff\s*duty/gi, 'Staff Duty');

        if (isEnclosure) {
            targetB = targetB.replace(/수료/g, '').trim();
        }
        targetB = targetB.replace(/PRT\s*DEMO/gi, 'PRT Demo');

        // B가 일반 외박인지 판정
        const bLower = targetB.toLowerCase();
        const isPlainGeneral = targetB.length === 0 ||
            bLower === '일반' ||
            bLower === 'pass' ||
            bLower === '외박' ||
            bLower === '잔류' ||
            bLower === 'none' ||
            bLower === '미실시';

        let isComp = false;
        let normalizedReward = '';

        if (!isPlainGeneral) {
            // 기수 포맷 적용 (예: 01-27 수료 -> BLC 01-27기 / 01-27 Cycle)
            if (dbMember) {
                targetB = formatReasonWithBatchPrefix(targetB, dbMember, isEnclosure);
            }

            const rawLower = raw.toLowerCase();
            isComp = rawLower.includes('컴펜') ||
                rawLower.includes('compensation') ||
                rawLower.includes('staff duty') ||
                rawLower.includes('staffduty') ||
                rawLower.includes('생일') ||
                rawLower.includes('birthday') ||
                rawLower.includes('마일리지') ||
                rawLower.includes('표창') ||
                rawLower.includes('포상') ||
                /\d{1,2}-\d{1,2}/.test(raw) ||
                /demo/i.test(rawLower);

            if (isEnclosure || isVacation) {
                if (targetB === '생일') targetB = 'Birthday';
                normalizedReward = targetB;
            } else {
                // 출타 특이사항(외박): 보상외박 사유에는 무조건 '컴펜'을 뒤에 붙임
                normalizedReward = targetB;
                if (!normalizedReward.includes('컴펜') && !normalizedReward.toLowerCase().includes('compensation')) {
                    normalizedReward = `${normalizedReward} 컴펜`;
                }
            }
        }

        return {
            reductionCause: normalizedCause,
            rewardReason: normalizedReward,
            isPlainGeneral,
            isComp,
            parsedDays
        };
    };

    // Levenshtein distance for fuzzy matching typos in official holiday names
    const getLevenshteinDistance = (a: string, b: string): number => {
        if (a === b) return 0;
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix: number[][] = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    };

    // Check if user's entered reason matches the official holiday name (e.g. allowing 'Columbus' without 'Day', and minor typos)
    const checkMatchesOfficialHoliday = (userReason: string, holidayName: string): boolean => {
        if (!holidayName || !userReason) return false;
        const normUser = userReason.toLowerCase().replace(/[\s,._\-\/]+/g, '');
        const normHoliday = holidayName.toLowerCase().replace(/[\s,._\-\/]+/g, '');

        if (normUser.length === 0 || normHoliday.length === 0) return false;

        // 1. Exact or partial substring match
        if (normUser.includes(normHoliday)) return true;

        // 2. Core holiday name without 'Day', '포데이', '휴일' 등
        const cleanHolidayCore = holidayName.toLowerCase()
            .replace(/\bday\b/gi, '')
            .replace(/포데이|쓰리데이|투데이|원데이|4데이|3데이|2데이|1데이/g, '')
            .replace(/연휴|휴일|holiday/gi, '')
            .replace(/[\s,._\-\/]+/g, '')
            .trim();

        if (cleanHolidayCore.length >= 2 && normUser.includes(cleanHolidayCore)) {
            return true;
        }

        // 3. Token-based matching & fuzzy matching (e.g. 'Columbus' in 'Columbus Day')
        const tokens = holidayName.toLowerCase()
            .split(/[\s,._\-\/]+/)
            .map(t => t.replace(/day|포데이|쓰리데이|투데이|4데이|3데이|2데이|holiday/g, '').trim())
            .filter(t => t.length >= 3);

        for (const token of tokens) {
            if (normUser.includes(token)) return true;

            // Prefix matching (e.g. 'columb' for 'columbus')
            if (token.length >= 6) {
                const prefix = token.slice(0, token.length - 2);
                if (normUser.includes(prefix)) return true;
            }

            // Fuzzy typo matching on sub-windows of length token.length (+/- 1)
            if (token.length >= 4) {
                for (let i = 0; i <= normUser.length - token.length + 1; i++) {
                    const sub = normUser.slice(i, i + token.length);
                    if (getLevenshteinDistance(sub, token) <= 1) return true;
                }
                if (token.length >= 6) {
                    for (let i = 0; i <= normUser.length - token.length + 2; i++) {
                        const sub1 = normUser.slice(i, i + token.length - 1);
                        if (getLevenshteinDistance(sub1, token) <= 1) return true;
                        const sub2 = normUser.slice(i, i + token.length + 1);
                        if (getLevenshteinDistance(sub2, token) <= 1) return true;
                    }
                }
            }
        }

        return false;
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
    const findMatchingMovement = (memberMovements: any[], block: Date[], expectedType: 'pass' | 'vacation', allowGeneral: boolean = false) => {
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
            if (expectedType === 'pass' && !allowGeneral && parsePassReason(mov.reason).isPlainGeneral) return false;
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
            const passBlocks = getWeekendBlocks(member, ['pass', 'pass-depart', 'recovery-pass-depart', 'vacation-pass-depart'], ['duty', 'recovery']);
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
            const vacationBlocks = getWeekendBlocks(member, ['vacation', 'linked', 'vacation-pass-depart'], [], timeline);
            if (vacationBlocks.length > 0) {
                const processedVacationIds = new Set<string>();
                vacationBlocks.forEach(block => {
                    const vacationDays = block.filter(d => {
                        const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                        const status = member.dayStatuses[dStr] || '';
                        return status === 'vacation' || status === 'linked' || status === 'vacation-pass-depart';
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

            // 공식 휴일 정의 (캘린더 당직 모드 기준: 당직 휴일이 있다면 그것을 따르고, 그렇지 않다면 주말 일반 투데이)
            const isOfficialCustomHoliday = !!matchedHoliday;
            let holidayDays = 2;
            let holidayName = 'Weekend';
            const officialHolidayIsoDates: string[] = [];

            if (matchedHoliday) {
                const hStart = new Date(matchedHoliday.startDate);
                const hEnd = new Date(matchedHoliday.endDate || matchedHoliday.startDate);
                holidayDays = Math.max(1, Math.round((hEnd.getTime() - hStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
                holidayName = (matchedHoliday.memo || 'Holiday').trim();

                let curr = new Date(hStart);
                while (curr <= hEnd) {
                    const y = curr.getFullYear();
                    const m = String(curr.getMonth() + 1).padStart(2, '0');
                    const d = String(curr.getDate()).padStart(2, '0');
                    const iso = `${y}-${m}-${d}`;
                    if (coreIsoDates.includes(iso)) {
                        officialHolidayIsoDates.push(iso);
                    }
                    curr.setDate(curr.getDate() + 1);
                }
            } else {
                // 당직 휴일이 없는 경우: 주말(토, 일)이 공식 휴일 (일반 투데이)
                coreTimeline.forEach((dateStr: string) => {
                    const [m, d] = dateStr.split('.').map(Number);
                    const dt = new Date(yearVal, m - 1, d);
                    if (dt.getDay() === 0 || dt.getDay() === 6) { // 토(6), 일(0)
                        const iso = `${yearVal}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        officialHolidayIsoDates.push(iso);
                    }
                });
                holidayDays = 2;
                holidayName = '일반';
            }

            // 공식 휴일/주말 날짜 집합 (Date 객체)
            const weekendDates: Date[] = officialHolidayIsoDates.map(iso => {
                const [y, m, d] = iso.split('-').map(Number);
                return new Date(y, m - 1, d, 12, 0, 0, 0);
            });

            // 해당 주말이 KTA 기수 기간에 포함되는지 확인
            const isWeekendInKtaBatch = (): boolean => {
                if (officialHolidayIsoDates.some(iso => isDateDuringKtaPeriod(iso, dutySchedules))) return true;

                const ktaDay0Events = dutySchedules.filter(s => s.type === 'kta' && s.memo && s.memo.includes('Day 0'));
                if (ktaDay0Events.some(b => {
                    const start = new Date(b.startDate + (b.startDate.includes('T') ? '' : 'T00:00:00'));
                    start.setHours(0, 0, 0, 0);
                    // KTA 기수는 통상 Day 0부터 21일 (Day 20 수료)
                    const end = b.endDate ? new Date(b.endDate + (b.endDate.includes('T') ? '' : 'T00:00:00')) : new Date(start.getTime() + 21 * 24 * 60 * 60 * 1000);
                    end.setHours(23, 59, 59, 999);
                    return weekendDates.some(w => w >= start && w <= end);
                })) return true;

                return weekendDates.some(w => {
                    const y = w.getFullYear();
                    const m = String(w.getMonth() + 1).padStart(2, '0');
                    const d = String(w.getDate()).padStart(2, '0');
                    return isDateDuringKtaPeriod(`${y}-${m}-${d}`, dutySchedules);
                });
            };

            // 해당 주말이 BLC 기수 기간에 포함되는지 확인
            const isWeekendInBlcBatch = (): boolean => {
                if (officialHolidayIsoDates.some(iso => isDateDuringBlcPeriod(iso, dutySchedules))) return true;

                const blcDay0Events = dutySchedules.filter(s => s.type === 'blc' && s.memo && s.memo.includes('Day 0'));
                if (blcDay0Events.some(b => {
                    const start = new Date(b.startDate + (b.startDate.includes('T') ? '' : 'T00:00:00'));
                    start.setHours(0, 0, 0, 0);
                    // BLC 기수는 통상 Day 0부터 26일 이상
                    const end = b.endDate ? new Date(b.endDate + (b.endDate.includes('T') ? '' : 'T00:00:00')) : new Date(start.getTime() + 26 * 24 * 60 * 60 * 1000);
                    end.setHours(23, 59, 59, 999);
                    return weekendDates.some(w => w >= start && w <= end);
                })) return true;

                return weekendDates.some(w => {
                    const y = w.getFullYear();
                    const m = String(w.getMonth() + 1).padStart(2, '0');
                    const d = String(w.getDate()).padStart(2, '0');
                    return isDateDuringBlcPeriod(`${y}-${m}-${d}`, dutySchedules);
                });
            };

            const inKtaBatch = isWeekendInKtaBatch();
            const inBlcBatch = isWeekendInBlcBatch();

            const getKtaBatchNumber = (): string => {
                const ktaDay0s = dutySchedules.filter(s => s.type === 'kta' && s.memo && s.memo.includes('Day 0'));
                const ktaGrads = dutySchedules.filter(s => s.type === 'kta' && (
                    s.memo?.includes('Graduation') || s.memo?.includes('수료') || s.memo?.includes('🎓')
                ));
                const targetDates = officialHolidayIsoDates.length > 0 ? officialHolidayIsoDates : coreIsoDates;

                for (const day0 of ktaDay0s) {
                    const eventsForThisDay0 = [day0, ...ktaGrads.filter(g => !day0.batch || !g.batch || g.batch === day0.batch)];
                    const isMatched = targetDates.some((ds: string) => isDateDuringKtaPeriod(ds, eventsForThisDay0));
                    if (isMatched) {
                        if (day0.batch) return day0.batch;
                        const m = (day0.memo || '').match(/(\d{1,2}-\d{1,2})/);
                        if (m) return m[1];
                    }
                }
                return '';
            };

            const getBlcBatchNumber = (): string => {
                const blcDay0s = dutySchedules.filter(s => s.type === 'blc' && s.memo && s.memo.includes('Day 0'));
                const holidays = dutySchedules.filter(s => s.type === 'holiday');
                const targetDates = officialHolidayIsoDates.length > 0 ? officialHolidayIsoDates : coreIsoDates;

                for (const day0 of blcDay0s) {
                    const eventsForThisDay0 = [day0, ...holidays];
                    const isMatched = targetDates.some((ds: string) => isDateDuringBlcPeriod(ds, eventsForThisDay0));
                    if (isMatched) {
                        if (day0.batch) return day0.batch;
                        const m = (day0.memo || '').match(/(\d{1,2}-\d{1,2})/);
                        if (m) return m[1];
                    }
                }
                return '';
            };

            let hasKtaCycleSupport = false;
            let hasBlcCycleSupport = false;

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

                // 멤버의 섹션 판별 (KTA, MEDIC, BLC)
                const memberSections: string[] = (dbMember?.sections || []).map((s: string) => s.trim().toUpperCase());
                const memberRole = (dbMember?.role || '').trim().toUpperCase();
                const isKtaMember = memberSections.includes('KTA') || memberRole.includes('KTA');
                const isMedicMember = memberSections.includes('MEDIC') || memberRole.includes('MEDIC');
                const isBlcMember = memberSections.includes('BLC') ||
                    memberSections.includes('S3') ||
                    memberSections.includes('S-3') ||
                    memberRole.includes('BLC') ||
                    memberRole.includes('S3');

                // 1. Process PASS blocks
                const passBlocks = getWeekendBlocks(member, ['pass', 'pass-depart', 'recovery-pass-depart', 'vacation-pass-depart']);
                const vacationBlocks = getWeekendBlocks(member, ['vacation', 'linked', 'vacation-pass-depart']);

                if (passBlocks.length > 0) {
                    const memberPassItems: { dateRangeKo: string; mov: any }[] = [];
                    const memberPassDates: string[] = [];
                    let firstReason = '';
                    let totalPassDaysSum = 0;
                    let actualPassDaysCount = 0;

                    passBlocks.forEach(block => {
                        const passDays = block.filter(d => {
                            const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                            const status = member.dayStatuses[dStr] || '';
                            return status !== 'pass-depart' && status !== 'recovery-pass-depart' && status !== 'vacation-pass-depart';
                        });

                        if (passDays.length > 0) {
                            actualPassDaysCount += passDays.length;
                            // remarks 판별을 위해 일반 외박(allowGeneral: true)도 매칭
                            let matchedMov = findMatchingMovement(memberMovements, passDays, 'pass', true);

                            // 매칭되지 않은 경우 coreTimeline과 겹치는 pass movement 탐색
                            if (!matchedMov) {
                                matchedMov = memberMovements.find(mov => mov.type === 'pass' && overlapsTimeline(mov, coreTimeline));
                            }

                            // DB movement 문서가 없더라도 시트에 passDays가 있으면 가상 mov 구성
                            if (!matchedMov) {
                                const firstD = passDays[0];
                                const lastD = passDays[passDays.length - 1];
                                const sIso = `${firstD.getFullYear()}-${String(firstD.getMonth() + 1).padStart(2, '0')}-${String(firstD.getDate()).padStart(2, '0')}`;
                                const eIso = `${lastD.getFullYear()}-${String(lastD.getMonth() + 1).padStart(2, '0')}-${String(lastD.getDate()).padStart(2, '0')}`;
                                matchedMov = {
                                    name: cleanName,
                                    type: 'pass',
                                    startDate: sIso,
                                    endDate: eIso,
                                    reason: '일반'
                                };
                            }

                            if (matchedMov && (isInCoreTimeline(matchedMov.startDate, coreTimeline) || overlapsTimeline(matchedMov, coreTimeline))) {
                                const movStart = new Date(matchedMov.startDate);
                                const movEnd = new Date(matchedMov.endDate);
                                const movDays = Math.round((movEnd.getTime() - movStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                                totalPassDaysSum += movDays;
                                if (!firstReason) firstReason = matchedMov.reason || '일반';
                                const dateRangeKo = formatRemarksDateRange(matchedMov, true);
                                memberPassItems.push({ dateRangeKo, mov: matchedMov });

                                let curr = new Date(movStart);
                                while (curr <= movEnd) {
                                    const y = curr.getFullYear();
                                    const m = String(curr.getMonth() + 1).padStart(2, '0');
                                    const d = String(curr.getDate()).padStart(2, '0');
                                    const iso = `${y}-${m}-${d}`;
                                    if (!memberPassDates.includes(iso)) {
                                        memberPassDates.push(iso);
                                    }
                                    curr.setDate(curr.getDate() + 1);
                                }
                            }
                        }
                    });

                    if (memberPassItems.length > 0) {
                        const reason = firstReason;
                        const parsedEnclosure = parsePassReason(reason, dbMember, true);
                        const parsedRemark = parsePassReason(reason, dbMember, false);
                        const rawReasonLower = (reason || '').toLowerCase();

                        // 당직으로 인한 축소 여부 확인 (Staff Duty는 보상외박 사유이므로 당직 축소 키워드에서 제외)
                        // 1) (A) 원인 또는 사유에 당직 관련 키워드가 있는 경우
                        // 2) 공식 휴일 기간 내에 당직(duty)이나 회복(recovery)이 있어 일수가 공식 휴일보다 줄어든 경우
                        const hasDutyKeyword = parsedRemark.reductionCause === '당직근무' ||
                            /([월화수목금토일]요일\s*당직|[월화수목금토일]\s*당|당직근무|당직)/i.test(reason);
                        const hasDutyInOfficialPeriod = officialHolidayIsoDates.some(iso => {
                            const [, m, d] = iso.split('-').map(Number);
                            const mD = `${m}.${d}`;
                            const st = member.dayStatuses[mD];
                            return st === 'duty' || st === 'recovery';
                        });

                        const isDutyReduced = (hasDutyKeyword || hasDutyInOfficialPeriod) &&
                            (totalPassDaysSum < holidayDays || (actualPassDaysCount > 0 && actualPassDaysCount < holidayDays));

                        const totalMovDays = isDutyReduced && actualPassDaysCount > 0 && actualPassDaysCount < totalPassDaysSum
                            ? actualPassDaysCount
                            : totalPassDaysSum;

                        // 포상외박(Enclosure) 목록 추가:
                        // (B)가 일반이 아닌 보상외박/컴펜 사유인 경우 Enclosure에 추가
                        if (parsedEnclosure.isComp || (!parsedEnclosure.isPlainGeneral && parsedEnclosure.rewardReason)) {
                            enclosureItems.push({
                                enlistmentDate,
                                koreanName: cleanName,
                                rankEnglish,
                                formattedName: formattedEnglishName,
                                count: totalMovDays,
                                typeStr: 'PASS',
                                reason: parsedEnclosure.rewardReason,
                                rawReason: reason,
                                dbMember
                            });
                        }

                        // 공식 휴일 3일 이상일 때 Enclosure 불릿 포인트 조건 판별:
                        if (matchedHoliday && holidayDays >= 3) {
                            // 1) 기수 중 일반 투데이를 사용한 경우
                            if (inKtaBatch && (isKtaMember || isMedicMember) && parsedRemark.isPlainGeneral) {
                                hasKtaCycleSupport = true;
                            }
                            if (inBlcBatch && isBlcMember && parsedRemark.isPlainGeneral) {
                                hasBlcCycleSupport = true;
                            }

                            // 2) (A)가 당직 관련 내용이 아닐 때, (A)에 DBIDS, 디비즈, PRT Demo 중 하나를 포함한다면:
                            // 기수 중(inKtaBatch) 공식 휴일 사유나 다른 보상외박 사유를 사용하지 않는 경우에만 KTA Cycle Support 추가
                            const isDutyCause = isDutyReduced || parsedRemark.reductionCause === '당직근무' || hasDutyKeyword;
                            
                            // 검수는 오직 (A) 원인 부분에서만 수행!
                            const causePartLower = (parsedRemark.reductionCause || '').toLowerCase();
                            const rawCausePart = reason.includes('로 인한') ? reason.split(/으로\s*인한|로\s*인한/)[0].toLowerCase() : '';
                            const hasSupportInA = !isDutyCause && (
                                /(dbids|디비즈|prt\s*demo|prtdemo|prt\s*데모)/i.test(causePartLower) ||
                                /(dbids|디비즈|prt\s*demo|prtdemo|prt\s*데모)/i.test(rawCausePart)
                            );

                            const isUsingOfficialHoliday = checkMatchesOfficialHoliday(rawReasonLower, holidayName);
                            const isUsingOtherComp = parsedRemark.isComp || parsedEnclosure.isComp;
                            const notUsingHolidayOrComp = !isUsingOfficialHoliday && !isUsingOtherComp && parsedRemark.isPlainGeneral;

                            if (inKtaBatch && hasSupportInA && notUsingHolidayOrComp) {
                                hasKtaCycleSupport = true;
                            }
                        }

                        // 1. 기간(날짜)이 공식 휴일과 완전히 동일한가?
                        const isDateRangeSame = (totalMovDays === holidayDays) &&
                            (officialHolidayIsoDates.length === memberPassDates.length) &&
                            officialHolidayIsoDates.every(d => memberPassDates.includes(d));

                        let shouldIncludeInRemarks = false;
                        let finalReasonStr = '';

                        // 특이사항 사유 구성: (A) 줄어드는 사유 + (B) 외박 사유(보상외박이면 컴펜)
                        const reasonParts: string[] = [];

                        // 1) (A) 기간 축소 원인
                        if (isDutyReduced || parsedRemark.reductionCause === '당직근무') {
                            reasonParts.push('당직근무');
                        } else if (parsedRemark.reductionCause) {
                            reasonParts.push(parsedRemark.reductionCause);
                        }

                        if (!isOfficialCustomHoliday) {
                            // [케이스 1] 공식 휴일이 일반 투데이인 주말
                            if (parsedRemark.isPlainGeneral) {
                                // 공식 휴일이 일반 투데이이면 기수 중 일반 투데이를 사용했더라도 {섹션} 업무 추가 필요 없음
                                if (reasonParts.length > 0) {
                                    finalReasonStr = `${attachKoreanRoParticle(reasonParts.join(', '))} ${totalMovDays} 데이`;
                                    shouldIncludeInRemarks = true;
                                } else if (!isDateRangeSame) {
                                    finalReasonStr = `${attachKoreanRoParticle('(사유 작성)')} 일반 ${totalMovDays} 데이`;
                                    shouldIncludeInRemarks = true;
                                } else {
                                    shouldIncludeInRemarks = false;
                                }
                            } else {
                                // (B)가 컴펜/보상외박 사유인 경우 (예: 'BLC 01-27기 컴펜', 'Staff Duty 컴펜')
                                if (parsedRemark.rewardReason) {
                                    reasonParts.push(parsedRemark.rewardReason);
                                }
                                finalReasonStr = `${attachKoreanRoParticle(reasonParts.join(', '))} ${totalMovDays} 데이`;
                                shouldIncludeInRemarks = true;
                            }
                        } else {
                            // [케이스 2] 공식 휴일이 3일 이상인 경우
                            const usedOfficialHolidayReason = checkMatchesOfficialHoliday(rawReasonLower, holidayName) && !parsedRemark.isComp;

                            if (usedOfficialHolidayReason) {
                                // 1. 공식 휴일 사유를 사용한 경우 (Day 제외 또는 오타 허용)
                                if (isDutyReduced) {
                                    finalReasonStr = `${attachKoreanRoParticle('당직근무')} ${totalMovDays} 데이`;
                                    shouldIncludeInRemarks = true;
                                } else if (!isDateRangeSame) {
                                    finalReasonStr = `${attachKoreanRoParticle(holidayName)} ${totalMovDays} 데이`;
                                    shouldIncludeInRemarks = true;
                                } else {
                                    // 정상 공식 휴일 출타 -> 제외
                                    shouldIncludeInRemarks = false;
                                }
                            } else if (parsedRemark.isPlainGeneral) {
                                // 2. 공식 사유를 적지 않고 사유 없는 '일반 투데이', 원데이 등을 적을 때에만 '__ 업무' 적용
                                if ((isKtaMember || isMedicMember) && inKtaBatch) {
                                    const secName = isMedicMember ? 'MEDIC' : 'KTA';
                                    reasonParts.push(`${secName} 업무`);
                                } else if (isBlcMember && inBlcBatch) {
                                    reasonParts.push('BLC 업무');
                                }

                                if (reasonParts.length > 0) {
                                    finalReasonStr = `${attachKoreanRoParticle(reasonParts.join(', '))} ${totalMovDays} 데이`;
                                } else {
                                    finalReasonStr = `${attachKoreanRoParticle('(사유 작성)')} 일반 ${totalMovDays} 데이`;
                                }
                                shouldIncludeInRemarks = true;
                            } else {
                                // 3. 공식 사유와 다른 사유(컴펜, 포상 등)를 적은 경우 -> (B) 사유(컴펜)를 사용!
                                if (parsedRemark.rewardReason) {
                                    reasonParts.push(parsedRemark.rewardReason);
                                }

                                if (reasonParts.length > 0) {
                                    finalReasonStr = `${attachKoreanRoParticle(reasonParts.join(', '))} ${totalMovDays} 데이`;
                                } else {
                                    finalReasonStr = `${attachKoreanRoParticle('(사유 작성)')} 일반 ${totalMovDays} 데이`;
                                }
                                shouldIncludeInRemarks = true;
                            }
                        }

                        if (shouldIncludeInRemarks) {
                            const combinedDateRangeKo = memberPassItems.map(p => p.dateRangeKo).join(', ');
                            remarksPassItems.push({
                                enlistmentDate,
                                koreanName: cleanName,
                                rankKo,
                                dateRangeKo: combinedDateRangeKo,
                                reason: finalReasonStr,
                                count: totalMovDays,
                                typeStr: 'PASS',
                                dbMember
                            });
                        }
                    }
                } else {
                    // [케이스 3] 외박(PASS)이 없는 인원 처리
                    // 공식 휴일 모든 날짜가 휴가(vacation/linked)인 경우에만 완전한 휴가자로 간주하여 외박(잔류) 목록에서 제외
                    const isAllOfficialDaysVacation = officialHolidayIsoDates.length > 0 &&
                        officialHolidayIsoDates.every(iso => {
                            const [, m, d] = iso.split('-').map(Number);
                            const mD = `${m}.${d}`;
                            const st = member.dayStatuses[mD];
                            return st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart';
                        });

                    // 해당 멤버의 이번 주말 movement에 혹시 컴펜이나 특정 사유(stay, pass, etc.)가 있는지 확인
                    const holidayEndIso = officialHolidayIsoDates[officialHolidayIsoDates.length - 1] || '';
                    const holidayStartIso = officialHolidayIsoDates[0] || '';
                    const relevantMov = memberMovements.find(mov => 
                        (mov.type === 'pass' || mov.type === 'stay') &&
                        (isInCoreTimeline(mov.startDate, coreTimeline) || (mov.startDate <= holidayEndIso && mov.endDate >= holidayStartIso))
                    ) || memberMovements.find(mov => 
                        isInCoreTimeline(mov.startDate, coreTimeline) || 
                        (mov.startDate <= holidayEndIso && mov.endDate >= holidayStartIso)
                    );
                    const rawReason = relevantMov?.reason || '';
                    const parsedRetention = parsePassReason(rawReason, dbMember, false);

                    // 공식 휴일 전체를 휴가로 나가지 않았거나(예: 주말 중 복귀/미출타), 외박 사유/타입이 명시적 잔류인 경우 잔류로 처리
                    const hasExplicitStay = (relevantMov?.type === 'stay') || rawReason.includes('잔류');

                    if (!isAllOfficialDaysVacation || hasExplicitStay) {
                        const hasDutyInOfficialPeriod = officialHolidayIsoDates.some(iso => {
                            const [, m, d] = iso.split('-').map(Number);
                            const mD = `${m}.${d}`;
                            const st = member.dayStatuses[mD];
                            return st === 'duty' || st === 'recovery';
                        });

                        let shouldIncludeRetention = false;
                        let retentionReasonStr = '';
                        const reasonParts: string[] = [];

                        if (hasDutyInOfficialPeriod || parsedRetention.reductionCause === '당직근무') {
                            reasonParts.push('당직근무');
                        } else if (parsedRetention.reductionCause) {
                            reasonParts.push(parsedRetention.reductionCause);
                        }

                        if (!isOfficialCustomHoliday) {
                            // 일반 투데이 주말에 잔류: 공식 휴일이 일반 투데이이면 {섹션} 업무 추가 필요 없음
                            if (parsedRetention.isPlainGeneral) {
                                if (reasonParts.length > 0) {
                                    retentionReasonStr = `${attachKoreanRoParticle(reasonParts.join(', '))} 잔류`;
                                } else {
                                    // 사유 없는 잔류 (기본 잔류)
                                    retentionReasonStr = '잔류';
                                }
                                shouldIncludeRetention = true;
                            } else {
                                if (parsedRetention.rewardReason) {
                                    reasonParts.push(parsedRetention.rewardReason);
                                }
                                if (reasonParts.length > 0) {
                                    retentionReasonStr = `${attachKoreanRoParticle(reasonParts.join(', '))} 잔류`;
                                } else {
                                    retentionReasonStr = '잔류';
                                }
                                shouldIncludeRetention = true;
                            }
                        } else {
                            // 공식 휴일 3일 이상 기간에 잔류
                            if (parsedRetention.isPlainGeneral) {
                                if ((isKtaMember || isMedicMember) && inKtaBatch) {
                                    const secName = isMedicMember ? 'MEDIC' : 'KTA';
                                    reasonParts.push(`${secName} 업무`);
                                } else if (isBlcMember && inBlcBatch) {
                                    reasonParts.push('BLC 업무');
                                }

                                if (reasonParts.length > 0) {
                                    retentionReasonStr = `${attachKoreanRoParticle(reasonParts.join(', '))} 잔류`;
                                } else {
                                    // 사유 없는 잔류 (기본 잔류)
                                    retentionReasonStr = '잔류';
                                }
                                shouldIncludeRetention = true;
                            } else {
                                if (parsedRetention.rewardReason) {
                                    reasonParts.push(parsedRetention.rewardReason);
                                }
                                if (reasonParts.length > 0) {
                                    retentionReasonStr = `${attachKoreanRoParticle(reasonParts.join(', '))} 잔류`;
                                } else {
                                    retentionReasonStr = '잔류';
                                }
                                shouldIncludeRetention = true;
                            }
                        }

                        if (shouldIncludeRetention) {
                            remarksPassItems.push({
                                enlistmentDate,
                                koreanName: cleanName,
                                rankKo,
                                dateRangeKo: '-',
                                reason: retentionReasonStr,
                                count: 0,
                                typeStr: 'PASS',
                                dbMember
                            });
                        }
                    }
                }

                // 2. Process VACATION blocks (only for remarks, excluded from enclosure)
                if (vacationBlocks.length > 0) {
                    const block = vacationBlocks[0];

                    // sheetWeeks를 활용하여 앞뒤 주차에 걸친 연속 휴가 전체 구간을 계산
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
                                const row = week.data.find((r: any) => {
                                    const c = r.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim();
                                    return c === cleanName;
                                });
                                if (row && row.dayStatuses) {
                                    const st = row.dayStatuses[dateStr];
                                    if (st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart') return true;
                                }
                            }
                        }
                        return false;
                    };

                    const matchedTimelineDates = timeline.filter((dStr: string) => {
                        const st = member.dayStatuses[dStr];
                        return st === 'vacation' || st === 'linked' || st === 'vacation-pass-depart';
                    });

                    let contiguousStartIso = '';
                    let contiguousEndIso = '';
                    let contiguousIsLinked = false;

                    if (matchedTimelineDates.length > 0) {
                        const [firstM, firstD] = matchedTimelineDates[0].split('.').map(Number);
                        const [lastM, lastD] = matchedTimelineDates[matchedTimelineDates.length - 1].split('.').map(Number);
                        let sObj = new Date(yearVal, firstM - 1, firstD, 12, 0, 0, 0);
                        let eObj = new Date(yearVal, lastM - 1, lastD, 12, 0, 0, 0);

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

                        contiguousStartIso = `${sObj.getFullYear()}-${String(sObj.getMonth() + 1).padStart(2, '0')}-${String(sObj.getDate()).padStart(2, '0')}`;
                        contiguousEndIso = `${eObj.getFullYear()}-${String(eObj.getMonth() + 1).padStart(2, '0')}-${String(eObj.getDate()).padStart(2, '0')}`;

                        const curD = new Date(sObj);
                        while (curD <= eObj) {
                            const dStr = `${curD.getMonth() + 1}.${curD.getDate()}`;
                            if (member.dayStatuses[dStr] === 'linked') {
                                contiguousIsLinked = true;
                                break;
                            }
                            if (sheetWeeks) {
                                for (const week of sheetWeeks) {
                                    if (week.data && Array.isArray(week.data)) {
                                        const row = week.data.find((r: any) => r.name.replace(/^(병장|상병|일병|이병)\s*/, '').trim() === cleanName);
                                        if (row?.dayStatuses?.[dStr] === 'linked') {
                                            contiguousIsLinked = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            if (contiguousIsLinked) break;
                            curD.setDate(curD.getDate() + 1);
                        }
                    }

                    let matchedMov = findMatchingMovement(memberMovements, block, 'vacation');
                    if (!matchedMov) {
                        matchedMov = memberMovements.find(mov => mov.type === 'vacation' && (
                            overlapsTimeline(mov, coreTimeline) ||
                            (contiguousStartIso && contiguousEndIso && mov.startDate <= contiguousEndIso && mov.endDate >= contiguousStartIso)
                        ));
                    }

                    // 해당 휴가가 coreTimeline 또는 공식 휴일 기간과 겹치는지 확인
                    const isRelevantVacation = matchedMov
                        ? (isInCoreTimeline(matchedMov.startDate, coreTimeline) || overlapsTimeline(matchedMov, coreTimeline) || (contiguousStartIso && contiguousEndIso))
                        : true;

                    if (isRelevantVacation) {
                        const reason = matchedMov?.reason || '';
                        
                        // 시작일과 종료일: matchedMov와 continuous 범위를 결합하여 온전한 전체 기간 사용
                        let finalStartIso = matchedMov?.startDate || contiguousStartIso;
                        let finalEndIso = matchedMov?.endDate || contiguousEndIso;

                        if (contiguousStartIso && (!finalStartIso || contiguousStartIso < finalStartIso)) {
                            finalStartIso = contiguousStartIso;
                        }
                        if (contiguousEndIso && (!finalEndIso || contiguousEndIso > finalEndIso)) {
                            finalEndIso = contiguousEndIso;
                        }

                        if (!finalStartIso || !finalEndIso) {
                            const firstD = block[0];
                            const lastD = block[block.length - 1];
                            finalStartIso = `${firstD.getFullYear()}-${String(firstD.getMonth() + 1).padStart(2, '0')}-${String(firstD.getDate()).padStart(2, '0')}`;
                            finalEndIso = `${lastD.getFullYear()}-${String(lastD.getMonth() + 1).padStart(2, '0')}-${String(lastD.getDate()).padStart(2, '0')}`;
                        }

                        // 그 주에 해당하는 휴가만 특이사항에 적고, 다음주로 넘어가더라도 다음주 특이사항에는 적지 않음
                        // 즉, 휴가의 시작일(finalStartIso)이 현재 주차(coreIsoDates)에 속하는 경우에만 포함
                        const startsInCurrentWeek = coreIsoDates.length > 0 && finalStartIso >= coreIsoDates[0] && finalStartIso <= coreIsoDates[coreIsoDates.length - 1];

                        if (startsInCurrentWeek) {
                            const synthMov = { startDate: finalStartIso, endDate: finalEndIso, reason: reason || '연가' };
                            const dateRangeKo = formatRemarksDateRange(synthMov, false);

                            const movStart = new Date(finalStartIso);
                            const movEnd = new Date(finalEndIso);
                            const totalMovDays = Math.round((movEnd.getTime() - movStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

                            const isLinked = contiguousIsLinked || block.some(d => {
                                const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                                return member.dayStatuses[dStr] === 'linked';
                            });

                            const isVacPassLinked = block.some(d => {
                                const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                                return member.dayStatuses[dStr] === 'vacation-pass-depart';
                            }) || (() => {
                                const passMov = memberMovements.find(m => m.type === 'pass');
                                if (passMov && finalEndIso) {
                                    const pStart = new Date(passMov.startDate);
                                    pStart.setDate(pStart.getDate() - 1);
                                    const pDepartIso = `${pStart.getFullYear()}-${String(pStart.getMonth() + 1).padStart(2, '0')}-${String(pStart.getDate()).padStart(2, '0')}`;
                                    return finalEndIso === pDepartIso || finalEndIso === passMov.startDate;
                                }
                                return false;
                            })();

                            // 휴가 사유는 컴펜을 붙이지 않음 (isVacation = true)
                            const parsedVac = parsePassReason(reason, dbMember, false, true);
                            const vacationReason = parsedVac.rewardReason || (reason ? reason.trim() : '연가');

                            remarksVacationItems.push({
                                enlistmentDate,
                                koreanName: cleanName,
                                rankKo,
                                dateRangeKo,
                                reason: vacationReason,
                                count: totalMovDays,
                                typeStr: 'VACATION',
                                isLinked,
                                isVacPassLinked,
                                dbMember
                            });
                        }
                    }
                }
            });

            // 인원 탭과 동일한 정렬 기준(호봉/조진 높은 순 -> 입대일 빠른 순 -> 이름 가나다 순)으로 정렬
            const sortItems = (items: any[]) => {
                items.sort((a, b) => {
                    const memA = a.dbMember || dbMembers.find(m => m.name === a.koreanName) || { name: a.koreanName, enlistmentDate: a.enlistmentDate };
                    const memB = b.dbMember || dbMembers.find(m => m.name === b.koreanName) || { name: b.koreanName, enlistmentDate: b.enlistmentDate };
                    return compareMembersByHobong(memA, memB, baseDate || new Date());
                });
            };

            sortItems(enclosureItems);
            sortItems(remarksPassItems);
            sortItems(remarksVacationItems);

            let enclosureText = 'ENCLOSURE\n\n';
            let enclosureHtml = '<div style="font-family: Arial, \'Malgun Gothic\', \'맑은 고딕\', sans-serif; font-size: 12pt; line-height: 1.15; font-weight: normal;">ENCLOSURE</div><br>';

            if (matchedHoliday && holidayDays >= 3) {
                const ktaBatchNum = getKtaBatchNumber();
                const blcBatchNum = getBlcBatchNumber();
                const ktaSupportText = `KTA ${ktaBatchNum ? ktaBatchNum + ' ' : ''}Cycle Support`;
                const blcSupportText = `BLC ${blcBatchNum ? blcBatchNum + ' ' : ''}Cycle Support`;

                // 공식 휴일 사유와 다른 보상외박 사유를 사용하는 인원 필터링:
                // 1) 외박 사유가 공식 휴일과 같은 인원(Day 제외, 작은 오탈자 허용)은 넘버링 목록에서 제외
                // 2) 일반 외박 사유도 제외
                const otherCompItems = enclosureItems.filter(item => {
                    const rawLower = (item.rawReason || '').toLowerCase();
                    const reasonLower = (item.reason || '').toLowerCase();
                    if (reasonLower.includes('일반') || rawLower.includes('일반')) return false;
                    if (checkMatchesOfficialHoliday(rawLower, holidayName) || checkMatchesOfficialHoliday(reasonLower, holidayName)) {
                        return false;
                    }
                    return true;
                });

                enclosureText += `• All KATUSAs would be on the ${holidayName} ${holidayDays} DAY PASS and exceptions are due to:\n\t• Staff Duty\n`;
                if (hasKtaCycleSupport) {
                    enclosureText += `\t• ${ktaSupportText}\n`;
                }
                if (hasBlcCycleSupport) {
                    enclosureText += `\t• ${blcSupportText}\n`;
                }
                if (otherCompItems.length > 0) {
                    enclosureText += `\t• Personnel choosing to utilize their other compensation\n`;
                }

                enclosureHtml += `<ul style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 12pt; line-height: 1.15; font-weight: normal; width: 16.51cm; margin: 0; padding-left: 1.27cm; list-style-type: disc; mso-line-height-rule: exactly;">
  <li style="margin: 0; padding: 0; line-height: 1.15; mso-line-height-rule: exactly;">
    All KATUSAs would be on the ${holidayName} ${holidayDays} DAY PASS and exceptions are due to:
    <ul style="margin: 0; padding-left: 1.27cm; list-style-type: circle; line-height: 1.15; mso-line-height-rule: exactly;">
      <li style="margin: 0; padding: 0; line-height: 1.15; mso-line-height-rule: exactly;">Staff Duty</li>${hasKtaCycleSupport ? `\n      <li style="margin: 0; padding: 0; line-height: 1.15; mso-line-height-rule: exactly;">${ktaSupportText}</li>` : ''}${hasBlcCycleSupport ? `\n      <li style="margin: 0; padding: 0; line-height: 1.15; mso-line-height-rule: exactly;">${blcSupportText}</li>` : ''}${otherCompItems.length > 0 ? '\n      <li style="margin: 0; padding: 0; line-height: 1.15; mso-line-height-rule: exactly;">Personnel choosing to utilize their other compensation</li>' : ''}
    </ul>
  </li>
</ul>`;

                if (otherCompItems.length > 0) {
                    enclosureText += `\n`;
                    enclosureHtml += `<br><table style="border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 12pt; font-weight: normal; border: none; width: 16.51cm; line-height: 1.15; mso-line-height-rule: exactly;">`;

                    otherCompItems.forEach((item, index) => {
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

            const formatReasonStr = (reason: string, count: number, typeStr?: string, isLinked?: boolean, isVacPassLinked?: boolean) => {
                if (typeStr === 'VACATION') {
                    const linkStr = isLinked 
                        ? '외휴연계 O' 
                        : isVacPassLinked 
                            ? (allowVacationPassLink ? '휴외연계 O' : '휴외연계 X') 
                            : '외휴연계 X';
                    return `${reason} ${count}일 사용, ${linkStr}`;
                }
                let cleanReason = reason.trim();
                if (cleanReason.includes('으로 인한') || cleanReason.includes('로 인한')) {
                    return cleanReason;
                }
                if (cleanReason === '잔류') {
                    return '잔류';
                }
                if (cleanReason === '당직근무' || cleanReason.includes('당직근무')) {
                    return count === 0 ? `${attachKoreanRoParticle('당직근무')} 잔류` : `${attachKoreanRoParticle('당직근무')} ${count} 데이`;
                }
                if (cleanReason === '일반' || cleanReason.includes('일반')) {
                    return count === 0 ? `${attachKoreanRoParticle('(사유 작성)')} 일반 잔류` : `${attachKoreanRoParticle('(사유 작성)')} 일반 ${count} 데이`;
                }
                if (!cleanReason.includes('컴펜') && !cleanReason.toLowerCase().includes('compensation')) {
                    cleanReason = `${cleanReason} 컴펜`;
                }
                return count === 0 ? `${attachKoreanRoParticle(cleanReason)} 잔류` : `${attachKoreanRoParticle(cleanReason)} ${count} 데이`;
            };

            const formatRankName = (name: string, rank: string, isHtml: boolean) => {
                const clean = name.replace(/\s+/g, '');
                if (clean.length === 2) {
                    if (isHtml) {
                        return `<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; white-space: nowrap;">${clean}&emsp;&nbsp;${rank}</span>`;
                    }
                    return `${clean}　 ${rank}`;
                }
                if (isHtml) {
                    return `<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; white-space: nowrap;">${clean}&nbsp;&nbsp;${rank}</span>`;
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
                    remarksText += `${num}.\t${rankNameColon}\t${item.dateRangeKo.trim()}\t${reasonStr}\n`;
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
                    const reasonStr = formatReasonStr(item.reason, item.count, item.typeStr, item.isLinked, item.isVacPassLinked);
                    remarksText += `${num}.\t${rankNameColon}\t${item.dateRangeKo.trim()}\t${reasonStr}\n`;
                });
            }

            let remarksHtml = `<div style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; line-height: 1.15; font-weight: normal;">`;
            remarksHtml += `<p align="center" style="font-size: 12pt; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; text-align: center; font-weight: normal; margin: 0 0 12pt 0; width: 100%;">출타 특이사항 ${weekRangeStr}</p>`;
            remarksHtml += `<div style="font-size: 12pt; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; margin-bottom: 6pt;">외박</div>`;

            if (remarksPassItems.length === 0) {
                remarksHtml += `-&nbsp;&nbsp;&nbsp;&nbsp;<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal;">없음</span><br><br>`;
            } else {
                remarksHtml += `<table style="table-layout: fixed; border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; font-weight: normal; width: 16.51cm; border: none; margin-bottom: 12pt; line-height: 1.35; mso-line-height-rule: at-least;">`;
                remarksHtml += `<colgroup>`;
                remarksHtml += `<col style="width: 0.85cm;" width="32" />`;
                remarksHtml += `<col style="width: 2.85cm;" width="108" />`;
                remarksHtml += `<col style="width: 4.0cm;" width="151" />`;
                remarksHtml += `<col style="width: 8.81cm;" width="333" />`;
                remarksHtml += `</colgroup>`;
                remarksPassItems.forEach((item, index) => {
                    const num = index + 1;
                    const rankName = formatRankName(item.koreanName, item.rankKo, true);
                    const rankNameAndColon = `${rankName}:`;
                    const reasonStr = formatReasonStr(item.reason, item.count);

                    const dateDisplayHtml = item.dateRangeKo.trim().replace(/,\s*/g, ',<br>');

                    remarksHtml += `<tr style="border: none; vertical-align: top; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.35; mso-line-height-rule: at-least;">`;
                    remarksHtml += `<td width="32" style="width: 0.85cm; vertical-align: top; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 2.5pt 0; margin: 0; border: none; font-weight: normal; line-height: 1.35; white-space: nowrap;">${num}.</td>`;
                    remarksHtml += `<td width="108" style="width: 2.85cm; vertical-align: top; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 2.5pt 0; margin: 0; border: none; font-weight: normal; line-height: 1.35; white-space: nowrap;">${rankNameAndColon}</td>`;
                    remarksHtml += `<td width="151" style="width: 4.0cm; vertical-align: top; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 2.5pt 0; margin: 0; border: none; font-weight: normal; line-height: 1.35;">${dateDisplayHtml}</td>`;
                    remarksHtml += `<td width="333" style="width: 8.81cm; vertical-align: top; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 2.5pt 0; margin: 0; border: none; font-weight: normal; line-height: 1.35; word-break: keep-all;">${reasonStr}</td>`;
                    remarksHtml += `</tr>`;
                });
                remarksHtml += `</table><br>`;
            }

            remarksHtml += `<div style="font-size: 12pt; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; margin-bottom: 6pt;">휴가</div>`;
            if (remarksVacationItems.length === 0) {
                remarksHtml += `-&nbsp;&nbsp;&nbsp;&nbsp;<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal;">없음</span><br>`;
            } else {
                remarksHtml += `<table style="table-layout: fixed; border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; font-weight: normal; width: 16.51cm; border: none; line-height: 1.35; mso-line-height-rule: at-least;">`;
                remarksHtml += `<colgroup>`;
                remarksHtml += `<col style="width: 0.85cm;" width="32" />`;
                remarksHtml += `<col style="width: 2.85cm;" width="108" />`;
                remarksHtml += `<col style="width: 4.0cm;" width="151" />`;
                remarksHtml += `<col style="width: 8.81cm;" width="333" />`;
                remarksHtml += `</colgroup>`;
                remarksVacationItems.forEach((item, index) => {
                    const num = index + 1;
                    const rankName = formatRankName(item.koreanName, item.rankKo, true);
                    const rankNameAndColon = `${rankName}:`;
                    const reasonStr = formatReasonStr(item.reason, item.count, item.typeStr, item.isLinked, item.isVacPassLinked);
                    const vacDateDisplayHtml = item.dateRangeKo.trim().replace(/,\s*/g, ',<br>');

                    remarksHtml += `<tr style="border: none; vertical-align: top; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.35; mso-line-height-rule: at-least;">`;
                    remarksHtml += `<td width="32" style="width: 0.85cm; vertical-align: top; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 2.5pt 0; margin: 0; border: none; font-weight: normal; line-height: 1.35; white-space: nowrap;">${num}.</td>`;
                    remarksHtml += `<td width="108" style="width: 2.85cm; vertical-align: top; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 2.5pt 0; margin: 0; border: none; font-weight: normal; line-height: 1.35; white-space: nowrap;">${rankNameAndColon}</td>`;
                    remarksHtml += `<td width="151" style="width: 4.0cm; vertical-align: top; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 2.5pt 0; margin: 0; border: none; font-weight: normal; line-height: 1.35;">${vacDateDisplayHtml}</td>`;
                    remarksHtml += `<td width="333" style="width: 8.81cm; vertical-align: top; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 2.5pt 0; margin: 0; border: none; font-weight: normal; line-height: 1.35; word-break: keep-all;">${reasonStr}</td>`;
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
                allowVacationPassLink={allowVacationPassLink}
            />
        </div>
    );
}
