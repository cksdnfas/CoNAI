import type { AiTorchBackendPreference, ChatPageAction, ChatPageData, McpHttpSettings } from '@conai/shared'
import type { useI18n } from '@/i18n'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import type { RuntimeJobRecord } from '@/types/runtime-job'
import type { AutoTabProps } from './components/auto-tab-types'
import type { SettingsTab } from './settings-tabs'

type Translate = ReturnType<typeof useI18n>['t']

/** The settings page's own operations for a connected chat: the save bar, the auto tab's runtime buttons, the system and maintenance tabs. */
export type SettingsChatActionContext = {
  tab: SettingsTab
  auto: AutoTabProps
  dirtyCount: number
  saveAll: () => Promise<void>
  mcpHttp: McpHttpSettings | undefined
  setMcpHttpEnabled: (enabled: boolean) => Promise<unknown>
  maintenance: {
    scanAll: () => void
    cancelScanAll: () => void
    scanAllJob: RuntimeJobRecord | undefined
    isScanningAll: boolean
    verifyAllFiles: () => void
    cancelVerifyAllFiles: () => void
    verifyAllFilesJob: RuntimeJobRecord | undefined
    isVerifyingAllFiles: boolean
    reextractAll: () => Promise<RuntimeJobRecord | undefined>
    cancelReextractAll: () => Promise<void>
    reextractJob: RuntimeJobRecord | undefined
    isReextracting: boolean
  }
}

/** Tabs whose inputs the chat fills; the save bar saves them. */
const FIELD_TABS = new Set<SettingsTab>(['general', 'library', 'media', 'auto', 'generation', 'posts', 'system'])
const BUILDS: AiTorchBackendPreference[] = ['auto', 'cpu', 'cu126', 'cu130', 'cu132']
const MAINTENANCE = ['scan_all', 'verify_files', 'reextract_metadata', 'cancel_scan', 'cancel_verify', 'cancel_reextract'] as const

/**
 * Text for page data: clipped, and without a leading link (page data refuses text that starts like one). Every
 * connected request carries the view, so free text stays short.
 */
