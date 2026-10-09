import { useState, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, MoreHorizontal, Sparkles, Square, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { Select } from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { MediaLightbox } from '@/features/images/components/media-lightbox'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import { MODEL_SLOTS_QUERY_KEY, listModelSlots } from '@/lib/api-codex-chat'
import { getGroupEmoticons, getGroupsHierarchyAll, groupEmoticonsQueryKey } from '@/lib/api-groups'
import { getImage, getImageDetailQueryKey } from '@/lib/api-images'
import { cn } from '@/lib/utils'
import { ReviewChips, SlotVisionReview } from './chat-asset-batch-modal'
import type { ProfileAssetRuns } from './chat-profile-asset-runs'

/** The library group name the server uses for a character (characterMediaGroupPath). */
export function characterGroupName(name: string) {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[/\\]/g, '-').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || '이름 없음'
}

/** The character's "채팅 캐릭터/<name>" groups: its expressions (with their keyworded images) and generated candidates. */
export function useCharacterGroups(characterName: string) {
  const { canViewImages } = useImagePermissions()
  const groups = useQuery({ queryKey: ['groups-hierarchy-all', 'chat-assets'], queryFn: getGroupsHierarchyAll, enabled: canViewImages, staleTime: 30000 })
  const name = characterGroupName(characterName)
  const root = groups.data?.find((group) => group.name === '채팅 캐릭터' && !group.parent_id)
  const character = root ? groups.data?.find((group) => group.name === name && group.parent_id === root.id) : undefined
  const expressionGroup = character ? groups.data?.find((group) => group.name === '표정' && group.parent_id === character.id) : undefined
  const candidateGroup = character ? groups.data?.find((group) => group.name === '후보' && group.parent_id === character.id) : undefined
  const emoticons = useQuery({ queryKey: groupEmoticonsQueryKey(expressionGroup?.id ?? 0), queryFn: () => getGroupEmoticons(expressionGroup!.id), enabled: canViewImages && !!expressionGroup })
  return { expressionGroupId: expressionGroup?.id ?? null, candidateGroup, entries: emoticons.data?.entries ?? [], loading: groups.isPending || (Boolean(expressionGroup) && emoticons.isPending) }
}

/** Library images with the feed's safety rules (blur / hide by rating), plus a lightbox over them. */
export function useSafeAssetImages(hashes: string[]) {
  const { canViewImages } = useImagePermissions()
  const unique = [...new Set(hashes)]
  const images = useQueries({ queries: unique.map((hash) => ({ queryKey: getImageDetailQueryKey(hash), queryFn: ({ signal }: { signal: AbortSignal }) => getImage(hash, { signal }), enabled: canViewImages, retry: (count: number, error: Error) => error.message === 'Metadata not found' && count < 10, retryDelay: 3000 })) })
  const safety = useImageFeedSafety({ items: images.flatMap((query) => (query.data ? [query.data] : [])) })
  const visible = new Map(safety.visibleItems.map((image) => [image.composite_hash, image]))
  const [lightbox, setLightbox] = useState<number | null>(null)
  return {
    /** The image, or null while loading or when hidden by the safety settings. */
    render: (hash: string, className = 'size-full object-cover') => {
      const image = visible.get(hash)
      if (!image) return images[unique.indexOf(hash)]?.isPending ? <span className="flex size-full items-center justify-center"><Spinner /></span> : null
      return <><ChatProfileImage src={buildApiUrl(`/api/images/${hash}/file`)} className={cn(className, safety.shouldBlurItemPreview(image) && 'blur-lg')} />{safety.renderItemPersistentOverlay(image)}</>
    },
    open: (hash: string) => { const index = safety.visibleItems.findIndex((image) => image.composite_hash === hash); if (index >= 0) setLightbox(index) },
    lightbox: <MediaLightbox items={safety.visibleItems} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(null)} />,
  }
}

/**
 * The generation preset assets use, with a warning when it cannot draw from the reference image (a text-to-image
 * workflow) or needs setting up, and a ⋯ menu for the rarely changed choices: the expression list and the vision model.
 */
