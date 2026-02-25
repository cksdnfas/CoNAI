import { useMemo } from 'react';
import {
    Box,
    IconButton,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Collapse,
    Typography
} from '@mui/material';
import {
    FolderOpen as FolderOpenIcon,
    Folder as FolderClosedIcon,
    ExpandMore as ExpandMoreIcon,
    ChevronRight as ChevronRightIcon
} from '@mui/icons-material';
import type { PromptGroupWithChildren } from './utils';

interface GroupTreeNodeProps {
    node: PromptGroupWithChildren;
    level: number;
    selectedId: number | null;
    expandedIds: Set<number>;
    onSelect: (node: PromptGroupWithChildren) => void;
    onToggle: (id: number) => void;
    searchTerm?: string;
}

function HighlightedText({ text, searchTerm }: { text: string; searchTerm?: string }) {
    if (!searchTerm || !searchTerm.trim()) {
        return <>{text}</>;
    }

    const lowerText = text.toLowerCase();
    const lowerSearch = searchTerm.toLowerCase();
    const index = lowerText.indexOf(lowerSearch);

    if (index === -1) {
        return <>{text}</>;
    }

    const before = text.slice(0, index);
    const match = text.slice(index, index + searchTerm.length);
    const after = text.slice(index + searchTerm.length);

    return (
        <>
            {before}
            <Box
                component="span"
                sx={{
                    bgcolor: 'warning.main',
                    color: 'warning.contrastText',
                    borderRadius: 0.5,
                    px: 0.25
                }}
            >
                {match}
            </Box>
            {after}
        </>
    );
}

export function GroupTreeNode({
    node,
    level,
    selectedId,
    expandedIds,
    onSelect,
    onToggle,
    searchTerm
}: GroupTreeNodeProps) {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedId === node.id;

    const handleClick = () => {
        onSelect(node);
        if (hasChildren && !isExpanded) {
            onToggle(node.id);
        }
    };

    return (
        <>
            <ListItemButton
                onClick={handleClick}
                selected={isSelected}
                sx={{
                    pl: 1 + level * 2,
                    py: 0.5,
                    minHeight: 36,
                    '&.Mui-selected': {
                        bgcolor: 'primary.dark',
                        '&:hover': { bgcolor: 'primary.dark' }
                    }
                }}
            >
                {hasChildren ? (
                    <IconButton
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggle(node.id);
                        }}
                        sx={{ p: 0.25, mr: 0.5 }}
                    >
                        {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                    </IconButton>
                ) : (
                    <Box sx={{ width: 28 }} />
                )}
                <ListItemIcon sx={{ minWidth: 28 }}>
                    {isExpanded ? (
                        <FolderOpenIcon fontSize="small" color="primary" />
                    ) : (
                        <FolderClosedIcon fontSize="small" color="primary" />
                    )}
                </ListItemIcon>
                <ListItemText
                    primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <HighlightedText text={node.group_name} searchTerm={searchTerm} />
                            <Typography variant="caption" color="text.secondary">
                                ({node.prompt_count})
                            </Typography>
                        </Box>
                    }
                    primaryTypographyProps={{
                        variant: 'body2',
                        noWrap: true,
                        component: 'div',
                        sx: { fontWeight: isSelected ? 600 : 400 }
                    }}
                />
            </ListItemButton>
            {hasChildren && (
                <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                    {node.children!.map((child) => (
                        <GroupTreeNode
                            key={child.id}
                            node={child}
                            level={level + 1}
                            selectedId={selectedId}
                            expandedIds={expandedIds}
                            onSelect={onSelect}
                            onToggle={onToggle}
                            searchTerm={searchTerm}
                        />
                    ))}
                </Collapse>
            )}
        </>
    );
}
