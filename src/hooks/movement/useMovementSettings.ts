import { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export interface MovementSettings {
    allowVacationPassLink: boolean;
}

export function useMovementSettings() {
    const [settings, setSettings] = useState<MovementSettings>({
        allowVacationPassLink: false
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'settings', 'movement'), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                setSettings({
                    allowVacationPassLink: data.allowVacationPassLink ?? false
                });
            } else {
                setSettings({
                    allowVacationPassLink: false
                });
            }
            setLoading(false);
        }, (error) => {
            console.error('Failed to subscribe movement settings:', error);
            setLoading(false);
        });

        return () => unsub();
    }, []);

    const updateAllowVacationPassLink = async (value: boolean) => {
        try {
            await setDoc(doc(db, 'settings', 'movement'), {
                allowVacationPassLink: value,
                updatedAt: serverTimestamp()
            }, { merge: true });
        } catch (error) {
            console.error('Failed to update allowVacationPassLink:', error);
            throw error;
        }
    };

    return {
        settings,
        allowVacationPassLink: settings.allowVacationPassLink,
        updateAllowVacationPassLink,
        loading
    };
}
