import { type MouseEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Folder, FolderOpen, Languages, Search, SlidersHorizontal, X } from 'lucide-react'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { AnchoredPopup, anchoredPopupBodyClassName, anchoredPopupHeaderClassName, anchoredPopupLabelClassName } from '@/components/ui/anchored-popup'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { SettingsResourceTable } from '@/features/settings/components/settings-resource-shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getDanbooruBrowserArtists,
  getDanbooruBrowserCharacters,
  getDanbooruBrowserSummary,
  getDanbooruBrowserTags,
} from '@/lib/api-danbooru-browser'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type {
  DanbooruBrowserArtistRecord,
  DanbooruBrowserCharacterRecord,
  DanbooruBrowserDatabaseInfo,
  DanbooruBrowserPagination,
  DanbooruBrowserRelatedTagCategory,
  DanbooruBrowserRelatedTagRecord,
  DanbooruBrowserSection,
  DanbooruBrowserTagRecord,
  DanbooruBrowserTreeNode,
} from '@/types/danbooru-browser'
import { useI18n } from '@/i18n'

const CHARACTER_PAGE_SIZE = 30
const DEFAULT_PAGE_SIZE = 50
const DEFAULT_RELATED_TAG_LIMIT = 100
const MAX_RELATED_TAG_LIMIT = 500
const RELATED_TAG_OPTIONS_STORAGE_KEY = 'conai:prompts:danbooru:character-related-tag-options'
const RELATED_TAG_CATEGORIES: DanbooruBrowserRelatedTagCategory[] = ['general', 'character', 'copyright', 'artist', 'meta']
const DEFAULT_RELATED_TAG_CATEGORIES: DanbooruBrowserRelatedTagCategory[] = ['general']
const DEFAULT_RELATED_TAG_SCORE_MIN_INPUT = '0.05'
const DANBOORU_DB_DOWNLOAD_URL = 'https://github.com/cksdnfas/danbooru-db-viewer'

interface CharacterRelatedTagOptionsState {
  categories: DanbooruBrowserRelatedTagCategory[]
  scoreMinInput: string
  scoreMaxInput: string
  limitInput: string
}

type DanbooruBrowserSelectedNode = Pick<DanbooruBrowserTreeNode, 'id' | 'section' | 'label' | 'translatedLabel' | 'count' | 'filter'>

const FALLBACK_TREE: DanbooruBrowserTreeNode[] = [
  { id: 'tags', label: 'Tags', parentId: null, section: 'tags', count: 0 },
  { id: 'artists', label: 'Artists', parentId: null, section: 'artists', count: 0 },
  { id: 'characters', label: 'Characters', parentId: null, section: 'characters', count: 0 },
]
function getDefaultExpandedTreeIds(section: DanbooruBrowserSection): string[] {
  if (section === 'tags') return ['tags']
  if (section === 'characters') return ['characters']
  return []
}

function formatCompactK(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) < 1000) return String(value)
  const formatted = (value / 1000).toFixed(1).replace(/\.0$/, '')
  return `${formatted}K`
}

function parseRelatedTagScoreInput(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(1, Math.max(0, parsed))
}

function parseRelatedTagLimitInput(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_RELATED_TAG_LIMIT
  return Math.min(MAX_RELATED_TAG_LIMIT, Math.max(0, Math.trunc(parsed)))
}

function getDefaultRelatedTagOptions(): CharacterRelatedTagOptionsState {
  return {
    categories: DEFAULT_RELATED_TAG_CATEGORIES,
    scoreMinInput: DEFAULT_RELATED_TAG_SCORE_MIN_INPUT,
    scoreMaxInput: '',
    limitInput: String(DEFAULT_RELATED_TAG_LIMIT),
  }
}

