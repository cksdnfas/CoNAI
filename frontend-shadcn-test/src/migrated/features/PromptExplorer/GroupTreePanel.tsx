import { useState, useMemo, useCallback } from 'react';
import {
    Box,
    Paper,
    List,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
    TextField,
    InputAdornment,
    IconButton
} from '@mui/material';
import {
    UnfoldMore as ExpandAllIcon,
    UnfoldLess as CollapseAllIcon,
    Search as SearchIcon,
    Clear as ClearIcon,
    Add as AddIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { GroupTreeNode } from './GroupTreeNode';
import type { PromptGroupWithChildren } from './utils';

interface GroupTreePanelProps {
    data: PromptGroupWithChildren[];
    selectedId: number | null;
    expandedIds: Set<number>;
    onSelect: (node: PromptGroupWithChildren) => void;
    onToggle: (id: number) => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    onAddGroup?: () => void;
}

function nodeMatchesSearch(node: PromptGroupWithChildren, searchTerm: string): boolean {
    const lowerSearch = searchTerm.toLowerCase();
    if (node.group_name.toLowerCase().includes(lowerSearch)) {
        return true;
    }
    if (node.children && node.children.length > 0) {
        return node.children.some(child => nodeMatchesSearch(child, searchTerm));
    }
    return false;
}

function filterTree(nodes: PromptGroupWithChildren[], searchTerm: string): PromptGroupWithChildren[] {
    if (!searchTerm.trim()) {
        return nodes;
    }
    return nodes.filter(node => nodeMatchesSearch(node, searchTerm)).map(node => {
        if (node.children && node.children.length > 0) {
            return {
                ...node,
                children: filterTree(node.children, searchTerm)
            };
        }
        return node;
    });
}

function collectMatchingParentIds(nodes: PromptGroupWithChildren[], searchTerm: string, parentIds: Set<number> = new Set()): Set<number> {
    const lowerSearch = searchTerm.toLowerCase();
    for (const node of nodes) {
        if (node.children && node.children.length > 0) {
            const hasMatchingChild = node.children.some(child => nodeMatchesSearch(child, searchTerm));
            if (hasMatchingChild || node.group_name.toLowerCase().includes(lowerSearch)) {
                parentIds.add(node.id);
            }
            collectMatchingParentIds(node.children, searchTerm, parentIds);
        }
    }
    return parentIds;
}

export function GroupTreePanel({
    data,
    selectedId,
    expandedIds,
    onSelect,
    onToggle,
    onExpandAll, // Keeping props but removing UI usage if redundant, or maybe requested to keep hidden?
    onCollapseAll,
    onAddGroup
}: GroupTreePanelProps) {
    const { t } = useTranslation(['common']);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [searchTerm, setSearchTerm] = useState('');

    const filteredData = useMemo(() => {
        return filterTree(data, searchTerm);
    }, [data, searchTerm]);

    const searchExpandedIds = useMemo(() => {
        if (!searchTerm.trim()) {
            return new Set<number>();
        }
        return collectMatchingParentIds(data, searchTerm);
    }, [data, searchTerm]);

    const effectiveExpandedIds = useMemo(() => {
        if (searchTerm.trim()) {
            return new Set([...expandedIds, ...searchExpandedIds]);
        }
        return expandedIds;
    }, [expandedIds, searchExpandedIds, searchTerm]);

    const handleClearSearch = useCallback(() => {
        setSearchTerm('');
    }, []);

    return (
        <Box
            sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}
        >
            {/* Search Bar and Add Button */}
            <Box sx={{ px: 1, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1 }}>
                <TextField
                    size="small"
                    fullWidth
                    placeholder={t('common:search') || 'Search...'}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                            </InputAdornment>
                        ),
                        endAdornment: searchTerm && (
                            <InputAdornment position="end">
                                <IconButton
                                    size="small"
                                    onClick={handleClearSearch}
                                    edge="end"
                                    sx={{ p: 0.5 }}
                                >
                                    <ClearIcon fontSize="small" />
                                </IconButton>
                            </InputAdornment>
                        )
                    }}
                />
                {onAddGroup && (
                    <Tooltip title="Create Group">
                        <IconButton size="small" onClick={onAddGroup} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <AddIcon />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>

            <List
                dense
                sx={{
                    flex: 1,
                    overflow: 'auto',
                    py: 0
                }}
            >
                {filteredData.length > 0 ? (
                    filteredData.map((node) => (
                        <GroupTreeNode
                            key={node.id}
                            node={node}
                            level={0}
                            selectedId={selectedId}
                            expandedIds={effectiveExpandedIds}
                            onSelect={onSelect}
                            onToggle={onToggle}
                            searchTerm={searchTerm}
                        />
                    ))
                ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, p: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            No groups found
                        </Typography>
                    </Box>
                )}
            </List>
        </Box>
    );
}
