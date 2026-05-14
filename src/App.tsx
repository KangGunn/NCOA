import { useState, useEffect } from 'react';
import BottomNav from './components/BottomNav';
import RollCallTab from './components/tabs/RollCallTab';
import PersonnelTab from './components/tabs/PersonnelTab';
import CalendarTab from './components/tabs/CalendarTab';
import { auth, db } from './lib/firebase';
import { onSnapshot, doc, collection, query, where } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import type { User } from 'firebase/auth';

function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const savedTab = localStorage.getItem('ncoa_active_tab');
    return savedTab || 'rollcall';
  });
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    localStorage.setItem('ncoa_active_tab', activeTab);
  }, [activeTab]);

  // RollCallTab states lifted to persist across tab switches
  const [healthNote, setHealthNote] = useState('');
  const [tomorrowNote, setTomorrowNote] = useState('');
  const [baseDate, setBaseDate] = useState(new Date());
  const [scheduleText, setScheduleText] = useState(() => {
    const today = new Date();
    const day = today.getDay();
    return (day >= 0 && day <= 4) ? '0620 HQ PT' : '';
  });
  const [scheduleParticipants, setScheduleParticipants] = useState<Record<string, string[]>>({
    'HQ PT': [],
    'KTA 업무지원': [],
    'MEDIC 의무지원': [],
    'BLC 업무지원': []
  });
  const [customSchedules, setCustomSchedules] = useState<{ name: string; participants: string[] }[]>([]);
  const [ktaBatches, setKtaBatches] = useState<{ batch: string, startDate: string, ktaType?: 'A' | 'B', memo?: string }[]>([]);
  const [ktaTemplate, setKtaTemplate] = useState<any>(null);
  const [blcBatches, setBlcBatches] = useState<{ batch: string, startDate: string, memo?: string }[]>([]);
  const [blcTemplate, setBlcTemplate] = useState<any>(null);
  const [holidays, setHolidays] = useState<{startDate: string, endDate: string}[]>([]);


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error('Anonymous sign-in failed', error);
          setLoading(false);
        }
        return;
      }

      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // KTA, BLC, Holiday 데이터 구독
  useEffect(() => {
    const qSchedules = query(collection(db, 'schedules'), where('type', 'in', ['kta', 'blc', 'holiday']));
    const unsubSchedules = onSnapshot(qSchedules, (snap) => {
      const kBatches: { batch: string, startDate: string, ktaType?: 'A' | 'B', memo?: string }[] = [];
      const bBatches: { batch: string, startDate: string, memo?: string }[] = [];
      const hDays: {startDate: string, endDate: string}[] = [];

      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.type === 'kta' && data.memo && data.memo.startsWith('Day 0')) {
          if (data.batch && data.startDate) kBatches.push({ batch: data.batch, startDate: data.startDate, ktaType: data.ktaType });
        } else if (data.type === 'blc') {
          if (data.batch && data.startDate) bBatches.push({ batch: data.batch, startDate: data.startDate, memo: data.memo });
        } else if (data.type === 'holiday') {
          if (data.startDate) hDays.push({ startDate: data.startDate, endDate: data.endDate || data.startDate });
        }
      });
      setKtaBatches(kBatches);
      setBlcBatches(bBatches);
      setHolidays(hDays);
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

  // 점호 탭 3번(주요일정) 자동 입력 로직 (HQ PT + 다중 KTA 기수)
  useEffect(() => {
    const tomorrow = new Date(baseDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDay = tomorrow.getDay();
    // 일~목(0~4)에 점호를 하면 내일이 월~금(1~5)이므로 PT가 있음
    const isTomorrowWeekday = tomorrowDay >= 1 && tomorrowDay <= 5;

    let scheduleLines: string[] = [];
    if (isTomorrowWeekday) {
      scheduleLines.push('0620 HQ PT');
    }

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
        blcBatches.filter(b => b.memo?.startsWith('Day 0')).forEach(b => {
          const blcStart = new Date(b.startDate);
          blcStart.setHours(0, 0, 0, 0);

          if (tomorrowCalc >= blcStart) {
            let dayCount = 0;
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

            if (dayCount <= 22) {
              const dayData = blcTemplate.schedules?.find((s: any) => s.day === dayCount);
              if (dayData && dayData.events.length > 0) {
                const batch = b.batch || '';
                const blcEvents = dayData.events.map((e: string) => e.replace(/\{batch\}/g, batch));
                scheduleLines = [...scheduleLines, ...blcEvents];
              }
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
  }, [baseDate, ktaBatches, ktaTemplate, blcBatches, blcTemplate, holidays]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 p-6">
        <p className="text-center text-gray-700 font-medium">연결에 실패했습니다.</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            signInAnonymously(auth).catch(() => setLoading(false));
          }}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex justify-center">
      <main className="w-full max-w-md min-h-screen bg-white shadow-2xl relative">
        <div className="h-full safe-area-top pb-6 px-6 pt-4">
          {activeTab === 'rollcall' && (
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
              setScheduleParticipants={setScheduleParticipants}
              customSchedules={customSchedules}
              setCustomSchedules={setCustomSchedules}
            />
          )}
          {activeTab === 'calendar' && <CalendarTab />}
          {activeTab === 'personnel' && <PersonnelTab />}
        </div>

        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </main>
    </div>
  );
}

export default App;
