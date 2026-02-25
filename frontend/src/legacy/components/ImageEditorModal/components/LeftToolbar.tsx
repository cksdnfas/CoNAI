import React from 'react';
import { Box, IconButton, Tooltip, Divider } from '@mui/material';
import {
  Brush,
  Delete,
  RotateRight,
  Flip,
  Crop,
  PanTool,
  Undo,
  Redo,
  SelectAll,
  ContentCut,
  ContentCopy,
  ContentPaste,
  HighlightAlt,
  Gesture,
  Check,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { Tool } from '../types/EditorTypes';

interface LeftToolbarProps {
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  hasPasteLayer: boolean;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onRotate: () => void;
  onFlip: () => void;
  onSelectAll: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onApplyCrop: () => void;
  onApplyPaste: () => void;
}

export const LeftToolbar: React.FC<LeftToolbarProps> = ({
  tool,
  canUndo,
  canRedo,
  hasSelection,
  hasClipboard,
  hasPasteLayer,
  onToolChange,
  onUndo,
  onRedo,
  onClear,
  onRotate,
  onFlip,
  onSelectAll,
  onCut,
  onCopy,
  onPaste,
  onApplyCrop,
  onApplyPaste,
}) => {
  const { t } = useTranslation('common');

  const ToolButton: React.FC<{
    toolName: Tool;
    icon: React.ReactNode;
    tooltip: string;
  }> = ({ toolName, icon, tooltip }) => (
    <Tooltip title={tooltip} placement="right">
      <IconButton
        onClick={() => onToolChange(toolName)}
        color={tool === toolName ? 'primary' : 'default'}
        size="medium"
        sx={{
          bgcolor: tool === toolName ? 'action.selected' : 'transparent',
          '&:hover': {
            bgcolor: tool === toolName ? 'action.selected' : 'action.hover',
          },
        }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );

  return (
    <Box
      sx={{
        width: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        py: 1,
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflowY: 'auto',
      }}
    >
      {/* Navigation Tools */}
      <ToolButton toolName="pan" icon={<PanTool />} tooltip={t('imageEditor.tools.pan', 'Pan (Space)')} />

      <Divider sx={{ width: '80%', my: 0.5 }} />

      {/* Selection Tools */}
      <ToolButton toolName="select" icon={<HighlightAlt />} tooltip={t('imageEditor.tools.select', 'Rectangle Select (M)')} />
      <ToolButton toolName="lasso" icon={<Gesture />} tooltip={t('imageEditor.tools.lasso', 'Lasso Select (L)')} />

      <Divider sx={{ width: '80%', my: 0.5 }} />

      {/* Drawing Tools */}
      <ToolButton toolName="brush" icon={<Brush />} tooltip={t('imageEditor.tools.brush', 'Brush (B)')} />
      <Tooltip title={t('imageEditor.tools.eraser', 'Eraser (E)')} placement="right">
        <IconButton
          onClick={() => onToolChange('eraser')}
          color={tool === 'eraser' ? 'primary' : 'default'}
          size="medium"
          sx={{
            bgcolor: tool === 'eraser' ? 'action.selected' : 'transparent',
            '&:hover': {
              bgcolor: tool === 'eraser' ? 'action.selected' : 'action.hover',
            },
          }}
        >
          {/* Custom eraser icon SVG */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0M4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53l-6.36-6.36l-3.54 3.53c-.39.39-.39 1.02 0 1.41z" />
          </svg>
        </IconButton>
      </Tooltip>

      <Divider sx={{ width: '80%', my: 0.5 }} />

      {/* Crop Tool */}
      <ToolButton toolName="crop" icon={<Crop />} tooltip={t('imageEditor.tools.crop', 'Crop (C)')} />

      {/* Apply Crop Button (shown when crop tool is active) */}
      {tool === 'crop' && (
        <Tooltip title={t('imageEditor.actions.applyCrop', 'Apply Crop (Enter)')} placement="right">
          <IconButton onClick={onApplyCrop} size="medium" color="success">
            <Check />
          </IconButton>
        </Tooltip>
      )}

      <Divider sx={{ width: '80%', my: 0.5 }} />

      {/* Edit Actions */}
      <Tooltip title={t('imageEditor.actions.undo', 'Undo (Ctrl+Z)')} placement="right">
        <span>
          <IconButton onClick={onUndo} disabled={!canUndo} size="medium">
            <Undo />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title={t('imageEditor.actions.redo', 'Redo (Ctrl+Y)')} placement="right">
        <span>
          <IconButton onClick={onRedo} disabled={!canRedo} size="medium">
            <Redo />
          </IconButton>
        </span>
      </Tooltip>

      <Divider sx={{ width: '80%', my: 0.5 }} />

      {/* Clipboard Actions */}
      <Tooltip title={t('imageEditor.actions.selectAll', 'Select All (Ctrl+A)')} placement="right">
        <IconButton onClick={onSelectAll} size="medium">
          <SelectAll />
        </IconButton>
      </Tooltip>

      <Tooltip title={t('imageEditor.actions.cut', 'Cut (Ctrl+X)')} placement="right">
        <span>
          <IconButton onClick={onCut} disabled={!hasSelection} size="medium">
            <ContentCut />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title={t('imageEditor.actions.copy', 'Copy (Ctrl+C)')} placement="right">
        <span>
          <IconButton onClick={onCopy} disabled={!hasSelection} size="medium">
            <ContentCopy />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title={t('imageEditor.actions.paste', 'Paste (Ctrl+V)')} placement="right">
        <span>
          <IconButton onClick={onPaste} disabled={!hasClipboard} size="medium">
            <ContentPaste />
          </IconButton>
        </span>
      </Tooltip>

      {/* Apply Paste Button (shown when paste layer exists) */}
      {hasPasteLayer && (
        <Tooltip title={t('imageEditor.actions.applyPaste', 'Apply Paste (Enter)')} placement="right">
          <IconButton onClick={onApplyPaste} size="medium" color="success">
            <Check />
          </IconButton>
        </Tooltip>
      )}

      <Divider sx={{ width: '80%', my: 0.5 }} />

      {/* Transform Actions */}
      <Tooltip title={t('imageEditor.actions.rotate', 'Rotate 90° (R)')} placement="right">
        <IconButton onClick={onRotate} size="medium">
          <RotateRight />
        </IconButton>
      </Tooltip>

      <Tooltip title={t('imageEditor.actions.flip', 'Flip Horizontal (F)')} placement="right">
        <IconButton onClick={onFlip} size="medium">
          <Flip />
        </IconButton>
      </Tooltip>

      <Divider sx={{ width: '80%', my: 0.5 }} />

      {/* Other Actions */}
      <Tooltip title={t('imageEditor.actions.clear', 'Clear All')} placement="right">
        <IconButton onClick={onClear} size="medium" color="error">
          <Delete />
        </IconButton>
      </Tooltip>
    </Box>
  );
};
