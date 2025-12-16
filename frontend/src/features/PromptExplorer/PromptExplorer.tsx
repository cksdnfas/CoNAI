import React, { useState, useEffect, useMemo } from 'react';
import { Box, useTheme, useMediaQuery, CircularProgress, Alert, Divider } from '@mui/material';
import {
    Add as AddIcon,
    KeyboardArrowDown as KeyboardArrowDownIcon,
    KeyboardArrowUp as KeyboardArrowUpIcon,
    Search as SearchIcon,
    Clear as ClearIcon
} from '@mui/icons-material';
import { CreateGroupDialog } from './CreateGroupDialog';
import { IconButton, Tooltip, Typography, TextField, InputAdornment } from '@mui/material';
import {
    promptCollectionApi,
    promptGroupApi
} from '../../services/api/promptApi';
import type { PromptSearchResult } from '@comfyui-image-manager/shared';
import { GroupTreePanel } from './GroupTreePanel';
import { PromptBadgeGrid } from './PromptBadgeGrid';
import { buildGroupTree } from './utils';
import type { PromptGroupWithChildren } from './utils';
import {
    usePromptGroups,
    useGroupPrompts,
    useSearchPrompts,
    useCreatePromptGroup,
    useDeletePromptGroup,
    useMovePrompts,
    useDeletePrompts
} from '../../hooks/usePrompts';

interface PromptExplorerProps {
    type: 'positive' | 'negative' | 'auto';
}