function readStoredRelatedTagOptions(): CharacterRelatedTagOptionsState {
  const defaults = getDefaultRelatedTagOptions()
  if (typeof window === 'undefined') return defaults

  try {
    const stored = window.localStorage.getItem(RELATED_TAG_OPTIONS_STORAGE_KEY)
    if (!stored) return defaults

    const parsed = JSON.parse(stored) as Partial<CharacterRelatedTagOptionsState>
    const categories = Array.isArray(parsed.categories)
      ? RELATED_TAG_CATEGORIES.filter((category) => parsed.categories?.includes(category))
      : defaults.categories

    return {
      categories,
      scoreMinInput: typeof parsed.scoreMinInput === 'string' ? parsed.scoreMinInput : defaults.scoreMinInput,
      scoreMaxInput: typeof parsed.scoreMaxInput === 'string' ? parsed.scoreMaxInput : defaults.scoreMaxInput,
      limitInput: typeof parsed.limitInput === 'string' ? parsed.limitInput : defaults.limitInput,
    }
  } catch {
    return defaults
  }
}

function persistRelatedTagOptions(options: CharacterRelatedTagOptionsState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(RELATED_TAG_OPTIONS_STORAGE_KEY, JSON.stringify(options))
}

function getRootLabel(section: DanbooruBrowserSection) {
  if (section === 'tags') return 'Tags'
  if (section === 'artists') return 'Artists'
  return 'Characters'
}

function getLocalizedTreeLabel(node: Pick<DanbooruBrowserTreeNode, 'id' | 'section' | 'label' | 'translatedLabel'>, language: string) {
  if (language !== 'ko') return node.label
  if (node.translatedLabel) return node.translatedLabel
  if (node.id === 'tags') return '태그'
  if (node.id === 'artists') return '아티스트'
  if (node.id === 'characters') return '캐릭터'
  return node.label
}

function getSectionTitle(node: DanbooruBrowserSelectedNode, language: string) {
  if (node.id === node.section) return getLocalizedTreeLabel(node, language)
  return getLocalizedTreeLabel(node, language)
}

function getLocalizedGeneralTagLabel(tag: Pick<DanbooruBrowserTagRecord | DanbooruBrowserRelatedTagRecord, 'displayName' | 'translatedName'>, language: string) {
  return language === 'ko' && tag.translatedName ? `${tag.displayName} [${tag.translatedName}]` : tag.displayName
}

function getRelatedTagLabel(tag: DanbooruBrowserRelatedTagRecord) {
  return tag.displayName
}

function PaginationControls({ pagination, onPageChange }: { pagination?: DanbooruBrowserPagination; onPageChange: (page: number) => void }) {
  const { t } = useI18n()
  if (!pagination || pagination.totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-4 text-sm text-muted-foreground">
      <span>
        {t({ ko: '페이지 {page} / {totalPages} · 전체 {total}', en: 'page {page} / {totalPages} · total {total}' }, {
          page: pagination.page,
          totalPages: pagination.totalPages,
          total: formatCompactK(pagination.total),
        })}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={pagination.page <= 1} onClick={() => onPageChange(Math.max(1, pagination.page - 1))}>
          {t({ ko: '이전', en: 'Previous' })}
        </Button>
        <Button size="sm" variant="outline" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>
          {t({ ko: '다음', en: 'Next' })}
        </Button>
      </div>
    </div>
  )
}

function DanbooruLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border/70 text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/10 hover:text-primary"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  )
}

function TableLoading({ columns = 3 }: { columns?: number }) {
  return (
    <div className="space-y-2 rounded-sm border border-border/70 bg-surface-container/30 p-3">
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={`${columns}-${index}`} className="h-10 w-full rounded-sm" />
      ))}
    </div>
  )
}

function EmptyTable() {
  const { t } = useI18n()
  return <div className="rounded-sm border border-border/70 bg-surface-low px-4 py-8 text-center text-sm text-muted-foreground">{t({ ko: '항목 없음', en: 'No items' })}</div>
}

