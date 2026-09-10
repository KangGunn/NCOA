import { useState, useEffect } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export interface MemberDoc {
    id: string;
    name: string;
    rank: string;
    enlistmentDate: string;
    role?: 'member' | 'runner' | 'holdover';
    sections?: string[];
    earlyPromotion?: number;
    joinDate?: string;
    updatedAt?: unknown;
    englishName?: string;
    phoneNumber?: string;
    dutyOffset?: number;
    penalties?: Array<{
        id: string;
        type: 'weekday' | 'friSun' | 'sat';
        reason: string;
        createdAt?: string;
    }>;
}

export function usePersonnel(baseDate: Date) {
    const [members, setMembers] = useState<MemberDoc[]>([]);
    const [addOpen, setAddOpen] = useState(false);
    const [addingRole, setAddingRole] = useState<'member' | 'runner' | 'holdover'>('member');
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

    const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
    
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

    const regularMembers = sortedMembers.filter(m => m.role !== 'runner' && m.role !== 'holdover');
    const runners = sortedMembers.filter(m => m.role === 'runner');
    const holdovers = sortedMembers.filter(m => m.role === 'holdover');
    const activeRegularCount = regularMembers.filter(m => !m.joinDate || dateStr >= m.joinDate).length;

    const detailMember = selectedId
        ? members.find((m) => m.id === selectedId) ?? null
        : null;

    return {
        members,
        addOpen,
        setAddOpen,
        addingRunner: addingRole === 'runner',
        setAddingRunner: (val: boolean) => setAddingRole(val ? 'runner' : 'member'),
        addingRole,
        setAddingRole,
        selectedId,
        setSelectedId,
        detailMember,
        regularMembers,
        runners,
        holdovers,
        activeRegularCount,
    };
}
