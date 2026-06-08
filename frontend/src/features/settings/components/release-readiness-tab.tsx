import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCopy, Download, History, RotateCcw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SettingsInsetBlock, SettingsSection, SettingsToggleRow, SettingsValueTile } from './settings-primitives'
import { APP_VERSION_LABEL } from '@/lib/app-metadata'
import { triggerBlobDownload } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n, type TranslationDictionary } from '@/i18n'
import {
  buildReleaseReadinessHandoffFilename,
  buildReleaseReadinessHandoffMarkdown,
  buildReleaseReadinessHistoryRecord,
  readReleaseReadinessHistoryFromStorage,
  RELEASE_READINESS_HISTORY_SCHEMA_VERSION,
  saveReleaseReadinessHistoryRecord,
  type ReleaseReadinessChecklistItemContract,
  type ReleaseReadinessEvidenceItemContract,
  type ReleaseReadinessHandoffItemContract,
  type ReleaseReadinessHistoryRecord,
  type ReleaseReadinessRunbookGuardrailContract,
  type ReleaseReadinessUserDecisionContract,
} from '../release-readiness-history'

type ReadinessItem = ReleaseReadinessChecklistItemContract
type EvidenceItem = ReleaseReadinessEvidenceItemContract
type HandoffEvidenceItem = ReleaseReadinessHandoffItemContract
type RunbookGuardrail = ReleaseReadinessRunbookGuardrailContract
type UserDecisionItem = ReleaseReadinessUserDecisionContract

type IntegratedOperationsLane = {
  id: string
  label: TranslationDictionary
  status: TranslationDictionary
  source: string
  description: TranslationDictionary
  checkpoints: TranslationDictionary[]
  nextReview: TranslationDictionary
}

type IntegratedDecisionGate = {
  id: string
  title: TranslationDictionary
  description: TranslationDictionary
}

const REVIEW_ITEMS: ReadinessItem[] = [
  {
    id: 'completed-work',
    title: { ko: '완료 작업 검토', en: 'Completed work reviewed' },
    description: {
      ko: '완료된 변경, 릴리즈 노트, 로컬 결과 상태가 릴리즈 판단 전에 확인됨.',
      en: 'Completed changes, release notes, and local result state are checked before release decisions.',
    },
  },
  {
    id: 'caveats',
    title: { ko: '주의 사항 확인', en: 'Caveats reviewed' },
    description: {
      ko: '미완료 항목, 보호 서비스, 외부 작업 제한이 릴리즈 준비 판단에 포함됨.',
      en: 'Open caveats, protected services, and external-action limits are included in readiness review.',
    },
  },
  {
    id: 'evidence',
    title: { ko: '검증 근거 확인', en: 'Evidence checked' },
    description: {
      ko: '빌드, 문서, Graphify 갱신, 스모크 근거가 커밋 또는 핸드오프 기록과 연결됨.',
      en: 'Build, docs, Graphify refresh, and smoke evidence are tied to commits or handoff notes.',
    },
  },
  {
    id: 'decisions',
    title: { ko: '사용자 결정 분리', en: 'User decisions separated' },
    description: {
      ko: 'push, demo update, restart, destructive cleanup은 실행 버튼이 아니라 승인 항목으로 남음.',
      en: 'Push, demo update, restart, and destructive cleanup stay as approvals, not action buttons.',
    },
  },
]

