import { useState } from 'react'
import { ChevronDown, Copy, FolderTree, GitBranch } from 'lucide-react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getThemeToneStyle, getThemeToneTextStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import { PromptTagActionMenu } from './prompt-tag-action-menu'
import type { ExtractedPromptActionScope, ExtractedPromptActionTerm, ExtractedPromptCardItem, ExtractedPromptGroupedSection } from '@/lib/image-extracted-prompts'

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

/** `card`: tinted block (default). `accent`: flat text block behind a 2px left accent line (image detail column). */
type ExtractedPromptSectionsVariant = 'card' | 'accent'

interface ExtractedPromptCardProps {
  item: ExtractedPromptCardItem
  variant?: ExtractedPromptSectionsVariant
  onAddSearchFilter?: (scope: ExtractedPromptActionScope, tag: string) => void
}

function getPromptAccentClassName(tone: ExtractedPromptCardItem['tone']) {
  switch (tone) {
    case 'positive':
      return 'border-primary/70 text-foreground'
    case 'character':
      return 'border-primary/40 text-foreground'
    case 'negative':
      return 'border-foreground/20 text-muted-foreground'
    default:
      return 'border-foreground/20 text-foreground'
  }
}

interface ExtractedPromptTermListProps {
  terms: ExtractedPromptActionTerm[]
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
          key={`${scope}:${term.searchValue}:${term.display}`}
          tag={term.searchValue}
          href={getPromptActionHref(scope)}
          onAddSearchFilter={onAddSearchFilter ? (tag) => onAddSearchFilter(scope, tag) : undefined}
        >
          {term.display}
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
                  'inline-flex max-w-full items-center rounded-sm bg-surface-high px-2 py-1 text-sm font-semibold text-foreground',
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
                section.prompts.map((term) => term.display).join(', ')
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ExtractedPromptCard({ item, variant = 'card', onAddSearchFilter }: ExtractedPromptCardProps) {
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

  const isAccent = variant === 'accent'
  const content = item.groupedSections?.length ? (
    <ExtractedPromptGroupedBody sections={item.groupedSections} actionScope={item.actionScope} onAddSearchFilter={onAddSearchFilter} />
  ) : item.actionScope && item.actionTerms?.length ? (
    <ExtractedPromptTermList terms={item.actionTerms} scope={item.actionScope} onAddSearchFilter={onAddSearchFilter} />
  ) : (
    <div className={isAccent ? 'leading-relaxed' : 'leading-8'}>{item.text}</div>
  )

  return (
    <section className={isAccent ? 'space-y-1.5' : 'overflow-hidden rounded-sm bg-surface-lowest'}>
      <div className={cn('flex items-center gap-2', isAccent ? '-ml-1' : 'px-4 pt-3 pb-1')}>
        <IconButton
          size="icon-xs"
          variant="ghost"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          label={expanded ? t({ ko: '{title} 접기', en: 'Collapse {title}' }, { title: item.title }) : t({ ko: '{title} 펼치기', en: 'Expand {title}' }, { title: item.title })}
          tooltip={false}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded ? 'rotate-0' : '-rotate-90')} />
        </IconButton>

        <div className={cn('min-w-0 font-semibold', isAccent ? 'text-xs' : 'text-sm')} style={getPromptToneStyle(item.tone)}>{item.title}</div>

        <div className="ml-auto flex items-center gap-2">
          {(item.badges ?? []).map((badge) => (
            <Badge key={`${item.id}:${badge}`} variant={badge === '그룹' ? 'default' : 'secondary'} className="tracking-normal normal-case" style={getPromptBadgeStyle(badge)}>
              {badge === '그룹' ? t({ ko: '그룹', en: 'Group' }) : badge}
            </Badge>
          ))}
          <IconButton
            size="icon-sm"
            variant="ghost"
            onClick={handleCopy}
            label={t({ ko: '{title} 복사', en: 'Copy {title}' }, { title: item.title })}
          >
            <Copy className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {expanded ? (
        isAccent ? (
          <div className={cn('border-l-2 pl-3 text-sm whitespace-pre-wrap break-words', getPromptAccentClassName(item.tone))}>{content}</div>
        ) : (
          <div className="px-4 pt-2 pb-4 text-base text-foreground whitespace-pre-wrap break-words">{content}</div>
        )
      ) : null}
    </section>
  )
}

/** Render reusable extracted prompt cards for image-derived prompt text. */
export function ExtractedPromptSections({
  items,
  variant = 'card',
  onAddSearchFilter,
}: {
  items: ExtractedPromptCardItem[]
  variant?: ExtractedPromptSectionsVariant
  onAddSearchFilter?: (scope: ExtractedPromptActionScope, tag: string) => void
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className={variant === 'accent' ? 'space-y-5' : 'space-y-3'}>
      {items.map((item) => (
        <ExtractedPromptCard key={item.id} item={item} variant={variant} onAddSearchFilter={onAddSearchFilter} />
      ))}
    </div>
  )
}
