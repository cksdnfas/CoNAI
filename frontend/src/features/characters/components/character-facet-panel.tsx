import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ToggleChip } from '@/components/ui/chip'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { CharacterFacetKey, CharacterLibraryFacets, CharacterSettingFilters } from '@/lib/api-character-library'
import { localizedTagName } from '../character-library-shared'

/** Values a dimension shows before "더 보기"; selected values always show. */
const FACET_PREVIEW_COUNT = 12

export function useFacetLabels(): Record<CharacterFacetKey, string> {
  const { t } = useI18n()
  return {
    copyright: t({ ko: '작품', en: 'Work' }),
    character: t({ ko: '캐릭터', en: 'Character' }),
    subject: t({ ko: '인물', en: 'Subject' }),
    hairColor: t({ ko: '머리색', en: 'Hair colour' }),
    hairLength: t({ ko: '머리 길이', en: 'Hair length' }),
    hairStyle: t({ ko: '헤어스타일', en: 'Hair style' }),
    eyeColor: t({ ko: '눈색', en: 'Eye colour' }),
    skinColor: t({ ko: '피부색', en: 'Skin colour' }),
    species: t({ ko: '종족', en: 'Species' }),
    outfit: t({ ko: '의상', en: 'Outfit' }),
  }
}

export const hasActiveFilters = (filters: CharacterSettingFilters) => Object.values(filters).some((tags) => tags?.length)

/** Toggle one tag of a dimension; an emptied dimension is dropped. */
export function toggleFilter(filters: CharacterSettingFilters, key: CharacterFacetKey, tag: string): CharacterSettingFilters {
  const current = filters[key] ?? []
  const next = current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]
  const rest = Object.fromEntries(Object.entries(filters).filter(([other]) => other !== key)) as CharacterSettingFilters
  return next.length ? { ...rest, [key]: next } : rest
}

/**
 * Tag filters by dimension (Danbooru dictionary classification): tags of one dimension match any, dimensions all apply.
 * Counts are shown when the source has them (the library), not for the catalog.
 */
export function CharacterFacetPanel({ facets, filters, onChange, loading }: {
  facets: CharacterLibraryFacets | undefined
  filters: CharacterSettingFilters
  onChange: (filters: CharacterSettingFilters) => void
  loading: boolean
}) {
  const { t, formatNumber, language } = useI18n()
  const labels = useFacetLabels()
  const [expanded, setExpanded] = useState<ReadonlySet<CharacterFacetKey>>(new Set())
  if (loading && !facets) return null
  if (facets && !facets.available) return <p className="text-xs text-muted-foreground">{t({ ko: 'Danbooru 사전을 설치하면 머리색·눈색·작품 같은 필터가 생겨.', en: 'Install the Danbooru dictionary for hair, eye and work filters.' })}</p>
  if (!facets?.dimensions.length) return null
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{t({ ko: '필터', en: 'Filters' })}</span>
        {hasActiveFilters(filters) ? <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onChange({})}>{t({ ko: '모두 해제', en: 'Clear all' })}</Button> : null}
      </div>
      {facets.dimensions.map((dimension) => {
        const selected = filters[dimension.key] ?? []
        const open = expanded.has(dimension.key)
        const shown = open ? dimension.values : dimension.values.filter((value, index) => index < FACET_PREVIEW_COUNT || selected.includes(value.tag))
        return (
          <div key={dimension.key} role="group" aria-label={labels[dimension.key]} className="space-y-1.5">
            <Text as="span" variant="label">{labels[dimension.key]}</Text>
            <div className="flex flex-wrap gap-1">
              {shown.map((value) => (
                <ToggleChip key={value.tag} size="sm" pressed={selected.includes(value.tag)} title={value.tag} onClick={() => onChange(toggleFilter(filters, dimension.key, value.tag))}>
                  <span className="max-w-[9rem] truncate">{localizedTagName(language, value.label, value.translated)}</span>
                  {value.count !== null ? <span className="tabular-nums opacity-70">{formatNumber(value.count)}</span> : null}
                </ToggleChip>
              ))}
              {dimension.values.length > shown.length || open ? (
                <ToggleChip size="sm" onClick={() => setExpanded((current) => { const next = new Set(current); if (open) next.delete(dimension.key); else next.add(dimension.key); return next })}>
                  {open ? t({ ko: '접기', en: 'Less' }) : t({ ko: '+{count}개 더', en: '+{count} more' }, { count: formatNumber(dimension.values.length - shown.length) })}
                </ToggleChip>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