const INTEGRATED_OPERATIONS_LANES: IntegratedOperationsLane[] = [
  {
    id: 'release-handoff',
    label: { ko: '릴리즈 준비', en: 'Release readiness' },
    status: { ko: '승인 분리', en: 'Approvals separated' },
    source: 'Settings > Release readiness',
    description: {
      ko: '로컬 커밋, 검증 근거, 핸드오프 메모, 롤백 기준을 먼저 모으고 push/deploy/restart는 사용자 결정으로 남겨.',
      en: 'Collect local commits, verification evidence, handoff notes, and rollback criteria while push/deploy/restart stay user decisions.',
    },
    checkpoints: [
      { ko: '완료 작업과 caveat 검토', en: 'Completed work and caveat review' },
      { ko: 'verify:release-readiness와 Graphify 근거', en: 'verify:release-readiness and Graphify evidence' },
      { ko: 'alpha/demo/restart/cleanup 승인 분리', en: 'Separate alpha/demo/restart/cleanup approvals' },
    ],
    nextReview: { ko: '릴리즈 액션 전 최종 판단', en: 'Final judgment before release action' },
  },
  {
    id: 'media-intelligence',
    label: { ko: '미디어 품질', en: 'Media quality' },
    status: { ko: '비파괴 검토', en: 'Non-destructive review' },
    source: 'Media review',
    description: {
      ko: '추천 큐, 태그 품질, 그룹 검사, 유사도 결정 기록, 복구 가능한 정리 staging을 릴리즈 판단 근거에 연결해.',
      en: 'Connect recommended queues, tag quality, group checks, similarity decision history, and recoverable cleanup staging to release judgment.',
    },
    checkpoints: [
      { ko: 'recommended queues와 tag quality suggestions', en: 'Recommended queues and tag quality suggestions' },
      { ko: 'group quality checks와 similarity decision history', en: 'Group quality checks and similarity decision history' },
      { ko: 'reversible cleanup staging, destructive cleanup 제외', en: 'Reversible cleanup staging, destructive cleanup excluded' },
    ],
    nextReview: { ko: '미디어 cleanup이나 공개 전 품질 판단', en: 'Quality judgment before media cleanup or public review' },
  },
  {
    id: 'workflow-runtime',
    label: { ko: '워크플로우 런타임', en: 'Workflow runtime' },
    status: { ko: '운영 상태', en: 'Runtime state' },
    source: 'Module graph > Run panel',
    description: {
      ko: 'saved workflow version, preset diff, queue health, retry policy, artifact retention, recovery telemetry를 실행 반복 전 확인 대상으로 둬.',
      en: 'Keep saved workflow versions, preset diffs, queue health, retry policy, artifact retention, and recovery telemetry reviewable before reruns.',
    },
    checkpoints: [
      { ko: 'version summary와 preset diff visibility', en: 'Version summary and preset diff visibility' },
      { ko: 'queue health, retry policy, retention hints', en: 'Queue health, retry policy, retention hints' },
      { ko: 'startup recovery와 running-not-in-process telemetry', en: 'Startup recovery and running-not-in-process telemetry' },
    ],
    nextReview: { ko: 'rerun, recovery, smoke 계획 전 상태 확인', en: 'State check before rerun, recovery, or smoke planning' },
  },
]

const INTEGRATED_DECISION_GATES: IntegratedDecisionGate[] = [
  {
    id: 'release-evidence-ready',
    title: { ko: '릴리즈 근거가 먼저 준비됨', en: 'Release evidence comes first' },
    description: {
      ko: '로컬 검증과 handoff evidence가 없으면 push/demo/restart 판단으로 넘어가지 않아.',
      en: 'Push/demo/restart judgment does not proceed without local checks and handoff evidence.',
    },
  },
  {
    id: 'media-quality-before-cleanup',
    title: { ko: '미디어 품질 판단이 정리보다 앞섬', en: 'Media quality before cleanup' },
    description: {
      ko: '추천 큐와 품질 신호는 staging만 만들고 삭제나 보존 정책 변경은 별도 승인으로 남겨.',
      en: 'Queues and quality signals create staging only; deletion and retention policy changes stay separately approved.',
    },
  },
  {
    id: 'runtime-health-before-rerun',
    title: { ko: '런타임 상태가 재실행보다 앞섬', en: 'Runtime health before rerun' },
    description: {
      ko: 'queue, retry, retention, recovery 상태가 기록되지 않으면 rerun/smoke 근거가 불완전한 것으로 봐.',
      en: 'Rerun/smoke evidence is incomplete until queue, retry, retention, and recovery state are recorded.',
    },
  },
]

const EVIDENCE_ITEMS: EvidenceItem[] = [
  {
    id: 'current-version',
    label: { ko: '현재 버전', en: 'Current version' },
    value: APP_VERSION_LABEL,
    detail: { ko: '패키지 버전 라벨 기준', en: 'From the package version label' },
    tone: 'ready',
  },
  {
    id: 'release-check',
    label: { ko: '릴리즈 점검', en: 'Release check' },
    value: 'npm run verify:release-readiness',
    detail: { ko: '스크립트 alias, docs build, 전체 build 포함', en: 'Includes script aliases, docs build, and full build' },
    tone: 'ready',
  },
  {
    id: 'graphify-evidence',
    label: { ko: 'Graphify 근거', en: 'Graphify evidence' },
    value: 'python -m graphify update .',
    detail: { ko: '코드 변경 뒤 갱신 필요', en: 'Required after code changes' },
    tone: 'attention',
  },
  {
    id: 'external-actions',
    label: { ko: '외부 작업', en: 'External actions' },
    value: 'approval-required',
    detail: { ko: 'push, deploy, restart는 별도 승인 필요', en: 'Push, deploy, and restart need separate approval' },
    tone: 'blocked',
  },
]