export function PromptExplorer({ type }: PromptExplorerProps) {

    // Data Queries
    const { data: rawGroups = [], isLoading: groupsLoading, error: groupsError } = usePromptGroups(type);

    // Derived Tree Data
    const treeData = useMemo(() => {
        if (!rawGroups) return [];
        return buildGroupTree(rawGroups);
    }, [rawGroups]);

    // Selection State
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
    const [selectedPromptIds, setSelectedPromptIds] = useState<Set<number>>(new Set());
    const [createGroupOpen, setCreateGroupOpen] = useState(false);

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);

    // Prompt Queries
    // If Searching, use search query. Else use group query.
    // Note: We can only have one "active" prompt list source. 

    const { data: groupPrompts = [], isLoading: groupPromptsLoading } = useGroupPrompts(
        selectedGroupId,
        type,
        !isSearching // Only fetch group prompts if NOT searching
    );

    const { data: searchResults = [], isLoading: searchLoading } = useSearchPrompts(
        searchQuery,
        type,
        isSearching // Enabled only if searching
    );

    const prompts = isSearching ? searchResults : groupPrompts;
    const loading = groupsLoading || (isSearching ? searchLoading : groupPromptsLoading);
    const error = groupsError ? (groupsError as Error).message : null; // Simple error handling

    // Mutations
    const createGroupMutation = useCreatePromptGroup();
    const deleteGroupMutation = useDeletePromptGroup();
    const movePromptsMutation = useMovePrompts();
    const deletePromptsMutation = useDeletePrompts();

    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    // Handlers
    const handleSearch = (query: string) => {
        setSearchQuery(query);
        setIsSearching(!!query);
    };

    const handleGroupSelect = (node: PromptGroupWithChildren) => {
        if (!isSearching) {
            setSelectedGroupId(node.id);
        } else {
            setSearchQuery('');
            setIsSearching(false);
            setSelectedGroupId(node.id);
        }
        setSelectedPromptIds(new Set());
    };

    const handleToggleGroup = (id: number) => {
        const newExpanded = new Set(expandedIds);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedIds(newExpanded);
    };

    const handleExpandAll = () => {
        const allIds = new Set(rawGroups.map(g => g.id));
        setExpandedIds(allIds);
    };

    const handleCollapseAll = () => {
        setExpandedIds(new Set());
    };

    const handleTogglePromptSelection = (id: number, multiSelect: boolean) => {
        const newSelected = new Set(multiSelect ? selectedPromptIds : []);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedPromptIds(newSelected);
    };

    const handleSelectAll = () => {
        const allIds = new Set(prompts.map(p => p.id));
        setSelectedPromptIds(allIds);
    };

    const handleClearSelection = () => {
        setSelectedPromptIds(new Set());
    };

    const handleMovePrompts = async (targetGroupId: number | null) => {
        if (selectedPromptIds.size === 0) return;

        const validIds = Array.from(selectedPromptIds).filter(id => id !== undefined && id !== null && calcIsValidId(id));
        if (validIds.length === 0) return;

        try {
            await movePromptsMutation.mutateAsync({
                promptIds: validIds,
                targetGroupId,
                type
            });
            setSelectedPromptIds(new Set());
        } catch (err) {
            console.error('Failed to move prompts:', err);
        }
    };

    const calcIsValidId = (id: any) => typeof id === 'number' && !isNaN(id);

    const handleDeletePrompts = async () => {
        if (!window.confirm(`Are you sure you want to delete ${selectedPromptIds.size} prompts?`)) return;

        try {
            await deletePromptsMutation.mutateAsync({
                promptIds: Array.from(selectedPromptIds),
                type
            });
            setSelectedPromptIds(new Set());
        } catch (err) {
            console.error('Failed to delete prompts:', err);
        }
    };

    const handleCreateGroup = async (name: string, parentId: number | null) => {
        try {
            await createGroupMutation.mutateAsync({
                name,
                parentId,
                type
            });
        } catch (err) {
            console.error('Failed to create group:', err);
        }
    };

    const handleDeleteGroup = async () => {
        if (selectedGroupId === null) return;
        if (!window.confirm('Are you sure you want to delete this group? Sub-groups and prompts usage counts will be preserved but unlinked.')) return;

        try {
            await deleteGroupMutation.mutateAsync({
                id: selectedGroupId,
                type
            });
            setSelectedGroupId(null);
        } catch (err) {
            console.error('Failed to delete group:', err);
        }
    };

    const selectedGroupNode = useMemo(() => {
        if (selectedGroupId === null) return null;
        // Recursive search for the node in the tree
        const findNode = (nodes: PromptGroupWithChildren[]): PromptGroupWithChildren | null => {
            for (const node of nodes) {
                if (node.id === selectedGroupId) return node;
                if (node.children) {
                    const found = findNode(node.children);
                    if (found) return found;
                }
            }
            return null;
        };
        return findNode(treeData);
    }, [selectedGroupId, treeData]);

    const subGroups = useMemo(() => {
        if (selectedGroupId === null) {
            return treeData; // Root groups
        }
        return selectedGroupNode?.children || [];
    }, [selectedGroupId, selectedGroupNode, treeData]);


    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                height: { xs: 'auto', md: 'calc(100vh - 240px)' }, // Dynamic height
                minHeight: '500px',
                gap: 2, // Restore gap
            }}
        >
            <Box
                sx={{
                    width: { xs: '100%', md: 280 },
                    display: 'flex',
                    flexDirection: 'column',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'background.paper',
                    overflow: 'hidden'
                }}
            >
                <Box
                    sx={{
                        p: 1,
                        cursor: 'pointer',
                        bgcolor: selectedGroupId === null ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                        display: 'flex',
                        alignItems: 'center'
                    }}
                    onClick={() => {
                        setSelectedGroupId(null);
                        setSearchQuery('');
                        setIsSearching(false);
                    }}
                >
                    <Typography variant="body2" sx={{ ml: 1 }}>All Prompts</Typography>
                </Box>
                <Divider />
                <GroupTreePanel
                    data={treeData}
                    selectedId={selectedGroupId}
                    expandedIds={expandedIds}
                    onSelect={handleGroupSelect}
                    onToggle={handleToggleGroup}
                    onExpandAll={handleExpandAll}
                    onCollapseAll={handleCollapseAll}
                    onAddGroup={() => setCreateGroupOpen(true)}
                />
            </Box>

            <Box
                sx={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: 'background.paper',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    overflow: 'hidden'
                }}
            >
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="Search prompts..."
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon color="action" />
                                </InputAdornment>
                            ),
                            endAdornment: searchQuery && (
                                <InputAdornment position="end">
                                    <IconButton size="small" onClick={() => handleSearch('')}>
                                        <ClearIcon fontSize="small" />
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                    />
                </Box>

                {loading && <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box>}
                {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

                <PromptBadgeGrid
                    prompts={prompts}
                    selectedGroup={selectedGroupNode}
                    selectedIds={selectedPromptIds}
                    onToggleSelection={handleTogglePromptSelection}
                    onSelectAll={handleSelectAll}
                    onClearSelection={handleClearSelection}
                    onMovePrompts={handleMovePrompts}
                    onDeletePrompts={handleDeletePrompts}
                    groups={treeData}
                    subGroups={!isSearching ? subGroups : []}
                    onGroupClick={(group) => {
                        handleGroupSelect(group);
                        if (selectedGroupId !== null) {
                            handleToggleGroup(selectedGroupId);
                        }
                    }}
                    onDeleteGroup={selectedGroupId !== null ? handleDeleteGroup : undefined}
                    isSearching={isSearching}
                />
            </Box>

            <CreateGroupDialog
                open={createGroupOpen}
                onClose={() => setCreateGroupOpen(false)}
                onCreate={handleCreateGroup}
                groups={treeData}
            />
        </Box>
    );
}
