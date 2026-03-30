import { useState } from 'react'
import { ChevronDown, Copy, FolderTree, GitBranch } from 'lucide-react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Badge } from '@/components/ui/badge'
import { getThemeToneStyle, getThemeToneTextStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import type { ExtractedPromptCardItem, ExtractedPromptGroupedSection } from '@/lib/image-extracted-prompts'

function getPromptToneStyle(tone: ExtractedPromptCardItem['tone']) {
  switch (tone) {
    case 'positive':
      return getThemeToneTextStyle('positive')
    case 'negative':
      return getThemeToneTextStyle('negative')
    case 'character':
      return { color: 'var(--primary)' }
    default:
      return undefined
  }
}

function getPromptBadgeStyle(label: string) {
  if (label === '그룹') {
    return getThemeToneStyle('rating')
  }

  return undefined
}

function getGroupedSectionIcon(section: ExtractedPromptGroupedSection) {
  if (section.kind === 'root') {
    return <FolderTree className="h-3.5 w-3.5 text-primary/80" />
  }

  if (section.kind === 'child') {
    return <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
  }

  return null
}

function getGroupedSectionTooltip(section: ExtractedPromptGroupedSection) {
  if (!section.hierarchyPath || section.hierarchyPath.length === 0) {
    return undefined
  }

  return section.hierarchyPath.join(' > ')
}

interface ExtractedPromptCardProps {
  item: ExtractedPromptCardItem
}

function ExtractedPromptGroupedBody({ sections }: { sections: ExtractedPromptGroupedSection[] }) {
  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const tooltip = getGroupedSectionTooltip(section)

        return (
          <div key={section.id} className="space-y-2">
            <div className="flex items-center gap-2">
              {getGroupedSectionIcon(section)}
              <span
                className={cn(
                  'inline-flex max-w-full items-center rounded-sm border border-border/70 bg-surface-low px-2 py-1 text-sm font-semibold text-foreground',
                  tooltip && 'cursor-help',
                )}
                title={tooltip}
              >
                {section.label}
              </span>
            </div>
            <div className="text-base leading-8 text-foreground/92 break-words">
              {section.prompts.join(', ')}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ExtractedPromptCard({ item }: ExtractedPromptCardProps) {
  const { showSnackbar } = useSnackbar()
  const [expanded, setExpanded] = useState(true)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.text)
      showSnackbar({ message: `${item.title}를 클립보드에 복사했어.`, tone: 'info' })
    } catch {
      showSnackbar({ message: `${item.title} 복사에 실패했어.`, tone: 'error' })
    }
  }

  return (
    <section className="overflow-hidden rounded-sm border border-white/8 bg-surface-lowest">
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label={expanded ? `${item.title} 접기` : `${item.title} 펼치기`}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded ? 'rotate-0' : '-rotate-90')} />
        </button>

        <div className={cn('min-w-0 text-sm font-semibold')} style={getPromptToneStyle(item.tone)}>{item.title}</div>

        <div className="ml-auto flex items-center gap-2">
          {(item.badges ?? []).map((badge) => (
            <Badge key={`${item.id}:${badge}`} variant={badge === '그룹' ? 'default' : 'secondary'} className="tracking-normal normal-case" style={getPromptBadgeStyle(badge)}>
              {badge}
            </Badge>
          ))}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-primary"
            onClick={handleCopy}
            aria-label={`${item.title} 복사`}
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="px-4 py-4 text-base text-foreground/92 whitespace-pre-wrap break-words">
          {item.groupedSections?.length ? (
            <ExtractedPromptGroupedBody sections={item.groupedSections} />
          ) : (
            <div className="leading-8">{item.text}</div>
          )}
        </div>
      ) : null}
    </section>
  )
}

/** Render reusable extracted prompt cards for image-derived prompt text. */
export function ExtractedPromptSections({ items }: { items: ExtractedPromptCardItem[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ExtractedPromptCard key={item.id} item={item} />
      ))}
    </div>
  )
}