const REVIEW_LANES: ReadinessItem[] = [
  {
    id: 'local-results',
    title: { ko: '로컬 결과', en: 'Local results' },
    description: {
      ko: '커밋, 변경 요약, 로컬 UI/계약 검증, 문서 빌드 결과를 릴리즈 전 근거로 모음.',
      en: 'Commit, change summary, focused UI/contract checks, and docs build results are collected as release evidence.',
    },
  },
  {
    id: 'caveat-register',
    title: { ko: '주의 사항', en: 'Caveats' },
    description: {
      ko: '미완료 항목, 실패한 검증, 보호 포트 3999, 수동 확인 필요 작업을 릴리즈 판단에서 숨기지 않음.',
      en: 'Open work, failed checks, protected port 3999, and manual checks stay visible for release judgment.',
    },
  },
  {
    id: 'handoff-evidence',
    title: { ko: '핸드오프 근거', en: 'Handoff evidence' },
    description: {
      ko: 'alpha push, demo host update, smoke, rollback 준비에 필요한 파일과 명령을 실행 전 검토 대상으로 둠.',
      en: 'Files and commands for alpha push, demo-host update, smoke, and rollback preparation stay reviewable before execution.',
    },
  },
]

const HANDOFF_EVIDENCE_ITEMS: HandoffEvidenceItem[] = [
  {
    id: 'local-commit-snapshot',
    title: { ko: '로컬 커밋 스냅샷', en: 'Local commit snapshot' },
    artifact: 'git status --short --branch; git log --oneline origin/alphatest..HEAD',
    detail: {
      ko: '원격보다 앞선 로컬 커밋과 깨끗한 작업 트리를 push 판단 전에 캡처해.',
      en: 'Capture local commits ahead of origin and clean worktree state before any push decision.',
    },
  },
  {
    id: 'alpha-push-plan',
    title: { ko: 'alpha push 준비 메모', en: 'Alpha push preparation note' },
    artifact: 'push approval note for alphatest',
    detail: {
      ko: 'push 명령은 실행하지 않고 대상 브랜치, 승인자, 예상 커밋 범위만 검토 대상으로 둬.',
      en: 'Do not run push; keep target branch, approver, and expected commit range reviewable.',
    },
  },
  {
    id: 'demo-host-handoff',
    title: { ko: 'demo host 핸드오프', en: 'Demo host handoff' },
    artifact: 'live demo host pull/update command notes',
    detail: {
      ko: 'demo host pull/update는 push 승인 뒤 별도 단계로 남기고 필요한 명령과 대상만 기록해.',
      en: 'Keep demo-host pull/update as a later approved step while recording commands and target host notes.',
    },
  },
  {
    id: 'smoke-evidence',
    title: { ko: '스모크 근거 번들', en: 'Smoke evidence bundle' },
    artifact: 'npm run verify:release-readiness + live target smoke notes',
    detail: {
      ko: '로컬 검증과 live target smoke 계획을 분리해, smoke 실행은 재시작 승인 뒤에만 진행해.',
      en: 'Separate local verification from live-target smoke planning; smoke runs only after restart approval.',
    },
  },
  {
    id: 'rollback-plan',
    title: { ko: '롤백 준비 기록', en: 'Rollback preparation record' },
    artifact: 'rollback notes: previous commit, service target, protected port 3999',
    detail: {
      ko: '재시작 전에 이전 커밋, 대상 서비스, 보호 포트 3999 회피, 실패 시 중단 기준을 확인해.',
      en: 'Confirm previous commit, service target, protected port 3999 avoidance, and stop criteria before restart.',
    },
  },
]

