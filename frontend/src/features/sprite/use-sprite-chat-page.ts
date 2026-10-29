import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { ChatPageAction, ChatPageField, ChatPageValue } from '@conai/shared'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import type { SpriteAnchorPolicy, SpriteAnimationOptions, SpriteBatchItem, SpriteExtractResult, SpriteNormalizeOptions, SpriteNormalizeSheet, SpriteVideoInfo } from '@/lib/api-sprite'
import { MAX_KEY_COLORS, MAX_SHEET_DIMENSION, MAX_SPRITE_FRAMES, normalizeHex, toExtractOptions, withDespill, type ExtractForm, type OutputForm, type SaveForm } from './sprite-options'

const HASH = /^[0-9a-f]{32,48}$/i
/** A longer video list is picked by hash text (checked on apply): listing every hash in the schema fills the page view. */
const SELECT_CHOICES_INLINE = 20
const hashList = (max: number) => pageArray({ type: 'string', maxLength: 48 }, max, 1)

/**
 * The sprite extract tab shares its video list, the extraction form, the sheet output and save choices, the last
 * preview build and the batch's per-video status with a connected chat. The bot can fill the form, change the list,
 * preview one video and (through a review card) run the whole list — and, because the page adds the sprite tools, run
 * the extraction itself with these values.
 */
