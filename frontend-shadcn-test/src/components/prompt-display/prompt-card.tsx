import { useCallback, useState, type ReactNode } from 'react'
import { Box, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { Check as CheckIcon, ContentCopy as CopyIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY_PREFIX = 'promptCard_collapsed_'

interface PromptCardProps {
  cardId: string
  title: string
  icon?: ReactNode
  content?: string | null
  children?: ReactNode
  copyText?: string
  color?: string
  headerExtra?: ReactNode
}

export default function PromptCard({
  cardId,
  title,
  icon,
  content,
  children,
  copyText,
  color = 'primary.main',
  headerExtra,
}: PromptCardProps) {
  const { t } = useTranslation('promptManagement')
  const [copied, setCopied] = useState(false)

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_PREFIX + cardId) === 'true'
    } catch {
      return false
    }
  })

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY_PREFIX + cardId, String(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [cardId])

  const textToCopy = copyText || content || ''

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!textToCopy) return

    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const hasContent = content?.trim() || children
  if (!hasContent) return null

  return (
    <Box
      sx={{
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'),
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.015)'),
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
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
          borderColor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)'),
          bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'),
          transition: 'background-color 0.15s',
          '&:hover': {
            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)'),
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
          {icon ? <Box sx={{ display: 'flex', color, fontSize: '1rem' }}>{icon}</Box> : null}
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

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {headerExtra}
          {textToCopy ? (
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
          ) : null}
        </Box>
      </Box>

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
  )
}