const RUNBOOK_GUARDRAILS: RunbookGuardrail[] = [
  {
    id: 'approval-before-push',
    phase: { ko: 'alpha push', en: 'Alpha push' },
    title: { ko: '승인 전 push 금지', en: 'No push before approval' },
    status: { ko: '승인 필요', en: 'Approval required' },
    description: {
      ko: '작업자는 로컬 커밋까지만 만들고 원격 반영은 사용자 승인 뒤 별도 단계로 남겨.',
      en: 'Workers stop at local commits; remote updates remain separate until the user approves them.',
    },
  },
  {
    id: 'demo-host-preflight',
    phase: { ko: 'demo host', en: 'Demo host' },
    title: { ko: 'pull/update는 준비 전용', en: 'Pull/update is preparation only' },
    status: { ko: '준비 전용', en: 'Preparation only' },
    description: {
      ko: 'demo host 대상, 브랜치, 예상 명령은 기록하지만 pull, deploy, restart는 실행하지 않아.',
      en: 'Record host, branch, and expected commands without running pull, deploy, or restart.',
    },
  },
  {
    id: 'protected-3999',
    phase: { ko: 'restart/smoke', en: 'Restart/smoke' },
    title: { ko: '보호 포트 3999 회피', en: 'Avoid protected port 3999' },
    status: { ko: '차단', en: 'Blocked' },
    description: {
      ko: '로드맵이 명시하지 않는 한 서비스 3999 조작, 재시작, smoke 실행은 승인 대상이야.',
      en: 'Touching service 3999, restarting, or running smoke needs approval unless a roadmap explicitly allows it.',
    },
  },
  {
    id: 'rollback-before-restart',
    phase: { ko: 'rollback', en: 'Rollback' },
    title: { ko: '재시작 전 롤백 기준', en: 'Rollback before restart' },
    status: { ko: '필수 확인', en: 'Required check' },
    description: {
      ko: '재시작 승인 전 이전 커밋, 실패 기준, 복구 담당 범위가 핸드오프 메모에 있어야 해.',
      en: 'Previous commit, failure threshold, and recovery owner notes must exist before restart approval.',
    },
  },
  {
    id: 'destructive-cleanup-boundary',
    phase: { ko: 'data cleanup', en: 'Data cleanup' },
    title: { ko: '파괴적 정리 분리', en: 'Separate destructive cleanup' },
    status: { ko: '별도 승인', en: 'Separate approval' },
    description: {
      ko: '삭제, 보존 정책, 스키마 변경은 release handoff 근거가 아니라 별도 승인 작업으로 남겨.',
      en: 'Deletion, retention policy, and schema changes stay outside release handoff evidence.',
    },
  },
]

const USER_DECISIONS: UserDecisionItem[] = [
  {
    id: 'alpha-push',
    title: { ko: 'alpha branch push 승인', en: 'Approve alpha branch push' },
    description: { ko: '로컬 검토 뒤 원격 반영 여부를 사용자가 결정함.', en: 'The user decides whether local work is pushed remotely after review.' },
  },
  {
    id: 'demo-update',
    title: { ko: 'demo host 업데이트 승인', en: 'Approve demo host update' },
    description: { ko: 'demo host pull/update는 릴리즈 판단 뒤 별도 승인으로 진행함.', en: 'Demo host pull/update happens only after a separate release decision.' },
  },
  {
    id: 'restart-smoke',
    title: { ko: 'restart/smoke 승인', en: 'Approve restart/smoke' },
    description: { ko: '서비스 재시작과 smoke는 보호 포트와 롤백 계획 확인 뒤 진행함.', en: 'Service restart and smoke run only after protected-port and rollback checks.' },
  },
  {
    id: 'cleanup',
    title: { ko: '데이터 정리 승인', en: 'Approve data cleanup' },
    description: { ko: '파괴적 삭제나 보존 정책 변경은 이 화면에서 실행하지 않음.', en: 'Destructive deletion or retention changes are not executed from this workspace.' },
  },
]

function getEvidenceToneLabel(tone: EvidenceItem['tone']) {
  if (tone === 'ready') return { ko: '준비', en: 'Ready' }
  if (tone === 'attention') return { ko: '확인', en: 'Check' }
  return { ko: '승인 필요', en: 'Approval needed' }
}

function getEvidenceToneVariant(tone: EvidenceItem['tone']) {
  if (tone === 'ready') return 'default'
  if (tone === 'attention') return 'secondary'
  return 'outline'
}