export function useSpriteChatPage({ active, videoHash, videos, setVideos, maxVideos, selectVideo, info, form, setForm, output, setOutput, save, setSave, build, statuses, batchRunning, zipReady, canPreview, canRunAll, preview, runAll, stopBatch, downloadZip }: {
  /** Only the open tab talks to the chat. */
  active: boolean
  videoHash: string | null
  /** The videos in the extract list; the chat picks which one the form shows. */
  videos: string[]
  setVideos: (hashes: string[]) => void
  maxVideos: number
  selectVideo: (hash: string) => void
  info: SpriteVideoInfo | null
  form: ExtractForm
  setForm: Dispatch<SetStateAction<ExtractForm>>
  output: OutputForm
  setOutput: Dispatch<SetStateAction<OutputForm>>
  save: SaveForm
  setSave: Dispatch<SetStateAction<SaveForm>>
  build: SpriteExtractResult | null
  statuses: Map<string, SpriteBatchItem>
  batchRunning: boolean
  zipReady: boolean
  canPreview: boolean
  canRunAll: boolean
  preview: () => Promise<void>
  runAll: () => Promise<void>
  stopBatch: () => Promise<void>
  downloadZip: () => void
}) {
  const { t } = useI18n()
  const commitVideos = useChatDraftTransaction(videos, setVideos)
  const fields: ChatPageField[] = [
    { id: 'rangeMode', label: t({ ko: '구간 (full = 영상 전체, common = 공통 구간)', en: 'Range (full = whole video, common = same start/end)' }), type: 'select', value: form.rangeMode, options: ['full', 'common'] },
    { id: 'startTime', label: t({ ko: '시작 (초)', en: 'Start (s)' }), type: 'number', value: form.startTime, min: 0 },
    { id: 'endTime', label: t({ ko: '끝 (초, 비우면 끝까지)', en: 'End (s, empty = to the end)' }), type: 'number', value: form.endTime ?? '', min: 0, allowEmpty: true },
    { id: 'samplingMode', label: t({ ko: '추출 방식', en: 'Sampling' }), type: 'select', value: form.samplingMode, options: ['interval', 'count'] },
    { id: 'intervalValue', label: t({ ko: '간격', en: 'Interval' }), type: 'number', value: form.intervalValue, min: 0.001 },
    { id: 'intervalUnit', label: t({ ko: '간격 단위 (영상이 여럿이면 초로 돌려)', en: 'Interval unit (several videos always use seconds)' }), type: 'select', value: form.intervalUnit, options: ['seconds', 'frames'] },
    { id: 'sampleCount', label: t({ ko: '개수', en: 'Count' }), type: 'number', value: form.sampleCount, min: 2, max: MAX_SPRITE_FRAMES, integer: true },
    { id: 'removeDuplicateFrames', label: t({ ko: '연속 중복 프레임 빼기', en: 'Drop repeated frames' }), type: 'boolean', value: form.removeDuplicateFrames },
    { id: 'similarityPercent', label: t({ ko: '중복 유사도 %', en: 'Duplicate similarity %' }), type: 'number', value: form.similarityPercent, min: 1, max: 100 },
    { id: 'keyColors', label: t({ ko: '배경 지정색 (#RRGGBB, 쉼표로 여러 개)', en: 'Key colours (#RRGGBB, comma separated)' }), type: 'text', value: form.keyColors.join(', ') },
    { id: 'tolerancePercent', label: t({ ko: '허용치 %', en: 'Tolerance %' }), type: 'number', value: form.tolerancePercent, min: 1, max: 100 },
    { id: 'softnessPercent', label: t({ ko: '부드러움 %', en: 'Softness %' }), type: 'number', value: form.softnessPercent, min: 0, max: 100 },
    { id: 'despill', label: t({ ko: '디스필', en: 'Despill' }), type: 'boolean', value: form.despill },
    { id: 'edgeCleanup', label: t({ ko: '가장자리 정리', en: 'Edge clean-up' }), type: 'boolean', value: form.edgeCleanup },
    { id: 'autoCrop', label: t({ ko: '자동 크롭', en: 'Auto crop' }), type: 'boolean', value: form.autoCrop },
    { id: 'alphaThreshold', label: t({ ko: '알파 임계값', en: 'Alpha threshold' }), type: 'number', value: form.alphaThreshold, min: 1, max: 255, integer: true },
    { id: 'resizeMode', label: t({ ko: '크기 조정', en: 'Resize' }), type: 'select', value: form.resizeMode, options: ['none', 'contain', 'cover', 'stretch'] },
    { id: 'outputWidth', label: t({ ko: '가로', en: 'Width' }), type: 'number', value: form.outputWidth, min: 1, max: MAX_SHEET_DIMENSION, integer: true },
    { id: 'outputHeight', label: t({ ko: '세로', en: 'Height' }), type: 'number', value: form.outputHeight, min: 1, max: MAX_SHEET_DIMENSION, integer: true },
    { id: 'columns', label: t({ ko: '시트 열 (0 = 자동)', en: 'Sheet columns (0 = automatic)' }), type: 'number', value: output.columns, min: 0, max: 64, integer: true },
    { id: 'spacing', label: t({ ko: '칸 간격 (px)', en: 'Cell spacing (px)' }), type: 'number', value: output.spacing, min: 0, max: 64, integer: true },
    { id: 'format', label: t({ ko: '시트 형식', en: 'Sheet format' }), type: 'select', value: output.format, options: ['png', 'webp'] },
    { id: 'quality', label: t({ ko: 'WebP 품질', en: 'WebP quality' }), type: 'number', value: output.quality, min: 1, max: 100, integer: true },
    { id: 'saveGroup', label: t({ ko: '저장 그룹 경로 (비우면 "스프라이트")', en: 'Save group path (empty = "스프라이트")' }), type: 'text', value: save.groupPath ?? '' },
    { id: 'zip', label: t({ ko: '전체 생성 때 ZIP도 받기', en: 'Also download a ZIP when building all' }), type: 'boolean', value: save.zip },
  ]

  const actions: ChatPageAction[] = [
    ...(videos.length > 1 ? [pageAction('sprite.select', t({ ko: '영상 고르기', en: 'Pick video' }), t({ ko: '추출 목록(data.videos)에서 볼 영상을 골라.', en: 'Pick which listed video (data.videos) the form shows.' }), pageObject({ hash: videos.length <= SELECT_CHOICES_INLINE ? pageChoice(videos) : pageText(64) }, ['hash']))] : []),
    ...(!batchRunning ? [
      pageAction('sprite.add_videos', t({ ko: '영상 넣기', en: 'Add videos' }), t({ ko: `라이브러리 영상 해시를 추출 목록 끝에 넣어 (최대 ${maxVideos}개). search_images(media_type video)로 찾은 해시를 써.`, en: `Append library video hashes to the extract list (up to ${maxVideos}). Use hashes from search_images with media_type video.` }), pageObject({ hashes: hashList(maxVideos) }, ['hashes'])),
      ...(videos.length ? [pageAction('sprite.remove_videos', t({ ko: '목록에서 빼기', en: 'Remove videos' }), t({ ko: '추출 목록에서 영상을 빼. all이면 목록을 비워.', en: 'Remove videos from the extract list; all clears it.' }), pageObject({ hashes: hashList(maxVideos), all: { type: 'boolean' } }))] : []),
    ] : []),
    ...(canPreview && videoHash ? [pageAction('sprite.preview', t({ ko: '이 영상만 미리보기', en: 'Preview this video' }), t({ ko: '지금 고른 영상의 해시를 넣어 저장 없이 시트를 만들어. 끝나면 data.lastBuild에 나와.', en: 'Pass the selected video hash to build a sheet without saving; data.lastBuild holds it when done.' }), pageObject({ hash: pageChoice([videoHash]) }, ['hash']))] : []),
    ...(canRunAll ? [pageAction('sprite.run', t({ ko: '전체 생성', en: 'Build all' }), t({ ko: '목록의 모든 영상을 지금 설정으로 만들어 라이브러리(saveGroup)에 저장해. zip이면 ZIP도 받아. 진행 상태는 data.batch에 나와.', en: 'Build every listed video with the current settings and save the sheets to the library (saveGroup); zip also downloads a ZIP. data.batch shows the progress.' }), pageObject({}), 'save')] : []),
    ...(batchRunning ? [pageAction('sprite.stop', t({ ko: '지금 영상 끝나고 멈추기', en: 'Stop after this video' }), t({ ko: '진행 중인 전체 생성을 지금 영상까지만 하고 멈춰.', en: 'Finish the current video, then end the running batch.' }), pageObject({}), 'save')] : []),
    ...(zipReady && !batchRunning ? [pageAction('sprite.download_zip', t({ ko: 'ZIP 다시 받기', en: 'Download the ZIP again' }), t({ ko: '지난 전체 생성의 ZIP을 브라우저로 다시 받아.', en: 'Download the last batch ZIP in the browser again.' }))] : []),
  ]

  const items = videos.map((hash) => statuses.get(hash) ?? null)
  useChatPageRegistration(active ? {
    kind: 'sprite',
    title: t({ ko: '스프라이트 · 추출', en: 'Sprites · Extract' }),
    resourceId: 'extract',
    fields,
    data: {
      tab: 'extract',
      videoHash: videoHash ?? '',
      videos,
      video: info ? { name: info.name, width: info.width, height: info.height, fps: info.fps, frameCount: info.frameCount, duration: info.duration } : null,
      extractOptions: JSON.parse(JSON.stringify(toExtractOptions(form, info, output))),
      lastBuild: build ? { buildId: build.buildId, frameCount: build.frameCount, frameWidth: build.frameWidth, frameHeight: build.frameHeight, saved: build.saved?.compositeHash ?? '' } : null,
      // Counts per status, and only the videos past waiting (capped): the view is resent with every request.
      ...(items.some(Boolean) || batchRunning ? { batch: {
        running: batchRunning,
        ...(zipReady ? { zipReady } : {}),
        counts: items.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item?.status ?? 'waiting']: (counts[item?.status ?? 'waiting'] ?? 0) + 1 }), {}),
        items: items.flatMap((item) => item && item.status !== 'waiting' ? [{
          videoHash: item.videoHash, status: item.status,
          ...(item.compositeHash ? { sheetHash: item.compositeHash } : {}),
          ...(item.error ? { error: item.error.slice(0, 200) } : {}),
        }] : []).slice(0, 40),
      } } : {}),
    },
    actions,
    apply: (patch: Record<string, ChatPageValue>) => {
      const outputPatch: Partial<OutputForm> = {}
      for (const key of ['columns', 'spacing', 'quality'] as const) if (key in patch) outputPatch[key] = Number(patch[key])
      if ('format' in patch) outputPatch.format = patch.format === 'webp' ? 'webp' : 'png'
      if (Object.keys(outputPatch).length) setOutput((current) => ({ ...current, ...outputPatch }))
      if ('saveGroup' in patch || 'zip' in patch) setSave((current) => ({
        groupPath: 'saveGroup' in patch ? String(patch.saveGroup).trim() || null : current.groupPath,
        zip: 'zip' in patch ? Boolean(patch.zip) : current.zip,
      }))
      setForm((current) => applySpritePatch(current, patch))
    },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'sprite.select') {
        if (!videos.includes(String(args.hash))) throw new Error('추출 목록에 없는 영상이야.')
        selectVideo(String(args.hash))
        return
      }
      if (id === 'sprite.add_videos' || id === 'sprite.remove_videos') {
        if (batchRunning) throw new Error('전체 생성 중에는 목록을 바꿀 수 없어.')
        const before = videos
        const hashes = (Array.isArray(args.hashes) ? args.hashes : []).map(String)
        if (hashes.some((hash) => !HASH.test(hash))) throw new Error('라이브러리 미디어 해시가 아니야.')
        const next = id === 'sprite.add_videos'
          ? [...before, ...hashes.filter((hash, index) => !before.includes(hash) && hashes.indexOf(hash) === index)].slice(0, maxVideos)
          : args.all === true ? [] : before.filter((hash) => !hashes.includes(hash))
        if (next.length === before.length && next.every((hash, index) => hash === before[index])) throw new Error(id === 'sprite.add_videos' ? '넣을 새 영상이 없어.' : '목록에 없는 영상이야.')
        return commitVideos(next)
      }
      if (id === 'sprite.preview') { await preview(); return }
      if (id === 'sprite.run') { await runAll(); return }
      if (id === 'sprite.stop') { await stopBatch(); return }
      if (id === 'sprite.download_zip') { downloadZip(); return }
      throw new Error('스프라이트 추출 화면에 없는 작업이야.')
    },
  } : null, { preserveOnSearchChange: true })
}