export function AssetPresetPicker({ runs, showExpressionMenu = false }: { runs: ProfileAssetRuns; showExpressionMenu?: boolean }) {
  const { t } = useI18n()
  const modelSlots = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: showExpressionMenu })
  const { presets, preset } = runs
  const support = preset?.assetSupport
  const warning = !preset
    ? (runs.presetsLoaded ? t({ ko: '자산을 만들 수 있는 생성 프리셋이 없어. 설정 › 채팅 › 생성 프리셋에서 만들어줘.', en: 'No generation preset can make assets. Make one under Settings › Chat › Generation presets.' }) : null)
    : support?.problem ?? (support?.mode === 'appearance' ? t({ ko: '이미지 입력이 없는 워크플로라 기준 이미지를 못 받아. 칸마다 얼굴이 달라질 수 있어. 이미지 입력 워크플로(i2i)를 권장해.', en: 'This workflow takes no image, so it cannot use the reference; faces may differ per slot. An image-input (i2i) workflow is recommended.' }) : null)
  return (
    <div className="flex min-w-0 items-center gap-1">
      {warning ? (
        <Tip content={warning}>
          <span className="inline-flex text-warning" tabIndex={0} aria-label={warning}><AlertTriangle className="size-4" /></span>
        </Tip>
      ) : null}
      <Select variant="settings" className="h-8 w-auto max-w-56 text-xs" aria-label={t({ ko: '생성 프리셋', en: 'Generation preset' })} value={preset?.id ?? ''} disabled={!presets.length} onChange={(event) => runs.choosePreset(Number(event.target.value))}>
        {!preset ? <option value="">{t({ ko: '생성 프리셋', en: 'Generation preset' })}</option> : null}
        {presets.map((entry) => (
          <option key={entry.id} value={entry.id} disabled={!entry.assetSupport?.mode}>
            {`${entry.kind === 'nai' ? 'NAI' : 'Comfy'} · ${entry.name}${entry.assetSupport?.mode === 'reference' && entry.kind === 'comfyui' ? ' · i2i' : entry.assetSupport?.mode === 'appearance' ? ' · t2i' : ''}`}
          </option>
        ))}
      </Select>
      {showExpressionMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '표정 목록 · 비전 검수', en: 'Expression list · vision review' })}><MoreHorizontal /></IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel>{t({ ko: '표정 목록', en: 'Expression list' })}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={String(runs.expressionPreset?.id ?? '')} onValueChange={(value) => runs.chooseExpressionPreset(Number(value))}>
              {runs.expressionPresets.map((entry) => <DropdownMenuRadioItem key={entry.id} value={String(entry.id)}>{entry.name}<span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{entry.items?.length ?? 0}</span></DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t({ ko: '비전 검수 모델', en: 'Vision review model' })}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={String(runs.visionSlotId ?? 0)} onValueChange={(value) => runs.chooseVision(Number(value) || null)}>
              <DropdownMenuRadioItem value="0">{t({ ko: '안 씀', en: 'None' })}</DropdownMenuRadioItem>
              {(modelSlots.data ?? []).filter((slot) => slot.providerType !== 'decision_typesafe').map((slot) => <DropdownMenuRadioItem key={slot.id} value={String(slot.id)}>{slot.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

/**
 * One slot's candidates in a row: the one in use is checked; clicking another applies it to the slot; double-click
 * opens it large. Working jobs show as spinners. `actions` sit at the right of the header.
 */
export function AssetCandidateTray({ runs, slotKey, title, currentHash, referenceHash, profileId, actions, wide = false }: {
  runs: ProfileAssetRuns
  slotKey: string
  title: ReactNode
  currentHash: string | null
  referenceHash: string | null
  profileId: number | null
  actions?: ReactNode
  wide?: boolean
}) {
  const { t } = useI18n()
  const state = runs.slotState(slotKey)
  const images = useSafeAssetImages(state.candidates.map((candidate) => candidate.hash))
  const applying = runs.isPending(slotKey)
  const shown = state.candidates.find((candidate) => candidate.hash === currentHash) ?? state.candidates[0]
  const batch = shown ? runs.batchOf(shown.hash) : null
  const size = wide ? 'h-[90px] w-[160px]' : 'h-[112px] w-[84px]'
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {state.candidates.length ? <span className="text-xs tabular-nums text-muted-foreground">{t({ ko: '후보 {count}', en: '{count} candidates' }, { count: state.candidates.length })}</span> : null}
        {state.failed ? (
          <Tip content={state.failure}>
            <span className="inline-flex items-center gap-1 text-xs text-warning" tabIndex={0}><AlertTriangle className="size-3.5" />{t({ ko: '실패', en: 'Failed' })}</span>
          </Tip>
        ) : null}
        <ReviewChips review={shown?.review} />
        <span className="flex-1" />
        {shown && batch && profileId && runs.visionSlotId ? (
          <SlotVisionReview key={`${batch.id}:${slotKey}:${shown.hash}:${runs.visionSlotId}`} profileId={profileId} batchId={batch.id} slotKey={slotKey} hash={shown.hash} referenceHash={referenceHash} modelSlotId={runs.visionSlotId} disabled={applying} />
        ) : null}
        {state.working ? <IconButton size="icon-sm" variant="ghost" onClick={() => void runs.cancel(slotKey)} label={t({ ko: '취소', en: 'Cancel' })}><Square /></IconButton> : null}
        {actions}
      </div>
      {state.candidates.length || state.working ? (
        <div className="flex gap-2 overflow-x-auto p-1">
          {state.working ? <span className={cn('flex shrink-0 items-center justify-center rounded-md bg-fill', size)}><Spinner /></span> : null}
          {state.candidates.map((candidate) => {
            const chosen = candidate.hash === currentHash
            return (
              // eslint-disable-next-line no-restricted-syntax -- the thumbnail itself is the control
              <button
                key={candidate.hash}
                type="button"
                disabled={applying}
                aria-pressed={chosen}
                aria-label={t({ ko: '이 후보로 바꾸기', en: 'Use this candidate' })}
                onClick={() => { if (!chosen) void runs.apply(slotKey, candidate.hash) }}
                onDoubleClick={() => images.open(candidate.hash)}
                className={cn('relative shrink-0 overflow-hidden rounded-md bg-fill outline-none focus-visible:ring-2 focus-visible:ring-ring', size, chosen && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
              >
                {images.render(candidate.hash)}
                {chosen ? <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
      {images.lightbox}
    </div>
  )
}

/**
 * The character's expressions as a row of slots, one per emotion of the expression list (plus emotions the group
 * already has). An empty slot generates with ✦; clicking a slot opens its candidates, library input and clear below.
 */
export function ExpressionSlots({ runs, characterName, profileId, referenceHash, canGenerate, blockedReason, onSet, onClear, renderInput }: {
  runs: ProfileAssetRuns
  characterName: string
  profileId: number | null
  referenceHash: string | null
  canGenerate: boolean
  /** Why generating is unavailable (shown on the disabled buttons). */
  blockedReason: string | null
  onSet: (name: string, hash: string) => Promise<void>
  onClear: (name: string) => Promise<void>
  /** The library / upload input for one slot. */
  renderInput: (onPick: (hash: string) => void) => ReactNode
}) {
  const { t } = useI18n()
  const groups = useCharacterGroups(characterName)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const names = [...new Set([...runs.emotionNames, ...groups.entries.flatMap((entry) => entry.keywords)])]
  const filled = new Map(names.map((name) => [name, groups.entries.find((entry) => entry.keywords.includes(name))?.compositeHash ?? null]))
  const images = useSafeAssetImages([...filled.values()].filter((hash): hash is string => Boolean(hash)))
  const emptyNames = names.filter((name) => !filled.get(name) && !runs.slotState(name).working && !runs.isPending(name) && runs.emotionNames.includes(name))
  const generateLabel = blockedReason ?? t({ ko: '만들기', en: 'Generate' })
  const fillAll = () => { if (emptyNames.length) void runs.start({ kind: 'expressions', names: emptyNames }, true) }
  const run = async (name: string, task: () => Promise<void>) => { setBusy(name); try { await task() } finally { setBusy(null) } }

  return (
    <section className="space-y-3">
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <h3 className="text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{t({ ko: '표정', en: 'Expressions' })}</h3>
        <span className="text-xs font-semibold tabular-nums">{names.filter((name) => filled.get(name)).length}/{names.length}</span>
        <span className="flex-1" />
        <AssetPresetPicker runs={runs} showExpressionMenu />
        <Tip content={blockedReason}>
          <span className="inline-flex" tabIndex={blockedReason ? 0 : -1}>
            <IconButton variant="default" size="icon-sm" disabled={!canGenerate || !emptyNames.length} onClick={fillAll} tooltip={!blockedReason} label={t({ ko: '빈 칸 채우기 {count}', en: 'Fill {count} empty' }, { count: emptyNames.length })}><Sparkles /></IconButton>
          </span>
        </Tip>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {names.map((name) => {
          const hash = filled.get(name)
          const state = runs.slotState(name)
          const working = state.working || runs.isPending(name)
          return (
            <div key={name} className="min-w-0 space-y-1 text-center">
              <div className={cn('relative aspect-[3/4] overflow-hidden rounded-md', hash ? 'bg-fill' : 'border border-dashed border-line', selected === name && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}>
                {/* eslint-disable-next-line no-restricted-syntax -- the slot itself is the control */}
                <button type="button" className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={name} aria-expanded={selected === name} onClick={() => setSelected(selected === name ? null : name)} onDoubleClick={() => { if (hash) images.open(hash) }} />
                {hash ? <div className="pointer-events-none size-full">{images.render(hash)}</div> : null}
                {working ? <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/50"><Spinner /></span> : null}
                {!working && state.failed ? <span className="pointer-events-none absolute left-1 top-1 text-warning"><AlertTriangle className="size-4" /></span> : null}
                {state.candidates.length > 1 ? <span className="pointer-events-none absolute right-1 top-1 rounded bg-backdrop px-1 text-2xs font-bold leading-4 text-white tabular-nums">{state.candidates.length}</span> : null}
                {!hash && !working ? (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center [&>*]:pointer-events-auto">
                    <IconButton size="icon-sm" variant="ghost" disabled={!canGenerate || !runs.emotionNames.includes(name)} label={generateLabel} onClick={() => void runs.start({ kind: 'expressions', names: [name] }, true)}><Sparkles /></IconButton>
                  </span>
                ) : null}
              </div>
              <div className={cn('truncate text-xs', selected === name ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{name}</div>
            </div>
          )
        })}
      </div>
      {selected ? (
        <AssetCandidateTray
          runs={runs}
          slotKey={selected}
          title={selected}
          currentHash={filled.get(selected) ?? null}
          referenceHash={referenceHash}
          profileId={profileId}
          actions={(
            <>
              <IconButton size="icon-sm" variant="ghost" disabled={!canGenerate || !runs.emotionNames.includes(selected) || runs.slotState(selected).working} label={blockedReason ?? t({ ko: '다시 만들기', en: 'Generate again' })} onClick={() => void runs.start({ kind: 'expressions', names: [selected] }, !filled.get(selected))}><Sparkles /></IconButton>
              {renderInput((hash) => void run(selected, () => onSet(selected, hash)))}
              {filled.get(selected) ? <IconButton size="icon-sm" variant="ghost" disabled={busy === selected} label={t({ ko: '비우기', en: 'Clear' })} onClick={() => void run(selected, () => onClear(selected))}><Trash2 /></IconButton> : null}
            </>
          )}
        />
      ) : null}
      {images.lightbox}
    </section>
  )
}
