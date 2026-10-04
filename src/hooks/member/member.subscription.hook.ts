import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { Member } from '../../types/member/member.type';
import { compareMembersByHobong } from '../../lib/rankUtils';

export function useMembers() {
    const [members, setMembers] = useState<Member[]>([]);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'members'), (snapshot) => {
            const data = snapshot.docs.map((doc) => doc.data() as Member);
            const sorted = [...data].sort((a, b) => compareMembersByHobong(a, b));
            setMembers(sorted);
        });
        return () => unsub();
    }, []);

    return { members };
}
