import React, { useState } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Tooltip,
  Typography,
  Paper,
  InputAdornment,
} from '@mui/material';
import {
  UnfoldMore,
  UnfoldLess,
  Search,
  Clear,
} from '@mui/icons-material';
import type { GroupWithHierarchy } from '@comfyui-image-manager/shared';
import { useGroupTree } from './useGroupTree';
import { GroupTreeItem } from './GroupTreeItem';

interface GroupTreeSelectorProps {
  groups: GroupWithHierarchy[];
  selectedIds?: number[];
  onSelectionChange?: (selectedIds: number[]) => void;
  excludeIds?: number[];
  multiSelect?: boolean;
  showSearch?: boolean;
  emptyMessage?: string;
  maxHeight?: number | string;
}

export const GroupTreeSelector: React.FC<GroupTreeSelectorProps> = ({
  groups,
  selectedIds = [],
  onSelectionChange,
  excludeIds = [],
  multiSelect = false,
  showSearch = true,
  emptyMessage = 'No groups available',
  maxHeight = 400,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter groups by search query
  const filteredGroups = React.useMemo(() => {
    if (!searchQuery.trim()) return groups;

    const query = searchQuery.toLowerCase();
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(query) ||
        group.description?.toLowerCase().includes(query)
    );
  }, [groups, searchQuery]);

  const {
    treeData,
    toggleExpand,
    expandAll,
    collapseAll,
    handleSelect,
    isExpanded,
    isSelected,
  } = useGroupTree({
    groups: filteredGroups,
    excludeIds,
    selectedIds,
    onSelectionChange,
    multiSelect,
  });

  // Render tree recursively
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
          <Box>{renderTree(node.children)}</Box>
        )}
      </React.Fragment>
    ));
  };

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* Search and Controls */}
      {showSearch && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            fullWidth
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: searchQuery && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={handleClearSearch}>
                    <Clear fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <Tooltip title="Expand All">
            <IconButton size="small" onClick={expandAll}>
              <UnfoldMore />
            </IconButton>
          </Tooltip>
          <Tooltip title="Collapse All">
            <IconButton size="small" onClick={collapseAll}>
              <UnfoldLess />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* Tree View */}
      <Paper
        variant="outlined"
        sx={{
          maxHeight,
          overflowY: 'auto',
          overflowX: 'hidden',
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(0,0,0,0.2)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            backgroundColor: 'rgba(0,0,0,0.3)',
          },
        }}
      >
        {treeData.length > 0 ? (
          <Box sx={{ paddingY: 0.5 }}>{renderTree(treeData)}</Box>
        ) : (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 200,
              color: 'text.secondary',
            }}
          >
            <Typography variant="body2">{emptyMessage}</Typography>
          </Box>
        )}
      </Paper>

      {/* Selection Info */}
      {multiSelect && selectedIds.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {selectedIds.length} group{selectedIds.length !== 1 ? 's' : ''}{' '}
          selected
        </Typography>
      )}
    </Box>
  );
};
