/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { MovementGrid } from './movement.grid.component';
import { MovementPreviewModal } from './movement.preview-modal.component';

interface MovementSheetViewProps {
    sheetWeeks: any[];
    currentWeekIndex: number;
    setCurrentWeekIndex: React.Dispatch<React.SetStateAction<number>>;
    dbMembers: any[];
    baseDate?: Date;
    movements: any[];
}

export function MovementSheetView({
    sheetWeeks,
    currentWeekIndex,
    setCurrentWeekIndex,
    dbMembers,
    baseDate,
    movements
}: MovementSheetViewProps) {
    const [previewData, setPreviewData] = useState<{ html: string; text: string; enclosure: string; enclosureHtml: string; remarks: string; remarksHtml: string } | null>(null);

    if (sheetWeeks.length === 0) return null;

    const currentWeek = sheetWeeks[currentWeekIndex];

    const handleCopyTable = async () => {
        try {
            const dataList = currentWeek.data || [];
            const timeline = currentWeek.timeline || [];

            // Sort logic matching MovementGrid
            const sortedEntries = [...dataList].sort((a, b) => {
                const cleanA = a.name.replace(/^(병장|상병|일병|이병)\s*/, '');
                const cleanB = b.name.replace(/^(병장|상병|일병|이병)\s*/, '');

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
                const cleanName = member.name.replace(/^(병장|상병|일병|이병)\s*/, '');
                const dbMember = dbMembers.find(m => m.name === cleanName);

                const englishName = dbMember?.englishName || cleanName;
                const phoneNumber = dbMember?.phoneNumber || '—';

                const rankMap: Record<string, string> = {
                    '병장': 'SGT', '상병': 'CPL', '일병': 'PFC', '이병': 'PV2',
                    'SGT': 'SGT', 'CPL': 'CPL', 'PFC': 'PFC', 'PV2': 'PV2', 'PVT': 'PVT'
                };
                const dbRankStr = dbMember?.rank || '';
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

                // Collect contiguous date blocks
                const activeDates = timeline.filter((dateStr: string) => {
                    const status = member.dayStatuses[dateStr] || 'none';
                    return ['pass', 'pass-depart', 'vacation', 'linked', 'recovery-pass-depart'].includes(status);
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
                            blocks.push(currentBlock);
                            currentBlock = [dateObj];
                        }
                    }
                });
                if (currentBlock.length > 0) {
                    blocks.push(currentBlock);
                }

                const remarksBlocks = blocks.filter(block => {
                    return block.some(d => {
                        const day = d.getDay();
                        return day === 0 || day === 6; // Sunday or Saturday
                    });
                });

                if (remarksBlocks.length === 0) return null;

                const remarks = remarksBlocks.slice(0, 1).map(block => {
                    const isVacation = block.some(d => {
                        const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                        const status = member.dayStatuses[dStr] || '';
                        return status === 'vacation' || status === 'linked';
                    });

                    // For PASS blocks, exclude departure days (pass-depart and recovery-pass-depart)
                    const finalBlock = isVacation
                        ? block
                        : block.filter(d => {
                            const dStr = `${d.getMonth() + 1}.${d.getDate()}`;
                            const status = member.dayStatuses[dStr] || '';
                            return status !== 'pass-depart' && status !== 'recovery-pass-depart';
                        });

                    if (finalBlock.length === 0) return null;

                    const count = finalBlock.length;
                    const start = finalBlock[0];
                    const end = finalBlock[finalBlock.length - 1];
                    const startStr = `${start.getMonth() + 1}.${start.getDate()}`;
                    const endStr = `${end.getMonth() + 1}.${end.getDate()}`;
                    const typeLabel = isVacation ? 'VACATION' : 'PASS';
                    if (count === 1) {
                        return `1 DAY ${typeLabel} (${startStr})`;
                    } else {
                        return `${count} DAY ${typeLabel} (${startStr}-${endStr})`;
                    }
                }).filter(Boolean).join(', ');

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

            finalRows.forEach((row) => {
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
                        html += `\n      <td style="border: 1px solid #000; width: 1.11cm; height: 0.53cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.subSec}</td>`;
                    } else {
                        html += `\n      <td colspan="2" rowspan="${span}" style="border: 1px solid #000; width: 2.22cm; font-weight: normal; vertical-align: middle; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.mainSec}</td>`;
                    }
                } else {
                    if (row.mainSec === 'HQ') {
                        html += `\n      <td style="border: 1px solid #000; width: 1.11cm; height: 0.53cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;">${row.subSec}</td>`;
                    }
                }
                spanRemaining--;

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

            // Generate Enclosure content (Sorted by Seniority / 짬순)
            const enclosureItems: any[] = [];

            finalRows.forEach((row) => {
                // If this row has no remarks, it doesn't belong in Enclosure
                if (!row.remarks || row.remarks === '—') return;

                // Enclosure is generated based on the EXACT same block selected for Remarks.
                // Remarks string format: "4 DAY PASS (6.19-6.22), 2 DAY VACATION (6.20-6.21)" etc.
                // We parse the very first block as it represents the main/only eligible weekend-containing block.
                const firstPart = row.remarks.split(',')[0].trim(); // e.g., "4 DAY PASS (6.19-6.22)"
                const match = firstPart.match(/^(\d+)\s+DAY\s+(PASS|VACATION)\s*\(([^)]+)\)$/i);
                if (!match) return;

                const count = parseInt(match[1], 10);
                const typeStr = match[2].toUpperCase(); // PASS or VACATION
                const dateRangeStr = match[3]; // e.g., "6.19-6.22" or "6.19"

                // Find corresponding movement to get the reason
                const memberMovements = movements.filter(mov => mov.name === row.koreanName);

                // Find a matching movement that overlaps with the dates in this remarks block
                let reason = '';
                let matchedMov = memberMovements.find(mov => {
                    const reasonLower = (mov.reason || '').trim().toLowerCase();
                    const isExcluded = !mov.reason ||
                        reasonLower === '' ||
                        reasonLower.includes('일반 투데이') ||
                        reasonLower.includes('일반투데이') ||
                        reasonLower.includes('원데이') ||
                        reasonLower.includes('잔류');
                    if (isExcluded) return false;

                    // Check if this movement overlaps with the dates of the remarks block
                    // dateRangeStr can be "6.19-6.22" or "6.19"
                    const parts = dateRangeStr.split('-');
                    const startStr = parts[0];
                    const endStr = parts[1] || parts[0];

                    // Determine year dynamically from baseDate
                    const yearVal = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

                    const [sm, sd] = startStr.split('.').map(Number);
                    const [em, ed] = endStr.split('.').map(Number);

                    const blockStartIso = `${yearVal}-${String(sm).padStart(2, '0')}-${String(sd).padStart(2, '0')}`;
                    const blockEndIso = `${yearVal}-${String(em).padStart(2, '0')}-${String(ed).padStart(2, '0')}`;

                    // Overlap check
                    return (mov.startDate <= blockEndIso && mov.endDate >= blockStartIso);
                });

                if (matchedMov) {
                    reason = matchedMov.reason;
                }

                // If no eligible reason is found, exclude from Enclosure (since reasons like "일반 투데이", "잔류" are excluded)
                if (!reason) return;

                // Format English name to Title Case
                const formattedName = row.englishName.toLowerCase().replace(/\b[a-z]/g, (letter: string) => letter.toUpperCase());

                enclosureItems.push({
                    enlistmentDate: row.dbMember?.enlistmentDate || '9999-12-31',
                    koreanName: row.koreanName,
                    rankEnglish: row.rankEnglish,
                    formattedName,
                    count,
                    typeStr,
                    reason
                });
            });
            // Sort strictly by enlistmentDate ascending (Seniority: earliest enlistment date first)
            // If enlistmentDate is identical, sort alphabetically by koreanName (가나다 순)
            enclosureItems.sort((a, b) => {
                if (a.enlistmentDate !== b.enlistmentDate) {
                    return a.enlistmentDate.localeCompare(b.enlistmentDate);
                }
                return a.koreanName.localeCompare(b.koreanName, 'ko');
            });

            let enclosureText = 'ENCLOSURE\n\n';
            let enclosureHtml = '<div style="font-family: Arial, \'Malgun Gothic\', \'맑은 고딕\', sans-serif; font-size: 12pt; line-height: 1.15; font-weight: normal;">ENCLOSURE</div><br>';

            if (enclosureItems.length === 0) {
                enclosureText = 'ENCLOSURE\n\n(No eligible items)';
                enclosureHtml += '<div style="font-family: Arial, \'Malgun Gothic\', \'맑은 고딕\', sans-serif; font-size: 12pt; line-height: 1.15; font-weight: normal;">(No eligible items)</div>';
            } else {
                enclosureHtml += `<table style="border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 12pt; font-weight: normal; border: none; width: 16.51cm; line-height: 1.15; mso-line-height-rule: exactly;">`;
                enclosureItems.forEach((item, index) => {
                    const num = index + 1;
                    enclosureText += `${num}.\t${item.rankEnglish} ${item.formattedName} will receive a ${item.count} DAY ${item.typeStr} by using the ${item.reason} compensation.\n`;
                    enclosureHtml += `<tr style="vertical-align: top; border: none; line-height: 1.15; mso-line-height-rule: exactly;">`;
                    enclosureHtml += `<td style="width: 1.05cm; text-align: right; padding: 0 0.2cm 0 0; margin: 0; border: none; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.15; mso-line-height-rule: exactly;">${num}.</td>`;
                    enclosureHtml += `<td style="width: 15.46cm; text-align: left; padding: 0; margin: 0; border: none; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.15; mso-line-height-rule: exactly;">${item.rankEnglish} ${item.formattedName} will receive a ${item.count} DAY ${item.typeStr} by using the ${item.reason} compensation.</td>`;
                    enclosureHtml += `</tr>`;
                });
                enclosureHtml += `</table>`;
            }

            // Generate '출타 특이사항' (remarks) content
            // Group by Pass vs Vacation
            const remarksPassItems: any[] = [];
            const remarksVacationItems: any[] = [];

            // Track all dates in remarks to calculate overall min/max bounds for the title
            const allRemarksDates: Date[] = [];
            const yearVal = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

            enclosureItems.forEach(item => {
                // Determine raw Korean rank from rankEnglish or dbMember
                // e.g. SGT = 병장, CPL = 상병, PFC = 일병, PV2 = 이병, PVT = 이병
                const rankMapKo: Record<string, string> = {
                    'SGT': '병장', 'CPL': '상병', 'PFC': '일병', 'PV2': '이병', 'PVT': '이병'
                };
                const rankKo = rankMapKo[item.rankEnglish] || '일병';

                // Retrieve original date range string from row.remarks
                const matchedRow = finalRows.find(r => r.koreanName === item.koreanName);
                let dateRangeStr = '';
                if (matchedRow && matchedRow.remarks) {
                    const firstPart = matchedRow.remarks.split(',')[0].trim();
                    const dateMatch = firstPart.match(/\(([^)]+)\)/);
                    if (dateMatch) {
                        dateRangeStr = dateMatch[1]; // e.g. "6.25-6.29"
                    }
                }

                // Format dateRangeStr to Korean style: "6.25(목)~6.29(월)"
                let formattedDateRange = '';
                if (dateRangeStr) {
                    const parts = dateRangeStr.split('-');
                    const startStr = parts[0];
                    const endStr = parts[1] || parts[0];

                    const [sm, sd] = startStr.split('.').map(Number);
                    const [em, ed] = endStr.split('.').map(Number);

                    let startD = new Date(yearVal, sm - 1, sd);
                    const endD = new Date(yearVal, em - 1, ed);

                    // For PASS items, the departure date is 1 day before the pass starts.
                    // Include the departure date in the range.
                    if (item.typeStr === 'PASS') {
                        startD.setDate(startD.getDate() - 1);
                    }

                    allRemarksDates.push(new Date(startD));
                    allRemarksDates.push(new Date(endD));

                    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                    const startDayKo = dayNames[startD.getDay()];
                    const endDayKo = dayNames[endD.getDay()];

                    const correctedSm = startD.getMonth() + 1;
                    const correctedSd = startD.getDate();

                    if (parts[1] || item.typeStr === 'PASS') {
                        formattedDateRange = `${correctedSm}/${correctedSd}(${startDayKo})~${em}/${ed}(${endDayKo})`;
                    } else {
                        formattedDateRange = `${correctedSm}/${correctedSd}(${startDayKo})`;
                    }
                }

                const remarksItem = {
                    koreanName: item.koreanName,
                    rankKo,
                    dateRangeKo: formattedDateRange,
                    reason: item.reason,
                    count: item.count,
                    typeStr: item.typeStr // PASS or VACATION
                };

                if (item.typeStr === 'PASS') {
                    remarksPassItems.push(remarksItem);
                } else {
                    remarksVacationItems.push(remarksItem);
                }
            });

            // Calculate overall min/max date range of remarks list
            let weekRangeStr = `(${currentWeek.startDate.replace('.', '/')}-${currentWeek.endDate.replace('.', '/')})`;
            if (allRemarksDates.length > 0) {
                const minDate = new Date(Math.min(...allRemarksDates.map(d => d.getTime())));
                const maxDate = new Date(Math.max(...allRemarksDates.map(d => d.getTime())));
                weekRangeStr = `(${minDate.getMonth() + 1}/${minDate.getDate()}~${maxDate.getMonth() + 1}/${maxDate.getDate()})`;
            }

            // Helper to format reason string to: "(사유) 컴펜으로 인한 N 데이"
            const formatReasonStr = (reason: string, count: number) => {
                let cleanReason = reason.trim();
                if (!cleanReason.includes('컴펜') && !cleanReason.toLowerCase().includes('compensation')) {
                    cleanReason = `${cleanReason} 컴펜`;
                }
                return `${cleanReason}으로 인한 ${count} 데이`;
            };

            // Helper to format name and rank: "강동민 병장" (length 3), "강건   상병" (length 2) to align ranks vertically
            const formatRankName = (name: string, rank: string, isHtml: boolean) => {
                const clean = name.replace(/\s+/g, '');
                if (clean.length === 2) {
                    // 2-letter name: add extra spacing to push rank to match 3-letter name alignment
                    return isHtml ? `${clean}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${rank}` : `${clean}   ${rank}`;
                }
                // 3-letter (or more) name: 1 space gap
                return isHtml ? `${clean}&nbsp;&nbsp;${rank}` : `${clean} ${rank}`;
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
                    const rankNameColon = `${rankName}:`; // Colon right after rank
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
                    const rankNameColon = `${rankName}:`; // Colon right after rank
                    const reasonStr = formatReasonStr(item.reason, item.count);
                    remarksText += `${num}.\t${rankNameColon}\t ${item.dateRangeKo}\t${reasonStr}\n`;
                });
            }

            // Format HTML Remarks (Arial, Titles 12pt, items 11pt) using an HTML Table for Word Copy-Paste Compatibility
            // Columns align with the requested layout:
            // Total Table Width: 16.51cm
            // Col 1: Index (width 1.05cm)
            // Col 2: Name & Rank with colon (width 2.59cm)
            // Col 3: Date range (width 4.16cm)
            // Col 4: Reason (width 8.71cm)
            // All cells height: 0.53cm
            let remarksHtml = `<div style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; line-height: 1.15; font-weight: normal;">`;
            remarksHtml += `<p align="center" style="font-size: 12pt; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; text-align: center; font-weight: normal; margin: 0 0 12pt 0; width: 100%;">출타 특이사항 ${weekRangeStr}</p>`;
            remarksHtml += `<div style="font-size: 12pt; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; margin-bottom: 6pt;">외박</div>`;

            if (remarksPassItems.length === 0) {
                remarksHtml += `-&nbsp;&nbsp;&nbsp;&nbsp;<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal;">없음</span><br><br>`;
            } else {
                remarksHtml += `<table style="border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; font-weight: normal; width: 16.51cm; border: none; margin-bottom: 12pt; line-height: 1.0; mso-line-height-rule: exactly;">`;
                remarksPassItems.forEach((item, index) => {
                    const num = index + 1;
                    const rankName = formatRankName(item.koreanName, item.rankKo, true);
                    const rankNameAndColon = `${rankName}:`;
                    const reasonStr = formatReasonStr(item.reason, item.count);

                    remarksHtml += `<tr style="height: 0.53cm; border: none; vertical-align: middle; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">`;
                    remarksHtml += `<td style="width: 1.05cm; height: 0.53cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">${num}.</td>`;
                    remarksHtml += `<td style="width: 2.59cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">${rankNameAndColon}</td>`;
                    remarksHtml += `<td style="width: 4.16cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">&nbsp;${item.dateRangeKo}</td>`;
                    remarksHtml += `<td style="width: 8.71cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">${reasonStr}</td>`;
                    remarksHtml += `</tr>`;
                });
                remarksHtml += `</table>`;
            }

            remarksHtml += `<div style="font-size: 12pt; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; margin-bottom: 6pt;">휴가</div>`;
            if (remarksVacationItems.length === 0) {
                remarksHtml += `-&nbsp;&nbsp;&nbsp;&nbsp;<span style="font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal;">없음</span><br>`;
            } else {
                remarksHtml += `<table style="border-collapse: collapse; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; font-weight: normal; width: 16.51cm; border: none; line-height: 1.0; mso-line-height-rule: exactly;">`;
                remarksVacationItems.forEach((item, index) => {
                    const num = index + 1;
                    const rankName = formatRankName(item.koreanName, item.rankKo, true);
                    const rankNameAndColon = `${rankName}:`;
                    const reasonStr = formatReasonStr(item.reason, item.count);

                    remarksHtml += `<tr style="height: 0.53cm; border: none; vertical-align: middle; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">`;
                    remarksHtml += `<td style="width: 1.05cm; height: 0.53cm; text-align: center; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">${num}.</td>`;
                    remarksHtml += `<td style="width: 2.59cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">${rankNameAndColon}</td>`;
                    remarksHtml += `<td style="width: 4.16cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">&nbsp;${item.dateRangeKo}</td>`;
                    remarksHtml += `<td style="width: 8.71cm; height: 0.53cm; text-align: left; font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif; padding: 0; margin: 0; border: none; font-weight: normal; line-height: 1.0; mso-line-height-rule: exactly;">${reasonStr}</td>`;
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
                dataList={currentWeek.data}
                dbMembers={dbMembers}
                baseDate={baseDate}
                movements={movements}
            />
        </div>
    );
}
