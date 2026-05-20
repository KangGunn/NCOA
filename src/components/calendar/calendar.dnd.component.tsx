import { useDraggable, useDroppable } from '@dnd-kit/core';
import { cn } from '../../lib/utils';

export function DraggableEventItem({ id, children }: { id: string, children: React.ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
    const style: React.CSSProperties = {
        ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}),
        ...(isDragging ? { opacity: 0.4, zIndex: 50 } : {}),
    };

    return (
        <div ref={setNodeRef} style={style} className="flex items-start gap-1">
            <div
                {...listeners}
                {...attributes}
                className="grid grid-cols-2 gap-[2px] p-1.5 cursor-grab active:cursor-grabbing touch-none shrink-0 mt-1.5 rounded hover:bg-gray-100 transition-colors"
            >
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="w-[3px] h-[3px] bg-gray-300 rounded-full" />
                ))}
            </div>
            <div className="flex-1 min-w-0">{children}</div>
        </div>
    );
}

export function DroppableDayZone({ id, children, color }: { id: string, children: React.ReactNode, color: 'red' | 'blue' }) {
    const { setNodeRef, isOver } = useDroppable({ id });
    const ring = color === 'red' ? 'ring-red-200 bg-red-50/30' : 'ring-blue-200 bg-blue-50/30';

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "bg-gray-50/50 rounded-3xl p-3 sm:p-4 border space-y-3 transition-all",
                isOver ? `border-transparent ring-2 ${ring}` : "border-gray-50"
            )}
        >
            {children}
        </div>
    );
}