function applySpritePatch(current: ExtractForm, patch: Record<string, ChatPageValue>): ExtractForm {
  let next = { ...current }
  if ('despill' in patch && Boolean(patch.despill) !== next.despill) next = withDespill(next, Boolean(patch.despill))
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'despill' || !(key in next)) continue
    if (key === 'keyColors') {
      const colors = String(value).split(',').map((color) => normalizeHex(color)).filter((color): color is string => Boolean(color))
      if (colors.length) next.keyColors = next.despill ? colors.slice(0, 1) : colors.slice(0, MAX_KEY_COLORS)
    } else if (key === 'endTime') {
      next.endTime = value === '' ? null : Number(value)
      if (!('rangeMode' in patch)) next.rangeMode = 'common'
    } else if (key === 'startTime') {
      next.startTime = Number(value)
      if (!('rangeMode' in patch)) next.rangeMode = 'common'
    } else if (key === 'samplingMode' || key === 'intervalUnit' || key === 'resizeMode' || key === 'rangeMode') {
      next = { ...next, [key]: String(value) } as ExtractForm
    } else if (typeof value === 'boolean') {
      next = { ...next, [key]: value }
    } else {
      next = { ...next, [key]: Number(value) }
    }
  }
  return next
}

type NormalizeSheetEntry = { hash: string; name: string; width: number; height: number; options: SpriteNormalizeSheet['options'] }