/** Provide a release decision workspace that never performs external release actions itself. */
export function ReleaseReadinessTab() {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [readinessHistory, setReadinessHistory] = useState(() => readReleaseReadinessHistoryFromStorage().records)
  const latestReadinessRecord = readinessHistory[0] ?? null
  const [selectedHistoryRecordId, setSelectedHistoryRecordId] = useState<string | null>(null)
  const [reviewedItems, setReviewedItems] = useState<Set<string>>(() => new Set(latestReadinessRecord?.reviewedItemIds ?? []))
  const [capturedHandoffItems, setCapturedHandoffItems] = useState<Set<string>>(() => new Set(latestReadinessRecord?.capturedHandoffItemIds ?? []))
  const reviewedCount = reviewedItems.size
  const capturedHandoffCount = capturedHandoffItems.size
  const allReviewed = reviewedCount === REVIEW_ITEMS.length
  const allHandoffCaptured = capturedHandoffCount === HANDOFF_EVIDENCE_ITEMS.length
  const readinessState = allReviewed ? t({ ko: '검토 완료', en: 'Reviewed' }) : t({ ko: '{count}/{total} 확인', en: '{count}/{total} checked' }, { count: reviewedCount, total: REVIEW_ITEMS.length })
  const handoffState = allHandoffCaptured ? t({ ko: '근거 캡처 완료', en: 'Evidence captured' }) : t({ ko: '{count}/{total} 캡처', en: '{count}/{total} captured' }, { count: capturedHandoffCount, total: HANDOFF_EVIDENCE_ITEMS.length })
  const historyState = readinessHistory.length > 0 ? t({ ko: '{count}개 저장', en: '{count} saved' }, { count: readinessHistory.length }) : t({ ko: '기록 없음', en: 'No records' })
  const latestHistoryLabel = latestReadinessRecord
    ? formatDateTime(latestReadinessRecord.savedAt, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : t({ ko: '아직 없음', en: 'None yet' })

  const readinessPercent = useMemo(() => Math.round((reviewedCount / REVIEW_ITEMS.length) * 100), [reviewedCount])
  const selectedReadinessRecord = useMemo(
    () => readinessHistory.find((record) => record.id === selectedHistoryRecordId) ?? latestReadinessRecord,
    [latestReadinessRecord, readinessHistory, selectedHistoryRecordId],
  )
  const selectedHandoffMarkdown = useMemo(
    () => selectedReadinessRecord ? buildReleaseReadinessHandoffMarkdown(selectedReadinessRecord) : '',
    [selectedReadinessRecord],
  )

  const toggleReviewedItem = (id: string, checked: boolean) => {
    setReviewedItems((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const toggleCapturedHandoffItem = (id: string, checked: boolean) => {
    setCapturedHandoffItems((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const saveReadinessHistorySnapshot = () => {
    const record = buildReleaseReadinessHistoryRecord({
      appVersionLabel: APP_VERSION_LABEL,
      reviewedItemIds: reviewedItems,
      capturedHandoffItemIds: capturedHandoffItems,
      reviewItems: REVIEW_ITEMS,
      evidenceItems: EVIDENCE_ITEMS,
      handoffItems: HANDOFF_EVIDENCE_ITEMS,
      runbookGuardrails: RUNBOOK_GUARDRAILS,
      userDecisions: USER_DECISIONS,
    })
    const document = saveReleaseReadinessHistoryRecord(record)
    setReadinessHistory(document.records)
    setSelectedHistoryRecordId(record.id)
    showSnackbar({ message: t({ ko: '릴리즈 준비 스냅샷을 저장했어.', en: 'Saved the release readiness snapshot.' }), tone: 'info' })
  }

  const restoreReadinessHistoryRecord = (record: ReleaseReadinessHistoryRecord) => {
    setSelectedHistoryRecordId(record.id)
    setReviewedItems(new Set(record.reviewedItemIds))
    setCapturedHandoffItems(new Set(record.capturedHandoffItemIds))
  }

  const copySelectedHandoffOutput = async () => {
    if (!selectedHandoffMarkdown) return

    try {
      await copyTextToClipboard(selectedHandoffMarkdown)
      showSnackbar({ message: t({ ko: '런북 핸드오프를 복사했어.', en: 'Copied the runbook handoff.' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '런북 핸드오프 복사에 실패했어.', en: 'Failed to copy the runbook handoff.' }), tone: 'error' })
    }
  }

  const downloadSelectedHandoffOutput = () => {
    if (!selectedReadinessRecord || !selectedHandoffMarkdown) return

    const blob = new Blob([selectedHandoffMarkdown], { type: 'text/markdown;charset=utf-8' })
    triggerBlobDownload(blob, buildReleaseReadinessHandoffFilename(selectedReadinessRecord))
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        data-release-readiness-history-contract="true"
        heading={t({ ko: '릴리즈 준비 워크스페이스', en: 'Release readiness workspace' })}
        actions={(
          <>
            <Button type="button" size="sm" variant="secondary" onClick={saveReadinessHistorySnapshot}>
              <Save className="h-4 w-4" />
              {t({ ko: '스냅샷 저장', en: 'Save snapshot' })}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setReviewedItems(new Set(REVIEW_ITEMS.map((item) => item.id)))}>
              <CheckCircle2 className="h-4 w-4" />
              {t({ ko: '검토 표시', en: 'Mark reviewed' })}
            </Button>
            <Button type="button" size="icon-sm" variant="secondary" onClick={() => setReviewedItems(new Set())} aria-label={t({ ko: '검토 초기화', en: 'Reset review' })} title={t({ ko: '검토 초기화', en: 'Reset review' })}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </>
        )}
      >
        <div className="grid gap-3 min-[900px]:grid-cols-[minmax(0,1fr)_180px_180px]">
          <SettingsInsetBlock>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={allReviewed ? 'default' : 'secondary'}>{readinessState}</Badge>
              <Badge variant={allHandoffCaptured ? 'default' : 'secondary'}>{handoffState}</Badge>
              <div className="min-w-0 text-sm text-muted-foreground">
                {t({
                  ko: '완료 작업, 주의 사항, 검증 근거, 사용자 결정을 릴리즈 액션 전에 한곳에서 점검해.',
                  en: 'Review completed work, caveats, evidence, and user-owned decisions in one place before release actions.',
                })}
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-sm bg-surface-high">
              <div className="h-full bg-primary transition-all" style={{ width: `${readinessPercent}%` }} />
            </div>
          </SettingsInsetBlock>

          <SettingsValueTile label={t({ ko: '진행률', en: 'Progress' })} value={`${readinessPercent}%`} />
          <SettingsValueTile
            data-release-readiness-history-summary="true"
            label={t({ ko: '런북 이력', en: 'Runbook history' })}
            value={(
              <span className="flex min-w-0 flex-col gap-1">
                <span>{historyState}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {t({ ko: 'v{version} · {latest}', en: 'v{version} · {latest}' }, { version: RELEASE_READINESS_HISTORY_SCHEMA_VERSION, latest: latestHistoryLabel })}
                </span>
              </span>
            )}
          />
        </div>

        <div className="grid gap-3 min-[900px]:grid-cols-2">
          {REVIEW_ITEMS.map((item) => {
            const checked = reviewedItems.has(item.id)

            return (
              <SettingsToggleRow key={item.id} className={cn('items-start', checked && 'border-primary/40 bg-primary/10')}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleReviewedItem(item.id, event.target.checked)}
                  aria-label={t(item.title)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{t(item.title)}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(item.description)}</span>
                </span>
              </SettingsToggleRow>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        data-release-readiness-runbook-export="true"
        heading={t({ ko: '런북 이력 내보내기', en: 'Runbook history export' })}
        actions={(
          <>
            <Button type="button" size="sm" variant="secondary" disabled={!selectedReadinessRecord} onClick={() => void copySelectedHandoffOutput()}>
              <ClipboardCopy className="h-4 w-4" />
              {t({ ko: '핸드오프 복사', en: 'Copy handoff' })}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!selectedReadinessRecord} onClick={downloadSelectedHandoffOutput}>
              <Download className="h-4 w-4" />
              {t({ ko: 'MD 내보내기', en: 'Export MD' })}
            </Button>
          </>
        )}
      >
        <SettingsInsetBlock className="text-sm leading-6 text-muted-foreground">
          {t({
            ko: '저장된 readiness 기록을 다시 확인하고, push/deploy/restart 없이 로컬 검토용 Markdown 핸드오프만 만들어.',
            en: 'Review saved readiness records and produce a local Markdown handoff without push, deploy, or restart.',
          })}
        </SettingsInsetBlock>

        <div className="grid gap-3 min-[1100px]:grid-cols-[minmax(280px,0.7fr)_minmax(0,1.3fr)]">
          <SettingsInsetBlock className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="h-4 w-4" />
              {t({ ko: '저장된 실행 근거', en: 'Saved evidence runs' })}
            </div>
            {readinessHistory.length > 0 ? (
              <div className="space-y-2">
                {readinessHistory.map((record) => {
                  const selected = selectedReadinessRecord?.id === record.id

                  return (
                    <button
                      key={record.id}
                      type="button"
                      data-release-readiness-history-record={record.id}
                      className={cn(
                        'w-full rounded-sm border border-border/70 bg-surface-container/35 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-primary/10',
                        selected && 'border-primary/60 bg-primary/10',
                      )}
                      onClick={() => setSelectedHistoryRecordId(record.id)}
                    >
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {formatDateTime(record.savedAt, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <Badge variant={record.summary.readyForExport ? 'default' : 'secondary'}>
                          {record.summary.readyForExport ? t({ ko: '내보내기 준비', en: 'Export ready' }) : t({ ko: '부분 기록', en: 'Partial' })}
                        </Badge>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t(
                          { ko: '검토 {reviewed}/{reviewTotal} · 핸드오프 {handoff}/{handoffTotal}', en: 'Reviewed {reviewed}/{reviewTotal} · handoff {handoff}/{handoffTotal}' },
                          {
                            reviewed: record.summary.reviewedCount,
                            reviewTotal: record.summary.reviewItemCount,
                            handoff: record.summary.capturedHandoffCount,
                            handoffTotal: record.summary.handoffItemCount,
                          },
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-sm border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
                {t({ ko: '저장된 readiness 기록이 없어.', en: 'No saved readiness records.' })}
              </div>
            )}
            <Button type="button" size="sm" variant="outline" disabled={!selectedReadinessRecord} onClick={() => selectedReadinessRecord && restoreReadinessHistoryRecord(selectedReadinessRecord)}>
              <RotateCcw className="h-4 w-4" />
              {t({ ko: '선택 기록 불러오기', en: 'Load selected record' })}
            </Button>
          </SettingsInsetBlock>

          <SettingsInsetBlock className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-foreground">{t({ ko: '핸드오프 출력', en: 'Handoff output' })}</div>
              <Badge variant="outline">{t({ ko: '로컬 Markdown', en: 'Local Markdown' })}</Badge>
            </div>
            <Textarea
              data-release-readiness-handoff-output="true"
              variant="settings"
              readOnly
              className="min-h-[300px] resize-y font-mono text-xs leading-5"
              value={selectedHandoffMarkdown || t({ ko: '스냅샷을 저장하면 핸드오프 출력이 여기에 생성돼.', en: 'Save a snapshot to generate handoff output here.' })}
            />
          </SettingsInsetBlock>
        </div>
      </SettingsSection>

      <SettingsSection
        data-integrated-operations-surface="true"
        heading={t({ ko: '통합 운영 표면', en: 'Integrated operations surface' })}
        actions={<Badge variant="secondary">{t({ ko: '검토 허브', en: 'Review hub' })}</Badge>}
      >
        <SettingsInsetBlock className="text-sm leading-6 text-muted-foreground">
          {t({
            ko: '릴리즈 준비, 미디어 품질, 워크플로우 런타임 상태를 같은 판단 흐름에 묶어 외부 작업 전에 확인할 근거와 남은 사용자 결정을 분리해.',
            en: 'Release readiness, media quality, and workflow runtime state are tied into one judgment flow so evidence and user decisions stay separated before external action.',
          })}
        </SettingsInsetBlock>

        <div className="grid gap-3 min-[1100px]:grid-cols-3">
          {INTEGRATED_OPERATIONS_LANES.map((lane) => (
            <SettingsInsetBlock key={lane.id} data-integrated-operations-lane={lane.id} className="flex min-h-full flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(lane.label)}</Badge>
                <Badge variant="outline">{t(lane.status)}</Badge>
              </div>
              <div className="mt-3 font-mono text-xs text-muted-foreground">{lane.source}</div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">{t(lane.description)}</div>
              <div className="mt-4 space-y-2">
                {lane.checkpoints.map((checkpoint) => (
                  <div key={t(checkpoint)} className="rounded-sm border border-border/60 bg-surface-container/35 px-3 py-2 text-xs leading-5 text-foreground">
                    {t(checkpoint)}
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-4 text-xs font-medium text-muted-foreground">
                {t(lane.nextReview)}
              </div>
            </SettingsInsetBlock>
          ))}
        </div>

        <div data-integrated-operations-gates="true" className="grid gap-3 min-[1000px]:grid-cols-3">
          {INTEGRATED_DECISION_GATES.map((gate) => (
            <SettingsInsetBlock key={gate.id} data-integrated-operations-gate={gate.id}>
              <div className="text-sm font-semibold text-foreground">{t(gate.title)}</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">{t(gate.description)}</div>
            </SettingsInsetBlock>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection heading={t({ ko: '검증 근거', en: 'Readiness evidence' })}>
        <div className="grid gap-3 md:grid-cols-2 min-[1200px]:grid-cols-4">
          {EVIDENCE_ITEMS.map((item) => (
            <SettingsValueTile
              key={item.value}
              label={t(item.label)}
              value={(
                <span className="flex min-w-0 flex-col gap-2">
                  <span className="truncate font-mono text-xs">{item.value}</span>
                  <Badge variant={getEvidenceToneVariant(item.tone)}>{t(getEvidenceToneLabel(item.tone))}</Badge>
                </span>
              )}
              valueClassName="font-normal"
            />
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {EVIDENCE_ITEMS.map((item) => (
            <SettingsInsetBlock key={t(item.label)} className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{t(item.label)}: </span>
              {t(item.detail)}
            </SettingsInsetBlock>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        heading={t({ ko: '릴리즈 핸드오프 근거', en: 'Release handoff evidence' })}
        actions={<Badge variant={capturedHandoffCount === HANDOFF_EVIDENCE_ITEMS.length ? 'default' : 'secondary'}>{handoffState}</Badge>}
      >
        <SettingsInsetBlock className="text-sm leading-6 text-muted-foreground">
          {t({
            ko: '이 체크는 실행 기록이 아니라 release handoff에 필요한 근거가 준비됐는지 보는 로컬 검토 상태야. push, deploy, restart, smoke는 여기서 실행하지 않아.',
            en: 'These checks are local review state for release handoff evidence, not execution records. Push, deploy, restart, and smoke do not run here.',
          })}
        </SettingsInsetBlock>

        <div className="grid gap-3 min-[1000px]:grid-cols-2">
          {HANDOFF_EVIDENCE_ITEMS.map((item) => {
            const checked = capturedHandoffItems.has(item.id)

            return (
              <SettingsToggleRow key={item.id} className={cn('items-start', checked && 'border-primary/40 bg-primary/10')}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleCapturedHandoffItem(item.id, event.target.checked)}
                  aria-label={t(item.title)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{t(item.title)}</span>
                  <span className="mt-1 block font-mono text-xs text-foreground/90">{item.artifact}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(item.detail)}</span>
                </span>
              </SettingsToggleRow>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection heading={t({ ko: '런북 가드레일', en: 'Runbook guardrails' })}>
        <div className="grid gap-3 min-[1000px]:grid-cols-2">
          {RUNBOOK_GUARDRAILS.map((item) => (
            <SettingsInsetBlock key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(item.phase)}</Badge>
                <Badge variant="outline">{t(item.status)}</Badge>
              </div>
              <div className="mt-3 text-sm font-semibold text-foreground">{t(item.title)}</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">{t(item.description)}</div>
            </SettingsInsetBlock>
          ))}
        </div>
      </SettingsSection>

      <div className="grid gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <SettingsSection heading={t({ ko: '검토 레인', en: 'Review lanes' })}>
          <div className="grid gap-3">
            {REVIEW_LANES.map((item) => (
              <SettingsInsetBlock key={item.id}>
                <div className="text-sm font-semibold text-foreground">{t(item.title)}</div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">{t(item.description)}</div>
              </SettingsInsetBlock>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection heading={t({ ko: '사용자 결정 필요', en: 'User decisions needed' })}>
          <div className="space-y-3">
            {USER_DECISIONS.map((item) => (
              <SettingsInsetBlock key={item.id}>
                <div className="flex items-start gap-2">
                  <Badge variant="outline">{t({ ko: '승인', en: 'Approval' })}</Badge>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">{t(item.title)}</div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">{t(item.description)}</div>
                  </div>
                </div>
              </SettingsInsetBlock>
            ))}
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}
