import { useState, useEffect, lazy, Suspense } from 'react';
import BottomNav from './components/BottomNav';
import { MovementSaveStatus } from './components/movement/movement.save-status.component';
import RollCallTab from './components/tabs/RollCallTab';
import { auth, db } from './lib/firebase';
import { onSnapshot, doc, collection, query, where } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { useRollCallSchedule } from './hooks/rollcall/rollcall.schedule.hook';

const loadPersonnelTab = () => import('./components/tabs/PersonnelTab');
const loadCalendarTab = () => import('./components/tabs/CalendarTab');
const loadMovementTab = () => import('./components/tabs/MovementTab');
const loadSettingsTab = () => import('./components/tabs/SettingsTab');
const loadDutyScheduler = () => import('./components/duty/DutySchedulerWorkspace');

const PersonnelTab = lazy(loadPersonnelTab);
const CalendarTab = lazy(loadCalendarTab);
const MovementTab = lazy(loadMovementTab);
const SettingsTab = lazy(loadSettingsTab);
const DutySchedulerWorkspace = lazy(loadDutyScheduler);

function formatDateStr(dateStr: unknown): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.trim().split(/[-./]/);
  if (parts.length >= 3) {
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].substring(0, 2).padStart(2, '0');
    if (y.length === 4 && m.length === 2 && d.length === 2) {
      return `${y}-${m}-${d}`;
    }
  }
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const savedTab = localStorage.getItem('ncoa_active_tab');
    return savedTab || 'rollcall';
  });
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([activeTab]));
  const [showDutyScheduler, setShowDutyScheduler] = useState(() => {
    return localStorage.getItem('ncoa_show_duty_scheduler') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('ncoa_show_duty_scheduler', String(showDutyScheduler));
  }, [showDutyScheduler]);

  useEffect(() => {
    localStorage.setItem('ncoa_active_tab', activeTab);
    setVisitedTabs(prev => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  // RollCallTab states lifted to persist across tab switches
  const [healthNote, setHealthNote] = useState('');
  const [tomorrowNote, setTomorrowNote] = useState('');
  const [baseDate, setBaseDate] = useState(new Date());
  const [scheduleText, setScheduleText] = useState('');
  const {
    scheduleParticipants,
    customSchedules,
    addCustomSchedule,
    removeCustomSchedule,
    toggleMember
  } = useRollCallSchedule(baseDate);
  const [ktaBatches, setKtaBatches] = useState<{ batch: string, startDate: string, ktaType?: 'A' | 'B', memo?: string }[]>([]);
  const [ktaTemplate, setKtaTemplate] = useState<any>(null);
  const [blcBatches, setBlcBatches] = useState<{ batch: string, startDate: string, memo?: string }[]>([]);
  const [blcTemplate, setBlcTemplate] = useState<any>(null);
  const [holidays, setHolidays] = useState<{startDate: string, endDate: string}[]>([]);
  const [dutyHolidays, setDutyHolidays] = useState<{startDate: string, endDate: string}[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error('Anonymous sign-in failed', error);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // 첫 화면(점호) 렌더링이 완료된 후, 브라우저 유휴 시간(Idle)에 나머지 탭을 백그라운드에서 순차적 다운로드 및 사전 마운트(Pre-mount)
  useEffect(() => {
    let dutyTimer: any = null;

    const prefetchTabs = async () => {
      // 1. 핵심 탭 모듈 비동기 다운로드
      await Promise.allSettled([
        loadPersonnelTab(),
        loadCalendarTab(),
        loadMovementTab(),
      ]);

      // 2. JS 다운로드가 끝나면 백그라운드(hidden)에 탭 컴포넌트들을 사전 마운트!
      // 이렇게 하면 캘린더/외특/인원 탭의 내부 훅(useMovementSync 구글 시트 요청 등)이
      // 사용자가 탭을 누르기 전에 백그라운드에서 데이터를 모두 다운로드해 둡니다.
      setVisitedTabs(prev => {
        const next = new Set(prev);
        next.add('personnel');
        next.add('calendar');
        next.add('movement');
        return next;
      });

      // 3. 최후순위: 핵심 탭 준비 후 여유 있게 PC 전용 당직 플래너 다운로드
      const scheduleLowestPriority = () => {
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          (window as any).requestIdleCallback(() => loadDutyScheduler(), { timeout: 5000 });
        } else {
          loadDutyScheduler();
        }
      };

      dutyTimer = setTimeout(scheduleLowestPriority, 2500);
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const handle = (window as any).requestIdleCallback(prefetchTabs, { timeout: 2000 });
      return () => {
        (window as any).cancelIdleCallback(handle);
        if (dutyTimer) clearTimeout(dutyTimer);
      };
    } else {
      const timer = setTimeout(prefetchTabs, 600);
      return () => {
        clearTimeout(timer);
        if (dutyTimer) clearTimeout(dutyTimer);
      };
    }
  }, []);

  // KTA, BLC, Holiday 데이터 구독
  useEffect(() => {
    const qSchedules = query(collection(db, 'schedules'), where('type', 'in', ['kta', 'blc', 'holiday']));
    const unsubSchedules = onSnapshot(qSchedules, (snap) => {
      const kBatches: { batch: string, startDate: string, ktaType?: 'A' | 'B', memo?: string }[] = [];
      const bBatches: { batch: string, startDate: string, memo?: string }[] = [];
      const hDays: {startDate: string, endDate: string}[] = [];
      const dHolidays: {startDate: string, endDate: string}[] = [];

      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.type === 'kta' && data.memo && data.memo.startsWith('Day 0')) {
          const sDate = formatDateStr(data.startDate);
          if (data.batch && sDate) kBatches.push({ batch: data.batch, startDate: sDate, ktaType: data.ktaType });
        } else if (data.type === 'blc') {
          const sDate = formatDateStr(data.startDate);
          if (data.batch && sDate) bBatches.push({ batch: data.batch, startDate: sDate, memo: data.memo });
        } else if (data.type === 'holiday') {
          const sDate = formatDateStr(data.startDate);
          const eDate = formatDateStr(data.endDate || data.startDate);
          if (sDate && eDate) {
            if (data.holidayType === 'duty') {
              dHolidays.push({ startDate: sDate, endDate: eDate });
            } else {
              hDays.push({ startDate: sDate, endDate: eDate });
            }
          }
        }
      });
      setKtaBatches(kBatches);
      setBlcBatches(bBatches);
      setHolidays(hDays);
      setDutyHolidays(dHolidays);
    });

    const unsubKtaTemplate = onSnapshot(doc(db, 'settings', 'ktaTemplate'), (snap) => {
      if (snap.exists()) setKtaTemplate(snap.data());
    });

    const unsubBlcTemplate = onSnapshot(doc(db, 'settings', 'blcTemplate'), (snap) => {
      if (snap.exists()) setBlcTemplate(snap.data());
    });

    return () => {
      unsubSchedules();
      unsubKtaTemplate();
      unsubBlcTemplate();
    };
  }, []);

  // 점호 탭 3번(주요일정) 자동 입력 로직 (다중 KTA/BLC 기수)
  useEffect(() => {
    let scheduleLines: string[] = [];

    // 2. KTA 일정 추가 로직 (모든 활성 기수에 대해 검사)
    if (ktaBatches.length > 0 && ktaTemplate) {
      const tomorrowCalc = new Date(baseDate);
      tomorrowCalc.setDate(tomorrowCalc.getDate() + 1);
      tomorrowCalc.setHours(0, 0, 0, 0);

      ktaBatches.forEach(b => {
        const ktaStart = new Date(b.startDate);
        ktaStart.setHours(0, 0, 0, 0);

        const diffTime = tomorrowCalc.getTime() - ktaStart.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= 20) {
          const dayData = ktaTemplate.schedules?.find((s: any) => s.day === diffDays);
          if (dayData && dayData.events.length > 0) {
            const batch = b.batch || '';
            const type = b.ktaType || 'A';
            const ktaEvents = dayData.events
              .map((e: string) => {
                let replaced = e.replace(/\{batch\}/g, batch);
                if (type === 'A') {
                  replaced = replaced.replace(/\{first\}/g, '1, 2').replace(/\{second\}/g, '3, 4');
                } else {
                  replaced = replaced.replace(/\{first\}/g, '3, 4').replace(/\{second\}/g, '1, 2');
                }
                return replaced;
              });
            
            scheduleLines = [...scheduleLines, ...ktaEvents];
          }
        }
      });
    }

    // 3. BLC 일정 추가 로직
    if (blcBatches.length > 0 && blcTemplate) {
      const tomorrowCalc = new Date(baseDate);
      tomorrowCalc.setDate(tomorrowCalc.getDate() + 1);
      tomorrowCalc.setHours(0, 0, 0, 0);
      const tomorrowStr = `${tomorrowCalc.getFullYear()}-${String(tomorrowCalc.getMonth() + 1).padStart(2, '0')}-${String(tomorrowCalc.getDate()).padStart(2, '0')}`;
      
      const isSunday = tomorrowCalc.getDay() === 0;
      const isHolidayDate = (dateStr: string) => holidays.some((h: any) => dateStr >= h.startDate && dateStr <= h.endDate);
      const isHoliday = isHolidayDate(tomorrowStr);

      if (!isSunday && !isHoliday) {
        blcBatches.filter(b => b.memo?.includes('Day 0')).forEach(b => {
          const blcStart = new Date(b.startDate);
          blcStart.setHours(0, 0, 0, 0);

          let dayCount: number | null = null;

          if (tomorrowCalc >= blcStart) {
            dayCount = 0;
            let current = new Date(blcStart);
            while (current < tomorrowCalc) {
              const currentStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
              const cIsSunday = current.getDay() === 0;
              const cIsHoliday = isHolidayDate(currentStr);
              if (!cIsSunday && !cIsHoliday) {
                dayCount++;
              }
              current.setDate(current.getDate() + 1);
            }
          } else {
            // 입교 전날 (Day -1) 체크
            const oneDayBefore = new Date(blcStart);
            oneDayBefore.setDate(oneDayBefore.getDate() - 1);
            if (tomorrowCalc.getTime() === oneDayBefore.getTime()) {
              dayCount = -1;
            }
          }

          if (dayCount !== null && dayCount >= -1 && dayCount <= 30) {
            const dayData = blcTemplate.schedules?.find((s: any) => s.day === dayCount);
            if (dayData && dayData.events && dayData.events.length > 0) {
              const batch = b.batch || '';
              const blcEvents = dayData.events
                .filter((e: string) => e.trim() !== '')
                .map((e: string) => e.replace(/\{batch\}/g, batch));
              scheduleLines = [...scheduleLines, ...blcEvents];
            }
          }
        });
      }
    }

    // 시간 순 정렬 (HHmm 형식으로 시작한다고 가정)
    const sortedSchedule = scheduleLines
      .filter(line => line.trim() !== '')
      .sort((a, b) => {
        const timeA = a.match(/^\d{4}/)?.[0] || '9999';
        const timeB = b.match(/^\d{4}/)?.[0] || '9999';
        return timeA.localeCompare(timeB);
      })
      .join('\n');

    // 강제 업데이트
    setScheduleText(sortedSchedule);
  }, [baseDate, ktaBatches, ktaTemplate, blcBatches, blcTemplate, holidays, dutyHolidays]);

  if (showDutyScheduler) {
    return (
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <DutySchedulerWorkspace onClose={() => setShowDutyScheduler(false)} />
      </Suspense>
    );
  }

  const renderTabFallback = () => (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex justify-center items-start sm:items-center relative overflow-x-hidden">
      {/* 데스크톱 전용 모바일 프레임 외곽 플로팅 위젯 카드 */}
      <div className="hidden lg:flex flex-col gap-4 fixed left-[calc(50%+240px)] top-1/2 -translate-y-1/2 p-6 bg-white rounded-xl border border-gray-100 shadow-lg max-w-xs z-10">
        <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-650">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
        </div>
        <div>
          <h3 className="text-sm font-black text-gray-900 tracking-tight flex items-center gap-1.5">
            🖥️ PC 전용 당직 플래너
          </h3>
          <p className="text-[11px] leading-relaxed text-gray-500 font-bold mt-1.5">
            더 넓은 데스크톱 화면에서 한눈에 당직 일정을 조율, 배정, 실시간 횟수 통계 조회까지 간편하게 관리하세요!
          </p>
        </div>
        <button
          onClick={() => setShowDutyScheduler(true)}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-1.5 active:scale-95"
        >
          당직표 짜기 시작
        </button>
      </div>

      <main className="w-full max-w-md min-h-screen bg-white shadow-2xl relative">
        <div className="min-h-full safe-area-top pb-12 px-4 sm:px-6 pt-4">
          <div className={activeTab === 'rollcall' ? '' : 'hidden'}>
            <RollCallTab 
              healthNote={healthNote}
              setHealthNote={setHealthNote}
              tomorrowNote={tomorrowNote}
              setTomorrowNote={setTomorrowNote}
              baseDate={baseDate}
              setBaseDate={setBaseDate}
              scheduleText={scheduleText}
              setScheduleText={setScheduleText}
              scheduleParticipants={scheduleParticipants}
              customSchedules={customSchedules}
              addCustomSchedule={addCustomSchedule}
              removeCustomSchedule={removeCustomSchedule}
              toggleMember={toggleMember}
              holidays={holidays}
            />
          </div>
          <Suspense fallback={renderTabFallback()}>
            <div className={activeTab === 'calendar' ? '' : 'hidden'}>
              {visitedTabs.has('calendar') && <CalendarTab baseDate={baseDate} />}
            </div>
            <div className={activeTab === 'movement' ? '' : 'hidden'}>
              {visitedTabs.has('movement') && <MovementTab baseDate={baseDate} />}
            </div>
            <div className={activeTab === 'personnel' ? '' : 'hidden'}>
              {visitedTabs.has('personnel') && <PersonnelTab baseDate={baseDate} />}
            </div>
            <div className={activeTab === 'settings' ? '' : 'hidden'}>
              {visitedTabs.has('settings') && <SettingsTab />}
            </div>
          </Suspense>
        </div>

        <MovementSaveStatus />
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </main>
    </div>
  );
}

export default App;
