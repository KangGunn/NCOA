import { useState } from 'react';
import { Users, RefreshCw, Check, Info, Calendar } from 'lucide-react';
import type { CalendarMember } from '../../types/calendar/calendar.type';

interface DutySidebarProps {
    viewMode: 'actual' | 'kta-template' | 'blc-template';
    loading: boolean;
    members: CalendarMember[];
    dutyStats: Record<string, { total: number; weekday: number; friSun: number; sat: number }>;
    selectedMember: CalendarMember | null;
    setSelectedMember: (member: CalendarMember | null) => void;
    toggleMemberDutyCompleted: (e: React.MouseEvent, id: string, name: string, status: boolean) => void;
    restrictionBrush: 'kta' | 'medic' | 'personal' | 'blc' | 's3' | 'pao' | null;
    setRestrictionBrush: React.Dispatch<React.SetStateAction<'kta' | 'medic' | 'personal' | 'blc' | 's3' | 'pao' | null>>;
    ktaDayLabels: Record<number, string>;
    setKtaDayLabels: React.Dispatch<React.SetStateAction<Record<number, string>>>;
    blcDayLabels: Record<number, string>;
    setBlcDayLabels: React.Dispatch<React.SetStateAction<Record<number, string>>>;
    handleSaveTemplateSettings: () => void;
    handleSaveBlcTemplateSettings: () => void;
    showToast: (msg: string, type?: 'success' | 'error') => void;
    dutyHolidays: any[];
    handleAddDutyHoliday: (name: string, startDate: string, endDate: string) => Promise<void>;
    handleDeleteDutyHoliday: (id: string) => Promise<void>;
}