function MissingDanbooruDatabaseNotice({ database }: { database?: DanbooruBrowserDatabaseInfo }) {
  const { t } = useI18n()
  const downloadUrl = database?.downloadUrl || DANBOORU_DB_DOWNLOAD_URL
  const expectedDirectory = database?.expectedDirectory || 'user/database'
  const expectedPath = database?.expectedPath || 'user/database/danbooru.sqlite'
  const filePatterns = database?.filePatterns?.join(', ') || 'danbooru.sqlite, *danbooru*.sqlite'

  return (
    <Alert>
      <AlertTitle>{t({ ko: 'Danbooru DB 파일이 필요해', en: 'Danbooru DB file required' })}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t({ ko: '파일명이 danbooru를 포함한 SQLite DB를 아래 위치에 넣으면 이 탭이 자동으로 인식해.', en: 'Place a SQLite DB whose file name includes danbooru in the location below and this tab will detect it automatically.' })}</p>
        <div className="space-y-1 rounded-sm border border-border/70 bg-surface-container/45 p-3 font-mono text-xs text-foreground">
          <div>{t({ ko: '폴더', en: 'Folder' })}: {expectedDirectory}</div>
          <div>{t({ ko: '권장 경로', en: 'Recommended path' })}: {expectedPath}</div>
          <div>{t({ ko: '인식 패턴', en: 'Detected patterns' })}: {filePatterns}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              {t({ ko: 'DB 다운로드/뷰어 안내 열기', en: 'Open DB download/viewer guide' })}
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

function TagsTable({ items, language }: { items: DanbooruBrowserTagRecord[]; language: string }) {
  if (items.length === 0) return <EmptyTable />

  return (
    <SettingsResourceTable gridClassName="grid-cols-[minmax(0,1fr)_120px] gap-4" minWidthClassName="min-w-0" headers={['Tag', <span className="block text-right" key="usage">Usage</span>]}>
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-4 px-4 py-3 text-sm transition-colors hover:bg-surface-high/60">
          <div className="min-w-0 font-medium text-foreground break-words" title={item.name}>{getLocalizedGeneralTagLabel(item, language)}</div>
          <div className="text-right font-mono text-muted-foreground tabular-nums" title={String(item.usageCount)}>{formatCompactK(item.usageCount)}</div>
        </div>
      ))}
    </SettingsResourceTable>
  )
}

function ArtistsTable({ items }: { items: DanbooruBrowserArtistRecord[] }) {
  if (items.length === 0) return <EmptyTable />

  return (
    <SettingsResourceTable gridClassName="grid-cols-[minmax(0,1fr)_120px_64px] gap-4" minWidthClassName="min-w-0" headers={['Artist', <span className="block text-right" key="works">Works</span>, 'Link']}>
      {items.map((item) => (
        <div key={item.tagId} className="grid grid-cols-[minmax(0,1fr)_120px_64px] items-center gap-4 px-4 py-3 text-sm transition-colors hover:bg-surface-high/60">
          <div className="min-w-0 font-medium text-foreground break-words" title={item.name}>{item.displayName}</div>
          <div className="text-right font-mono text-muted-foreground tabular-nums" title={String(item.worksCount)}>{formatCompactK(item.worksCount)}</div>
          <div className="flex justify-center"><DanbooruLinkButton href={item.danbooruUrl} label={`Open ${item.name} on Danbooru`} /></div>
        </div>
      ))}
    </SettingsResourceTable>
  )
}

interface CharacterRelatedTagOptionsPopupProps {
  open: boolean
  anchorRef: RefObject<HTMLDivElement | null>
  selectedCategories: DanbooruBrowserRelatedTagCategory[]
  scoreMinInput: string
  scoreMaxInput: string
  limitInput: string
  onClose: () => void
  onToggleCategory: (category: DanbooruBrowserRelatedTagCategory) => void
  onScoreMinInputChange: (value: string) => void
  onScoreMaxInputChange: (value: string) => void
  onLimitInputChange: (value: string) => void
  onReset: () => void
}

