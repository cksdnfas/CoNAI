import type { ReactNode } from 'react'
import { CollapsibleScoreMeterList, ScoreMeterList, StackedRatingBar, TagBundleSection } from './tag-result-ui'

type PromptScoreEntries = Array<[string, number]>

/** Render the shared rating section used by prompt/tag result surfaces. */
export function RatingPromptSection({
  entries,
  title = 'rating',
}: {
  entries: PromptScoreEntries
  title?: string
}) {
  if (entries.length === 0) return null

  return <StackedRatingBar title={title} entries={entries} />
}

/** Render the shared character score section used by prompt/tag result surfaces. */
export function CharacterPromptSection({
  entries,
  title = 'character',
  accentClassName = 'bg-primary/60',
}: {
  entries: PromptScoreEntries
  title?: string
  accentClassName?: string
}) {
  if (entries.length === 0) return null

  return <ScoreMeterList title={title} entries={entries} accentClassName={accentClassName} />
}

/** Render the shared general prompt section with tags and optional collapsible scores. */
export function GeneralPromptSection({
  tags,
  entries,
  label = 'general',
  accentClassName = 'bg-primary/80',
  collapsibleScores = true,
  tagsHeaderAction,
}: {
  tags: string[]
  entries: PromptScoreEntries
  label?: string
  accentClassName?: string
  collapsibleScores?: boolean
  tagsHeaderAction?: ReactNode
}) {
  if (tags.length === 0 && entries.length === 0) return null

  return (
    <div className="space-y-3">
      {tags.length > 0 ? <TagBundleSection label={label} tags={tags} headerAction={tagsHeaderAction} /> : null}
      {entries.length > 0
        ? collapsibleScores
          ? <CollapsibleScoreMeterList title={label} entries={entries} accentClassName={accentClassName} />
          : <ScoreMeterList title={label} entries={entries} accentClassName={accentClassName} />
        : null}
    </div>
  )
}

/** Render the shared artist prompt section with tags and configurable score folding. */
export function ArtistPromptSection({
  tags,
  entries,
  label = 'artist',
  accentClassName = 'bg-primary/80',
  collapsibleScores = true,
  getTagHref,
  onTagClick,
}: {
  tags: string[]
  entries: PromptScoreEntries
  label?: string
  accentClassName?: string
  collapsibleScores?: boolean
  getTagHref?: (tag: string) => string | null
  onTagClick?: (tag: string, href: string) => void
}) {
  if (tags.length === 0 && entries.length === 0) return null

  return (
    <div className="space-y-3">
      {tags.length > 0 ? <TagBundleSection label={label} tags={tags} getTagHref={getTagHref} onTagClick={onTagClick} /> : null}
      {entries.length > 0
        ? collapsibleScores
          ? <CollapsibleScoreMeterList title={label} entries={entries} accentClassName={accentClassName} />
          : <ScoreMeterList title={label} entries={entries} accentClassName={accentClassName} />
        : null}
    </div>
  )
}
