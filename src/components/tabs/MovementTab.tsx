/* eslint-disable @typescript-eslint/no-explicit-any */
// MovementTab for Special Leave (외특)
import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, CheckCircle2, AlertCircle, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import axios from 'axios';

export default function MovementTab() {
    const [fileName, setFileName] = useState<string | null>(null);
    const [parsedData, setParsedData] = useState<any[] | null>(null);

    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [ambiguousMembers, setAmbiguousMembers] = useState<any[] | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, string>>({});

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        setLoading(true);
        setError(null);
        setSuccess(null); // 기존 성공 메시지 초기화
        setParsedData(null); // 기존 분석 데이터 초기화
        setAmbiguousMembers(null);
        setResolutions({});

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const rawData = XLSX.utils.sheet_to_json(ws) as any[];

                const extractedData: any[] = [];
                let isCapturing = false;
                let isDutyCapturing = false;

                // 연도는 현재 시스템 연도 사용 (2026)
                const currentYear = new Date().getFullYear();

                for (let i = 0; i < rawData.length; i++) {
                    const content = String(rawData[i]['댓글 내용'] || '').trim();

                    // 1. 외박 특이사항 (ㅌㅇㅅㅎ) 시작 체크
                    if (content === 'ㅌㅇㅅㅎ') {
                        isCapturing = true;
                        isDutyCapturing = false;
                        continue;
                    }

                    // 2. 당직 시작 체크 (내용에 '당직' 포함)
                    if (content.includes('당직') && !content.startsWith('ㄴ')) {
                        isDutyCapturing = true;
                        isCapturing = false;
                        continue;
                    }

                    if (isCapturing) {
                        if (content.startsWith('ㄴ')) {
                            const lines = content.split('\n');
                            lines.forEach(line => {
                                const cleanLine = line.replace(/^ㄴ/, '').trim();

                                // 1. 관등성명 인식
                                const nameMatch = cleanLine.match(/^(병장|상병|일병|이병)\s+([가-힣]+)/);
                                if (nameMatch) {
                                    const rank = nameMatch[1];
                                    const name = nameMatch[2];

                                    // 2. + 기준 분리 (앞은 외박)
                                    const passPart = cleanLine.split('+')[0];

                                    // 3. 날짜 추출 로직 (기간 -> 단일 날짜 순서)
                                    const rangeRegex = /(\d{1,2})[./](\d{1,2})\s*~\s*(\d{1,2})[./](\d{1,2})/;
                                    const singleRegex = /(\d{1,2})[./](\d{1,2})/;

                                    const rangeMatch = passPart.match(rangeRegex);

                                    if (rangeMatch) {
                                        // 5. 날짜 범위인 경우 (5/23~5/25)
                                        const startM = parseInt(rangeMatch[1]);
                                        const startD = parseInt(rangeMatch[2]);
                                        const endM = parseInt(rangeMatch[3]);
                                        const endD = parseInt(rangeMatch[4]);

                                        const startDate = new Date(currentYear, startM - 1, startD);
                                        const endDate = new Date(currentYear, endM - 1, endD);
                                        const departDate = new Date(startDate);
                                        departDate.setDate(startDate.getDate() - 1);

                                        const passData = {
                                            name: `${rank} ${name}`,
                                            type: '외박',
                                            period: `${startM}.${startD}~${endM}.${endD}`,
                                            depart: `${departDate.getMonth() + 1}.${departDate.getDate()}`,
                                            return: `${endM}.${endD}`,
                                            stayDays: getDatesBetween(startDate, endDate, true)
                                        };

                                        // 7. 휴가 부분 처리 (+ 이후)
                                        const vacationPart = cleanLine.split('+')[1];
                                        if (vacationPart) {
                                            const vRangeMatch = vacationPart.match(rangeRegex);
                                            const vSingleMatch = vacationPart.match(singleRegex);

                                            if (vRangeMatch || vSingleMatch) {
                                                const vM1 = parseInt((vRangeMatch || vSingleMatch)![1]);
                                                const vD1 = parseInt((vRangeMatch || vSingleMatch)![2]);
                                                const vM2 = vRangeMatch ? parseInt(vRangeMatch[3]) : vM1;
                                                const vD2 = vRangeMatch ? parseInt(vRangeMatch[4]) : vD1;

                                                const vStartDate = new Date(currentYear, vM1 - 1, vD1);
                                                const vEndDate = new Date(currentYear, vM2 - 1, vD2);

                                                const vStartStr = `${vM1}.${vD1}`;
                                                const isLinked = vStartStr === passData.return;

                                                extractedData.push({
                                                    ...passData,
                                                    vacation: {
                                                        period: vRangeMatch ? `${vM1}.${vD1}~${vM2}.${vD2}` : `${vM1}.${vD1}`,
                                                        depart: vStartStr,
                                                        isLinked,
                                                        return: `${vM2}.${vD2}`,
                                                        stayDays: getDatesBetween(vStartDate, vEndDate, false)
                                                    }
                                                });
                                            } else {
                                                extractedData.push(passData);
                                            }
                                        } else {
                                            extractedData.push(passData);
                                        }
                                    } else {
                                        const singleMatch = passPart.match(singleRegex);
                                        if (singleMatch) {
                                            const m = parseInt(singleMatch[1]);
                                            const d = parseInt(singleMatch[2]);
                                            const endDate = new Date(currentYear, m - 1, d);
                                            const departDate = new Date(endDate);
                                            departDate.setDate(endDate.getDate() - 1);

                                            const isDayOff = passPart.match(/(원|투|쓰리|포|파이브)데이/);
                                            const hasStayKeyword = passPart.includes('잔류');

                                            // 단일 날짜인데 '잔류'가 있고 '데이' 표현이 없으면 잔류로 처리
                                            if (hasStayKeyword && !isDayOff) {
                                                extractedData.push({ name: `${rank} ${name}`, type: '잔류', detail: '당직/업무 등으로 인한 잔류' });
                                            } else {
                                                const passData = {
                                                    name: `${rank} ${name}`,
                                                    type: '외박',
                                                    period: `${m}.${d} (원데이)`,
                                                    depart: `${departDate.getMonth() + 1}.${departDate.getDate()}`,
                                                    return: `${m}.${d}`,
                                                    stayDays: []
                                                };

                                                // 단일 날짜 뒤에 휴가가 있는 경우 처리
                                                const vacationPart = cleanLine.split('+')[1];
                                                if (vacationPart) {
                                                    const vRangeMatch = vacationPart.match(rangeRegex);
                                                    const vSingleMatch = vacationPart.match(singleRegex);

                                                    if (vRangeMatch || vSingleMatch) {
                                                        const vM1 = parseInt((vRangeMatch || vSingleMatch)![1]);
                                                        const vD1 = parseInt((vRangeMatch || vSingleMatch)![2]);
                                                        const vM2 = vRangeMatch ? parseInt(vRangeMatch[3]) : vM1;
                                                        const vD2 = vRangeMatch ? parseInt(vRangeMatch[4]) : vD1;

                                                        const vStartDate = new Date(currentYear, vM1 - 1, vD1);
                                                        const vEndDate = new Date(currentYear, vM2 - 1, vD2);

                                                        const vStartStr = `${vM1}.${vD1}`;
                                                        const isLinked = vStartStr === passData.return;

                                                        extractedData.push({
                                                            ...passData,
                                                            vacation: {
                                                                period: vRangeMatch ? `${vM1}.${vD1}~${vM2}.${vD2}` : `${vM1}.${vD1}`,
                                                                depart: vStartStr,
                                                                isLinked,
                                                                return: `${vM2}.${vD2}`,
                                                                stayDays: getDatesBetween(vStartDate, vEndDate, false)
                                                            }
                                                        });
                                                    } else {
                                                        extractedData.push(passData);
                                                    }
                                                } else {
                                                    extractedData.push(passData);
                                                }
                                            }
                                        } else if (passPart.includes('잔류')) {
                                            // 날짜도 없고 '잔류'라는 단어가 있을 때만 잔류 처리
                                            extractedData.push({ name: `${rank} ${name}`, type: '잔류', detail: '잔류' });
                                        } else {
                                            extractedData.push({ name: `${rank} ${name}`, type: '잔류', detail: '날짜 데이터 없음' });
                                        }
                                    }
                                }
                            });
                        } else if (content !== '') {
                            isCapturing = false;
                        }
                    }

                    // 4. 당직 파싱 영역
                    if (isDutyCapturing) {
                        if (content.startsWith('ㄴ')) {
                            const cleanLine = content.replace(/^ㄴ/, '').trim();
                            // "ㄴ 상병 김대호, 5월 9일 (토) 당직입니다." 형식 파싱 (/, ., 월/일 모두 지원)
                            const dutyMatch = cleanLine.match(/^(병장|상병|일병|이병)\s+([가-힣]+)[,\s]+(\d{1,2})\s*[./월]\s*(\d{1,2})/);

                            if (dutyMatch) {
                                const rank = dutyMatch[1];
                                const name = dutyMatch[2];
                                const m = dutyMatch[3];
                                const d = dutyMatch[4];

                                extractedData.push({
                                    name: `${rank} ${name}`,
                                    type: '당직',
                                    date: `${m}.${d}`
                                });
                            }
                        } else if (content !== '') {
                            isDutyCapturing = false;
                        }
                    }
                }

                setParsedData(extractedData);
                setLoading(false);
            } catch (err) {
                console.error('Error parsing excel:', err);
                setError('파일을 읽는 중 오류가 발생했습니다.');
                setLoading(false);
            }
        };

        // 날짜 사이의 중간 날짜들 구하는 헬퍼 함수
        function getDatesBetween(start: Date, end: Date, includeStart: boolean = true) {
            const dates = [];
            const curr = new Date(start);
            if (!includeStart) {
                curr.setDate(curr.getDate() + 1);
            }

            while (curr < end) {
                dates.push(`${curr.getMonth() + 1}.${curr.getDate()}`);
                curr.setDate(curr.getDate() + 1);
            }
            return dates;
        }
        reader.onerror = () => {
            setError('파일 읽기 실패');
            setLoading(false);
        };
        reader.readAsBinaryString(file);

        // 입력창 초기화 (동일 파일 재업로드 가능하게 함)
        e.target.value = '';
    };

    const handleSync = async (resolvedData?: any[]) => {
        if (!parsedData && !resolvedData) return;
        if (!confirm('분석된 데이터를 스프레드시트에 반영할까요?')) return;

        setSyncing(true);
        setError(null);
        setSuccess(null);

        try {
            const isLocal = window.location.hostname === 'localhost';
            const baseUrl = isLocal
                ? 'http://127.0.0.1:5001/seniorkatusa-aa594/asia-northeast3'
                : 'https://asia-northeast3-seniorkatusa-aa594.cloudfunctions.net';

            // 해결된 데이터가 있으면 그것을 사용, 없으면 원본 파싱 데이터 사용
            const movementsToSync = (resolvedData || parsedData!).map(m => {
                // 이미 해결된 동명이인이라면 이름 교체
                const resolvedName = resolutions[m.name] || m.name;
                return { ...m, name: resolvedName };
            });

            const response = await axios.post(`${baseUrl}/syncMovementToSheet`, {
                movements: movementsToSync
            });

            if (response.data.status === "ambiguous") {
                setAmbiguousMembers(response.data.ambiguousMembers);
                setSyncing(false);
                return;
            }

            if (response.data.status === 'success') {
                setSuccess(`${response.data.count}개의 셀이 성공적으로 업데이트되었습니다!`);
                setAmbiguousMembers(null);
                setResolutions({});
            } else {
                throw new Error(response.data.message);
            }
        } catch (err: any) {
            console.error('Sync error:', err);
            setError(`동기화 실패: ${err.response?.data?.message || err.message}`);
        } finally {
            setSyncing(false);
        }
    };

    const copyToClipboard = () => {
        if (!parsedData) return;
        navigator.clipboard.writeText(JSON.stringify(parsedData, null, 2));
        alert('JSON 데이터가 클립보드에 복사되었습니다. Antigravity에게 붙여넣어 주세요!');
    };

    return (
        <div className="pt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            <header>
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">
                    외특 관리 <span className="text-blue-600 text-sm ml-2 font-bold bg-blue-50 px-2 py-1 rounded-lg">PC 전용</span>
                </h1>
                <p className="text-gray-500 font-medium mt-1">밴드에서 다운로드한 외박 특이사항(xlsx)을 업로드합니다.</p>
            </header>

            <div className="bg-white rounded-[2rem] border-2 border-dashed border-gray-200 p-10 flex flex-col items-center justify-center gap-4 transition-colors hover:border-blue-400 group relative overflow-hidden">
                <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform relative">
                    <Upload className="w-8 h-8 text-blue-600" />
                </div>
                <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">
                        {fileName || 'xlsx 파일을 여기에 드래그하거나 클릭하세요'}
                    </p>
                    <p className="text-sm text-gray-400 font-medium mt-1">
                        최대 용량 20MB (실제 파일은 약 20kb 내외)
                    </p>
                </div>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-10">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {error && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-600">
                    <AlertCircle className="w-5 h-5" />
                    <p className="font-bold">{error}</p>
                </div>
            )}

            {parsedData && (
                <div className="space-y-4 animate-in zoom-in-95 duration-300">
                    <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-center justify-between gap-3 text-green-700">
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="w-5 h-5" />
                            <p className="font-bold">분석 완료 ({parsedData.length}건)</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={copyToClipboard}
                                className="px-3 py-2 bg-white border border-green-200 text-green-700 rounded-xl font-bold text-xs active:scale-95 transition-all"
                            >
                                JSON 복사
                            </button>
                            <button
                                onClick={() => handleSync()}
                                disabled={syncing}
                                className="px-4 py-2 bg-green-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-green-200 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {syncing ? (
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <Send className="w-4 h-4" />
                                )}
                                시트 동기화
                            </button>
                        </div>
                    </div>

                    {success && (
                        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center gap-3 text-blue-600 animate-in slide-in-from-top-2">
                            <CheckCircle2 className="w-5 h-5" />
                            <p className="font-bold">{success}</p>
                        </div>
                    )}

                    <div className="grid gap-3">
                        {parsedData.map((item, idx) => (
                            <div key={idx} className="bg-white border-2 border-gray-100 rounded-2xl p-5 shadow-sm hover:border-blue-200 transition-colors">
                                <div className="flex items-start justify-between mb-3">
                                    <div>
                                        <span className="text-lg font-black text-gray-900">{item.name}</span>
                                        <span className={cn(
                                            "ml-2 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider",
                                            item.type === '외박' ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
                                        )}>
                                            {item.type}
                                        </span>
                                    </div>
                                    {item.period && (
                                        <span className="text-xs font-bold text-gray-400">{item.period}</span>
                                    )}
                                </div>

                                {item.type === '외박' ? (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="bg-blue-50/50 rounded-xl p-2 text-center border border-blue-100/50">
                                                <div className="text-[10px] font-bold text-blue-400 mb-0.5">외박출발</div>
                                                <div className="text-sm font-black text-blue-600">{item.depart}</div>
                                            </div>
                                            <div className="bg-indigo-50/50 rounded-xl p-2 text-center border border-indigo-100/50">
                                                <div className="text-[10px] font-bold text-indigo-400 mb-0.5">중간</div>
                                                <div className="text-xs font-black text-indigo-600 truncate">{item.stayDays.join(', ')}</div>
                                            </div>
                                            <div className="bg-purple-50/50 rounded-xl p-2 text-center border border-purple-100/50">
                                                <div className="text-[10px] font-bold text-purple-400 mb-0.5">외박복귀</div>
                                                <div className="text-sm font-black text-purple-600">{item.return}</div>
                                            </div>
                                        </div>

                                        {item.vacation && (
                                            <div className="bg-orange-50/30 border border-orange-100 rounded-xl p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[11px] font-black text-orange-600 uppercase tracking-wider">휴가 정보</span>
                                                    <span className="text-[10px] font-bold text-orange-400">{item.vacation.period}</span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div className="bg-orange-50 rounded-lg p-1.5 text-center">
                                                        <div className="text-[9px] font-bold text-orange-400">출발</div>
                                                        <div className={cn(
                                                            "text-xs font-black",
                                                            item.vacation.isLinked ? "text-red-500" : "text-orange-600"
                                                        )}>
                                                            {item.vacation.depart}
                                                            {item.vacation.isLinked && <span className="text-[8px] ml-0.5">(연계)</span>}
                                                        </div>
                                                    </div>
                                                    <div className="bg-orange-50 rounded-lg p-1.5 text-center">
                                                        <div className="text-[9px] font-bold text-orange-400">중간</div>
                                                        <div className="text-[10px] font-black text-orange-600 truncate">
                                                            {item.vacation.stayDays.join(', ')}
                                                        </div>
                                                    </div>
                                                    <div className="bg-orange-50 rounded-lg p-1.5 text-center">
                                                        <div className="text-[9px] font-bold text-orange-400">복귀</div>
                                                        <div className="text-xs font-black text-orange-600">{item.vacation.return}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : item.type === '당직' ? (
                                    <div className="bg-red-50/50 rounded-xl p-4 border border-red-100 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                            <span className="text-sm font-bold text-red-700">당직 근무</span>
                                        </div>
                                        <span className="text-sm font-black text-red-600">{item.date}</span>
                                    </div>
                                ) : (
                                    <div className="bg-gray-50 rounded-xl p-3 text-sm font-bold text-gray-500 text-center italic">
                                        해당 주차 열외 사항 없음 (잔류)
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <p className="text-xs text-center text-gray-400 font-medium pb-8">
                        이 데이터는 2026년 기준으로 계산되었습니다.
                        상태값이 정확한지 확인 후 알려주세요!
                    </p>
                </div>
            )}

            {/* 동명이인 해결 모달 */}
            {ambiguousMembers && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-6 text-white text-center">
                            <h3 className="text-xl font-black mb-1">동명이인 확인 필요</h3>
                            <p className="text-sm opacity-90 font-bold">엑셀의 이름과 일치하는 인원이 여러 명입니다.</p>
                        </div>
                        
                        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                            {ambiguousMembers.map((member, idx) => (
                                <div key={idx} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                                    <div className="text-sm font-black text-gray-400 mb-3 uppercase tracking-tighter">
                                        엑셀 표기: <span className="text-gray-800">{member.excelName}</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {member.options.map((option: string) => (
                                            <button
                                                key={option}
                                                onClick={() => setResolutions(prev => ({ ...prev, [member.excelName]: option }))}
                                                className={cn(
                                                    "p-3 rounded-xl text-sm font-black transition-all duration-200 border-2 text-left flex items-center justify-between",
                                                    resolutions[member.excelName] === option
                                                        ? "bg-orange-50 border-orange-500 text-orange-600 shadow-md scale-[1.02]"
                                                        : "bg-white border-gray-100 text-gray-500 hover:border-orange-200"
                                                )}
                                            >
                                                {option}
                                                {resolutions[member.excelName] === option && <CheckCircle2 className="w-4 h-4" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="p-6 bg-gray-50 flex gap-3 border-t border-gray-100">
                            <button
                                onClick={() => {
                                    setAmbiguousMembers(null);
                                    setResolutions({});
                                }}
                                className="flex-1 py-4 bg-white border border-gray-200 rounded-2xl text-gray-500 font-black hover:bg-gray-50 transition-colors"
                            >
                                취소
                            </button>
                            <button
                                onClick={() => handleSync()}
                                disabled={Object.keys(resolutions).length < ambiguousMembers.length}
                                className={cn(
                                    "flex-1 py-4 rounded-2xl font-black text-white transition-all shadow-lg shadow-orange-200",
                                    Object.keys(resolutions).length < ambiguousMembers.length
                                        ? "bg-gray-300 cursor-not-allowed"
                                        : "bg-orange-500 hover:bg-orange-600 active:scale-95"
                                )}
                            >
                                선택 완료 및 계속
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
