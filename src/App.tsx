import { useState, useEffect } from 'react';
import BottomNav from './components/BottomNav';
import RollCallTab from './components/tabs/RollCallTab';
import PersonnelTab from './components/tabs/PersonnelTab';
import CalendarTab from './components/tabs/CalendarTab';
import { auth } from './lib/firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import type { User } from 'firebase/auth';

function App() {
  const [activeTab, setActiveTab] = useState('rollcall');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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
        <div className="h-full pt-safe-top pb-32 px-6">
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
