import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { Member } from '../../types/member/member.type';

export function useMembers() {
    const [members, setMembers] = useState<Member[]>([]);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'members'), (snapshot) => {
            const data = snapshot.docs.map((doc) => doc.data() as Member);
            const sorted = [...data].sort((a, b) => {
                const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
                const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
                if (dateA !== dateB) return dateA < dateB ? -1 : 1;
                return (a.name || '').localeCompare(b.name || '');
            });
            setMembers(sorted);
        });
        return () => unsub();
    }, []);

    return { members };
}
