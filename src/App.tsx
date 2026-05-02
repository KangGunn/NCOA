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
  const [ktaBatches, setKtaBatches] = useState<{ batch: string, startDate: string, ktaType?: 'A' | 'B' }[]>([]);
  const [ktaTemplate, setKtaTemplate] = useState<any>(null);


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

  // KTA 데이터 구독
  useEffect(() => {
    const qBatches = query(collection(db, 'schedules'), where('type', '==', 'kta'));
    const unsubBatches = onSnapshot(qBatches, (snap) => {
      const batches = snap.docs
        .map(doc => {
          const data = doc.data();
          // memo가 'Day 0'으로 시작하는 것만 기수의 시작일로 간주
          if (data.memo && data.memo.startsWith('Day 0')) {
            return { 
              batch: data.batch, 
              startDate: data.startDate, 
              ktaType: data.ktaType 
            };
          }
          return null;
        })
        .filter((b): b is { batch: string, startDate: string, ktaType: 'A' | 'B' | undefined } => !!b && !!b.batch && !!b.startDate);
      setKtaBatches(batches);
    });

    const unsubTemplate = onSnapshot(doc(db, 'settings', 'ktaTemplate'), (snap) => {
      if (snap.exists()) setKtaTemplate(snap.data());
    });
    return () => {
      unsubBatches();
      unsubTemplate();
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
                let replaced = e.replace(/\{batch\}/g, `${batch} ${type}`);
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

    // 시간 순 정렬 (HHmm 형식으로 시작한다고 가정)
    const sortedSchedule = scheduleLines
      .filter(line => line.trim() !== '')
      .sort((a, b) => {
        const timeA = a.match(/^\d{4}/)?.[0] || '9999';
        const timeB = b.match(/^\d{4}/)?.[0] || '9999';
        return timeA.localeCompare(timeB);
      })
      .join('\n');

    // 3. 날짜가 바뀌면 해당 날짜의 기본값으로 강제 업데이트
    setScheduleText(sortedSchedule);
  }, [baseDate, ktaBatches, ktaTemplate]);

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
        <div className="h-full pt-safe-top pb-6 px-6">
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
