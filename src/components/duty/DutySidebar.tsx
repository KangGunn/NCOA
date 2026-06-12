import { useState } from 'react';
import { RefreshCw, Check, Info, Calendar, ChevronDown, Wand2 } from 'lucide-react';
import type { CalendarMember } from '../../types/calendar/calendar.type';
import { calculateRank } from '../../lib/rankUtils';

interface DutySidebarProps {
    viewMode: 'actual' | 'kta-template' | 'blc-template';
    loading: boolean;
    members: CalendarMember[];
    dutyStats: Record<string, { 
        total: number; 
        weekday: number; 
        friSun: number; 
        sat: number;
        currentMonthWeekday?: number;
        currentMonthFriSun?: number;
        currentMonthSat?: number;
    }>;
    toggleMemberDutyCompleted: (e: React.MouseEvent, id: string, name: string, status: boolean) => void;
    restrictionBrush: string | null;
    setRestrictionBrush: React.Dispatch<React.SetStateAction<string | null>>;
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
    ktaSections: string[];
    blcSections: string[];
    handleToggleSectionMapping: (mode: 'kta' | 'blc', section: string) => void;
    currentDate: Date;
    onOpenAutoDistributeModal: () => void;
}

export function DutySidebar({
    viewMode, loading, members, dutyStats,
    toggleMemberDutyCompleted,
    restrictionBrush, setRestrictionBrush,
    ktaDayLabels, setKtaDayLabels,
    blcDayLabels, setBlcDayLabels,
    handleSaveTemplateSettings, handleSaveBlcTemplateSettings,
    showToast,
    dutyHolidays, handleAddDutyHoliday, handleDeleteDutyHoliday,
    ktaSections, blcSections, handleToggleSectionMapping,
    currentDate,
    onOpenAutoDistributeModal
}: DutySidebarProps) {
    const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
    const [showCompleted, setShowCompleted] = useState(false);
    const [showKtaBrushEditor, setShowKtaBrushEditor] = useState(false);
    const [showBlcBrushEditor, setShowBlcBrushEditor] = useState(false);
    if (viewMode === 'actual') {
        const criteriaWeekday = (() => {
            const saved = localStorage.getItem('ncoa_criteria_weekday');
            return saved ? parseInt(saved, 10) : 13;
        })();
        const criteriaFriSun = (() => {
            const saved = localStorage.getItem('ncoa_criteria_frisun');
            return saved ? parseInt(saved, 10) : 9;
        })();
        const criteriaSat = (() => {
            const saved = localStorage.getItem('ncoa_criteria_sat');
            return saved ? parseInt(saved, 10) : 6;
        })();

        const lastDayOfCurrentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        const lastDayStr = `${lastDayOfCurrentMonth.getFullYear()}-${String(lastDayOfCurrentMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDayOfCurrentMonth.getDate()).padStart(2, '0')}`;
        const filteredMembers = members.filter(m => !m.joinDate || lastDayStr >= m.joinDate);

        const classified = filteredMembers.map((member: CalendarMember) => {
            const stats = dutyStats[member.name] || { total: 0, weekday: 0, friSun: 0, sat: 0, currentMonthWeekday: 0, currentMonthFriSun: 0, currentMonthSat: 0 };
            const count = stats.total;

            const isSK = member.sections?.includes('SK') || false;
            const isCompleted = member.role !== 'runner' && (isSK || !!member.dutyCompleted || (stats.weekday >= criteriaWeekday && stats.friSun >= criteriaFriSun && stats.sat >= criteriaSat));

            return { member, stats, count, isCompleted };
        });

        const sortMembers = (arr: typeof classified) => {
            return [...arr].sort((a, b) => {
                const roleA = a.member.role || 'member';
                const roleB = b.member.role || 'member';
                
                // 1. Regular members first, runners second
                if (roleA === 'runner' && roleB !== 'runner') return 1;
                if (roleA !== 'runner' && roleB === 'runner') return -1;
                
                // 2. Sort by enlistmentDate (asc)
                const dateA = typeof a.member.enlistmentDate === 'string' ? a.member.enlistmentDate.trim() : '';
                const dateB = typeof b.member.enlistmentDate === 'string' ? b.member.enlistmentDate.trim() : '';
                if (dateA !== dateB) {
                    return dateA < dateB ? -1 : 1;
                }
                
                // 3. Sort by name (asc)
                const nameA = typeof a.member.name === 'string' ? a.member.name.trim() : '';
                const nameB = typeof b.member.name === 'string' ? b.member.name.trim() : '';
                return nameA.localeCompare(nameB);
            });
        };

        const activeMembers = sortMembers(classified.filter(c => !c.isCompleted));
        const completedMembers = sortMembers(classified.filter(c => c.isCompleted));

        const renderMemberCard = ({ member, stats, count, isCompleted }: any) => {
            const countBadgeColor = 'bg-slate-850/80 border-slate-800 text-slate-300';
            const dynamicRank = member.role === 'runner'
                ? (member.rank || '러너')
                : (member.enlistmentDate
                    ? calculateRank(new Date(member.enlistmentDate), member.earlyPromotion || 0, currentDate)
                    : (member.rank || '대원'));

            const currentMonthTotal = (stats.currentMonthWeekday || 0) + (stats.currentMonthFriSun || 0) + (stats.currentMonthSat || 0);

            return (
                <div
                    key={member.id}
                    className={`w-full flex items-center justify-between p-3.5 rounded-2xl transition-all border text-left group/member ${isCompleted
                            ? 'bg-slate-950/20 border-slate-900/40 text-slate-550 opacity-60 hover:bg-slate-900/30'
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
                        <span className={`text-[10px] font-bold truncate text-slate-500`}>
                            {dynamicRank}
                        </span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                        <button
                            onClick={(e) => toggleMemberDutyCompleted(e, member.id, member.name, isCompleted)}
                            className={`p-1.5 rounded-lg transition-all border ${isCompleted
                                    ? 'bg-emerald-950/65 hover:bg-emerald-900 border-emerald-500/40 text-emerald-300'
                                    : 'hover:bg-slate-800 text-slate-550 hover:text-slate-200 border-transparent hover:border-slate-700'
                                } ${isCompleted ? 'opacity-100' : 'opacity-0 group-hover/member:opacity-100'}`}
                            title={isCompleted ? "당직 완료 상태 해제" : "당직 완료 대원으로 설정"}
                        >
                            <Check className="w-3.5 h-3.5" />
                        </button>
                        {member.role !== 'runner' && (
                            <div className="flex flex-col items-end gap-1.5 select-none min-w-0 pr-0.5">
                                <div className={`px-2 py-0.5 rounded-xl text-[11px] font-black shrink-0 border flex items-center gap-1 ${isCompleted
                                        ? 'bg-slate-950/60 border-slate-900 text-slate-550'
                                        : countBadgeColor
                                    }`}>
                                    <span>당직 {count}회</span>
                                    {currentMonthTotal > 0 && (
                                        <span className="text-emerald-400 font-extrabold text-[10.5px]">+{currentMonthTotal}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-[10px] font-black tracking-tight shrink-0">
                                    <span className={isCompleted ? 'text-slate-650' : stats.weekday >= criteriaWeekday ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                                        평 {stats.weekday}
                                        {stats.currentMonthWeekday > 0 && (
                                            <span className="text-emerald-400 font-extrabold ml-0.5">+{stats.currentMonthWeekday}</span>
                                        )}
                                    </span>
                                    <span className={isCompleted ? 'text-slate-650' : stats.friSun >= criteriaFriSun ? 'text-emerald-400 font-bold' : 'text-sky-400'}>
                                        금일 {stats.friSun}
                                        {stats.currentMonthFriSun > 0 && (
                                            <span className="text-emerald-400 font-extrabold ml-0.5">+{stats.currentMonthFriSun}</span>
                                        )}
                                    </span>
                                    <span className={isCompleted ? 'text-slate-650' : stats.sat >= criteriaSat ? 'text-emerald-400 font-bold' : 'text-rose-400'}>
                                        토 {stats.sat}
                                        {stats.currentMonthSat > 0 && (
                                            <span className="text-emerald-400 font-extrabold ml-0.5">+{stats.currentMonthSat}</span>
                                        )}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        };

        return (
            <aside className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col shrink-0 h-full overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                        <h2 className="text-base font-black tracking-wider text-slate-200">당직 플래너</h2>
                    </div>
                    <button
                        onClick={onOpenAutoDistributeModal}
                        title="자동 분배"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 hover:border-indigo-500/60 text-indigo-300 hover:text-indigo-200 rounded-xl text-[11px] font-black transition-all active:scale-[0.97] cursor-pointer shadow-sm"
                    >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>자동 분배</span>
                    </button>
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
                        <div className="space-y-2.5">
                            {/* Active Members */}
                            {activeMembers.map(item => renderMemberCard(item))}

                            {/* Collapsible Completed Members */}
                            {completedMembers.length > 0 && (
                                <div className="space-y-2.5 pt-2">
                                    <button
                                        onClick={() => setShowCompleted(!showCompleted)}
                                        className="w-full py-2.5 bg-emerald-950/30 hover:bg-emerald-950/50 border border-emerald-900/40 rounded-2xl flex items-center justify-center gap-2 text-xs font-black text-emerald-400 transition-all active:scale-[0.99] cursor-pointer shadow-md"
                                    >
                                        <span>✅ 당직 완료 대원 {showCompleted ? "접기" : "보기"} ({completedMembers.length}명)</span>
                                        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showCompleted ? 'rotate-180' : ''}`} />
                                    </button>

                                    {showCompleted && completedMembers.map(item => renderMemberCard(item))}
                                </div>
                            )}
                        </div>
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


            </aside>
        );
    }

    const availableSections = ['KTA', 'MEDIC', 'BLC', 'S1', 'S3', 'S4', 'S6', 'RSO', 'PAO', 'SK'];

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
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-black text-slate-400 tracking-wider block">🚫 당직 불가 배정 브러시</label>
                                <button
                                    onClick={() => setShowKtaBrushEditor(!showKtaBrushEditor)}
                                    className="text-[10px] font-black px-2.5 py-1 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-350 hover:text-slate-200 rounded-lg cursor-pointer transition-colors"
                                >
                                    ⚙️ 브러시 편집
                                </button>
                            </div>

                            {showKtaBrushEditor && (
                                <div className="p-3 bg-slate-950/80 border border-slate-850 rounded-2xl space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <span className="text-[10px] font-black text-slate-500 block mb-1">💡 브러시로 추가할 섹션 선택 (KTA)</span>
                                    <div className="flex flex-wrap gap-1.5">
                                        {availableSections.map(sec => {
                                            const isChecked = ktaSections.includes(sec);
                                            return (
                                                <button
                                                    key={sec}
                                                    type="button"
                                                    onClick={() => handleToggleSectionMapping('kta', sec)}
                                                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black transition-all border ${
                                                        isChecked
                                                            ? 'bg-rose-950/60 border-rose-500/50 text-rose-300'
                                                            : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-850'
                                                    }`}
                                                >
                                                    {sec}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-col gap-2.5">
                                {ktaSections.map((sec) => {
                                    const isActive = restrictionBrush === sec;
                                    return (
                                        <button
                                            key={sec}
                                            onClick={() => setRestrictionBrush(prev => prev === sec ? null : sec)}
                                            className={`w-full py-3.5 px-4 border rounded-2xl text-xs font-black transition-all flex items-center justify-between shadow-md active:scale-[0.98] ${
                                                isActive
                                                    ? 'bg-rose-900/50 border-rose-500 text-rose-200 ring-2 ring-rose-500/50 shadow-rose-950/40'
                                                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="w-2.5 h-2.5 rounded-full bg-rose-550 border border-rose-400 animate-pulse" />
                                                <span>🚫 {sec} 불가</span>
                                            </div>
                                            {isActive ? (
                                                <span className="text-[9px] px-2 py-0.5 rounded bg-rose-500 text-white font-black animate-bounce">활성 중</span>
                                            ) : (
                                                <span className="text-[9px] text-slate-600">OFF</span>
                                            )}
                                        </button>
                                    );
                                })}
                                {ktaSections.length === 0 && (
                                    <p className="text-[11px] text-slate-600 italic text-center py-4">활성화된 섹션 브러시가 없습니다.<br />우측 상단 '브러시 편집'에서 섹션을 추가하세요.</p>
                                )}
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
                                            <span className="text-[10px] font-black text-slate-350 truncate pr-1">Day {d}: <span className="text-rose-450 font-bold">{label}</span></span>
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
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-black text-slate-400 tracking-wider block">🚫 당직 불가 배정 브러시</label>
                                <button
                                    onClick={() => setShowBlcBrushEditor(!showBlcBrushEditor)}
                                    className="text-[10px] font-black px-2.5 py-1 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-350 hover:text-slate-200 rounded-lg cursor-pointer transition-colors"
                                >
                                    ⚙️ 브러시 편집
                                </button>
                            </div>

                            {showBlcBrushEditor && (
                                <div className="p-3 bg-slate-950/80 border border-slate-850 rounded-2xl space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <span className="text-[10px] font-black text-slate-500 block mb-1">💡 브러시로 추가할 섹션 선택 (BLC)</span>
                                    <div className="flex flex-wrap gap-1.5">
                                        {availableSections.map(sec => {
                                            const isChecked = blcSections.includes(sec);
                                            return (
                                                <button
                                                    key={sec}
                                                    type="button"
                                                    onClick={() => handleToggleSectionMapping('blc', sec)}
                                                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black transition-all border ${
                                                        isChecked
                                                            ? 'bg-blue-950/60 border-blue-500/50 text-blue-300'
                                                            : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-850'
                                                    }`}
                                                >
                                                    {sec}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-col gap-2.5">
                                {blcSections.map((sec) => {
                                    const isActive = restrictionBrush === sec;
                                    return (
                                        <button
                                            key={sec}
                                            onClick={() => setRestrictionBrush(prev => prev === sec ? null : sec)}
                                            className={`w-full py-3.5 px-4 border rounded-2xl text-xs font-black transition-all flex items-center justify-between shadow-md active:scale-[0.98] ${
                                                isActive
                                                    ? 'bg-blue-900/50 border-blue-500 text-blue-200 ring-2 ring-blue-500/50 shadow-blue-950/40'
                                                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="w-2.5 h-2.5 rounded-full bg-blue-550 border border-blue-400 animate-pulse" />
                                                <span>🚫 {sec} 불가</span>
                                            </div>
                                            {isActive ? (
                                                <span className="text-[9px] px-2 py-0.5 rounded bg-blue-500 text-white font-black animate-bounce">활성 중</span>
                                            ) : (
                                                <span className="text-[9px] text-slate-600">OFF</span>
                                            )}
                                        </button>
                                    );
                                })}
                                {blcSections.length === 0 && (
                                    <p className="text-[11px] text-slate-600 italic text-center py-4">활성화된 섹션 브러시가 없습니다.<br />우측 상단 '브러시 편집'에서 섹션을 추가하세요.</p>
                                )}
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