function CharacterRelatedTagOptionsPopup({
  open,
  anchorRef,
  selectedCategories,
  scoreMinInput,
  scoreMaxInput,
  limitInput,
  onClose,
  onToggleCategory,
  onScoreMinInputChange,
  onScoreMaxInputChange,
  onLimitInputChange,
  onReset,
}: CharacterRelatedTagOptionsPopupProps) {
  const { t } = useI18n()

  return (
    <AnchoredPopup open={open} anchorRef={anchorRef} onClose={onClose} align="end" side="bottom" className="w-[320px] p-0">
      <div className={anchoredPopupHeaderClassName}>
        <div className={anchoredPopupLabelClassName}>{t({ ko: 'Related tags 표시 옵션', en: 'Related tags display options' })}</div>
      </div>
      <div className={cn(anchoredPopupBodyClassName, 'space-y-4')}>
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{t({ ko: '노출 카테고리', en: 'Visible categories' })}</div>
          <div className="grid grid-cols-2 gap-2">
            {RELATED_TAG_CATEGORIES.map((category) => {
              const checked = selectedCategories.includes(category)
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => onToggleCategory(category)}
                  className={cn(
                    'rounded-sm border px-3 py-2 text-left text-xs font-medium transition-colors',
                    checked
                      ? 'border-primary/55 bg-primary/12 text-primary'
                      : 'border-border/70 bg-surface-container/45 text-muted-foreground hover:border-primary/35 hover:text-foreground',
                  )}
                >
                  {category}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{t({ ko: '최대 표시 갯수', en: 'Maximum visible count' })}</div>
          <Input
            type="number"
            min="0"
            max={MAX_RELATED_TAG_LIMIT}
            step="1"
            value={limitInput}
            onChange={(event) => onLimitInputChange(event.target.value)}
            placeholder={String(DEFAULT_RELATED_TAG_LIMIT)}
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{t({ ko: 'Cosine 점수 범위', en: 'Cosine score range' })}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={scoreMinInput}
              onChange={(event) => onScoreMinInputChange(event.target.value)}
              placeholder="min"
            />
            <Input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={scoreMaxInput}
              onChange={(event) => onScoreMaxInputChange(event.target.value)}
              placeholder="max"
            />
          </div>
          <div className="text-[11px] text-muted-foreground">{t({ ko: '기본값은 general만, 최소 0.05, 최대 100개야.', en: 'Default is general only, min 0.05, up to 100 items.' })}</div>
        </div>

        <div className="flex justify-end border-t border-border/70 pt-3">
          <Button size="sm" variant="ghost" onClick={onReset}>{t({ ko: '초기화', en: 'Reset' })}</Button>
        </div>
      </div>
    </AnchoredPopup>
  )
}

function CharacterImageCell({ item }: { item: DanbooruBrowserCharacterRecord }) {
  const [imageIndex, setImageIndex] = useState(0)
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null)
  const images = item.images ?? []
  const activeIndex = imageIndex % Math.max(1, images.length)
  const activeImage = images[activeIndex]
  const hoverPreviewStyle = hoverPosition
    ? {
        left: Math.min(hoverPosition.x + 18, Math.max(16, window.innerWidth - 336)),
        top: Math.min(hoverPosition.y + 18, Math.max(16, window.innerHeight - 392)),
      }
    : undefined

  useEffect(() => {
    setImageIndex(0)
    setHoverPosition(null)
  }, [item.tagId, images.length])

  if (!activeImage) {
    return <div className="h-24 w-[72px]" />
  }

  const updateHoverPreview = (event: MouseEvent) => {
    setHoverPosition({ x: event.clientX, y: event.clientY })
  }

  return (
    <>
      <button
        type="button"
        className="relative h-24 w-[72px] overflow-hidden rounded-sm bg-transparent"
        onClick={() => setImageIndex((current) => (current + 1) % images.length)}
        onMouseEnter={updateHoverPreview}
        onMouseMove={updateHoverPreview}
        onMouseLeave={() => setHoverPosition(null)}
        title={item.name}
      >
        <img src={activeImage.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        <span className="pointer-events-none absolute right-1 top-1 rounded-sm bg-black/60 px-1 text-[10px] font-medium leading-4 text-white shadow-sm">
          {activeIndex + 1}/{images.length}
        </span>
      </button>

      {hoverPosition && hoverPreviewStyle ? createPortal(
        <div
          className="pointer-events-none fixed z-[1000] w-80 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-2xl ring-1 ring-black/20"
          style={hoverPreviewStyle}
        >
          <img src={activeImage.url} alt="" className="max-h-80 w-full rounded-sm object-contain" />
          <div className="mt-2 truncate text-xs text-muted-foreground">{activeImage.fileName}</div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

function RelatedTagsTranslationModal({ item, onClose }: { item: DanbooruBrowserCharacterRecord; onClose: () => void }) {
  const originalText = item.relatedTags.map((tag) => tag.displayName).join(', ')
  const translatedText = item.relatedTags.map((tag) => tag.translatedName || '—').join(', ')

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/62 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[min(560px,92vw)] rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-sm font-semibold">{item.displayName}</div>
          <Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-4 text-sm">
          <section>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Original</div>
            <div className="whitespace-pre-wrap break-words rounded-sm border border-border/70 bg-surface-container/40 p-3 text-foreground">{originalText || '—'}</div>
          </section>
          <section>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">한국어</div>
            <div className="whitespace-pre-wrap break-words rounded-sm border border-border/70 bg-surface-container/40 p-3 text-foreground">{translatedText || '—'}</div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CharactersTable({ items, language }: { items: DanbooruBrowserCharacterRecord[]; language: string }) {
  const [translationTarget, setTranslationTarget] = useState<DanbooruBrowserCharacterRecord | null>(null)
  const showTranslationActions = language === 'ko'
  if (items.length === 0) return <EmptyTable />

  return (
    <>
      <SettingsResourceTable
        gridClassName="grid-cols-[88px_minmax(150px,0.85fr)_110px_minmax(140px,0.85fr)_minmax(220px,1.8fr)_72px] gap-4"
        minWidthClassName="min-w-0"
        headers={['Image', 'Character', <span className="block text-left" key="works">Works</span>, 'Copyright', 'Related tags', 'Link']}
      >
        {items.map((item) => (
          <div
            key={item.tagId}
            className="grid grid-cols-[88px_minmax(150px,0.85fr)_110px_minmax(140px,0.85fr)_minmax(220px,1.8fr)_72px] items-start gap-4 px-4 py-3 text-sm transition-colors hover:bg-surface-high/60"
          >
            <CharacterImageCell item={item} />
            <div className="min-w-0 font-medium text-foreground break-words" title={item.name}>{item.displayName}</div>
            <div className="pt-0.5 text-left font-mono text-muted-foreground tabular-nums" title={String(item.worksCount)}>{formatCompactK(item.worksCount)}</div>
            <div className="min-w-0 whitespace-pre-wrap break-words text-muted-foreground">
              {item.copyrights.length > 0 ? item.copyrights.map((copyright) => copyright.displayName).join('\n') : '—'}
            </div>
            <div className="min-w-0 whitespace-pre-wrap break-words leading-6 text-foreground/90">
              {item.relatedTags.length > 0 ? item.relatedTags.map((tag) => getRelatedTagLabel(tag)).join(', ') : '—'}
            </div>
            <div className="flex justify-center gap-1">
              {showTranslationActions && item.relatedTags.length > 0 ? (
                <Button type="button" size="icon-sm" variant="outline" onClick={() => setTranslationTarget(item)} title="Related tags 번역" aria-label="Related tags 번역">
                  <Languages className="h-4 w-4" />
                </Button>
              ) : null}
              <DanbooruLinkButton href={item.danbooruUrl} label={`Open ${item.name} on Danbooru`} />
            </div>
          </div>
        ))}
      </SettingsResourceTable>
      {translationTarget ? <RelatedTagsTranslationModal item={translationTarget} onClose={() => setTranslationTarget(null)} /> : null}
    </>
  )
}

export function PromptDanbooruBrowserPanel() {
  const { language, t } = useI18n()
  const isDesktopPageLayout = useDesktopPageLayout()
  const [selectedNodeId, setSelectedNodeId] = useState('tags')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [isRelatedTagOptionsOpen, setIsRelatedTagOptionsOpen] = useState(false)
  const [relatedTagCategories, setRelatedTagCategories] = useState<DanbooruBrowserRelatedTagCategory[]>(() => readStoredRelatedTagOptions().categories)
  const [relatedTagScoreMinInput, setRelatedTagScoreMinInput] = useState(() => readStoredRelatedTagOptions().scoreMinInput)
  const [relatedTagScoreMaxInput, setRelatedTagScoreMaxInput] = useState(() => readStoredRelatedTagOptions().scoreMaxInput)
  const [relatedTagLimitInput, setRelatedTagLimitInput] = useState(() => readStoredRelatedTagOptions().limitInput)
  const relatedTagOptionsAnchorRef = useRef<HTMLDivElement | null>(null)

  const summaryQuery = useQuery({
    queryKey: ['danbooru-browser-summary'],
    queryFn: getDanbooruBrowserSummary,
  })
  const database = summaryQuery.data?.database
  const isDanbooruDbAvailable = database?.available === true

  const tree = summaryQuery.data?.tree ?? FALLBACK_TREE
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of tree) {
      if (node.parentId) {
        counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1)
      }
    }
    return counts
  }, [tree])
  const selectedNode = useMemo<DanbooruBrowserSelectedNode>(() => {
    return tree.find((node) => node.id === selectedNodeId) ?? tree[0] ?? FALLBACK_TREE[0]
  }, [selectedNodeId, tree])
  const activeSection = selectedNode.section
  const categoryCode = activeSection === 'tags' ? selectedNode.filter?.categoryCode : undefined
  const taxonomyNodeId = activeSection === 'tags' ? selectedNode.filter?.taxonomyNodeId : undefined
  const copyrightTagId = activeSection === 'characters' ? selectedNode.filter?.copyrightTagId : undefined
  const currentLimit = activeSection === 'characters' ? CHARACTER_PAGE_SIZE : DEFAULT_PAGE_SIZE
  const relatedTagScoreMin = parseRelatedTagScoreInput(relatedTagScoreMinInput)
  const relatedTagScoreMax = parseRelatedTagScoreInput(relatedTagScoreMaxInput)
  const relatedTagLimit = parseRelatedTagLimitInput(relatedTagLimitInput)
  const relatedTagFilterActive = relatedTagCategories.length !== RELATED_TAG_CATEGORIES.length || relatedTagScoreMin !== undefined || relatedTagScoreMax !== undefined || relatedTagLimit !== DEFAULT_RELATED_TAG_LIMIT
  const defaultExpandedTreeIds = useMemo(() => getDefaultExpandedTreeIds(activeSection), [activeSection])

  useEffect(() => {
    setPage(1)
  }, [activeSection, categoryCode, taxonomyNodeId, copyrightTagId, searchQuery, relatedTagCategories, relatedTagScoreMin, relatedTagScoreMax, relatedTagLimit])

  useEffect(() => {
    persistRelatedTagOptions({
      categories: relatedTagCategories,
      scoreMinInput: relatedTagScoreMinInput,
      scoreMaxInput: relatedTagScoreMaxInput,
      limitInput: relatedTagLimitInput,
    })
  }, [relatedTagCategories, relatedTagScoreMinInput, relatedTagScoreMaxInput, relatedTagLimitInput])

  useEffect(() => {
    if (activeSection !== 'characters') {
      setIsRelatedTagOptionsOpen(false)
    }
  }, [activeSection])

  const tagsQuery = useQuery({
    queryKey: ['danbooru-browser-tags', searchQuery, categoryCode, taxonomyNodeId, page],
    queryFn: () => getDanbooruBrowserTags({ query: searchQuery, categoryCode, taxonomyNodeId, page, limit: currentLimit }),
    enabled: isDanbooruDbAvailable && activeSection === 'tags',
  })

  const artistsQuery = useQuery({
    queryKey: ['danbooru-browser-artists', searchQuery, page],
    queryFn: () => getDanbooruBrowserArtists({ query: searchQuery, page, limit: currentLimit }),
    enabled: isDanbooruDbAvailable && activeSection === 'artists',
  })

  const charactersQuery = useQuery({
    queryKey: ['danbooru-browser-characters', searchQuery, copyrightTagId, page, relatedTagCategories, relatedTagScoreMin, relatedTagScoreMax, relatedTagLimit],
    queryFn: () => getDanbooruBrowserCharacters({
      query: searchQuery,
      copyrightTagId,
      page,
      limit: CHARACTER_PAGE_SIZE,
      relatedTagCategories,
      relatedTagScoreMin,
      relatedTagScoreMax,
      relatedTagLimit,
    }),
    enabled: isDanbooruDbAvailable && activeSection === 'characters',
  })

  const activeQuery = activeSection === 'tags' ? tagsQuery : activeSection === 'artists' ? artistsQuery : charactersQuery
  const pagination = activeQuery.data?.pagination
  const currentCount = pagination?.total ?? selectedNode.count

  const handleApplySearch = () => {
    setSearchQuery(searchInput.trim())
  }

  const handleClearSearch = () => {
    setSearchInput('')
    setSearchQuery('')
  }

  const handleToggleRelatedTagCategory = (category: DanbooruBrowserRelatedTagCategory) => {
    setRelatedTagCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : RELATED_TAG_CATEGORIES.filter((item) => item === category || current.includes(item))
    ))
  }

  const handleResetRelatedTagOptions = () => {
    const defaults = getDefaultRelatedTagOptions()
    setRelatedTagCategories(defaults.categories)
    setRelatedTagScoreMinInput(defaults.scoreMinInput)
    setRelatedTagScoreMaxInput(defaults.scoreMaxInput)
    setRelatedTagLimitInput(defaults.limitInput)
  }

  return (
    <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[260px_minmax(0,1fr)]' : 'grid-cols-1')}>
      <ExplorerSidebar
        title="Danbooru DB"
        badge={<Badge variant="outline">{formatCompactK(summaryQuery.data?.counts.tags ?? 0)}</Badge>}
        floatingFrame
        floatingLockStorageKey="conai:prompts:danbooru-sidebar-locked"
        className={cn('sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
        bodyClassName="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
      >
        {summaryQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full rounded-sm" />
            ))}
          </div>
        ) : null}

        {summaryQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: 'DB 요약 로드 실패', en: 'Failed to load DB summary' })}</AlertTitle>
            <AlertDescription>{summaryQuery.error instanceof Error ? summaryQuery.error.message : t({ ko: '알 수 없는 오류', en: 'Unknown error' })}</AlertDescription>
          </Alert>
        ) : null}

        {!summaryQuery.isLoading && !summaryQuery.isError ? (
          <HierarchyNav
            key={activeSection}
            items={tree}
            expandable
            defaultExpandedIds={defaultExpandedTreeIds}
            selectedId={selectedNodeId}
            onSelect={(node) => setSelectedNodeId(node.id)}
            getId={(node) => node.id}
            getParentId={(node) => node.parentId}
            getLabel={(node) => {
              const hasChildren = (childCountByParentId.get(node.id) ?? 0) > 0
              const countLabel = hasChildren && node.directCount !== undefined
                ? node.directCount === 0
                  ? `(${formatCompactK(node.count)})`
                  : `${formatCompactK(node.directCount)}(${formatCompactK(node.count)})`
                : formatCompactK(node.count)

              return (
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <span className="min-w-0 truncate">{getLocalizedTreeLabel(node, language)}</span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{countLabel}</span>
                </div>
              )
            }}
            sortItems={(left, right) => {
              const rootOrder: Record<string, number> = { artists: 0, tags: 1, characters: 2 }
              const leftIsRoot = left.parentId === null
              const rightIsRoot = right.parentId === null
              if (leftIsRoot || rightIsRoot) {
                return (rootOrder[left.id] ?? 99) - (rootOrder[right.id] ?? 99)
              }

              const leftLabel = getLocalizedTreeLabel(left, language)
              const rightLabel = getLocalizedTreeLabel(right, language)
              const leftIsUnclassified = left.label.toLowerCase() === 'unclassified'
              const rightIsUnclassified = right.label.toLowerCase() === 'unclassified'
              if (leftIsUnclassified !== rightIsUnclassified) return leftIsUnclassified ? -1 : 1

              return leftLabel.localeCompare(rightLabel, ['ko', 'en'], { numeric: true, sensitivity: 'base' })
            }}
            renderIcon={(_node, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
          />
        ) : null}
      </ExplorerSidebar>

      <section className="relative z-0 space-y-4">
        <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{getSectionTitle(selectedNode, language)}</h2>
            <div className="mt-1 text-sm text-muted-foreground">
              {t({ ko: '{count}개 표시 가능', en: '{count} available' }, { count: formatCompactK(currentCount) })}
              {activeSection === 'characters' ? <span> · {t({ ko: '페이지당 30개', en: '30 per page' })}</span> : null}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[280px]">
            <div className="flex gap-2">
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleApplySearch()
                }}
                placeholder={t({ ko: '검색', en: 'Search' })}
              />
              <Button size="sm" variant="outline" onClick={handleApplySearch}>
                <Search className="h-4 w-4" />
              </Button>
              {activeSection === 'characters' ? (
                <div ref={relatedTagOptionsAnchorRef}>
                  <Button
                    size="sm"
                    variant={relatedTagFilterActive ? 'default' : 'outline'}
                    onClick={() => setIsRelatedTagOptionsOpen((open) => !open)}
                    title={t({ ko: 'Related tags 표시 옵션', en: 'Related tags display options' })}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
              {searchQuery ? (
                <Button size="sm" variant="ghost" onClick={handleClearSearch}>
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <CharacterRelatedTagOptionsPopup
          open={activeSection === 'characters' && isRelatedTagOptionsOpen}
          anchorRef={relatedTagOptionsAnchorRef}
          selectedCategories={relatedTagCategories}
          scoreMinInput={relatedTagScoreMinInput}
          scoreMaxInput={relatedTagScoreMaxInput}
          limitInput={relatedTagLimitInput}
          onClose={() => setIsRelatedTagOptionsOpen(false)}
          onToggleCategory={handleToggleRelatedTagCategory}
          onScoreMinInputChange={setRelatedTagScoreMinInput}
          onScoreMaxInputChange={setRelatedTagScoreMaxInput}
          onLimitInputChange={setRelatedTagLimitInput}
          onReset={handleResetRelatedTagOptions}
        />

        {!summaryQuery.isLoading && !summaryQuery.isError && !isDanbooruDbAvailable ? (
          <MissingDanbooruDatabaseNotice database={database} />
        ) : null}

        {isDanbooruDbAvailable && activeQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '목록 로드 실패', en: 'Failed to load rows' })}</AlertTitle>
            <AlertDescription>{activeQuery.error instanceof Error ? activeQuery.error.message : t({ ko: '알 수 없는 오류', en: 'Unknown error' })}</AlertDescription>
          </Alert>
        ) : null}

        {isDanbooruDbAvailable && activeQuery.isLoading ? <TableLoading columns={activeSection === 'characters' ? 6 : activeSection === 'artists' ? 3 : 2} /> : null}

        {isDanbooruDbAvailable && !activeQuery.isLoading && activeSection === 'tags' ? <TagsTable items={tagsQuery.data?.items ?? []} language={language} /> : null}
        {isDanbooruDbAvailable && !activeQuery.isLoading && activeSection === 'artists' ? <ArtistsTable items={artistsQuery.data?.items ?? []} /> : null}
        {isDanbooruDbAvailable && !activeQuery.isLoading && activeSection === 'characters' ? <CharactersTable items={charactersQuery.data?.items ?? []} language={language} /> : null}

        {isDanbooruDbAvailable ? <PaginationControls pagination={pagination} onPageChange={setPage} /> : null}
      </section>
    </div>
  )
}
