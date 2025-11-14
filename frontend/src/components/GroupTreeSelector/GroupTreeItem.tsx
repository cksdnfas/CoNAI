import React from 'react';
import {
  Box,
  Typography,
  Chip,
  IconButton,
  alpha,
  useTheme,
} from '@mui/material';
import {
  ChevronRight,
  ExpandMore,
  Folder,
  FolderOpen,
  AutoAwesome,
} from '@mui/icons-material';
import type { GroupWithHierarchy } from '@comfyui-image-manager/shared';

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
  const theme = useTheme();
  const groupColor = group.color || theme.palette.primary.main;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        paddingLeft: `${level * 24}px`,
        paddingY: 0.5,
        cursor: 'pointer',
        backgroundColor: isSelected
          ? alpha(groupColor, 0.15)
          : 'transparent',
        borderLeft: isSelected
          ? `3px solid ${groupColor}`
          : '3px solid transparent',
        transition: 'all 0.2s ease',
        '&:hover': {
          backgroundColor: isSelected
            ? alpha(groupColor, 0.2)
            : alpha(theme.palette.action.hover, 0.08),
        },
      }}
      onClick={onSelect}
    >
      {/* Expand/Collapse Button */}
      <Box sx={{ width: 24, height: 24, flexShrink: 0 }}>
        {hasChildren && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            sx={{ padding: 0 }}
          >
            {isExpanded ? (
              <ExpandMore fontSize="small" />
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
          color: groupColor,
        }}
      >
        {isExpanded && hasChildren ? (
          <FolderOpen fontSize="small" />
        ) : (
          <Folder fontSize="small" />
        )}
      </Box>

      {/* Color Bar */}
      <Box
        sx={{
          width: 4,
          height: 24,
          backgroundColor: groupColor,
          borderRadius: 1,
          marginRight: 1.5,
          flexShrink: 0,
        }}
      />

      {/* Group Name */}
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
        {group.name}
      </Typography>

      {/* Image Count */}
      {group.image_count !== undefined && group.image_count > 0 && (
        <Chip
          label={group.image_count}
          size="small"
          sx={{
            height: 20,
            fontSize: '0.7rem',
            marginLeft: 1,
            backgroundColor: alpha(theme.palette.primary.main, 0.1),
            color: theme.palette.primary.main,
          }}
        />
      )}

      {/* Auto-collect Badge */}
      {group.auto_collect_enabled && (
        <Chip
          icon={<AutoAwesome sx={{ fontSize: '0.8rem' }} />}
          label="Auto"
          size="small"
          color="secondary"
          sx={{
            height: 20,
            fontSize: '0.65rem',
            marginLeft: 0.5,
            '& .MuiChip-icon': {
              marginLeft: '4px',
            },
          }}
        />
      )}
    </Box>
  );
};
