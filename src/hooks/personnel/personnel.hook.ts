import { useState, useEffect } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export interface MemberDoc {
    id: string;
    name: string;
    rank: string;
    enlistmentDate: string;
    role?: 'member' | 'runner';
    sections?: string[];
    earlyPromotion?: number;
    updatedAt?: unknown;
}

export function usePersonnel() {
    const [members, setMembers] = useState<MemberDoc[]>([]);
    const [addOpen, setAddOpen] = useState(false);
    const [addingRunner, setAddingRunner] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onSnapshot(query(collection(db, 'members')), (snap) => {
            const rows: MemberDoc[] = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<MemberDoc, 'id'>),
            }));
            setMembers(rows);
        });
        return () => unsub();
    }, []);

    const sortedMembers = [...members].sort((a, b) => {
        const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
        const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
        if (dateA !== dateB) {
            return dateA < dateB ? -1 : 1;
        }
        
        const nameA = typeof a.name === 'string' ? a.name.trim() : '';
        const nameB = typeof b.name === 'string' ? b.name.trim() : '';
        if (nameA !== nameB) {
            return nameA < nameB ? -1 : 1;
        }
        return 0;
    });

    const regularMembers = sortedMembers.filter(m => m.role !== 'runner');
    const runners = sortedMembers.filter(m => m.role === 'runner');

    const detailMember = selectedId
        ? members.find((m) => m.id === selectedId) ?? null
        : null;

    return {
        members,
        addOpen,
        setAddOpen,
        addingRunner,
        setAddingRunner,
        selectedId,
        setSelectedId,
        detailMember,
        regularMembers,
        runners,
    };
}