export function chatPageText(value: string | null | undefined, max = 160) {
  if (!value) return null
  const text = value.replace(/^\s*(?:https?:\/\/|data:)/i, '').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** A job as the chat sees it: coarse progress, so a pending review card is not invalidated by every poll. */
function jobView(job: RuntimeJobRecord | undefined, busy: boolean): ChatPageData {
  if (!job) return busy ? 'starting' : null
  const running = job.status === 'running' || job.status === 'queued'
  return {
    status: job.status,
    ...(running ? { percent: Math.floor(job.progress.percentage / 10) * 10 } : { processed: job.progress.processed, failed: job.progress.failed }),
    ...(job.failureMessage ? { failure: chatPageText(job.failureMessage) } : {}),
  }
}

export function settingsChatActions(ctx: SettingsChatActionContext, t: Translate): ChatPageAction[] {
  const actions: ChatPageAction[] = []
  if (FIELD_TABS.has(ctx.tab)) {
    actions.push(pageAction('settings.save', t({ ko: '설정 저장', en: 'Save settings' }), t({ ko: '저장 바의 저장 안 한 변경(모든 탭)을 저장해.', en: 'Save every unsaved change in the save bar (all tabs).' }), undefined, 'save'))
  }
  if (ctx.tab === 'auto') {
    actions.push(
      pageAction('settings.ai_runtime', t({ ko: 'AI 런타임 설치·취소', en: 'Install or cancel the AI runtime' }), t({
        ko: 'install: build(비우면 입력된 빌드)로 AI 환경 설치·재설치(수 GB, 몇 분, 검증 뒤 교체). cancel: 설치 중지.',
        en: 'install: install or reinstall the AI environment with build (empty = the input; a few GB, minutes; switches after its check). cancel: stop it.',
      }), pageObject({ operation: pageChoice(['install', 'cancel']), build: pageChoice(BUILDS) }, ['operation']), 'save'),
      pageAction('settings.ai_runtime_check', t({ ko: 'AI 런타임 다시 검사', en: 'Check the AI runtime again' }), t({ ko: 'GPU와 설치된 환경을 다시 검사해.', en: 'Detect the GPU and the installed environment again.' })),
      pageAction('settings.kaloscope_requeue', t({ ko: 'Kaloscope 작가 다시 추출', en: 'Re-extract Kaloscope artists' }), t({ ko: '예전 v2 작가 결과(data.kaloscope.outdated)를 3.0으로 다시 뽑아.', en: 'Extract the old v2 artist results (data.kaloscope.outdated) again with 3.0.' }), undefined, 'save'),
      pageAction('settings.rating_tier_add', t({ ko: '평가 등급 추가', en: 'Add a rating tier' }), t({ ko: '평가 등급 하나를 초안에 덧붙여.', en: 'Append a rating tier to the draft.' })),
    )
  }
  if (ctx.tab === 'system' && ctx.mcpHttp) {
    actions.push(pageAction('settings.mcp_http', t({ ko: 'HTTP MCP 켜기·끄기', en: 'Turn HTTP MCP on or off' }), t({ ko: '외부 MCP 클라이언트용 /mcp를 켜거나 꺼. 키는 사람이 관리해.', en: 'Turn /mcp for outside MCP clients on or off. Keys stay with a person.' }), pageObject({ enabled: { type: 'boolean' } }, ['enabled']), 'save'))
  }
  if (ctx.tab === 'maintenance') {
    actions.push(pageAction('settings.maintenance', t({ ko: '유지보수 작업', en: 'Maintenance job' }), t({
      ko: 'scan_all 전체 스캔 · verify_files 디스크에 없는 파일 기록 삭제(빠진 외장 드라이브도 지워지니 먼저 확인받아) · reextract_metadata 메타데이터 재추출 · cancel_scan/cancel_verify/cancel_reextract 중지. 재추출은 이미 등록한 항목을 마저 처리해.',
      en: 'scan_all rescan · verify_files remove records of files missing on disk (an unplugged drive counts; confirm first) · reextract_metadata · cancel_scan/cancel_verify/cancel_reextract. Already queued re-extractions finish.',
    }), pageObject({ operation: pageChoice([...MAINTENANCE]) }, ['operation']), 'save'))
  }
  return actions
}

export function settingsChatData(ctx: SettingsChatActionContext): Record<string, ChatPageData> {
  const { auto } = ctx
  if (ctx.tab === 'auto') {
    const runtime = auto.aiRuntimeStatus
    const install = runtime?.install
    const probe = runtime?.active?.probe ?? null
    const embedding = auto.embeddingStatus
    const kaloscope = auto.kaloscopeStatus
    return {
      aiRuntime: runtime ? {
        installed: runtime.active ? { build: runtime.active.backend, torch: probe?.torch ?? null, gpuOk: probe?.cudaAvailable ? probe.gpuSupported !== false && probe.gpuComputeOk !== false : null } : null,
        gpu: runtime.gpus[0] ? `${runtime.gpus[0].name} · cc ${runtime.gpus[0].computeCapability} · driver ${runtime.gpus[0].driverVersion}` : null,
        recommended: runtime.recommendation.blocked ? `${runtime.recommendation.backend} (blocked: ${runtime.recommendation.blocked})` : runtime.recommendation.backend,
        installSupported: runtime.installSupported,
        // The log is read once a failed install has settled; while one runs it moves every poll.
        install: install && install.status !== 'idle' ? {
          status: install.status, build: install.backend, step: install.step,
          ...(install.status === 'failed' ? { error: chatPageText(install.error), log: install.log.slice(-4).map((line) => chatPageText(line, 100) ?? '') } : {}),
        } : null,
      } : null,
      embedding: embedding ? {
        ready: embedding.enabled && embedding.dependenciesAvailable && embedding.modelCached, loaded: embedding.modelLoaded, downloading: Boolean(embedding.download), indexing: embedding.indexing,
        ...(embedding.dependenciesAvailable ? {} : { message: chatPageText(embedding.statusMessage) }),
        ...(embedding.indexing ? {} : { indexed: Object.fromEntries(embedding.indexed.map((entry) => [entry.space, entry.items])) }),
      } : null,
      kaloscope: kaloscope ? {
        ready: kaloscope.dependenciesAvailable && kaloscope.modelCached, outdated: kaloscope.outdatedResults ?? 0,
        ...(kaloscope.dependenciesAvailable ? {} : { message: chatPageText(kaloscope.statusMessage) }),
      } : null,
    }
  }
  if (ctx.tab === 'system' && ctx.mcpHttp) {
    // Key values never leave the card; the chat reads names and permissions only.
    return { mcpHttpEnabled: ctx.mcpHttp.enabled, mcpHttpKeys: ctx.mcpHttp.keys.map((key) => ({ name: key.name, group: key.groupKey })) }
  }
  if (ctx.tab === 'maintenance') {
    const { maintenance } = ctx
    return {
      jobs: {
        scanAll: jobView(maintenance.scanAllJob, maintenance.isScanningAll),
        verifyFiles: jobView(maintenance.verifyAllFilesJob, maintenance.isVerifyingAllFiles),
        reextractMetadata: maintenance.reextractJob && (maintenance.reextractJob.status === 'queued' || maintenance.reextractJob.status === 'running')
          ? { status: maintenance.reextractJob.status, phase: maintenance.reextractJob.phase }
          : jobView(maintenance.reextractJob, maintenance.isReextracting),
      },
    }
  }
  if (ctx.tab === 'generation') {
    return { comfyuiHelper: 'A person downloads the CoNAI Helper ZIP here into ComfyUI custom_nodes; outputs return through its node' }
  }
  return {}
}

/** Runs a settings operation; false when the id is not one of the page's own. */
export async function applySettingsChatAction(id: string, args: Record<string, ChatPageData>, ctx: SettingsChatActionContext): Promise<boolean> {
  const { auto, maintenance } = ctx
  switch (id) {
    case 'settings.save':
      if (ctx.dirtyCount === 0) throw new Error('저장할 변경이 없어.')
      await ctx.saveAll()
      return true
    case 'settings.ai_runtime': {
      const runtime = auto.aiRuntimeStatus
      if (!runtime) throw new Error('AI 런타임 상태를 아직 못 읽었어.')
      if (args.operation === 'cancel') {
        if (runtime.install.status !== 'running') throw new Error('진행 중인 설치가 없어.')
        auto.onCancelAiRuntimeInstall()
        return true
      }
      if (runtime.install.status === 'running') throw new Error('이미 설치 중이야.')
      if (!runtime.installSupported) throw new Error('이 환경에서는 앱이 AI 런타임을 설치할 수 없어.')
      if (runtime.recommendation.blocked === 'driver-too-old') throw new Error('GPU 드라이버가 낮아서 설치할 수 없어. 드라이버를 580 이상으로 올려줘.')
      const build = (typeof args.build === 'string' ? args.build : auto.aiRuntimeDraft?.torchBackend ?? 'auto') as AiTorchBackendPreference
      auto.onInstallAiRuntime(build)
      return true
    }
    case 'settings.ai_runtime_check':
      auto.onRefreshAiRuntime()
      return true
    case 'settings.kaloscope_requeue': {
      const status = auto.kaloscopeStatus
      if (!status?.outdatedResults) throw new Error('다시 뽑을 예전 결과가 없어.')
      if (!status.enabled || !status.autoTagOnUpload) throw new Error('Kaloscope와 새 이미지 자동 처리를 먼저 켜고 저장해줘.')
      auto.onRequeueOutdatedKaloscope()
      return true
    }
    case 'settings.rating_tier_add':
      auto.onAddRatingTier()
      return true
    case 'settings.mcp_http':
      await ctx.setMcpHttpEnabled(args.enabled === true)
      return true
    case 'settings.maintenance':
      switch (args.operation) {
        case 'scan_all': if (maintenance.isScanningAll) throw new Error('이미 스캔 중이야.'); maintenance.scanAll(); return true
        case 'verify_files': if (maintenance.isVerifyingAllFiles) throw new Error('이미 검증 중이야.'); maintenance.verifyAllFiles(); return true
        case 'reextract_metadata':
          if (!(await maintenance.reextractAll())) throw new Error('메타데이터 재추출을 시작하지 못했어.')
          return true
        case 'cancel_scan': maintenance.cancelScanAll(); return true
        case 'cancel_verify': maintenance.cancelVerifyAllFiles(); return true
        case 'cancel_reextract':
          if (!maintenance.reextractJob || (maintenance.reextractJob.status !== 'queued' && maintenance.reextractJob.status !== 'running')) {
            throw new Error('진행 중인 재추출이 없어.')
          }
          await maintenance.cancelReextractAll()
          return true
      }
      throw new Error('알 수 없는 유지보수 작업이야.')
  }
  return false
}
