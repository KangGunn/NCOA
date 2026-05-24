import { db } from '../../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

interface UseDutyTemplateProps {
    ktaTemplate: any;
    blcTemplate: any;
    restrictions: Record<number, { kta: boolean; medic: boolean; pao: boolean }>;
    blcRestrictions: Record<number, { blc: boolean; s3: boolean; pao: boolean }>;
    ktaDayLabels: Record<number, string>;
    blcDayLabels: Record<number, string>;
    extraBefore: number;
    extraAfter: number;
    setRestrictions: React.Dispatch<React.SetStateAction<Record<number, { kta: boolean; medic: boolean; pao: boolean }>>>;
    setBlcRestrictions: React.Dispatch<React.SetStateAction<Record<number, { blc: boolean; s3: boolean; pao: boolean }>>>;
    showToast: (message: string, type?: 'success' | 'error') => void;
}

export function useDutyTemplate({
    ktaTemplate, blcTemplate,
    restrictions, blcRestrictions,
    ktaDayLabels, blcDayLabels,
    extraBefore, extraAfter,
    setRestrictions, setBlcRestrictions,
    showToast
}: UseDutyTemplateProps) {
    // KTA/MEDIC/PAO 당직 불가 토글 핸들러 (Day 기준)
    const handleToggleRestriction = (day: number, type: 'kta' | 'medic' | 'pao') => {
        setRestrictions(prev => {
            const current = prev[day] || { kta: false, medic: false, pao: false };
            return {
                ...prev,
                [day]: {
                    ...current,
                    [type]: !current[type]
                }
            };
        });
    };

    // BLC/S3/PAO 당직 불가 토글 핸들러 (Day 기준)
    const handleToggleBlcRestriction = (day: number, type: 'blc' | 's3' | 'pao') => {
        setBlcRestrictions(prev => {
            const current = prev[day] || { blc: false, s3: false, pao: false };
            return {
                ...prev,
                [day]: {
                    ...current,
                    [type]: !current[type]
                }
            };
        });
    };

    const handleSaveTemplateSettings = async () => {
        try {
            await setDoc(doc(db, 'settings', 'ktaTemplate'), {
                ...ktaTemplate,
                restrictions: Object.entries(restrictions).map(([dayStr, val]) => ({
                    day: parseInt(dayStr, 10),
                    ktaRestricted: val.kta,
                    medicRestricted: val.medic,
                    paoRestricted: val.pao
                })),
                dayLabels: ktaDayLabels,
                extraBefore,
                extraAfter
            }, { merge: true });
            showToast("KTA/MEDIC/PAO 당직 불가 제한 설정이 Firestore에 성공적으로 저장되었습니다! 💾");
        } catch (e) {
            console.error("Error saving restrictions:", e);
            showToast("설정 저장 중 오류가 발생했습니다.", "error");
        }
    };

    const handleSaveBlcTemplateSettings = async () => {
        try {
            await setDoc(doc(db, 'settings', 'blcTemplate'), {
                ...blcTemplate,
                restrictions: Object.entries(blcRestrictions).map(([dayStr, val]) => ({
                    day: parseInt(dayStr, 10),
                    blcRestricted: val.blc,
                    s3Restricted: val.s3,
                    paoRestricted: val.pao
                })),
                dayLabels: blcDayLabels
            }, { merge: true });
            showToast("BLC/S3/PAO 당직 불가 제한 설정이 Firestore에 성공적으로 저장되었습니다! 💾");
        } catch (e) {
            console.error("Error saving BLC restrictions:", e);
            showToast("설정 저장 중 오류가 발생했습니다.", "error");
        }
    };

    return {
        handleToggleRestriction,
        handleToggleBlcRestriction,
        handleSaveTemplateSettings,
        handleSaveBlcTemplateSettings
    };
}