/**
 * The normalize tab: the sheet list with each sheet's grid, the shared normalization options, and running it (saved to
 * the library through a review card, or as a ZIP download).
 */
export function useSpriteNormalizeChatPage({ active, sheets, setSheets, selected, setSelected, prepareSheets, options, setOptions, problems, running, canRun, canSave, run, savedHashes, failures }: {
  active: boolean
  sheets: NormalizeSheetEntry[]
  setSheets: (sheets: NormalizeSheetEntry[]) => void
  selected: string | null
  setSelected: (hash: string | null) => void
  prepareSheets: (hashes: string[]) => Promise<NormalizeSheetEntry[]>
  options: SpriteNormalizeOptions
  setOptions: Dispatch<SetStateAction<SpriteNormalizeOptions>>
  problems: string[]
  running: boolean
  canRun: boolean
  canSave: boolean
  run: (save: boolean) => Promise<void>
  savedHashes: string[]
  failures: Array<{ source: string; error: string }>
}) {
  const { t } = useI18n()
  const currentSheets = useRef(sheets)
  useLayoutEffect(() => { currentSheets.current = sheets }, [sheets])
  const commitSheetList = useChatDraftTransaction(sheets, setSheets)
  const commitSheets = (next: { sheets: NormalizeSheetEntry[]; selected: string | null }) => {
    const undo = commitSheetList(next.sheets)
    setSelected(next.selected)
    return { isCurrent: undo.isCurrent, restore: () => { undo.restore(); setSelected(selected) } }
  }
  const fields: ChatPageField[] = [
    { id: 'mode', label: t({ ko: '모드 (per_sheet = 시트별, group = 묶음 공통 셀 크기)', en: 'Mode (per_sheet = each sheet, group = one shared cell size)' }), type: 'select', value: options.mode, options: ['per_sheet', 'group'] },
    { id: 'anchorPolicy', label: t({ ko: '기준점', en: 'Anchor' }), type: 'select', value: options.anchorPolicy, options: ['center', 'bottom_center', 'custom'] },
    { id: 'padding', label: t({ ko: '여백', en: 'Padding' }), type: 'number', value: options.padding, min: 0, max: 512, integer: true },
    { id: 'outputSpacing', label: t({ ko: '출력 간격', en: 'Output spacing' }), type: 'number', value: options.outputSpacing, min: 0, max: 64, integer: true },
    { id: 'alphaThreshold', label: t({ ko: '알파 임계값', en: 'Alpha threshold' }), type: 'number', value: options.alphaThreshold, min: 1, max: 255, integer: true },
    { id: 'outputFormat', label: t({ ko: '형식', en: 'Format' }), type: 'select', value: options.outputFormat, options: ['png', 'webp'] },
    { id: 'outputQuality', label: t({ ko: 'WebP 품질', en: 'WebP quality' }), type: 'number', value: options.outputQuality, min: 1, max: 100, integer: true },
  ]
  const sheetSchema = pageObject({
    hash: { type: 'string', maxLength: 48 },
    columns: pageNumber(1, 64, true), rows: pageNumber(1, 64, true), frameCount: pageNumber(1, MAX_SPRITE_FRAMES, true), inputSpacing: pageNumber(0, 64, true),
    outputColumns: pageNumber(1, MAX_SPRITE_FRAMES, true), readOrder: pageChoice(['row_major', 'column_major']), customAnchorX: pageNumber(0), customAnchorY: pageNumber(0),
  }, ['hash'])
  const hashes = sheets.map((sheet) => sheet.hash)
  const actions: ChatPageAction[] = running ? [] : [
    pageAction('sprite.add_sheets', t({ ko: '시트 넣기', en: 'Add sheets' }), t({ ko: '라이브러리 이미지 해시를 시트 목록에 넣어. 격자는 자동으로 잡히고 data.sheets에서 확인해.', en: 'Add library image hashes to the sheet list; the grid is detected automatically (check data.sheets).' }), pageObject({ hashes: hashList(500) }, ['hashes'])),
    ...(sheets.length ? [
      pageAction('sprite.remove_sheets', t({ ko: '시트 빼기', en: 'Remove sheets' }), t({ ko: '시트 목록에서 빼. all이면 비워.', en: 'Remove sheets from the list; all clears it.' }), pageObject({ hashes: hashList(500), all: { type: 'boolean' } })),
      pageAction('sprite.sheet', t({ ko: '시트 격자 고치기', en: 'Edit a sheet grid' }), t({ ko: '시트 하나의 열·행·프레임 수·간격·읽는 순서·출력 열·직접 기준점을 바꿔. data.problems가 비어야 실행돼.', en: 'Change one sheet\'s columns, rows, frame count, spacing, read order, output columns or custom anchor; data.problems must be empty to run.' }), sheetSchema),
      pageAction('sprite.select', t({ ko: '시트 고르기', en: 'Pick sheet' }), t({ ko: '미리보기에 띄울 시트를 골라.', en: 'Pick the sheet the preview shows.' }), pageObject({ hash: pageChoice(hashes) }, ['hash'])),
    ] : []),
    ...(canRun ? [pageAction('sprite.download', t({ ko: 'ZIP으로 받기', en: 'Download ZIP' }), t({ ko: '저장 없이 정규화해서 ZIP으로 받아.', en: 'Normalize without saving and download a ZIP.' }))] : []),
    ...(canRun && canSave ? [pageAction('sprite.run', t({ ko: '라이브러리에 저장', en: 'Save to library' }), t({ ko: '모든 시트를 정규화해서 라이브러리에 저장해.', en: 'Normalize every sheet and save them to the library.' }), pageObject({}), 'save')] : []),
  ]
  useChatPageRegistration(active ? {
    kind: 'sprite',
    title: t({ ko: '스프라이트 · 정규화', en: 'Sprites · Normalize' }),
    resourceId: 'normalize',
    fields,
    data: {
      tab: 'normalize',
      ...(selected ? { selected } : {}),
      // Defaults (no spacing, rows first, anchors unless custom) are left out; the view is resent with every request.
      sheets: sheets.slice(0, 40).map(({ hash, name, width, height, options: sheet }) => ({
        hash, name: name.slice(0, 80), size: `${width}x${height}`, columns: sheet.columns, rows: sheet.rows, frameCount: sheet.frameCount, outputColumns: sheet.outputColumns,
        ...(sheet.inputSpacing ? { inputSpacing: sheet.inputSpacing } : {}),
        ...(sheet.readOrder !== 'row_major' ? { readOrder: sheet.readOrder } : {}),
        ...(options.anchorPolicy === 'custom' ? { customAnchorX: sheet.customAnchorX, customAnchorY: sheet.customAnchorY } : {}),
      })),
      ...(sheets.length > 40 ? { sheetCount: sheets.length } : {}),
      ...(problems.length ? { problems: problems.slice(0, 40) } : {}),
      ...(running ? { running } : {}),
      ...(savedHashes.length ? { savedSheets: savedHashes.slice(0, 40) } : {}),
      ...(failures.length ? { failures: failures.slice(0, 20).map((failure) => ({ source: failure.source, error: failure.error.slice(0, 200) })) } : {}),
    },
    actions,
    apply: (patch) => setOptions((current) => {
      const next = { ...current }
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'mode') next.mode = value === 'group' ? 'group' : 'per_sheet'
        else if (key === 'anchorPolicy') next.anchorPolicy = String(value) as SpriteAnchorPolicy
        else if (key === 'outputFormat') next.outputFormat = value === 'webp' ? 'webp' : 'png'
        else if (key in next) (next as Record<string, unknown>)[key] = Number(value)
      }
      return next
    }),
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'sprite.add_sheets') {
        const list = (Array.isArray(args.hashes) ? args.hashes : []).map(String)
        if (list.some((hash) => !HASH.test(hash))) throw new Error('라이브러리 이미지 해시가 아니야.')
        const added = await prepareSheets(list)
        assertCurrent()
        if (currentSheets.current !== sheets) throw new Error(t({ ko: '그사이 시트 목록이 바뀌었어.', en: 'The sheet list changed while loading.' }))
        if (!added.length) throw new Error(t({ ko: '넣을 새 시트가 없어.', en: 'There are no new sheets to add.' }))
        return commitSheets({ sheets: [...sheets, ...added], selected: selected ?? added[0].hash })
      }
      if (id === 'sprite.remove_sheets') {
        const before = sheets
        const drop = (Array.isArray(args.hashes) ? args.hashes : []).map(String)
        const next = args.all === true ? [] : before.filter((sheet) => !drop.includes(sheet.hash))
        if (next.length === before.length) throw new Error('목록에 없는 시트야.')
        return commitSheets({ sheets: next, selected: selected && !next.some((sheet) => sheet.hash === selected) ? next[0]?.hash ?? null : selected })
      }
      if (id === 'sprite.sheet') {
        const target = sheets.find((sheet) => sheet.hash === String(args.hash))
        if (!target) throw new Error('목록에 없는 시트야.')
        const { hash: _hash, ...patch } = args
        void _hash
        const next = sheets.map((sheet) => sheet.hash === target.hash ? { ...sheet, options: { ...sheet.options, ...patch as Partial<SpriteNormalizeSheet['options']> } } : sheet)
        return commitSheets({ sheets: next, selected: target.hash })
      }
      if (id === 'sprite.select') {
        if (!hashes.includes(String(args.hash))) throw new Error('목록에 없는 시트야.')
        setSelected(String(args.hash))
        return
      }
      if (id === 'sprite.download') { await run(false); return }
      if (id === 'sprite.run') { await run(true); return }
      throw new Error('스프라이트 정규화 화면에 없는 작업이야.')
    },
  } : null)
}

