import { useState } from 'react'
import { ChevronDown, Copy, FolderTree, GitBranch } from 'lucide-react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getThemeToneStyle, getThemeToneTextStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import { PromptTagActionMenu } from './prompt-tag-action-menu'
import type { ExtractedPromptActionScope, ExtractedPromptCardItem, ExtractedPromptGroupedSection } from '@/lib/image-extracted-prompts'

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
  onAddSearchFilter?: (scope: ExtractedPromptActionScope, tag: string) => void
}

interface ExtractedPromptTermListProps {
  terms: string[]
  scope: ExtractedPromptActionScope
  onAddSearchFilter?: (scope: ExtractedPromptActionScope, tag: string) => void
}

function getPromptActionHref(scope: ExtractedPromptActionScope) {
  return scope === 'lora' ? null : undefined
}

function ExtractedPromptTermList({ terms, scope, onAddSearchFilter }: ExtractedPromptTermListProps) {
  if (terms.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2 leading-normal">
      {terms.map((term) => (
        <PromptTagActionMenu
          key={`${scope}:${term}`}
          tag={term}
          href={getPromptActionHref(scope)}
          onAddSearchFilter={onAddSearchFilter ? (tag) => onAddSearchFilter(scope, tag) : undefined}
          className="rounded-full bg-surface-low px-2.5 py-1 text-xs text-foreground transition hover:bg-surface-high hover:text-primary"
        >
          {term}
        </PromptTagActionMenu>
      ))}
    </div>
  )
}

function ExtractedPromptGroupedBody({ sections, actionScope, onAddSearchFilter }: { sections: ExtractedPromptGroupedSection[]; actionScope?: ExtractedPromptActionScope; onAddSearchFilter?: (scope: ExtractedPromptActionScope, tag: string) => void }) {
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
              {actionScope ? (
                <ExtractedPromptTermList terms={section.prompts} scope={actionScope} onAddSearchFilter={onAddSearchFilter} />
              ) : (
                section.prompts.join(', ')
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ExtractedPromptCard({ item, onAddSearchFilter }: ExtractedPromptCardProps) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(true)

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(item.text)
      showSnackbar({ message: t({ ko: '{title}를 클립보드에 복사했어.', en: '{title} copied to the clipboard.' }, { title: item.title }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '{title} 복사에 실패했어.', en: '{title} copy failed.' }, { title: item.title }), tone: 'error' })
    }
  }

  return (
    <section className="overflow-hidden rounded-sm border border-white/8 bg-surface-lowest">
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label={expanded ? t({ ko: '{title} 접기', en: 'Collapse {title}' }, { title: item.title }) : t({ ko: '{title} 펼치기', en: 'Expand {title}' }, { title: item.title })}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded ? 'rotate-0' : '-rotate-90')} />
        </button>

        <div className={cn('min-w-0 text-sm font-semibold')} style={getPromptToneStyle(item.tone)}>{item.title}</div>

        <div className="ml-auto flex items-center gap-2">
          {(item.badges ?? []).map((badge) => (
            <Badge key={`${item.id}:${badge}`} variant={badge === '그룹' ? 'default' : 'secondary'} className="tracking-normal normal-case" style={getPromptBadgeStyle(badge)}>
              {badge === '그룹' ? t({ ko: '그룹', en: 'Group' }) : badge}
            </Badge>
          ))}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-primary"
            onClick={handleCopy}
            aria-label={t({ ko: '{title} 복사', en: 'Copy {title}' }, { title: item.title })}
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="px-4 py-4 text-base text-foreground/92 whitespace-pre-wrap break-words">
          {item.groupedSections?.length ? (
            <ExtractedPromptGroupedBody sections={item.groupedSections} actionScope={item.actionScope} onAddSearchFilter={onAddSearchFilter} />
          ) : item.actionScope && item.actionTerms?.length ? (
            <ExtractedPromptTermList terms={item.actionTerms} scope={item.actionScope} onAddSearchFilter={onAddSearchFilter} />
          ) : (
            <div className="leading-8">{item.text}</div>
          )}
        </div>
      ) : null}
    </section>
  )
}

/** Render reusable extracted prompt cards for image-derived prompt text. */
export function ExtractedPromptSections({
  items,
  onAddSearchFilter,
}: {
  items: ExtractedPromptCardItem[]
  onAddSearchFilter?: (scope: ExtractedPromptActionScope, tag: string) => void
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ExtractedPromptCard key={item.id} item={item} onAddSearchFilter={onAddSearchFilter} />
      ))}
    </div>
  )
}
