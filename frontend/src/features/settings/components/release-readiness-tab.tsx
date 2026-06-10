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
  type ReleaseReadinessAlertReviewItemContract,
  type ReleaseReadinessEvidenceItemContract,
  type ReleaseReadinessHandoffItemContract,
  type ReleaseReadinessHistoryRecord,
  type ReleaseReadinessEvidenceReviewContract,
  type ReleaseReadinessOperationStepContract,
  type ReleaseReadinessRunbookGuardrailContract,
  type ReleaseReadinessTrendEvidenceContract,
  type ReleaseReadinessAutomationContextContract,
  type ReleaseReadinessAutomationRehearsalContract,
  type ReleaseReadinessUserDecisionContract,
} from '../release-readiness-history'

type ReadinessItem = ReleaseReadinessChecklistItemContract
type AlertReviewItem = ReleaseReadinessAlertReviewItemContract
type EvidenceItem = ReleaseReadinessEvidenceItemContract
type HandoffEvidenceItem = ReleaseReadinessHandoffItemContract
type RunbookGuardrail = ReleaseReadinessRunbookGuardrailContract
type OperationStep = ReleaseReadinessOperationStepContract
type TrendEvidenceItem = ReleaseReadinessTrendEvidenceContract
type UserDecisionItem = ReleaseReadinessUserDecisionContract
type AutomationContextItem = ReleaseReadinessAutomationContextContract
type AutomationRehearsalItem = ReleaseReadinessAutomationRehearsalContract
type OperatorEvidenceReviewItem = ReleaseReadinessEvidenceReviewContract

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

