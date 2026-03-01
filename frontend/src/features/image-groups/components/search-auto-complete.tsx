import React, { useEffect, useRef, useState } from 'react'
import { Ban as NegativeIcon, CheckCircle as PositiveIcon, Search as SearchIcon, Sparkles as AutoIcon, Star as RatingIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RatingTier } from '@comfyui-image-manager/shared'
import { apiClient } from '@/lib/api/client'
import { cn } from '@/lib/utils'

export interface PromptSearchResult {
  id: number
  prompt: string
  usage_count: number
  group_id: number | null
  synonyms: string[]
  type: 'positive' | 'negative' | 'auto' | 'rating'
  min_score?: number
  max_score?: number | null
  color?: string | null
}

interface PromptSearchApiResponse {
  success: boolean
  data: PromptSearchResult[]
  pagination: { total: number }
}

interface RatingTierApiResponse {
  success: boolean
  data: RatingTier[]
}

interface SearchAutoCompleteProps {
  value: string
  onChange: (value: string) => void
  onSelectTag?: (tag: PromptSearchResult) => void
  onKeyPress?: (event: React.KeyboardEvent) => void
  placeholder?: string
}

type TabType = 'positive' | 'auto' | 'negative' | 'rating'

const SearchAutoComplete: React.FC<SearchAutoCompleteProps> = ({
  value,
  onChange,
  onSelectTag,
  onKeyPress,
  placeholder,
}) => {
  const { t } = useTranslation(['search'])

  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('positive')
  const [suggestions, setSuggestions] = useState<PromptSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [currentTerm, setCurrentTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)

  const [stats, setStats] = useState<{
    positive: number
    auto: number
    negative: number
    rating: number
  }>({ positive: 0, auto: 0, negative: 0, rating: 0 })

  const anchorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const textBeforeCursor = value.slice(0, cursorPosition)
    const textAfterCursor = value.slice(cursorPosition)
    const lastCommaIndex = textBeforeCursor.lastIndexOf(',')

    let termStart = lastCommaIndex + 1
    while (termStart < textBeforeCursor.length && textBeforeCursor[termStart] === ' ') {
      termStart += 1
    }

    const nextCommaIndex = textAfterCursor.indexOf(',')
    const termEnd = nextCommaIndex === -1 ? value.length : cursorPosition + nextCommaIndex

    const term = value.slice(termStart, termEnd).trim()
    setCurrentTerm(term)
  }, [value, cursorPosition])

  useEffect(() => {
    if (!currentTerm && !open && activeTab !== 'rating') return

    const fetchSuggestions = async () => {
      setLoading(true)
      try {
        if (activeTab === 'rating') {
          const response = await apiClient.get<RatingTierApiResponse>('/api/settings/rating/tiers')
          if (response.data.success) {
            let tiers = response.data.data || []
            if (currentTerm) {
              tiers = tiers.filter((tier) => tier.tier_name.toLowerCase().includes(currentTerm.toLowerCase()))
            }

            const ratingResults: PromptSearchResult[] = tiers.map((tier) => ({
              id: tier.id,
              prompt: tier.tier_name,
              usage_count: 0,
              group_id: null,
              synonyms: [],
              type: 'rating',
              min_score: tier.min_score,
              max_score: tier.max_score,
              color: tier.color,
            }))

            setSuggestions(ratingResults)
            setStats((prev) => ({ ...prev, rating: tiers.length }))
          }
        } else {
          const response = await apiClient.get<PromptSearchApiResponse>('/api/prompt-collection/search', {
            params: {
              q: currentTerm,
              type: activeTab,
              limit: 20,
            },
          })

          if (response.data.success) {
            setSuggestions(response.data.data || [])
            setStats((prev) => ({ ...prev, [activeTab]: response.data.pagination?.total ?? 0 }))

            if (currentTerm.length >= 2) {
              const types: TabType[] = ['positive', 'auto', 'negative']
              const otherTypes = types.filter((type) => type !== activeTab)

              await Promise.all(
                otherTypes.map(async (type) => {
                  const result = await apiClient.get<PromptSearchApiResponse>('/api/prompt-collection/search', {
                    params: { q: currentTerm, type, limit: 1 },
                  })
                  if (result.data.success) {
                    setStats((prev) => ({ ...prev, [type]: result.data.pagination?.total ?? 0 }))
                  }
                }),
              )
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch suggestions', error)
      } finally {
        setLoading(false)
      }
    }

    const timer = window.setTimeout(() => {
      void fetchSuggestions()
    }, 300)

    return () => window.clearTimeout(timer)
  }, [activeTab, currentTerm, open])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      const root = anchorRef.current
      if (root && !root.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const handleTabChange = (_event: React.SyntheticEvent, newValue: TabType) => {
    setActiveTab(newValue)
    inputRef.current?.focus()
  }

  const handleSelectTag = (tag: PromptSearchResult) => {
    if (onSelectTag) {
      onSelectTag(tag)
    } else {
      const textBeforeCursor = value.slice(0, cursorPosition)
      const textAfterCursor = value.slice(cursorPosition)
      const lastCommaIndex = textBeforeCursor.lastIndexOf(',')
      const termStart = lastCommaIndex + 1

      const nextCommaIndex = textAfterCursor.indexOf(',')
      const termEnd = nextCommaIndex === -1 ? value.length : cursorPosition + nextCommaIndex

      let nextValue = ''
      if (lastCommaIndex === -1) {
        nextValue = tag.prompt + (nextCommaIndex === -1 ? ', ' : '')
        if (nextCommaIndex !== -1) {
          nextValue += value.slice(nextCommaIndex)
        }
      } else {
        nextValue = value.slice(0, termStart) + ` ${tag.prompt}` + (nextCommaIndex === -1 ? ', ' : '') + value.slice(termEnd)
      }
      onChange(nextValue)
    }

    setOpen(false)
    inputRef.current?.focus()
  }

  const getTagColor = (option: PromptSearchResult) => {
    if (option.type === 'rating' && option.color) return option.color
    if (option.type === 'positive') return '#16a34a'
    if (option.type === 'negative') return '#dc2626'
    if (option.type === 'auto') return '#0284c7'
    if (option.type === 'rating') return '#ca8a04'
    return '#111827'
  }

  return (
    <div className="relative" ref={anchorRef}>
      <div className="border-input bg-background focus-within:ring-ring/50 flex h-9 items-center rounded-md border px-3 focus-within:ring-2">
        <SearchIcon className="mr-2 h-4 w-4 text-muted-foreground" />
        <input
          className="h-full w-full bg-transparent text-sm outline-none"
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onKeyPress={onKeyPress}
          ref={inputRef}
          onClick={() => setOpen(true)}
          onSelect={(event: React.SyntheticEvent<HTMLInputElement>) => {
            const target = event.target as HTMLInputElement
            setCursorPosition(target.selectionStart ?? 0)
          }}
        />
      </div>

      {open && (suggestions.length > 0 || currentTerm.length > 0 || activeTab === 'rating') ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg">
          <div className="border-b p-1">
            <div className="grid grid-cols-4 gap-1">
              {([
                { key: 'positive' as const, label: `${t('search:tabs.positive', 'Positive')} (${stats.positive})`, icon: <PositiveIcon className="h-4 w-4" /> },
                { key: 'auto' as const, label: `${t('search:tabs.auto', 'Auto')} (${stats.auto})`, icon: <AutoIcon className="h-4 w-4" /> },
                { key: 'negative' as const, label: `${t('search:tabs.negative', 'Negative')} (${stats.negative})`, icon: <NegativeIcon className="h-4 w-4" /> },
                { key: 'rating' as const, label: t('search:tabs.rating', 'Rating'), icon: <RatingIcon className="h-4 w-4" /> },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  title={tab.label}
                  className={cn(
                    'flex h-8 items-center justify-center rounded text-muted-foreground hover:bg-muted/60',
                    activeTab === tab.key ? 'bg-muted text-foreground' : null,
                  )}
                  onClick={(event) => handleTabChange(event, tab.key)}
                >
                  {tab.icon}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-2 text-center text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div className="max-h-96 overflow-auto py-1">
              {suggestions.map((option) => (
                <button
                  type="button"
                  key={`${option.type}-${option.id}`}
                  onClick={() => handleSelectTag(option)}
                  className="hover:bg-muted flex w-full items-start justify-between gap-3 px-3 py-1 text-left"
                >
                  <span>
                    <span className="block text-sm font-semibold" style={{ color: getTagColor(option) }}>{option.prompt}</span>
                    {option.synonyms && option.synonyms.length > 0 ? (
                      <span className="block text-xs text-muted-foreground">→ {option.synonyms.join(', ')}</span>
                    ) : null}
                  </span>
                  {option.type === 'rating' ? (
                    <span className="text-xs text-muted-foreground">{option.min_score}~{option.max_score || '∞'}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{option.usage_count > 0 ? `${option.usage_count}` : ''}</span>
                  )}
                </button>
              ))}
              {suggestions.length === 0 ? (
                <div className="p-2 text-center text-sm text-muted-foreground">{t('search:noResults', 'No tags found')}</div>
              ) : null}
            </div>
          )}

          <div className="border-t px-2 py-1 text-xs text-muted-foreground">{t('search:tip.select', 'Select to add tag')}</div>
        </div>
      ) : null}
    </div>
  )
}

export default SearchAutoComplete
