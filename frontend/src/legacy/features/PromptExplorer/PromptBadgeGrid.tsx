import React, { useState } from 'react';
import {
    Box,
    Paper,
    Typography,
    Chip,
    IconButton,
    Tooltip,
    Divider,
    Stack,
    Button
} from '@mui/material';
import {
    SortByAlpha as SortIcon,
    Delete as DeleteIcon,
    DriveFileMove as MoveIcon,
    SelectAll as SelectAllIcon,
    Deselect as DeselectIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { PromptSearchResult } from '@comfyui-image-manager/shared';
import type { PromptGroupWithChildren } from './utils';
import { MovePromptDialog } from './MovePromptDialog';

interface PromptBadgeGridProps {
    prompts: PromptSearchResult[];
    selectedGroup: PromptGroupWithChildren | null;
    selectedIds: Set<number>;
    onToggleSelection: (id: number, multiSelect: boolean) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onMovePrompts: (targetGroupId: number | null) => Promise<void>;
    onDeletePrompts: () => Promise<void>;
    groups: PromptGroupWithChildren[]; // For move dialog
    subGroups?: PromptGroupWithChildren[];
    onGroupClick?: (group: PromptGroupWithChildren) => void;
    onDeleteGroup?: () => Promise<void>;
    isSearching?: boolean;
}

export function PromptBadgeGrid({
    prompts = [],
    selectedGroup,
    selectedIds,
    onToggleSelection,
    onSelectAll,
    onClearSelection,
    onMovePrompts,
    onDeletePrompts,
    groups,
    subGroups = [],
    onGroupClick,
    onDeleteGroup,
    isSearching = false
}: PromptBadgeGridProps) {
    const { t } = useTranslation(['common']);
    const [moveDialogOpen, setMoveDialogOpen] = useState(false);

    // Function to handle click with modifier keys
    const handleChipClick = (id: number, event: React.MouseEvent) => {
        const isMulti = event.ctrlKey || event.metaKey || event.shiftKey;
        onToggleSelection(id, true);
    };

    const selectedCount = selectedIds.size;

    // Grouping Logic for Search Results
    const groupedResults = React.useMemo(() => {
        if (!isSearching) return null;

        const map = new Map<number | 'uncategorized', PromptSearchResult[]>();

        prompts.forEach(p => {
            const key = p.group_id || 'uncategorized';
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(p);
        });

        // Helper to find group name
        const findGroupName = (id: number, nodes: PromptGroupWithChildren[]): string => {
            for (const node of nodes) {
                if (node.id === id) return node.group_name;
                if (node.children) {
                    const found = findGroupName(id, node.children);
                    if (found) return found;
                }
            }
            return '';
        };

        const result: { id: number | 'uncategorized', name: string, prompts: PromptSearchResult[] }[] = [];

        map.forEach((prompts, key) => {
            let name = 'Uncategorized';
            if (key !== 'uncategorized') {
                name = findGroupName(key as number, groups) || `Group ${key}`;
            }
            result.push({ id: key, name, prompts });
        });

        // Sort by name (Groups first, then Uncategorized?)
        return result.sort((a, b) => a.name.localeCompare(b.name));

    }, [prompts, isSearching, groups]);

    return (
        <Box
            sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden'
            }}
        >
            {/* Header / Toolbar */}
            <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle1" sx={{ ml: 1, fontWeight: 'bold' }}>
                    {isSearching ? `${t('search:searchBar.buttons.search', 'Search Results')} (${prompts.length})` :
                        (selectedGroup ? selectedGroup.group_name : 'All Prompts') + ` (${prompts.length})`}
                </Typography>

                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

                <Tooltip title="Select All">
                    <IconButton size="small" onClick={onSelectAll}>
                        <SelectAllIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Unselect All">
                    <span>
                        <IconButton size="small" onClick={onClearSelection} disabled={selectedCount === 0}>
                            <DeselectIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>

                <Box sx={{ flex: 1 }} />

                {/* Only show Delete Group if NOT searching and a group is selected */}
                {!isSearching && selectedGroup && onDeleteGroup && (
                    <Button
                        variant="outlined"
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        onClick={onDeleteGroup}
                        sx={{ mr: 1 }}
                    >
                        Delete Group
                    </Button>
                )}

                {selectedCount > 0 && (
                    <Stack direction="row" spacing={1}>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<MoveIcon />}
                            onClick={() => setMoveDialogOpen(true)}
                        >
                            Move ({selectedCount})
                        </Button>
                        <Button
                            variant="outlined"
                            size="small"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={onDeletePrompts}
                        >
                            Delete ({selectedCount})
                        </Button>
                    </Stack>
                )}
            </Box>

            {/* Grid Content */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                {/* Sub-groups Section */}
                {subGroups.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            Folders
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {subGroups.map((group) => (
                                <Paper
                                    key={group.id}
                                    variant="outlined"
                                    sx={{
                                        p: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        cursor: 'pointer',
                                        minWidth: 120,
                                        '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                    onClick={() => onGroupClick?.(group)}
                                >
                                    <Box component="span" sx={{ fontSize: 20 }}>📁</Box>
                                    <Typography variant="body2" noWrap>
                                        {group.group_name}
                                    </Typography>
                                </Paper>
                            ))}
                        </Box>
                        <Divider sx={{ my: 2 }} />
                    </Box>
                )}

                {/* Prompts Section */}
                {isSearching && groupedResults ? (
                    <Box component="div">
                        {groupedResults.map((group) => (
                            <Box key={group.id} sx={{ mb: 3 }}>
                                <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                                    {group.id === 'uncategorized' ? 'Uncategorized' : (
                                        <>
                                            <span style={{ marginRight: 8 }}>📁</span> {group.name}
                                        </>
                                    )}
                                    <Typography component="span" variant="caption" sx={{ ml: 1 }}>({group.prompts.length})</Typography>
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                    {group.prompts.map((prompt) => {
                                        const isSelected = selectedIds.has(prompt.id);
                                        return (
                                            <Chip
                                                key={prompt.id}
                                                label={`${prompt.prompt} (${prompt.usage_count})`}
                                                onClick={(e) => handleChipClick(prompt.id, e)}
                                                color={isSelected ? 'primary' : 'default'}
                                                variant={isSelected ? 'filled' : 'outlined'}
                                                sx={{
                                                    cursor: 'pointer',
                                                    '&:hover': {
                                                        bgcolor: isSelected ? 'primary.dark' : 'action.hover'
                                                    }
                                                }}
                                            />
                                        );
                                    })}
                                </Box>
                                <Divider sx={{ mt: 2 }} />
                            </Box>
                        ))}
                        {groupedResults.length === 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100px' }}>
                                <Typography color="text.secondary">No matching prompts found.</Typography>
                            </Box>
                        )}
                    </Box>
                ) : (
                    prompts.length > 0 ? (
                        <Box>
                            {/* Original render for non-search */}
                            {userWantsGroupedView && <Typography variant="subtitle2" color="text.secondary" gutterBottom>Prompts</Typography>}
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {prompts.map((prompt) => {
                                    const isSelected = selectedIds.has(prompt.id);
                                    return (
                                        <Chip
                                            key={prompt.id}
                                            label={`${prompt.prompt} (${prompt.usage_count})`}
                                            onClick={(e) => handleChipClick(prompt.id, e)}
                                            color={isSelected ? 'primary' : 'default'}
                                            variant={isSelected ? 'filled' : 'outlined'}
                                            sx={{
                                                cursor: 'pointer',
                                                '&:hover': {
                                                    bgcolor: isSelected ? 'primary.dark' : 'action.hover'
                                                }
                                            }}
                                        />
                                    );
                                })}
                            </Box>
                        </Box>
                    ) : (
                        subGroups.length === 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50%' }}>
                                <Typography color="text.secondary">No groups or prompts found.</Typography>
                            </Box>
                        )
                    )
                )}
            </Box>

            <MovePromptDialog
                open={moveDialogOpen}
                onClose={() => setMoveDialogOpen(false)}
                onConfirm={onMovePrompts}
                groups={groups}
                selectedCount={selectedCount}
            />
        </Box>
    );
}

// Helper to determine if we should show header (if subGroups exist)
const userWantsGroupedView = true; 