export function DutySidebar({
    viewMode, loading, members, dutyStats,
    selectedMember, setSelectedMember, toggleMemberDutyCompleted,
    restrictionBrush, setRestrictionBrush,
    ktaDayLabels, setKtaDayLabels,
    blcDayLabels, setBlcDayLabels,
    handleSaveTemplateSettings, handleSaveBlcTemplateSettings,
    showToast,
    dutyHolidays, handleAddDutyHoliday, handleDeleteDutyHoliday
}: DutySidebarProps) {
    const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
    if (viewMode === 'actual') {
        return (
            <aside className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col shrink-0 h-full overflow-hidden">
                <div className="p-6 border-b border-slate-800 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-base font-black tracking-wider text-slate-200">대원 명단 & 당직 통계</h2>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar bg-slate-900/20 min-h-0">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
                            <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
                            <span className="text-xs font-bold">대원 데이터 불러오는 중...</span>
                        </div>
                    ) : members.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-10 font-bold">등록된 부대원이 없습니다.</p>
                    ) : (
                        members.map((member: CalendarMember) => {
                            const isChosen = selectedMember?.id === member.id;
                            const stats = dutyStats[member.name] || { total: 0, weekday: 0, friSun: 0, sat: 0 };
                            const count = stats.total;
                            const isCompleted = !!member.dutyCompleted;
                            
                            let countBadgeColor = 'bg-slate-800 text-slate-400';
                            if (count >= 5) countBadgeColor = 'bg-rose-950 border border-rose-500/30 text-rose-300';
                            else if (count >= 3) countBadgeColor = 'bg-amber-950 border border-amber-500/30 text-amber-300';
                            else if (count > 0) countBadgeColor = 'bg-indigo-950 border border-indigo-500/30 text-indigo-300';

                            return (
                                <div
                                    key={member.id}
                                    onClick={() => {
                                        if (isCompleted) {
                                            showToast("당직 완료된 대원은 배정할 수 없습니다. (먼저 상태를 해제해주세요)", "error");
                                            return;
                                        }
                                        setSelectedMember(isChosen ? null : member);
                                    }}
                                    className={`w-full flex items-center justify-between p-3.5 rounded-2xl transition-all border text-left cursor-pointer group/member ${
                                        isCompleted
                                            ? 'bg-slate-950/20 border-slate-900/40 text-slate-550 opacity-60 hover:bg-slate-900/30'
                                            : isChosen 
                                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/15 scale-[1.02]' 
                                                : 'bg-slate-900/40 border-slate-850 text-slate-350 hover:bg-slate-800/60 hover:border-slate-800'
                                    }`}
                                >
                                    <div className="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className={`text-sm font-black tracking-tight truncate ${isCompleted ? 'line-through text-slate-500' : ''}`}>
                                                {member.name}
                                            </span>
                                            {isCompleted && (
                                                <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-900/45 text-emerald-400 text-[8px] font-black tracking-wide shrink-0">
                                                    ✅ 완료
                                                </span>
                                            )}
                                        </div>
                                        <span className={`text-[10px] font-bold truncate ${isChosen ? 'text-indigo-200' : 'text-slate-500'}`}>
                                            {member.rank}
                                        </span>
                                        
                                        <div className="flex items-center gap-1.5 mt-1 text-[8.5px] font-black tracking-tight shrink-0 select-none">
                                            <span className={`px-1 py-0.5 rounded ${
                                                isCompleted
                                                    ? 'bg-slate-950/40 text-slate-600 border border-slate-900/20'
                                                    : isChosen 
                                                        ? 'bg-indigo-950/40 text-indigo-200 border border-indigo-500/30' 
                                                        : 'bg-slate-950/50 text-slate-400 border border-slate-800/40'
                                            }`}>
                                                평 {stats.weekday}
                                            </span>
                                            <span className={`px-1 py-0.5 rounded ${
                                                isCompleted
                                                    ? 'bg-slate-950/40 text-slate-600 border border-slate-900/20'
                                                    : isChosen 
                                                        ? 'bg-indigo-950/40 text-indigo-200 border border-indigo-500/30' 
                                                        : 'bg-slate-950/50 text-slate-400 border border-slate-800/40'
                                            }`}>
                                                금일 {stats.friSun}
                                            </span>
                                            <span className={`px-1 py-0.5 rounded ${
                                                isCompleted
                                                    ? 'bg-slate-950/40 text-slate-600 border border-slate-900/20'
                                                    : isChosen 
                                                        ? 'bg-indigo-950/40 text-indigo-200 border border-indigo-500/30' 
                                                        : 'bg-slate-950/50 text-slate-400 border border-slate-800/40'
                                            }`}>
                                                토 {stats.sat}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <div className={`px-2 py-1 rounded-lg text-[10px] font-black shrink-0 ${
                                            isCompleted
                                                ? 'bg-slate-950/60 text-slate-500 border border-slate-900'
                                                : isChosen 
                                                    ? 'bg-indigo-750 text-indigo-100 border border-indigo-500/45' 
                                                    : countBadgeColor
                                        }`}>
                                            당직 {count}회
                                        </div>
                                        <button
                                            onClick={(e) => toggleMemberDutyCompleted(e, member.id, member.name, isCompleted)}
                                            className={`p-1.5 rounded-lg transition-all border ${
                                                isCompleted
                                                    ? 'bg-emerald-950/65 hover:bg-emerald-900 border-emerald-500/40 text-emerald-300'
                                                    : isChosen 
                                                        ? 'hover:bg-indigo-750 text-indigo-200 hover:text-white border-transparent' 
                                                        : 'hover:bg-slate-800 text-slate-550 hover:text-slate-200 border-transparent hover:border-slate-700'
                                            } ${isCompleted ? 'opacity-100' : 'opacity-0 group-hover/member:opacity-100'}`}
                                            title={isCompleted ? "당직 완료 상태 해제" : "당직 완료 대원으로 설정"}
                                        >
                                            <Check className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="p-4 border-t border-slate-850 bg-slate-900/40 shrink-0 flex gap-2">
                    <button
                        onClick={() => setIsHolidayModalOpen(true)}
                        className="flex-1 py-3 px-4 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-350 hover:text-slate-200 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 active:scale-[0.98] shadow-md cursor-pointer"
                    >
                        <Calendar className="w-4 h-4 text-indigo-400" />
                        <span>휴일 추가 / 관리</span>
                    </button>
                </div>

                {isHolidayModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="w-[450px] bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 relative text-left">
                            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                                <div className="flex items-center gap-2">
                                    <Calendar className="w-5 h-5 text-indigo-400" />
                                    <h3 className="text-sm font-black text-slate-200 tracking-wider">
                                        당직 휴일 추가 / 관리
                                    </h3>
                                </div>
                                <button 
                                    onClick={() => setIsHolidayModalOpen(false)}
                                    className="text-slate-500 hover:text-slate-350 text-xs font-black transition-colors px-2 py-1 hover:bg-slate-800 rounded-lg cursor-pointer"
                                >
                                    닫기
                                </button>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-slate-400 tracking-wider block">🎉 새 휴일 등록</label>
                                    <div className="flex flex-col gap-2.5">
                                        <input 
                                            type="text" 
                                            placeholder="휴일명 (예: 추석 연휴)"
                                            id="duty-holiday-name-modal"
                                            className="w-full py-2.5 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                                        />
                                        <div className="flex gap-2 w-full">
                                            <div className="flex-1 min-w-0">
                                                <span className="text-[10px] font-black text-slate-500 block mb-1">시작일</span>
                                                <input 
                                                    type="date" 
                                                    id="duty-holiday-start-modal"
                                                    className="w-full py-2 px-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-100 focus:outline-none focus:border-indigo-500"
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="text-[10px] font-black text-slate-500 block mb-1">종료일</span>
                                                <input 
                                                    type="date" 
                                                    id="duty-holiday-end-modal"
                                                    className="w-full py-2 px-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-100 focus:outline-none focus:border-indigo-500"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const nameInput = document.getElementById('duty-holiday-name-modal') as HTMLInputElement;
                                                const startInput = document.getElementById('duty-holiday-start-modal') as HTMLInputElement;
                                                const endInput = document.getElementById('duty-holiday-end-modal') as HTMLInputElement;
                                                
                                                const name = nameInput.value.trim();
                                                const start = startInput.value;
                                                const end = endInput.value;
                                                
                                                if (!name || !start || !end) {
                                                    showToast("휴일 이름과 기간을 빠짐없이 입력해주세요.", "error");
                                                    return;
                                                }
                                                if (end < start) {
                                                    showToast("종료일은 시작일보다 빠를 수 없습니다.", "error");
                                                    return;
                                                }
                                                
                                                await handleAddDutyHoliday(name, start, end);
                                                nameInput.value = '';
                                                startInput.value = '';
                                                endInput.value = '';
                                            }}
                                            className="w-full py-3 bg-indigo-600 hover:bg-indigo-550 active:scale-[0.98] text-white rounded-xl text-xs font-black transition-all cursor-pointer text-center shadow-lg shadow-indigo-500/15 mt-1"
                                        >
                                            휴일 추가
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2 pt-2 border-t border-slate-800/60">
                                    <label className="text-xs font-black text-slate-400 tracking-wider block">📋 등록된 당직 휴일 목록 ({dutyHolidays.length})</label>
                                    
                                    {dutyHolidays.length === 0 ? (
                                        <p className="text-[11px] text-slate-600 text-center py-6 font-bold">등록된 전용 휴일이 없습니다.</p>
                                    ) : (
                                        <div className="max-h-48 overflow-y-auto space-y-2 custom-scrollbar pr-1 w-full">
                                            {dutyHolidays.map((h: any) => (
                                                <div key={h.id} className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-850 w-full hover:border-slate-800 transition-colors">
                                                    <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                                                        <span className="text-[11px] font-black text-slate-300 truncate">{h.name}</span>
                                                        <span className="text-[9px] font-bold text-slate-500">{h.startDate} ~ {h.endDate}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDeleteDutyHoliday(h.id)}
                                                        className="text-[10px] font-black text-rose-500 hover:text-rose-400 px-2 py-1 bg-rose-950/20 hover:bg-rose-950/20 border border-rose-900/30 rounded-lg transition-all shrink-0 cursor-pointer"
                                                        title="휴일 삭제"
                                                    >
                                                        삭제
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {selectedMember && (
                    <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0 animate-in slide-in-from-bottom-6 duration-350">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-black text-indigo-300">브러시 활성화 중</span>
                            <span className="text-[11px] font-extrabold text-slate-400">{selectedMember.rank} {selectedMember.name}</span>
                        </div>
                        <button
                            onClick={() => setSelectedMember(null)}
                            className="px-3 py-1.5 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-[10px] font-black transition-all"
                        >
                            선택 해제
                        </button>
                    </div>
                )}
            </aside>
        );
    }

    if (viewMode === 'kta-template') {
        return (
            <aside className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col shrink-0 h-full overflow-hidden">
                <div className="flex-1 flex flex-col justify-between p-6 bg-slate-900/60 custom-scrollbar overflow-y-auto h-full">
                    <div className="space-y-6">
                        <div className="flex items-center gap-2 pb-4 border-b border-slate-800">
                            <Info className="w-5 h-5 text-rose-400" />
                            <h2 className="text-sm font-black tracking-wider text-slate-200 uppercase">KTA 템플릿 제어 센터</h2>
                        </div>

                        <div className="space-y-3.5">
                            <label className="text-xs font-black text-slate-400 tracking-wider block">🚫 당직 불가 배정 브러시</label>
                            <div className="flex flex-col gap-2.5">
                                <button
                                    onClick={() => setRestrictionBrush(prev => prev === 'kta' ? null : 'kta')}
                                    className={`w-full py-3.5 px-4 border rounded-2xl text-xs font-black transition-all flex items-center justify-between shadow-md active:scale-[0.98] ${
                                        restrictionBrush === 'kta' 
                                            ? 'bg-rose-900/50 border-rose-500 text-rose-200 ring-2 ring-rose-500/50 shadow-rose-950/40' 
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-rose-550 border border-rose-400 animate-pulse" />
                                        <span>🚫 KTA 불가</span>
                                    </div>
                                    {restrictionBrush === 'kta' ? (
                                        <span className="text-[9px] px-2 py-0.5 rounded bg-rose-500 text-white font-black animate-bounce">활성 중</span>
                                    ) : (
                                        <span className="text-[9px] text-slate-600">OFF</span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setRestrictionBrush(prev => prev === 'medic' ? null : 'medic')}
                                    className={`w-full py-3.5 px-4 border rounded-2xl text-xs font-black transition-all flex items-center justify-between shadow-md active:scale-[0.98] ${
                                        restrictionBrush === 'medic' 
                                            ? 'bg-amber-900/50 border-amber-500 text-amber-200 ring-2 ring-amber-500/50 shadow-amber-950/40' 
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-amber-550 border border-amber-400 animate-pulse" />
                                        <span>🚫 MEDIC 불가</span>
                                    </div>
                                    {restrictionBrush === 'medic' ? (
                                        <span className="text-[9px] px-2 py-0.5 rounded bg-amber-500 text-white font-black animate-bounce">활성 중</span>
                                    ) : (
                                        <span className="text-[9px] text-slate-600">OFF</span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setRestrictionBrush(prev => prev === 'pao' ? null : 'pao')}
                                    className={`w-full py-3.5 px-4 border rounded-2xl text-xs font-black transition-all flex items-center justify-between shadow-md active:scale-[0.98] ${
                                        restrictionBrush === 'pao' 
                                            ? 'bg-purple-900/50 border-purple-500 text-purple-200 ring-2 ring-purple-500/50 shadow-purple-950/40' 
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-purple-555 border border-purple-400 animate-pulse" />
                                        <span>🚫 PAO 불가</span>
                                    </div>
                                    {restrictionBrush === 'pao' ? (
                                        <span className="text-[9px] px-2 py-0.5 rounded bg-purple-500 text-white font-black animate-bounce">활성 중</span>
                                    ) : (
                                        <span className="text-[9px] text-slate-600">OFF</span>
                                    )}
                                </button>
                            </div>
                        </div>

                        <div className="p-4 bg-slate-950/40 border border-slate-850 rounded-2xl space-y-3 shrink-0">
                            <h4 className="text-[11px] font-black text-rose-450 tracking-wider flex items-center gap-1">🏷️ Day 커스텀 배지 라벨 설정</h4>
                            <div className="flex flex-col gap-2 w-full">
                                <div className="flex gap-1.5 w-full">
                                    <input 
                                        type="number" 
                                        placeholder="Day"
                                        id="kta-label-day"
                                        className="w-16 shrink-0 py-1.5 px-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-center font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500"
                                    />
                                    <input 
                                        type="text" 
                                        placeholder="예: 면담선발"
                                        id="kta-label-text"
                                        className="flex-1 min-w-0 py-1.5 px-2.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500"
                                    />
                                </div>
                                <button
                                    onClick={() => {
                                        const dayInput = document.getElementById('kta-label-day') as HTMLInputElement;
                                        const textInput = document.getElementById('kta-label-text') as HTMLInputElement;
                                        const dayNum = parseInt(dayInput.value, 10);
                                        const txt = textInput.value.trim();
                                        if (isNaN(dayNum) || !txt) {
                                            showToast("Day 번호와 배지 텍스트를 정확히 입력해주세요.", "error");
                                            return;
                                        }
                                        setKtaDayLabels(prev => ({ ...prev, [dayNum]: txt }));
                                        dayInput.value = '';
                                        textInput.value = '';
                                        showToast(`Day ${dayNum}에 '${txt}' 라벨을 임시 등록했습니다.`);
                                    }}
                                    className="w-full py-1.5 bg-rose-600 hover:bg-rose-550 active:scale-95 text-white rounded-lg text-xs font-black transition-all cursor-pointer text-center"
                                >
                                    추가
                                </button>
                            </div>
                            
                            {Object.keys(ktaDayLabels).length > 0 && (
                                <div className="space-y-1.5 max-h-[500px] overflow-y-auto custom-scrollbar pt-2 border-t border-slate-800/40">
                                    {Object.entries(ktaDayLabels).map(([d, label]) => (
                                        <div key={d} className="flex items-center justify-between bg-slate-950/60 py-1 px-2 rounded-lg border border-slate-900">
                                            <span className="text-[10px] font-black text-slate-350 truncate pr-1">Day {d}: <span className="text-rose-400 font-bold">{label}</span></span>
                                            <button
                                                onClick={() => {
                                                    const next = { ...ktaDayLabels };
                                                    delete next[parseInt(d, 10)];
                                                    setKtaDayLabels(next);
                                                }}
                                                className="text-[9px] font-bold text-slate-500 hover:text-red-400 transition-colors shrink-0 px-1"
                                            >
                                                삭제
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="pt-6 border-t border-slate-800 mt-6 shrink-0">
                        <button
                            onClick={handleSaveTemplateSettings}
                            className="w-full py-4 px-4 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-950/30"
                        >
                            <Check className="w-4 h-4" />
                            템플릿 당직 불가 설정 저장
                        </button>
                    </div>
                </div>
            </aside>
        );
    }

    if (viewMode === 'blc-template') {
        return (
            <aside className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col shrink-0 h-full overflow-hidden">
                <div className="flex-1 flex flex-col justify-between p-6 bg-slate-900/60 custom-scrollbar overflow-y-auto h-full">
                    <div className="space-y-6">
                        <div className="flex items-center gap-2 pb-4 border-b border-slate-800">
                            <Info className="w-5 h-5 text-blue-400" />
                            <h2 className="text-sm font-black tracking-wider text-slate-200 uppercase">BLC 템플릿 제어 센터</h2>
                        </div>

                        <div className="space-y-3.5">
                            <label className="text-xs font-black text-slate-400 tracking-wider block">🚫 당직 불가 배정 브러시</label>
                            <div className="flex flex-col gap-2.5">
                                <button
                                    onClick={() => setRestrictionBrush(prev => prev === 'blc' ? null : 'blc')}
                                    className={`w-full py-3.5 px-4 border rounded-2xl text-xs font-black transition-all flex items-center justify-between shadow-md active:scale-[0.98] ${
                                        restrictionBrush === 'blc' 
                                            ? 'bg-blue-900/50 border-blue-500 text-blue-200 ring-2 ring-blue-500/50 shadow-blue-950/40' 
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-blue-550 border border-blue-400 animate-pulse" />
                                        <span>🚫 BLC 불가</span>
                                    </div>
                                    {restrictionBrush === 'blc' ? (
                                        <span className="text-[9px] px-2 py-0.5 rounded bg-blue-500 text-white font-black animate-bounce">활성 중</span>
                                    ) : (
                                        <span className="text-[9px] text-slate-600">OFF</span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setRestrictionBrush(prev => prev === 's3' ? null : 's3')}
                                    className={`w-full py-3.5 px-4 border rounded-2xl text-xs font-black transition-all flex items-center justify-between shadow-md active:scale-[0.98] ${
                                        restrictionBrush === 's3' 
                                            ? 'bg-indigo-900/50 border-indigo-500 text-indigo-200 ring-2 ring-indigo-500/50 shadow-indigo-950/40' 
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-550 border border-indigo-400 animate-pulse" />
                                        <span>🚫 S3 불가</span>
                                    </div>
                                    {restrictionBrush === 's3' ? (
                                        <span className="text-[9px] px-2 py-0.5 rounded bg-indigo-500 text-white font-black animate-bounce">활성 중</span>
                                    ) : (
                                        <span className="text-[9px] text-slate-600">OFF</span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setRestrictionBrush(prev => prev === 'pao' ? null : 'pao')}
                                    className={`w-full py-3.5 px-4 border rounded-2xl text-xs font-black transition-all flex items-center justify-between shadow-md active:scale-[0.98] ${
                                        restrictionBrush === 'pao' 
                                            ? 'bg-purple-900/50 border-purple-500 text-purple-200 ring-2 ring-purple-500/50 shadow-purple-950/40' 
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-purple-555 border border-purple-400 animate-pulse" />
                                        <span>🚫 PAO 불가</span>
                                    </div>
                                    {restrictionBrush === 'pao' ? (
                                        <span className="text-[9px] px-2 py-0.5 rounded bg-purple-500 text-white font-black animate-bounce">활성 중</span>
                                    ) : (
                                        <span className="text-[9px] text-slate-600">OFF</span>
                                    )}
                                </button>
                            </div>
                        </div>

                        <div className="p-4 bg-slate-950/40 border border-slate-850 rounded-2xl space-y-3 shrink-0">
                            <h4 className="text-[11px] font-black text-blue-400 tracking-wider flex items-center gap-1">🏷️ Day 커스텀 배지 라벨 설정</h4>
                            <div className="flex flex-col gap-2 w-full">
                                <div className="flex gap-1.5 w-full">
                                    <input 
                                        type="number" 
                                        placeholder="Day"
                                        id="blc-label-day"
                                        className="w-16 shrink-0 py-1.5 px-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-center font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                                    />
                                    <input 
                                        type="text" 
                                        placeholder="예: 포데이"
                                        id="blc-label-text"
                                        className="flex-1 min-w-0 py-1.5 px-2.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                                    />
                                </div>
                                <button
                                    onClick={() => {
                                        const dayInput = document.getElementById('blc-label-day') as HTMLInputElement;
                                        const textInput = document.getElementById('blc-label-text') as HTMLInputElement;
                                        const dayNum = parseInt(dayInput.value, 10);
                                        const txt = textInput.value.trim();
                                        if (isNaN(dayNum) || !txt) {
                                            showToast("Day 번호와 배지 텍스트를 정확히 입력해주세요.", "error");
                                            return;
                                        }
                                        setBlcDayLabels(prev => ({ ...prev, [dayNum]: txt }));
                                        dayInput.value = '';
                                        textInput.value = '';
                                        showToast(`BLC Day ${dayNum}에 '${txt}' 라벨을 임시 등록했습니다.`);
                                    }}
                                    className="w-full py-1.5 bg-blue-600 hover:bg-blue-550 active:scale-95 text-white rounded-lg text-xs font-black transition-all cursor-pointer text-center"
                                >
                                    추가
                                </button>
                            </div>
                            
                            {Object.keys(blcDayLabels).length > 0 && (
                                <div className="space-y-1.5 max-h-[500px] overflow-y-auto custom-scrollbar pt-2 border-t border-slate-800/40">
                                    {Object.entries(blcDayLabels).map(([d, label]) => (
                                        <div key={d} className="flex items-center justify-between bg-slate-950/60 py-1 px-2 rounded-lg border border-slate-900">
                                            <span className="text-[10px] font-black text-slate-350 truncate pr-1">Day {d}: <span className="text-indigo-400 font-bold">{label}</span></span>
                                            <button
                                                onClick={() => {
                                                    const next = { ...blcDayLabels };
                                                    delete next[parseInt(d, 10)];
                                                    setBlcDayLabels(next);
                                                }}
                                                className="text-[9px] font-bold text-slate-500 hover:text-red-400 transition-colors shrink-0 px-1"
                                            >
                                                삭제
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="pt-6 border-t border-slate-800 mt-6 shrink-0">
                        <button
                            onClick={handleSaveBlcTemplateSettings}
                            className="w-full py-4 px-4 bg-blue-600 hover:bg-blue-550 active:scale-95 text-white rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-950/30"
                        >
                            <Check className="w-4 h-4" />
                            BLC/S3 당직 불가 설정 저장
                        </button>
                    </div>
                </div>
            </aside>
        );
    }

    return null;
}
