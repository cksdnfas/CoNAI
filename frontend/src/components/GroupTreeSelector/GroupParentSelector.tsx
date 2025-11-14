import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Collapse,
  alpha,
  useTheme,
} from '@mui/material';
import { ExpandMore, Clear } from '@mui/icons-material';
import { GroupWithHierarchy } from '@shared/types/group';
import { useGroupTree } from './useGroupTree';
import { GroupTreeItem } from './GroupTreeItem';

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
  label = 'Parent Group',
  noParentLabel = 'No Parent',
}) => {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const {
    treeData,
    toggleExpand,
    handleSelect,
    isExpanded,
    isSelected,
  } = useGroupTree({
    groups,
    excludeIds,
    selectedIds: selectedParentId ? [selectedParentId] : [],
    onSelectionChange: (selectedIds) => {
      onParentChange(selectedIds[0] || null);
      setIsOpen(false);
    },
    multiSelect: false,
  });

  // Find selected group name
  const selectedGroup = selectedParentId
    ? groups.find((g) => g.id === selectedParentId)
    : null;

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

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {label}
      </Typography>

      {/* Selected Value Display */}
      <Paper
        variant="outlined"
        sx={{
          padding: 1.5,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: isOpen
            ? alpha(theme.palette.primary.main, 0.05)
            : 'transparent',
          borderColor: isOpen ? 'primary.main' : 'divider',
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: 'primary.main',
            backgroundColor: alpha(theme.palette.primary.main, 0.02),
          },
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
          {selectedGroup ? (
            <>
              {selectedGroup.color && (
                <Box
                  sx={{
                    width: 4,
                    height: 20,
                    backgroundColor: selectedGroup.color,
                    borderRadius: 1,
                  }}
                />
              )}
              <Typography variant="body2">{selectedGroup.name}</Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {noParentLabel}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {selectedParentId && (
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onParentChange(null);
              }}
              sx={{ minWidth: 'auto', padding: 0.5 }}
            >
              <Clear fontSize="small" />
            </Button>
          )}
          <ExpandMore
            sx={{
              transition: 'transform 0.2s ease',
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </Box>
      </Paper>

      {/* Tree Dropdown */}
      <Collapse in={isOpen}>
        <Paper
          variant="outlined"
          sx={{
            mt: 1,
            maxHeight: 300,
            overflowY: 'auto',
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
          }}
        >
          {/* No Parent Option */}
          <Box
            sx={{
              padding: 1.5,
              cursor: 'pointer',
              backgroundColor: !selectedParentId
                ? alpha(theme.palette.primary.main, 0.15)
                : 'transparent',
              borderLeft: !selectedParentId
                ? `3px solid ${theme.palette.primary.main}`
                : '3px solid transparent',
              transition: 'all 0.2s ease',
              '&:hover': {
                backgroundColor: alpha(theme.palette.action.hover, 0.08),
              },
            }}
            onClick={() => {
              onParentChange(null);
              setIsOpen(false);
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {noParentLabel}
            </Typography>
          </Box>

          {/* Tree View */}
          {treeData.length > 0 ? (
            <Box sx={{ paddingY: 0.5 }}>{renderTree(treeData)}</Box>
          ) : (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 100,
                color: 'text.secondary',
              }}
            >
              <Typography variant="body2">No groups available</Typography>
            </Box>
          )}
        </Paper>
      </Collapse>
    </Box>
  );
};
