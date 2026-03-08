import React, { useState, useRef, useEffect } from 'react';
import {
    ChevronDown,
    X,
    Search,
    Maximize2,
    Minimize2
} from 'lucide-react';
import type { GroupWithHierarchy } from '@conai/shared';
import { useTranslation } from 'react-i18next';
import { useGroupTree } from '../hooks/use-group-tree';
import { GroupTreeItem } from './group-tree-item';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface GroupParentSelectorProps {
    groups: GroupWithHierarchy[];
    selectedParentId: number | null;
    onParentChange: (parentId: number | null) => void;
    excludeIds?: number[];
    label?: string;
    noParentLabel?: string;
}

export const GroupParentSelector: React.FC<GroupParentSelectorProps> = ({
    groups,
    selectedParentId,
    onParentChange,
    excludeIds = [],
    label,
    noParentLabel = 'No Parent',
}) => {
    const { t } = useTranslation(['imageGroups', 'common']);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const memoizedExcludeIds = React.useMemo(() => excludeIds, [excludeIds]);
    const memoizedSelectedIds = React.useMemo(() => selectedParentId ? [selectedParentId] : [], [selectedParentId]);

    const {
        treeData,
        toggleExpand,
        expandAll,
        collapseAll,
        handleSelect,
        isExpanded,
        isSelected,
    } = useGroupTree({
        groups,
        excludeIds: memoizedExcludeIds,
        selectedIds: memoizedSelectedIds,
        onSelectionChange: (selectedIds) => {
            onParentChange(selectedIds[0] || null);
            // Close dropdown on selection
            setIsOpen(false);
        },
        multiSelect: false,
    });

    // Find selected group name for display
    const selectedGroup = selectedParentId
        ? groups.find((g) => g.id === selectedParentId)
        : null;

    // Handle clicking outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const renderTree = (nodes: ReturnType<typeof useGroupTree>['treeData']) => {
        return nodes.map((node) => (
            <React.Fragment key={node.group.id}>
                <GroupTreeItem
                    group={node.group}
                    level={node.level}
                    hasChildren={node.children.length > 0}
                    isExpanded={isExpanded(node.group.id)}
                    isSelected={isSelected(node.group.id)}
                    onToggleExpand={() => toggleExpand(node.group.id)}
                    onSelect={() => handleSelect(node.group.id)}
                />
                {isExpanded(node.group.id) && node.children.length > 0 && (
                    <div>{renderTree(node.children)}</div>
                )}
            </React.Fragment>
        ));
    };

    return (
        <div className="space-y-1.5" ref={dropdownRef}>
            {label && <label className="text-sm font-medium">{label}</label>}

            <div className="relative">
                {/* Selected Field Trigger */}
                <div
                    className={cn(
                        "flex items-center gap-2 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 cursor-pointer transition-all",
                        isOpen && "ring-2 ring-ring ring-offset-2 border-primary"
                    )}
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <div className="flex-grow flex items-center gap-2 overflow-hidden">
                        {selectedGroup ? (
                            <>
                                <div
                                    className="w-1 h-5 flex-shrink-0 bg-primary rounded-full"
                                    style={{ backgroundColor: selectedGroup.color || undefined }}
                                />
                                <span className="truncate">{selectedGroup.name}</span>
                            </>
                        ) : (
                            <span className="text-muted-foreground">{noParentLabel}</span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 ml-auto">
                        {selectedParentId && (
                            <button
                                type="button"
                                className="p-1 rounded-sm hover:bg-accent text-muted-foreground transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onParentChange(null);
                                }}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                        <ChevronDown className={cn(
                            "w-4 h-4 text-muted-foreground transition-transform duration-200",
                            isOpen && "transform rotate-180"
                        )} />
                    </div>
                </div>

                {/* Dropdown Menu */}
                {isOpen && (
                    <div className="absolute z-50 mt-1 w-full bg-popover text-popover-foreground shadow-lg rounded-md border border-border animate-in fade-in zoom-in duration-200 origin-top">
                        <div className="p-1.5 flex items-center gap-1 border-bottom bg-accent/30 rounded-t-md">
                            <div className="flex-grow flex items-center bg-background border rounded-md px-2 h-8">
                                <Search className="w-3.5 h-3.5 text-muted-foreground mr-1.5" />
                                <input
                                    className="bg-transparent border-none outline-none text-xs w-full"
                                    placeholder="Search..."
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    expandAll();
                                }}
                            >
                                <Maximize2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    collapseAll();
                                }}
                            >
                                <Minimize2 className="w-3.5 h-3.5" />
                            </Button>
                        </div>

                        <ScrollArea className="max-h-60 overflow-y-auto">
                            <div className="py-1">
                                {/* No Parent Option in Tree */}
                                <div
                                    className={cn(
                                        "flex items-center py-2 px-3 cursor-pointer text-sm transition-colors border-l-4",
                                        !selectedParentId
                                            ? "bg-primary/10 border-primary font-semibold"
                                            : "hover:bg-accent border-transparent text-muted-foreground"
                                    )}
                                    onClick={() => {
                                        onParentChange(null);
                                        setIsOpen(false);
                                    }}
                                >
                                    {noParentLabel}
                                </div>

                                {/* Recursive Tree */}
                                {treeData.length > 0 ? (
                                    <div className="py-1">{renderTree(treeData)}</div>
                                ) : (
                                    <div className="py-8 text-center text-xs text-muted-foreground italic">
                                        {t('imageGroups:messages.noGroupsAvailable')}
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                )}
            </div>
        </div>
    );
};
