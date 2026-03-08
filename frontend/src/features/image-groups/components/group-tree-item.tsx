import React from 'react';
import {
    ChevronRight,
    ChevronDown,
    Folder,
    FolderOpen,
    Zap
} from 'lucide-react';
import type { GroupWithHierarchy } from '@conai/shared';
import { cn } from '@/lib/utils';

interface GroupTreeItemProps {
    group: GroupWithHierarchy;
    level: number;
    hasChildren: boolean;
    isExpanded: boolean;
    isSelected: boolean;
    onToggleExpand: () => void;
    onSelect: () => void;
}

export const GroupTreeItem: React.FC<GroupTreeItemProps> = ({
    group,
    level,
    hasChildren,
    isExpanded,
    isSelected,
    onToggleExpand,
    onSelect,
}) => {
    const groupColor = group.color || '#2196f3';

    return (
        <div
            className={cn(
                "flex items-center py-1.5 px-2 cursor-pointer transition-colors border-l-4",
                isSelected
                    ? "bg-primary/10 border-primary"
                    : "hover:bg-accent/50 border-transparent"
            )}
            style={{ paddingLeft: `${level * 20 + 8}px` }}
            onClick={() => {
                onSelect();
                // If it has children, also toggle expansion on click for convenience
                if (hasChildren && !isSelected) {
                    onToggleExpand();
                }
            }}
        >
            {/* Expand/Collapse Button */}
            <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center mr-1">
                {hasChildren && (
                    <button
                        type="button"
                        className="p-0.5 rounded-sm hover:bg-accent flex items-center justify-center transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleExpand();
                        }}
                    >
                        {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                        ) : (
                            <ChevronRight className="w-4 h-4" />
                        )}
                    </button>
                )}
            </div>

            {/* Folder Icon */}
            <div
                className="w-5 h-5 flex-shrink-0 flex items-center justify-center mr-2"
                style={{ color: groupColor }}
            >
                {isExpanded && hasChildren ? (
                    <FolderOpen className="w-4 h-4 fill-current opacity-80" />
                ) : (
                    <Folder className="w-4 h-4 fill-current opacity-80" />
                )}
            </div>

            {/* Color Indicator Shim */}
            <div
                className="w-1 h-5 flex-shrink-0 rounded-full mr-2"
                style={{ backgroundColor: groupColor }}
            />

            {/* Group Name */}
            <span className={cn(
                "flex-grow text-sm truncate",
                isSelected ? "font-semibold text-foreground" : "text-muted-foreground"
            )}>
                {group.name}
            </span>

            {/* Stats/Badges */}
            <div className="flex items-center gap-1.5 ml-2">
                {(group.image_count ?? 0) > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium leading-none">
                        {group.image_count}
                    </span>
                )}
                {Boolean(group.auto_collect_enabled) && (
                    <div title="Auto-collect enabled">
                        <Zap className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    </div>
                )}
            </div>
        </div>
    );
};
