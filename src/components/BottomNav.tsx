import { FileText, Calendar, Users, ClipboardList } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';

interface BottomNavProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
}

export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
    const tabs = [
        { id: 'rollcall', label: '점호', icon: FileText },
        { id: 'calendar', label: '캘린더', icon: Calendar },
        { id: 'movement', label: '외특', icon: ClipboardList },
        { id: 'personnel', label: '인원', icon: Users },
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 py-2 bg-white/90 backdrop-blur-lg border-t border-gray-100 safe-area-bottom">
            <div className="flex justify-around items-center max-w-md mx-auto">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            className={cn(
                                "relative flex flex-col items-center justify-center w-full py-2 gap-1 transition-colors duration-200 outline-none",
                                isActive ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
                            )}
                        >
                            <div className="relative p-1">
                                {isActive && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute inset-0 bg-blue-100 rounded-xl -z-10"
                                        initial={false}
                                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    />
                                )}
                                <tab.icon className={cn("w-6 h-6 transition-all duration-300", isActive && "scale-110")} strokeWidth={isActive ? 2.5 : 2} />
                            </div>
                            <span className="text-[11px] font-semibold">{tab.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
