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
          {activeTab === 'rollcall' && <RollCallTab />}
          {activeTab === 'calendar' && <CalendarTab />}
          {activeTab === 'personnel' && <PersonnelTab />}
        </div>

        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </main>
    </div>
  );
}

export default App;
