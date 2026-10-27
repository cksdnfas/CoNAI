import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, Shuffle } from 'lucide-react'
import { PageToolbar } from '@/components/common/page-toolbar'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { PromptTypeFilter } from '@/types/prompt'
import type { PromptPageView } from '../prompt-page-view'
import { PROMPT_TYPE_LABELS } from '../prompt-page-utils'

export interface PromptPageToolbarProps {
  view: PromptPageView
  /** Prompt type to go back to when the preset toggle is switched off. */
  promptType: PromptTypeFilter
  canViewWildcards: boolean
  onChangeView: (view: PromptPageView) => void
  /** Flexible middle (search). */
  children?: ReactNode
  /** View-specific icon actions placed before the wildcard / preset keys (sort, options…). */
  actions?: ReactNode
}

/** The shared part of the toolbar that each /prompts view extends with its own search and actions. */
export type PromptPageToolbarBaseProps = Omit<PromptPageToolbarProps, 'children' | 'actions'>

/** The one toolbar row of /prompts: type switch · search · view actions · wildcard and preset keys. */
export function PromptPageToolbar({ view, promptType, canViewWildcards, onChangeView, children, actions }: PromptPageToolbarProps) {
  const { t } = useI18n()
  const items = [
    ...Object.entries(PROMPT_TYPE_LABELS).map(([value, label]) => ({ value, label: t(label) })),
    { value: 'danbooru', label: t({ ko: '단부루', en: 'Danbooru' }) },
  ]
  const isPresetView = view === 'presets'

  return (
    <PageToolbar
      title={t('pageAccessCatalog.prompts')}
      start={(
        <SegmentedControl
          value={view}
          items={items}
          onChange={(next) => onChangeView(next as PromptPageView)}
          size="sm"
          semantics="tabs"
          ariaLabel={t({ ko: '프롬프트 종류', en: 'Prompt type' })}
        />
      )}
      actions={(
        <>
          {actions}
          {canViewWildcards ? (
            <Button asChild variant="ghost" size="sm">
              <Link to="/wildcards"><Shuffle />{t({ ko: '와일드카드', en: 'Wildcards' })}</Link>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={isPresetView}
            data-pressed={isPresetView ? 'true' : undefined}
            onClick={() => onChangeView(isPresetView ? promptType : 'presets')}
          >
            <Bookmark />{t({ ko: '프리셋', en: 'Presets' })}
          </Button>
        </>
      )}
    >
      {children}
    </PageToolbar>
  )
}
