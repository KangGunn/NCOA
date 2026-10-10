import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { MovementRecord } from '../../types/movement/movement.type';

export function useMovements() {
    const [movements, setMovements] = useState<MovementRecord[]>([]);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'movements'), (snapshot) => {
            const list: MovementRecord[] = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            } as MovementRecord));
            setMovements(list);
        });

        return () => unsub();
    }, []);

    return { movements };
}
