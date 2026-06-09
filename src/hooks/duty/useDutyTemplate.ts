import { db } from '../../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

interface UseDutyTemplateProps {
    ktaTemplate: any;
    blcTemplate: any;
    restrictions: Record<number, Record<string, boolean>>;
    blcRestrictions: Record<number, Record<string, boolean>>;
    ktaDayLabels: Record<number, string>;
    blcDayLabels: Record<number, string>;
    extraBefore: number;
    extraAfter: number;
    setRestrictions: React.Dispatch<React.SetStateAction<Record<number, Record<string, boolean>>>>;
    setBlcRestrictions: React.Dispatch<React.SetStateAction<Record<number, Record<string, boolean>>>>;
    showToast: (message: string, type?: 'success' | 'error') => void;
    ktaSections: string[];
    blcSections: string[];
}

export function useDutyTemplate({
    ktaTemplate, blcTemplate,
    restrictions, blcRestrictions,
    ktaDayLabels, blcDayLabels,
    extraBefore, extraAfter,
    setRestrictions, setBlcRestrictions,
    showToast,
    ktaSections, blcSections
}: UseDutyTemplateProps) {
    // 특정 섹션 당직 불가 토글 핸들러 (KTA Day 기준)
    const handleToggleRestriction = (day: number, section: string) => {
        setRestrictions(prev => {
            const current = prev[day] || {};
            return {
                ...prev,
                [day]: {
                    ...current,
                    [section]: !current[section]
                }
            };
        });
    };

    // 특정 섹션 당직 불가 토글 핸들러 (BLC Day 기준)
    const handleToggleBlcRestriction = (day: number, section: string) => {
        setBlcRestrictions(prev => {
            const current = prev[day] || {};
            return {
                ...prev,
                [day]: {
                    ...current,
                    [section]: !current[section]
                }
            };
        });
    };

    const handleSaveTemplateSettings = async () => {
        try {
            await setDoc(doc(db, 'settings', 'ktaTemplate'), {
                ...ktaTemplate,
                sections: ktaSections,
                restrictions: Object.entries(restrictions).map(([dayStr, val]) => ({
                    day: parseInt(dayStr, 10),
                    restMap: val,
                    ktaRestricted: !!val['KTA'],
                    medicRestricted: !!val['MEDIC'],
                    paoRestricted: !!val['PAO']
                })),
                dayLabels: ktaDayLabels,
                extraBefore,
                extraAfter
            }, { merge: true });
            showToast("KTA 당직 불가 제한 및 섹션 브러시 설정이 성공적으로 저장되었습니다! 💾");
        } catch (e) {
            console.error("Error saving restrictions:", e);
            showToast("설정 저장 중 오류가 발생했습니다.", "error");
        }
    };

    const handleSaveBlcTemplateSettings = async () => {
        try {
            await setDoc(doc(db, 'settings', 'blcTemplate'), {
                ...blcTemplate,
                sections: blcSections,
                restrictions: Object.entries(blcRestrictions).map(([dayStr, val]) => ({
                    day: parseInt(dayStr, 10),
                    restMap: val,
                    blcRestricted: !!val['BLC'],
                    s3Restricted: !!val['S3'],
                    paoRestricted: !!val['PAO']
                })),
                dayLabels: blcDayLabels
            }, { merge: true });
            showToast("BLC 당직 불가 제한 및 섹션 브러시 설정이 성공적으로 저장되었습니다! 💾");
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