/** The animation tab: one sheet, its grid and the output (fps, format, background), run as a file or into the library. */
export function useSpriteAnimationChatPage({ active, sheet, setSheet, prepareSheet, options, setOptions, invalid, running, canRun, canSave, run, savedHashes }: {
  active: boolean
  sheet: { hash: string; name: string; width: number; height: number } | null
  setSheet: (sheet: { hash: string; name: string; width: number; height: number } | null) => void
  prepareSheet: (hash: string) => Promise<{ sheet: { hash: string; name: string; width: number; height: number }; grid: { columns: number; rows: number; frameCount: number } } | null>
  options: SpriteAnimationOptions
  setOptions: Dispatch<SetStateAction<SpriteAnimationOptions>>
  invalid: boolean
  running: boolean
  canRun: boolean
  canSave: boolean
  run: (save: boolean) => Promise<void>
  savedHashes: string[]
}) {
  const { t } = useI18n()
  const commitSheet = useChatDraftTransaction({ sheet, options }, (next) => { setSheet(next.sheet); setOptions(next.options) })
  const fields: ChatPageField[] = [
    { id: 'columns', label: t({ ko: '열', en: 'Columns' }), type: 'number', value: options.columns, min: 1, max: 64, integer: true },
    { id: 'rows', label: t({ ko: '행', en: 'Rows' }), type: 'number', value: options.rows, min: 1, max: 64, integer: true },
    { id: 'frameCount', label: t({ ko: '프레임', en: 'Frames' }), type: 'number', value: options.frameCount, min: 1, max: MAX_SPRITE_FRAMES, integer: true },
    { id: 'spacing', label: t({ ko: '간격', en: 'Spacing' }), type: 'number', value: options.spacing, min: 0, max: 64, integer: true },
    { id: 'fps', label: 'FPS', type: 'number', value: options.fps, min: 1, max: 60, integer: true },
    { id: 'outputFormat', label: t({ ko: '형식', en: 'Format' }), type: 'select', value: options.outputFormat, options: ['gif', 'webp', 'mp4'] },
    { id: 'backgroundColor', label: t({ ko: 'MP4 배경색 (#RRGGBB)', en: 'MP4 background (#RRGGBB)' }), type: 'text', value: options.backgroundColor },
  ]
  const actions: ChatPageAction[] = running ? [] : [
    pageAction('sprite.add_sheets', t({ ko: '시트 고르기', en: 'Pick sheet' }), t({ ko: '애니메이션으로 만들 라이브러리 시트 이미지를 골라. 격자는 자동으로 잡혀.', en: 'Pick the library sheet image to animate; the grid is detected automatically.' }), pageObject({ hashes: hashList(1) }, ['hashes'])),
    ...(canRun ? [pageAction('sprite.download', t({ ko: '파일로 받기', en: 'Download file' }), t({ ko: '저장 없이 애니메이션 파일로 받아.', en: 'Build the animation and download it without saving.' }))] : []),
    ...(canRun && canSave ? [pageAction('sprite.run', t({ ko: '라이브러리에 저장', en: 'Save to library' }), t({ ko: '애니메이션을 만들어 라이브러리에 저장해.', en: 'Build the animation and save it to the library.' }), pageObject({}), 'save')] : []),
  ]
  useChatPageRegistration(active ? {
    kind: 'sprite',
    title: t({ ko: '스프라이트 · 애니메이션', en: 'Sprites · Animation' }),
    resourceId: 'animation',
    fields,
    data: {
      tab: 'animation',
      sheet: sheet ? { hash: sheet.hash, name: sheet.name.slice(0, 80), size: `${sheet.width}x${sheet.height}` } : null,
      ...(sheet && invalid ? { gridProblem: true } : {}),
      ...(running ? { running } : {}),
      ...(savedHashes.length ? { savedAnimations: savedHashes.slice(0, 20) } : {}),
    },
    actions,
    apply: (patch) => setOptions((current) => {
      const next = { ...current }
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'outputFormat') next.outputFormat = String(value) as SpriteAnimationOptions['outputFormat']
        else if (key === 'backgroundColor') { const color = normalizeHex(String(value)); if (color) next.backgroundColor = color }
        else if (key in next) (next as Record<string, unknown>)[key] = Number(value)
      }
      return next
    }),
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'sprite.add_sheets') {
        const hash = String((Array.isArray(args.hashes) ? args.hashes : [])[0] ?? '')
        if (!HASH.test(hash)) throw new Error('라이브러리 이미지 해시가 아니야.')
        const prepared = await prepareSheet(hash)
        assertCurrent()
        if (!prepared) throw new Error(t({ ko: '시트를 읽지 못했어.', en: 'Could not read the sheet.' }))
        return commitSheet({ sheet: prepared.sheet, options: { ...options, ...prepared.grid, spacing: 0 } })
      }
      if (id === 'sprite.download') { await run(false); return }
      if (id === 'sprite.run') { await run(true); return }
      throw new Error('스프라이트 애니메이션 화면에 없는 작업이야.')
    },
  } : null)
}

