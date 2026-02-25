import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Collapse,
  Chip,
  IconButton,
  alpha,
  useTheme,
} from '@mui/material';
import {
  ExpandMore,
  Clear,
  ChevronRight,
  ExpandMore as ExpandMoreIcon,
  Folder,
  FolderOpen,
} from '@mui/icons-material';

// Generic hierarchy item interface
interface HierarchyItem {
  id: number;
  name: string;
  parent_id?: number | null;
  children?: HierarchyItem[];
  color?: string;
  // For groups
  image_count?: number;
  auto_collect_enabled?: boolean;
  // For wildcards
  item_count?: number;
}

interface HierarchyParentSelectorProps<T extends HierarchyItem> {
  items: T[];
  selectedParentId: number | null;
  onParentChange: (parentId: number | null) => void;
  excludeIds?: number[];
  label?: string;
  noParentLabel?: string;
  showItemCount?: boolean;
}

interface TreeNode<T extends HierarchyItem> {
  item: T;
  level: number;
  children: TreeNode<T>[];
}

export function HierarchyParentSelector<T extends HierarchyItem>({
  items,
  selectedParentId,
  onParentChange,
  excludeIds = [],
  label = 'Parent',
  noParentLabel = 'None (Root Level)',
  showItemCount = true,
}: HierarchyParentSelectorProps<T>) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Build tree structure
  const buildTree = (parentId: number | null = null, level: number = 0): TreeNode<T>[] => {
    return items
      .filter((item) => {
        const itemParentId = item.parent_id ?? null;
        return itemParentId === parentId && !excludeIds.includes(item.id);
      })
      .map((item) => ({
        item,
        level,
        children: buildTree(item.id, level + 1),
      }));
  };

  const treeData = buildTree();

  // Find selected item
  const selectedItem = selectedParentId
    ? items.find((item) => item.id === selectedParentId)
    : null;

  // Toggle expand
  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Render tree item
  const renderTreeItem = (node: TreeNode<T>) => {
    const isExpanded = expandedIds.has(node.item.id);
    const isSelected = selectedParentId === node.item.id;
    const hasChildren = node.children.length > 0;
    const itemColor = node.item.color || theme.palette.primary.main;
    const itemCount = node.item.image_count ?? node.item.item_count ?? 0;

    return (
      <React.Fragment key={node.item.id}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            paddingLeft: `${node.level * 24 + 8}px`,
            paddingRight: '8px',
            paddingY: 0.5,
            cursor: 'pointer',
            backgroundColor: isSelected
              ? alpha(itemColor, 0.15)
              : 'transparent',
            borderLeft: isSelected
              ? `3px solid ${itemColor}`
              : '3px solid transparent',
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: isSelected
                ? alpha(itemColor, 0.2)
                : alpha(theme.palette.action.hover, 0.08),
            },
          }}
          onClick={() => {
            onParentChange(node.item.id);
            if (hasChildren) {
              toggleExpand(node.item.id);
            }
          }}
        >
          {/* Expand/Collapse Button */}
          <Box sx={{ width: 24, height: 24, flexShrink: 0 }}>
            {hasChildren && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(node.item.id);
                }}
                sx={{ padding: 0 }}
              >
                {isExpanded ? (
                  <ExpandMoreIcon fontSize="small" />
                ) : (
                  <ChevronRight fontSize="small" />
                )}
              </IconButton>
            )}
          </Box>

          {/* Folder Icon */}
          <Box
            sx={{
              width: 24,
              height: 24,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 0.5,
              marginRight: 1,
              color: itemColor,
            }}
          >
            {isExpanded && hasChildren ? (
              <FolderOpen fontSize="small" />
            ) : (
              <Folder fontSize="small" />
            )}
          </Box>

          {/* Color Bar */}
          {node.item.color && (
            <Box
              sx={{
                width: 4,
                height: 24,
                backgroundColor: itemColor,
                borderRadius: 1,
                marginRight: 1.5,
                flexShrink: 0,
              }}
            />
          )}

          {/* Item Name */}
          <Typography
            variant="body2"
            sx={{
              flexGrow: 1,
              fontWeight: isSelected ? 600 : 400,
              color: isSelected
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {node.item.name}
          </Typography>

          {/* Item Count */}
          {showItemCount && itemCount > 0 && (
            <Chip
              label={itemCount}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.7rem',
                marginLeft: 1,
                marginRight: 1,
                backgroundColor: alpha(theme.palette.primary.main, 0.1),
                color: theme.palette.primary.main,
              }}
            />
          )}
        </Box>

        {/* Render Children */}
        {isExpanded && hasChildren && (
          <Box>{node.children.map((child) => renderTreeItem(child))}</Box>
        )}
      </React.Fragment>
    );
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
          {selectedItem ? (
            <>
              {selectedItem.color && (
                <Box
                  sx={{
                    width: 4,
                    height: 20,
                    backgroundColor: selectedItem.color,
                    borderRadius: 1,
                  }}
                />
              )}
              <Typography variant="body2">{selectedItem.name}</Typography>
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
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {noParentLabel}
            </Typography>
          </Box>

          {/* Tree View */}
          {treeData.length > 0 ? (
            <Box sx={{ paddingY: 0.5 }}>
              {treeData.map((node) => renderTreeItem(node))}
            </Box>
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
              <Typography variant="body2">No items available</Typography>
            </Box>
          )}
        </Paper>
      </Collapse>
    </Box>
  );
}
