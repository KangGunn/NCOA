import { AlertCircle } from 'lucide-react';
import { useMovementSync } from '../../hooks/movement/movement.sync.hook';
import { MovementHeader } from '../movement/movement.header.component';
import { MovementSheetView } from '../movement/movement.sheet-view.component';
import { MovementExcelView } from '../movement/movement.excel-view.component';
import { MovementAmbiguousModal } from '../movement/movement.ambiguous-modal.component';

interface MovementTabProps {
    baseDate?: Date;
}

export default function MovementTab({ baseDate }: MovementTabProps) {
    const {
        parsedData,
        sheetWeeks,
        currentWeekIndex,
        setCurrentWeekIndex,
        viewMode,
        setViewMode,
        loading,
        syncing,
        error,
        success,
        ambiguousMembers,
        setAmbiguousMembers,
        resolutions,
        setResolutions,
        sheetMode,
        dbMembers,
        toggleMode,
        handleFileUpload,
        handleSync,
        getExcelTimelineAndData
    } = useMovementSync(baseDate);

    return (
        <div className="pt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            <MovementHeader
                sheetMode={sheetMode}
                toggleMode={toggleMode}
            />

            {loading && (
                <div className="flex items-center justify-center py-10">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {error && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-600">
                    <AlertCircle className="w-5 h-5" />
                    <p className="font-bold">{error}</p>
                </div>
            )}

            {/* Sheet Mode View */}
            {viewMode === 'sheet' && !loading && (
                <MovementSheetView
                    sheetWeeks={sheetWeeks}
                    currentWeekIndex={currentWeekIndex}
                    setCurrentWeekIndex={setCurrentWeekIndex}
                    handleFileUpload={handleFileUpload}
                    dbMembers={dbMembers}
                    baseDate={baseDate}
                />
            )}

            {/* Excel Mode View */}
            {viewMode === 'excel' && parsedData && (
                <MovementExcelView
                    parsedData={parsedData}
                    syncing={syncing}
                    success={success}
                    handleSync={handleSync}
                    cancelSync={() => {
                        setViewMode('sheet');
                    }}
                    getExcelTimelineAndData={getExcelTimelineAndData}
                    dbMembers={dbMembers}
                    baseDate={baseDate}
                />
            )}

            {/* 동명이인 해결 모달 */}
            {ambiguousMembers && (
                <MovementAmbiguousModal
                    ambiguousMembers={ambiguousMembers}
                    resolutions={resolutions}
                    setResolutions={setResolutions}
                    handleSync={handleSync}
                    cancelResolving={() => {
                        setAmbiguousMembers(null);
                        setResolutions({});
                    }}
                />
            )}
        </div>
    );
}
