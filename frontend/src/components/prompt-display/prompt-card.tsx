import { useCallback, useState, type MouseEvent, type ReactNode } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY_PREFIX = 'promptCard_collapsed_'

const COLOR_MAP: Record<string, string> = {
  'primary.main': 'hsl(var(--primary))',
  'error.main': 'hsl(0 72% 50%)',
  'warning.main': 'hsl(38 92% 50%)',
  'success.main': 'hsl(142 76% 36%)',
}

function resolveColor(color: string) {
  return COLOR_MAP[color] ?? color
}

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

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
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
  const resolvedColor = resolveColor(color)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className={`flex select-none items-center justify-between px-3 py-2 transition-colors hover:bg-muted/40 ${collapsed ? '' : 'border-b border-border'}`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}
            aria-hidden="true"
          />
          {icon ? <span className="flex text-base" style={{ color: resolvedColor }}>{icon}</span> : null}
          <span
            className="text-[0.7rem] font-bold uppercase tracking-wide"
            style={{ color: resolvedColor }}
          >
            {title}
          </span>
        </button>

        <div className="flex items-center gap-2">
          {headerExtra}
          {textToCopy ? (
            <button
              type="button"
              onClick={handleCopy}
              className={`inline-flex items-center justify-center rounded p-1 transition-colors ${copied ? 'text-emerald-600' : 'text-muted-foreground hover:text-foreground'}`}
              title={copied ? t('promptDisplay.copied', 'Copied!') : t('promptDisplay.copy', 'Copy')}
              aria-label={copied ? t('promptDisplay.copied', 'Copied!') : t('promptDisplay.copy', 'Copy')}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <div className="px-3 py-3">
          {children || (
            <p
              className="text-[0.8rem] leading-relaxed text-foreground"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {content}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