const ALERT_REVIEW_ITEMS: AlertReviewItem[] = [
  {
    id: 'media-review-queue',
    domain: 'media-review',
    title: { ko: '미디어 검토 큐', en: 'Media review queue' },
    signal: { ko: '미검토 항목 backlog', en: 'Unreviewed item backlog' },
    sourceSurface: 'Media review > operational trends',
    thresholdKey: 'review-queue-threshold',
    detail: {
      ko: '미검토 항목은 operator review 상태로만 저장하고 자동 정리나 삭제로 이어지지 않아.',
      en: 'Unreviewed items are saved as operator-review state only and do not trigger cleanup or deletion.',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'media-quality-backlog',
    domain: 'media-review',
    title: { ko: '품질 backlog', en: 'Quality backlog' },
    signal: { ko: 'missing/sparse tags, unrated, ungrouped 합산', en: 'Missing/sparse tags, unrated, and ungrouped totals' },
    sourceSurface: 'Media review > threshold guidance',
    thresholdKey: 'quality-backlog-threshold',
    detail: {
      ko: '태그와 그룹 품질 신호는 릴리즈 판단 근거로만 남기고 데이터 변경은 별도 작업으로 분리해.',
      en: 'Tag and group quality signals stay as release-review evidence; data changes remain separate work.',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'media-similarity-decision',
    domain: 'media-review',
    title: { ko: '유사도 결정 기록', en: 'Similarity decision history' },
    signal: { ko: 'needs-human-review 결정', en: 'Needs-human-review decisions' },
    sourceSurface: 'Media review > similarity history',
    thresholdKey: 'similarity-review-threshold',
    detail: {
      ko: '유사 이미지 판단은 reversible review record로 남기고 중복 처리나 삭제는 자동 실행하지 않아.',
      en: 'Similarity decisions stay as reversible review records and never run duplicate handling or deletion automatically.',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'media-cleanup-staging',
    domain: 'media-review',
    title: { ko: '정리 staging', en: 'Cleanup staging' },
    signal: { ko: 'recoverable/missing/similar staging', en: 'Recoverable, missing, and similar staging' },
    sourceSurface: 'Media review > cleanup staging',
    thresholdKey: 'cleanup-approval-threshold',
    detail: {
      ko: '정리 후보는 비파괴 staging으로만 저장하고 삭제, retention policy, schema 변경은 승인 필요로 남겨.',
      en: 'Cleanup candidates are saved as non-destructive staging; deletion, retention policy, and schema changes need approval.',
    },
    approvalBoundary: 'approval-required',
  },
  {
    id: 'runtime-queue-pressure',
    domain: 'workflow-runtime',
    title: { ko: '큐 압력', en: 'Queue pressure' },
    signal: { ko: 'active queue와 concurrency mismatch', en: 'Active queue and concurrency mismatch' },
    sourceSurface: 'Module graph > run panel',
    thresholdKey: 'queue-pressure-threshold',
    detail: {
      ko: '큐 압력은 다음 실행 전 확인 대상으로 저장하고 실행, 취소, 재시작은 여기서 수행하지 않아.',
      en: 'Queue pressure is saved for review before the next run; execution, cancellation, and restart do not run here.',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'runtime-retry-policy',
    domain: 'workflow-runtime',
    title: { ko: '재시도 정책', en: 'Retry policy' },
    signal: { ko: 'paused/stopped autorun', en: 'Paused or stopped autoruns' },
    sourceSurface: 'Module graph > runtime health',
    thresholdKey: 'retry-stop-threshold',
    detail: {
      ko: '중지된 자동 실행은 stop reason review로만 저장하고 rerun은 별도 판단 뒤 진행해.',
      en: 'Stopped autoruns are saved for stop-reason review only; reruns remain a separate decision.',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'runtime-recovery',
    domain: 'workflow-runtime',
    title: { ko: '복구 불일치', en: 'Recovery mismatch' },
    signal: { ko: 'startup recovery와 running-not-in-process', en: 'Startup recovery and running-not-in-process state' },
    sourceSurface: 'Module graph > recovery telemetry',
    thresholdKey: 'recovery-mismatch-threshold',
    detail: {
      ko: '복구 신호는 최근 실패와 산출물 상태를 다시 볼 근거로 저장하고 프로세스 조작은 실행하지 않아.',
      en: 'Recovery signals are saved as evidence to recheck failures and outputs; process actions do not run here.',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'runtime-retention',
    domain: 'workflow-runtime',
    title: { ko: '산출물 보존', en: 'Artifact retention' },
    signal: { ko: 'pending retention prune', en: 'Pending retention prune' },
    sourceSurface: 'Module graph > artifact retention',
    thresholdKey: 'retention-approval-threshold',
    detail: {
      ko: '보존 정리 신호는 승인 필요 상태로만 저장하고 삭제나 보존 정책 변경은 수행하지 않아.',
      en: 'Retention-prune signals are saved as approval-required state only; deletion and policy changes do not run.',
    },
    approvalBoundary: 'approval-required',
  },
  {
    id: 'runtime-terminal-failure',
    domain: 'workflow-runtime',
    title: { ko: '실패 이력', en: 'Terminal failure history' },
    signal: { ko: 'failed/cancelled terminal run ratio', en: 'Failed and cancelled terminal run ratio' },
    sourceSurface: 'Module graph > terminal history',
    thresholdKey: 'terminal-failure-threshold',
    detail: {
      ko: '실패율 신호는 error/input diff review 근거로 저장하고 즉시 재실행은 하지 않아.',
      en: 'Failure-rate signals are saved for error/input diff review and do not trigger immediate reruns.',
    },
    approvalBoundary: 'operator-review',
  },
]

const TREND_EVIDENCE_ITEMS: TrendEvidenceItem[] = [
  {
    id: 'dependency-audit-trend',
    domain: 'dependency-security',
    title: { ko: '의존성 보안 추세', en: 'Dependency security trend' },
    sourceSurface: 'npm audit + npm --prefix docs audit',
    metric: 'vulnerability-count-trend',
    trend: {
      ko: 'runtime과 docs toolchain audit가 0 vulnerabilities 기준선으로 돌아옴.',
      en: 'Runtime and docs toolchain audits returned to a 0-vulnerability baseline.',
    },
    exportValue: 'M1-CU1/M1-CU2: better-queue removal plus VitePress nested Vite override; npm audit lanes are clean',
    releaseUse: {
      ko: '보안 dependency lane은 릴리즈 검토 근거로 넘기고, 새 downgrade나 broad override는 별도 승인으로 남겨.',
      en: 'Use the security dependency lane as release evidence while new downgrades or broad overrides stay separately approved.',
    },
    approvalBoundary: 'local-evidence',
  },
  {
    id: 'release-handoff-trend',
    domain: 'release-operations',
    title: { ko: '릴리즈 핸드오프 추세', en: 'Release handoff trend' },
    sourceSurface: 'Settings > Release readiness + docs/systems/26.6.9-*',
    metric: 'captured-handoff-readiness',
    trend: {
      ko: 'alpha handoff, demo operation checklist, rollback boundary가 push/deploy/restart 없이 누적됨.',
      en: 'Alpha handoff, demo operation checklist, and rollback boundaries accumulate without push, deploy, or restart.',
    },
    exportValue: 'local Markdown handoff includes branch range, approval gates, operation steps, and no-touch 3999 boundaries',
    releaseUse: {
      ko: '사용자가 외부 작업 승인 여부를 판단할 때 같은 export를 검토하게 해.',
      en: 'Give the user the same export when deciding whether to approve external release actions.',
    },
    approvalBoundary: 'approval-required',
  },
  {
    id: 'media-review-trend',
    domain: 'media-review',
    title: { ko: '미디어 검토 추세', en: 'Media review trend' },
    sourceSurface: 'Media review > operational trends',
    metric: 'review-quality-cleanup-signals',
    trend: {
      ko: 'review queue, quality backlog, similarity decision, cleanup staging 신호가 readiness 기록으로 묶임.',
      en: 'Review queue, quality backlog, similarity decisions, and cleanup staging signals are bundled into readiness records.',
    },
    exportValue: 'operator-review thresholds: review-queue, quality-backlog, similarity-review; approval-required cleanup staging',
    releaseUse: {
      ko: '공개 전 품질 판단에는 쓰되, 삭제나 retention 변경은 승인 작업으로 분리해.',
      en: 'Use this for pre-release quality judgment while deletion or retention changes stay separate approvals.',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'workflow-runtime-trend',
    domain: 'workflow-runtime',
    title: { ko: '워크플로우 런타임 추세', en: 'Workflow runtime trend' },
    sourceSurface: 'Module graph > runtime health',
    metric: 'queue-retry-recovery-retention-signals',
    trend: {
      ko: 'queue pressure, retry stop, recovery mismatch, retention, terminal failure 신호가 재실행 전 근거로 저장됨.',
      en: 'Queue pressure, retry stop, recovery mismatch, retention, and terminal failure signals are saved before rerun decisions.',
    },
    exportValue: 'runtime thresholds: queue-pressure, retry-stop, recovery-mismatch, retention-approval, terminal-failure',
    releaseUse: {
      ko: 'rerun, smoke, restart 판단 전에 같은 runtime record를 다시 보게 해.',
      en: 'Review the same runtime record before rerun, smoke, or restart decisions.',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'final-verification-trend',
    domain: 'release-operations',
    title: { ko: '최종 검증 추세', en: 'Final verification trend' },
    sourceSurface: 'M3-CU2 final checks',
    metric: 'local-verification-baseline',
    trend: {
      ko: 'final readiness는 audit, release readiness, media/runtime contracts, build, Graphify 갱신으로 닫힘.',
      en: 'Final readiness closes on audit, release readiness, media/runtime contracts, build, and Graphify refresh.',
    },
    exportValue: 'npm audit; npm run verify:release-readiness; npm run verify:media-runtime-observability-contracts; npm run build; python -m graphify update .',
    releaseUse: {
      ko: 'completion handoff에서 로컬 검증 baseline과 남은 승인 결정을 나누는 기준으로 사용해.',
      en: 'Use this in the completion handoff to separate the local verification baseline from remaining approvals.',
    },
    approvalBoundary: 'local-evidence',
  },
]


const OPERATOR_EVIDENCE_REVIEW_ITEMS: OperatorEvidenceReviewItem[] = [
  {
    id: 'mcp-dry-run-evidence-packet',
    sourceSurface: { ko: 'MCP dry-run evidence', en: 'MCP dry-run evidence' },
    evidenceAnchor: 'npm run export:mcp-dry-run-evidence',
    compares: {
      ko: 'tool boundary, target endpoint, read-only versus approval-required operation classes',
      en: 'tool boundary, target endpoint, read-only versus approval-required operation classes',
    },
    operatorQuestion: {
      ko: 'agent가 live MCP tool을 호출하기 전에 dry-run evidence만으로 승인 범위를 판단할 수 있는가?',
      en: 'Can an operator judge the approval scope from dry-run evidence before any live MCP tool call?',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'workflow-recovery-handoff-packet',
    sourceSurface: { ko: 'Workflow recovery handoff', en: 'Workflow recovery handoff' },
    evidenceAnchor: 'buildWorkflowRuntimeRecoveryHandoffPacket(runtimeHealth)',
    compares: {
      ko: 'queue pressure, stopped autoruns, recovery mismatch, terminal failure, retention approval signals',
      en: 'queue pressure, stopped autoruns, recovery mismatch, terminal failure, retention approval signals',
    },
    operatorQuestion: {
      ko: 'rerun, rollback, restart, cleanup 중 어떤 결정이 로컬 검토이고 어떤 결정이 별도 승인인가?',
      en: 'Which rerun, rollback, restart, or cleanup decisions are local review versus separate approval?',
    },
    approvalBoundary: 'approval-required',
  },
  {
    id: 'media-approval-packet',
    sourceSurface: { ko: 'Media approval packet', en: 'Media approval packet' },
    evidenceAnchor: 'Media review > cleanup staging + similarity decision history',
    compares: {
      ko: 'review queue, tag quality backlog, similarity decisions, reversible cleanup staging',
      en: 'review queue, tag quality backlog, similarity decisions, reversible cleanup staging',
    },
    operatorQuestion: {
      ko: '미디어 정리 후보가 비파괴 검토에 머무르고 삭제/retention 변경은 승인 항목으로 분리됐는가?',
      en: 'Do media cleanup candidates remain non-destructive review while deletion and retention changes stay approval-owned?',
    },
    approvalBoundary: 'approval-required',
  },
]

const AUTOMATION_CONTEXT_ITEMS: AutomationContextItem[] = [
  {
    id: 'local-automation-context-map',
    surface: { ko: '로컬 자동화 컨텍스트 맵', en: 'Local automation context map' },
    contractAnchor: 'docs/systems/local-automation-context-operations-map.md',
    reviewUse: {
      ko: '릴리즈 준비, 워크플로우 런타임, 미디어 리뷰, MCP 자동화 표면을 같은 handoff 기준으로 검토해.',
      en: 'Review release readiness, workflow runtime, media review, and MCP automation surfaces against the same handoff baseline.',
    },
    boundary: 'local-evidence',
  },
  {
    id: 'mcp-automation-opt-in',
    surface: { ko: 'MCP/에이전트 진입점', en: 'MCP and agent entry points' },
    contractAnchor: 'docs/GUIDE/MCP_GUIDE.md + backend/src/mcp/*',
    reviewUse: {
      ko: 'agent-facing entry point는 opt-in 문서와 backend anchor가 맞을 때만 다음 작업 근거로 사용해.',
      en: 'Use agent-facing entry points as future-work evidence only when opt-in docs and backend anchors agree.',
    },
    boundary: 'opt-in-only',
  },
  {
    id: 'cross-surface-handoff-export',
    surface: { ko: '통합 핸드오프 export', en: 'Cross-surface handoff export' },
    contractAnchor: 'Settings > Release readiness Markdown export',
    reviewUse: {
      ko: 'automation, workflow, media 신호와 사용자 승인 항목을 한 Markdown export에서 다시 확인해.',
      en: 'Recheck automation, workflow, media signals, and user-owned approvals in one Markdown export.',
    },
    boundary: 'approval-required',
  },
]

const AUTOMATION_REHEARSAL_ITEMS: AutomationRehearsalItem[] = [
  {
    id: 'cleanup-staging-dry-run',
    rehearsalSurface: { ko: '정리 staging 리허설', en: 'Cleanup staging rehearsal' },
    dryRunAnchor: 'Media review > cleanup staging preview',
    localDiffArtifact: 'local candidate diff only; no deletion or retention-policy mutation',
    stopCondition: {
      ko: '삭제, retention 변경, schema 변경이 필요하면 즉시 승인 요청으로 중단해.',
      en: 'Stop for approval when deletion, retention changes, or schema changes are required.',
    },
    approvalBoundary: 'approval-required',
  },
  {
    id: 'workflow-recovery-replay-dry-run',
    rehearsalSurface: { ko: '워크플로우 복구 replay 리허설', en: 'Workflow recovery replay rehearsal' },
    dryRunAnchor: 'buildWorkflowRuntimeRecoveryHandoffPacket(runtimeHealth)',
    localDiffArtifact: 'queue/retry/recovery handoff packet; no rerun, cancel, or restart',
    stopCondition: {
      ko: 'rerun, cancel, restart, live smoke가 필요하면 리허설 결과만 남기고 멈춰.',
      en: 'Stop with rehearsal evidence when rerun, cancel, restart, or live smoke is needed.',
    },
    approvalBoundary: 'operator-review',
  },
  {
    id: 'release-candidate-command-dry-run',
    rehearsalSurface: { ko: '릴리즈 후보 명령 리허설', en: 'Release candidate command rehearsal' },
    dryRunAnchor: 'Settings > Release readiness operation checklist',
    localDiffArtifact: 'command plan and expected smoke assertions only; no push/deploy/restart',
    stopCondition: {
      ko: 'push, deploy, restart, public smoke는 사용자 승인 전 실행하지 않아.',
      en: 'Do not run push, deploy, restart, or public smoke before user approval.',
    },
    approvalBoundary: 'approval-required',
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

const OPERATION_STEPS: OperationStep[] = [
  {
    id: 'local-preflight',
    phase: { ko: '로컬 사전 확인', en: 'Local preflight' },
    approval: { ko: '로컬만 허용', en: 'Local only' },
    command: 'git status --short --branch && git log --oneline origin/alphatest..HEAD',
    target: 'local alphatest workspace',
    smokeAssertion: 'working tree is clean; ahead range matches the approved handoff packet',
    stopCondition: 'stop if dirty work, unexpected branch, or an unapproved commit range appears',
  },
  {
    id: 'alpha-push',
    phase: { ko: 'alpha push', en: 'Alpha push' },
    approval: { ko: '사용자 승인 필요', en: 'User approval required' },
    command: 'git push origin alphatest',
    target: 'origin/alphatest',
    smokeAssertion: 'remote alphatest HEAD matches the approved local commit after push',
    stopCondition: 'stop if the push target or commit range differs; do not force push',
  },
  {
    id: 'demo-host-update',
    phase: { ko: 'demo host 업데이트', en: 'Demo host update' },
    approval: { ko: '별도 승인 필요', en: 'Separate approval required' },
    command: 'git fetch origin && git checkout alphatest && git pull --ff-only origin alphatest',
    target: 'approved demo host only',
    smokeAssertion: 'demo host worktree reaches the approved commit without touching protected service 3999',
    stopCondition: 'stop if fast-forward pull is unavailable or the demo host branch differs',
  },
  {
    id: 'demo-service-restart',
    phase: { ko: 'demo service 재시작', en: 'Demo service restart' },
    approval: { ko: '재시작 승인 필요', en: 'Restart approval required' },
    command: 'restart configured demo service only',
    target: 'live target 2999 demo service',
    smokeAssertion: 'configured service restarts while protected service 3999 remains untouched',
    stopCondition: 'stop if another service, port 3999, schema/data cleanup, or auth/security work is required',
  },
  {
    id: 'live-smoke',
    phase: { ko: 'live smoke', en: 'Live smoke' },
    approval: { ko: 'smoke 승인 필요', en: 'Smoke approval required' },
    command: 'open live target 2999 and run frontend load, backend health, media browsing, workflow readiness, and MCP opt-in checks',
    target: 'live target 2999 only',
    smokeAssertion: 'frontend, API reachability, key media browsing, workflow readiness, and MCP opt-in boundary pass',
    stopCondition: 'stop at the first failed assertion and report the failure before further changes',
  },
  {
    id: 'rollback-handoff',
    phase: { ko: '롤백 핸드오프', en: 'Rollback handoff' },
    approval: { ko: '롤백 승인 필요', en: 'Rollback approval required' },
    command: 'prepare rollback to previous approved commit and restart configured demo service only',
    target: 'approved demo branch and configured demo service',
    smokeAssertion: 'rollback target, previous commit, service target, and no-touch 3999 evidence are recorded',
    stopCondition: 'stop if rollback would require force push, destructive cleanup, or protected service 3999 access',
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
  const [reviewedAlerts, setReviewedAlerts] = useState<Set<string>>(() => new Set(latestReadinessRecord?.reviewedAlertIds ?? []))
  const reviewedCount = reviewedItems.size
  const capturedHandoffCount = capturedHandoffItems.size
  const reviewedAlertCount = reviewedAlerts.size
  const allReviewed = reviewedCount === REVIEW_ITEMS.length
  const allHandoffCaptured = capturedHandoffCount === HANDOFF_EVIDENCE_ITEMS.length
  const allAlertsReviewed = reviewedAlertCount === ALERT_REVIEW_ITEMS.length
  const allEvidenceReadyForExport = allReviewed && allHandoffCaptured && allAlertsReviewed
  const readinessState = allReviewed ? t({ ko: '검토 완료', en: 'Reviewed' }) : t({ ko: '{count}/{total} 확인', en: '{count}/{total} checked' }, { count: reviewedCount, total: REVIEW_ITEMS.length })
  const handoffState = allHandoffCaptured ? t({ ko: '근거 캡처 완료', en: 'Evidence captured' }) : t({ ko: '{count}/{total} 캡처', en: '{count}/{total} captured' }, { count: capturedHandoffCount, total: HANDOFF_EVIDENCE_ITEMS.length })
  const alertReviewState = allAlertsReviewed ? t({ ko: '알림 검토 완료', en: 'Alerts reviewed' }) : t({ ko: '{count}/{total} 알림', en: '{count}/{total} alerts' }, { count: reviewedAlertCount, total: ALERT_REVIEW_ITEMS.length })
  const exportReadinessState = allEvidenceReadyForExport ? t({ ko: '내보내기 준비', en: 'Ready to export' }) : t({ ko: '증거 보강 필요', en: 'Evidence needed' })
  const trendEvidenceState = t({ ko: '{count}개 추세 근거', en: '{count} trend evidence items' }, { count: TREND_EVIDENCE_ITEMS.length })
  const evidenceConsoleState = t({ ko: '{count}개 근거 소스', en: '{count} evidence sources' }, { count: OPERATOR_EVIDENCE_REVIEW_ITEMS.length })
  const automationRehearsalState = t({ ko: '{count}개 리허설 계약', en: '{count} rehearsal contracts' }, { count: AUTOMATION_REHEARSAL_ITEMS.length })
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

  const toggleAlertReviewItem = (id: string, checked: boolean) => {
    setReviewedAlerts((current) => {
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
      reviewedAlertIds: reviewedAlerts,
      reviewItems: REVIEW_ITEMS,
      evidenceItems: EVIDENCE_ITEMS,
      alertReviewItems: ALERT_REVIEW_ITEMS,
      trendEvidenceItems: TREND_EVIDENCE_ITEMS,
      automationContextItems: AUTOMATION_CONTEXT_ITEMS,
      automationRehearsalItems: AUTOMATION_REHEARSAL_ITEMS,
      evidenceReviewItems: OPERATOR_EVIDENCE_REVIEW_ITEMS,
      handoffItems: HANDOFF_EVIDENCE_ITEMS,
      runbookGuardrails: RUNBOOK_GUARDRAILS,
      operationSteps: OPERATION_STEPS,
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
    setReviewedAlerts(new Set(record.reviewedAlertIds))
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
              <Badge variant={allAlertsReviewed ? 'default' : 'secondary'}>{alertReviewState}</Badge>
              <Badge data-release-readiness-export-state="true" variant={allEvidenceReadyForExport ? 'default' : 'outline'}>{exportReadinessState}</Badge>
              <Badge variant="outline">{trendEvidenceState}</Badge>
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
                        {' · '}
                        {t(
                          { ko: '알림 {alerts}/{alertTotal} · 추세 {trends}', en: 'alerts {alerts}/{alertTotal} · trends {trends}' },
                          {
                            alerts: record.summary.reviewedAlertCount,
                            alertTotal: record.summary.alertReviewItemCount,
                            trends: record.summary.trendEvidenceCount,
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
        data-release-readiness-alert-review="true"
        heading={t({ ko: '관측 알림 검토', en: 'Observability alert review' })}
        actions={(
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setReviewedAlerts(new Set(ALERT_REVIEW_ITEMS.map((item) => item.id)))}>
              <CheckCircle2 className="h-4 w-4" />
              {t({ ko: '알림 검토 표시', en: 'Mark alerts' })}
            </Button>
            <Button type="button" size="icon-sm" variant="secondary" onClick={() => setReviewedAlerts(new Set())} aria-label={t({ ko: '알림 검토 초기화', en: 'Reset alert review' })} title={t({ ko: '알림 검토 초기화', en: 'Reset alert review' })}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </>
        )}
      >
        <SettingsInsetBlock className="text-sm leading-6 text-muted-foreground">
          {t({
            ko: '미디어 검토와 워크플로우 런타임의 threshold 신호를 readiness 이력에 같이 저장해, cleanup/rerun/restart 판단 전에 같은 기록으로 다시 볼 수 있게 해.',
            en: 'Save media-review and workflow-runtime threshold signals with readiness history so cleanup, rerun, and restart decisions can revisit the same record.',
          })}
        </SettingsInsetBlock>

        <div className="grid gap-3 min-[1000px]:grid-cols-3">
          {ALERT_REVIEW_ITEMS.map((item) => {
            const checked = reviewedAlerts.has(item.id)

            return (
              <SettingsToggleRow
                key={item.id}
                data-release-readiness-alert={item.id}
                className={cn('items-start', checked && 'border-primary/40 bg-primary/10')}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleAlertReviewItem(item.id, event.target.checked)}
                  aria-label={t(item.title)}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{t(item.title)}</span>
                    <Badge variant={item.approvalBoundary === 'approval-required' ? 'outline' : 'secondary'}>
                      {item.approvalBoundary === 'approval-required' ? t({ ko: '승인 필요', en: 'Approval needed' }) : t({ ko: '운영 검토', en: 'Operator review' })}
                    </Badge>
                  </span>
                  <span className="mt-1 block font-mono text-xs text-foreground/90">{item.thresholdKey}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(item.signal)}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(item.detail)}</span>
                </span>
              </SettingsToggleRow>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        data-release-readiness-trend-evidence="true"
        heading={t({ ko: '관측 추세 근거', en: 'Trend evidence' })}
        actions={<Badge variant="secondary">{trendEvidenceState}</Badge>}
      >
        <SettingsInsetBlock className="text-sm leading-6 text-muted-foreground">
          {t({
            ko: '의존성 보안, 릴리즈 핸드오프, 미디어 검토, 워크플로우 런타임 신호를 하나의 exportable trend evidence로 저장해 completion handoff에서 같은 기준으로 볼 수 있게 해.',
            en: 'Save dependency security, release handoff, media review, and workflow runtime signals as exportable trend evidence for the completion handoff.',
          })}
        </SettingsInsetBlock>

        <div className="grid gap-3 min-[1000px]:grid-cols-2">
          {TREND_EVIDENCE_ITEMS.map((item) => (
            <SettingsInsetBlock key={item.id} data-release-readiness-trend={item.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(item.title)}</Badge>
                <Badge variant={item.approvalBoundary === 'approval-required' ? 'outline' : 'secondary'}>
                  {item.approvalBoundary === 'approval-required'
                    ? t({ ko: '승인 필요', en: 'Approval needed' })
                    : item.approvalBoundary === 'operator-review'
                      ? t({ ko: '운영 검토', en: 'Operator review' })
                      : t({ ko: '로컬 근거', en: 'Local evidence' })}
                </Badge>
              </div>
              <div className="font-mono text-xs text-foreground/90">{item.metric}</div>
              <div className="text-sm leading-6 text-muted-foreground">{t(item.trend)}</div>
              <div className="rounded-sm border border-border/60 bg-surface-container/35 px-3 py-2 font-mono text-xs leading-5 text-foreground">
                {item.exportValue}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">{t(item.releaseUse)}</div>
            </SettingsInsetBlock>
          ))}
        </div>
      </SettingsSection>



      <SettingsSection
        data-release-readiness-automation-rehearsal="true"
        heading={t({ ko: '자동화 리허설 계약', en: 'Automation rehearsal contracts' })}
        actions={<Badge variant="secondary">{automationRehearsalState}</Badge>}
      >
        <SettingsInsetBlock className="text-sm leading-6 text-muted-foreground">
          {t({
            ko: 'cleanup, recovery, release 후보 작업을 dry-run 근거와 로컬 diff로만 리허설해. 이 표면은 삭제, rerun, push, deploy, restart, 외부 서비스를 실행하지 않아.',
            en: 'Rehearse cleanup, recovery, and release-candidate work with dry-run evidence and local diffs only. This surface does not delete, rerun, push, deploy, restart, or call external services.',
          })}
        </SettingsInsetBlock>

        <div className="grid gap-3 min-[1000px]:grid-cols-3">
          {AUTOMATION_REHEARSAL_ITEMS.map((item) => (
            <SettingsInsetBlock key={item.id} data-release-readiness-automation-rehearsal-item={item.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(item.rehearsalSurface)}</Badge>
                <Badge variant={item.approvalBoundary === 'approval-required' ? 'outline' : 'secondary'}>
                  {item.approvalBoundary === 'approval-required'
                    ? t({ ko: '승인 필요', en: 'Approval needed' })
                    : item.approvalBoundary === 'operator-review'
                      ? t({ ko: '운영 검토', en: 'Operator review' })
                      : t({ ko: '로컬 근거', en: 'Local evidence' })}
                </Badge>
              </div>
              <div className="font-mono text-xs text-foreground/90">{item.dryRunAnchor}</div>
              <div className="rounded-sm border border-border/60 bg-surface-container/35 px-3 py-2 font-mono text-xs leading-5 text-foreground">
                {item.localDiffArtifact}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">{t(item.stopCondition)}</div>
            </SettingsInsetBlock>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        data-release-readiness-operator-evidence-console="true"
        heading={t({ ko: '운영자 근거 검토 콘솔', en: 'Operator evidence review console' })}
        actions={<Badge variant="secondary">{evidenceConsoleState}</Badge>}
      >
        <SettingsInsetBlock className="text-sm leading-6 text-muted-foreground">
          {t({
            ko: 'MCP dry-run, workflow recovery handoff, media approval packet을 한 화면의 비교 계약으로 묶어. 이 콘솔은 증거를 비교할 뿐 MCP 호출, rerun, cleanup, restart, 외부 작업은 실행하지 않아.',
            en: 'Bundle MCP dry-run, workflow recovery handoff, and media approval packet evidence into one comparison contract. This console compares evidence only; it does not call MCP, rerun workflows, clean media, restart services, or perform external actions.',
          })}
        </SettingsInsetBlock>

        <div className="grid gap-3 min-[1000px]:grid-cols-3">
          {OPERATOR_EVIDENCE_REVIEW_ITEMS.map((item) => (
            <SettingsInsetBlock key={item.id} data-release-readiness-operator-evidence={item.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(item.sourceSurface)}</Badge>
                <Badge variant={item.approvalBoundary === 'approval-required' ? 'outline' : 'secondary'}>
                  {item.approvalBoundary === 'approval-required'
                    ? t({ ko: '승인 필요', en: 'Approval needed' })
                    : item.approvalBoundary === 'operator-review'
                      ? t({ ko: '운영 검토', en: 'Operator review' })
                      : t({ ko: '로컬 근거', en: 'Local evidence' })}
                </Badge>
              </div>
              <div className="font-mono text-xs text-foreground/90">{item.evidenceAnchor}</div>
              <div className="text-sm leading-6 text-muted-foreground">{t(item.compares)}</div>
              <div className="rounded-sm border border-border/60 bg-surface-container/35 px-3 py-2 text-xs leading-5 text-foreground">
                {t(item.operatorQuestion)}
              </div>
            </SettingsInsetBlock>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        data-release-readiness-automation-context="true"
        heading={t({ ko: '자동화 컨텍스트 핸드오프', en: 'Automation context handoff' })}
        actions={<Badge variant="secondary">{t({ ko: '로컬 근거', en: 'Local evidence' })}</Badge>}
      >
        <SettingsInsetBlock className="text-sm leading-6 text-muted-foreground">
          {t({
            ko: 'agent/operator가 다음 작업 전에 릴리즈 준비, 워크플로우, 미디어 리뷰, MCP 진입점을 같은 export contract로 확인하게 해. 여기서 MCP 호출, push, deploy, restart는 실행하지 않아.',
            en: 'Let agents and operators review release readiness, workflow, media review, and MCP entry points through the same export contract before future work. This does not call MCP, push, deploy, or restart.',
          })}
        </SettingsInsetBlock>

        <div className="grid gap-3 min-[1000px]:grid-cols-3">
          {AUTOMATION_CONTEXT_ITEMS.map((item) => (
            <SettingsInsetBlock key={item.id} data-release-readiness-automation-context-item={item.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(item.surface)}</Badge>
                <Badge variant={item.boundary === 'approval-required' ? 'outline' : 'secondary'}>
                  {item.boundary === 'approval-required'
                    ? t({ ko: '승인 필요', en: 'Approval needed' })
                    : item.boundary === 'opt-in-only'
                      ? t({ ko: 'opt-in 전용', en: 'Opt-in only' })
                      : t({ ko: '로컬 근거', en: 'Local evidence' })}
                </Badge>
              </div>
              <div className="font-mono text-xs text-foreground/90">{item.contractAnchor}</div>
              <div className="text-sm leading-6 text-muted-foreground">{t(item.reviewUse)}</div>
            </SettingsInsetBlock>
          ))}
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
        actions={(
          <>
            <Badge variant={capturedHandoffCount === HANDOFF_EVIDENCE_ITEMS.length ? 'default' : 'secondary'}>{handoffState}</Badge>
            <Button type="button" size="sm" variant="outline" onClick={() => setCapturedHandoffItems(new Set(HANDOFF_EVIDENCE_ITEMS.map((item) => item.id)))}>
              <CheckCircle2 className="h-4 w-4" />
              {t({ ko: '근거 캡처 표시', en: 'Mark evidence' })}
            </Button>
            <Button type="button" size="icon-sm" variant="secondary" onClick={() => setCapturedHandoffItems(new Set())} aria-label={t({ ko: '근거 캡처 초기화', en: 'Reset evidence capture' })} title={t({ ko: '근거 캡처 초기화', en: 'Reset evidence capture' })}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </>
        )}
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

      <SettingsSection
        data-release-readiness-operation-checklist="true"
        heading={t({ ko: '승인 후 작업 체크리스트', en: 'Post-approval operation checklist' })}
        actions={<Badge variant="outline">{t({ ko: '실행 없음', en: 'No execution' })}</Badge>}
      >
        <SettingsInsetBlock className="text-sm leading-6 text-muted-foreground">
          {t({
            ko: '이 목록은 승인 뒤 사람이 실행 여부를 판단할 순서와 중단 조건만 기록해. 이 화면은 push, pull, restart, smoke, rollback을 실행하지 않아.',
            en: 'This list records the post-approval order and stop conditions only. This screen does not run push, pull, restart, smoke, or rollback.',
          })}
        </SettingsInsetBlock>
        <div className="grid gap-3 min-[1100px]:grid-cols-2">
          {OPERATION_STEPS.map((step) => (
            <SettingsInsetBlock key={step.id} data-release-readiness-operation-step={step.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(step.phase)}</Badge>
                <Badge variant="outline">{t(step.approval)}</Badge>
              </div>
              <div className="rounded-sm border border-border/60 bg-surface-container/35 px-3 py-2 font-mono text-xs leading-5 text-foreground">
                {step.command}
              </div>
              <div className="grid gap-2 text-xs leading-5 text-muted-foreground">
                <div><span className="font-semibold text-foreground">{t({ ko: '대상', en: 'Target' })}: </span>{step.target}</div>
                <div><span className="font-semibold text-foreground">{t({ ko: '확인', en: 'Assertion' })}: </span>{step.smokeAssertion}</div>
                <div><span className="font-semibold text-foreground">{t({ ko: '중단', en: 'Stop' })}: </span>{step.stopCondition}</div>
              </div>
            </SettingsInsetBlock>
          ))}
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
