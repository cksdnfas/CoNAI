import React, { useState, useCallback } from 'react';
import { Box, Typography, IconButton, Tooltip, Collapse } from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

const STORAGE_KEY_PREFIX = 'promptCard_collapsed_';

interface PromptCardProps {
  /** Unique ID for persisting collapse state */
  cardId: string;
  title: string;
  icon?: React.ReactNode;
  content?: string | null;
  children?: React.ReactNode;
  copyText?: string;
  color?: string;
}

/**
 * Reusable collapsible card module for displaying prompt sections.
 * Collapse state is persisted in localStorage across image changes.
 */
const PromptCard: React.FC<PromptCardProps> = ({
  cardId,
  title,
  icon,
  content,
  children,
  copyText,
  color = 'primary.main',
}) => {
  const { t } = useTranslation('promptManagement');
  const [copied, setCopied] = useState(false);

  // Initialize collapsed state from localStorage
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_PREFIX + cardId) === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_PREFIX + cardId, String(next));
      } catch { /* ignore */ }
      return next;
    });
  }, [cardId]);

  const textToCopy = copyText || content || '';

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const hasContent = content?.trim() || children;
  if (!hasContent) return null;

  return (
    <Box
      sx={{
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: (theme) =>
          theme.palette.mode === 'dark'
            ? 'rgba(255, 255, 255, 0.1)'
            : 'rgba(0, 0, 0, 0.1)',
        bgcolor: (theme) =>
          theme.palette.mode === 'dark'
            ? 'rgba(255, 255, 255, 0.02)'
            : 'rgba(0, 0, 0, 0.015)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Header - clickable to toggle collapse */}
      <Box
        onClick={toggleCollapsed}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 0.75,
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: collapsed ? 'none' : '1px solid',
          borderColor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.06)'
              : 'rgba(0, 0, 0, 0.06)',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.03)'
              : 'rgba(0, 0, 0, 0.02)',
          transition: 'background-color 0.15s',
          '&:hover': {
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.06)'
                : 'rgba(0, 0, 0, 0.04)',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <ExpandMoreIcon
            sx={{
              fontSize: '1rem',
              color: 'text.secondary',
              transition: 'transform 0.2s',
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            }}
          />
          {icon && (
            <Box sx={{ display: 'flex', color, fontSize: '1rem' }}>
              {icon}
            </Box>
          )}
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontSize: '0.7rem',
            }}
          >
            {title}
          </Typography>
        </Box>

        {textToCopy && (
          <Tooltip title={copied ? t('promptDisplay.copied', 'Copied!') : t('promptDisplay.copy', 'Copy')}>
            <IconButton
              size="small"
              onClick={handleCopy}
              sx={{
                p: 0.5,
                color: copied ? 'success.main' : 'text.secondary',
                '&:hover': { color: copied ? 'success.main' : 'text.primary' },
              }}
            >
              {copied ? <CheckIcon sx={{ fontSize: '0.9rem' }} /> : <CopyIcon sx={{ fontSize: '0.9rem' }} />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Collapsible Content */}
      <Collapse in={!collapsed}>
        <Box sx={{ px: 1.5, py: 1.25 }}>
          {children || (
            <Typography
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
                wordBreak: 'break-word',
                fontSize: '0.8rem',
                color: 'text.primary',
              }}
            >
              {content}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

export default PromptCard;
