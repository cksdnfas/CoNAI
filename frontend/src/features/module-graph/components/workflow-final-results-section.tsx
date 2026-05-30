import { Badge } from '@/components/ui/badge'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useI18n } from '@/i18n'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord, GraphWorkflowRecord } from '@/lib/api-module-graph'
import type { ImageRecord } from '@/types/image'
import { useMemo } from 'react'
import {
  getArtifactPreviewUrl,
  isGraphArtifactVisualMedia,
  parseArtifactMetadataRecord,
  resolveGraphArtifactMimeType,
} from '../module-graph-shared'
import { ExecutionArtifactCard } from './execution-artifact-card'
import { getNodeDisplayLabel } from './graph-execution-panel-helpers'

function getFinalResultOverlayLabel(nodeLabel: string) {
  const normalizedLabel = nodeLabel.trim().toLowerCase()
  if (!normalizedLabel || normalizedLabel === 'final' || normalizedLabel === 'final result' || normalizedLabel === '최종' || normalizedLabel === '최종 결과') {
    return undefined
  }

  return nodeLabel
}

function getFinalResultSourcePortLabel(portKey: string | null | undefined, artifactType: string | null | undefined) {
  const normalizedPortKey = portKey?.trim()
  if (!normalizedPortKey) {
    return undefined
  }

  const normalizedArtifactType = artifactType?.trim().toLowerCase()
  if (normalizedArtifactType && normalizedPortKey.toLowerCase() === normalizedArtifactType) {
    return undefined
  }

  return normalizedPortKey
}

function getFinalResultSourceNodeLabel(nodeLabel: string, sourceNodeId: string) {
  const normalizedLabel = nodeLabel.trim()
  if (!normalizedLabel || normalizedLabel === sourceNodeId || normalizedLabel === `노드 ${sourceNodeId}`) {
    return undefined
  }

  return normalizedLabel
}

function buildFallbackArtifact(finalResult: GraphExecutionFinalResultRecord): GraphExecutionArtifactRecord {
  return {
    id: finalResult.source_artifact_id,
    execution_id: finalResult.source_execution_id ?? finalResult.execution_id,
    node_id: finalResult.source_node_id,
    port_key: finalResult.source_port_key,
    artifact_type: finalResult.artifact_type,
    storage_path: finalResult.source_storage_path,
    metadata: finalResult.source_metadata,
    created_date: finalResult.created_date,
  }
}

type ResolvedFinalResultEntry = {
  finalResult: GraphExecutionFinalResultRecord
  artifact: GraphExecutionArtifactRecord
  nodeLabel: string
  overlayLabel?: string
  sourceNodeLabel?: string
  sourcePortLabel?: string
}

type FinalResultPreviewArtifact = GraphExecutionArtifactRecord & {
  source_metadata?: string | null
  source_storage_path?: string | null
}

function readMetadataNumber(metadata: Record<string, unknown> | null, keys: string | string[]) {
  const candidateKeys = Array.isArray(keys) ? keys : [keys]
  for (const key of candidateKeys) {
    const value = metadata?.[key]
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }
  }

  return null
}

function readMetadataString(metadata: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value !== 'string') {
      continue
    }

    const trimmedValue = value.trim()
    if (trimmedValue) {
      return trimmedValue
    }
  }

  return null
}

function resolveFinalResultOriginalFilePath(metadata: Record<string, unknown> | null, previewArtifact: FinalResultPreviewArtifact) {
  return readMetadataString(metadata, [
    'originalFileName',
    'original_file_name',
    'outputFileName',
    'output_file_name',
    'fileName',
    'file_name',
    'originalFilePath',
    'original_file_path',
    'outputPath',
    'output_path',
    'filePath',
    'file_path',
  ])
    ?? previewArtifact.source_storage_path
    ?? previewArtifact.storage_path
    ?? null
}

function buildFinalResultPreviewArtifact(entry: ResolvedFinalResultEntry): FinalResultPreviewArtifact {
  return {
    ...entry.artifact,
    source_metadata: entry.finalResult.source_metadata,
    source_storage_path: entry.artifact.storage_path ? undefined : entry.finalResult.source_storage_path,
  }
}

function resolveFinalResultMetadataRecord(entry: ResolvedFinalResultEntry) {
  const sourceMetadata = parseArtifactMetadataRecord(entry.finalResult.source_metadata)
  const artifactMetadata = parseArtifactMetadataRecord(entry.artifact.metadata)

  if (sourceMetadata && artifactMetadata) {
    return { ...sourceMetadata, ...artifactMetadata }
  }

  return artifactMetadata ?? sourceMetadata
}

function buildFinalResultImageRecord(entry: ResolvedFinalResultEntry): ImageRecord | null {
  const previewArtifact = buildFinalResultPreviewArtifact(entry)
  const previewUrl = getArtifactPreviewUrl(previewArtifact)
  if (!previewUrl || !isGraphArtifactVisualMedia(previewArtifact)) {
    return null
  }

  const mimeType = resolveGraphArtifactMimeType(previewArtifact)
  const fileType = mimeType?.startsWith('video/')
    ? 'video'
    : mimeType === 'image/gif'
      ? 'animated'
      : 'image'
  const metadata = resolveFinalResultMetadataRecord(entry)

  return {
    id: `final-result-${entry.finalResult.id}`,
    composite_hash: readMetadataString(metadata, ['actualCompositeHash', 'actual_composite_hash', 'compositeHash', 'composite_hash']),
    original_file_path: resolveFinalResultOriginalFilePath(metadata, previewArtifact),
    thumbnail_url: previewUrl,
    image_url: previewUrl,
    width: readMetadataNumber(metadata, ['actualWidth', 'actual_width', 'outputWidth', 'output_width', 'width']),
    height: readMetadataNumber(metadata, ['actualHeight', 'actual_height', 'outputHeight', 'output_height', 'height']),
    mime_type: mimeType,
    file_type: fileType,
  }
}

/** Render one shared explicit-final-results surface for workflow runner and execution panels. */
export function WorkflowFinalResultsSection({
  finalResults,
  artifacts,
  selectedGraph,
  nodeLabelOverrides,
  emptyLabel,
}: {
  finalResults: GraphExecutionFinalResultRecord[]
  artifacts: GraphExecutionArtifactRecord[]
  selectedGraph?: GraphWorkflowRecord | null
  nodeLabelOverrides?: Record<string, string> | null
  emptyLabel?: string
}) {
  const { t } = useI18n()
  const resolvedEmptyLabel = emptyLabel ?? t({ ko: '최종 결과 노드를 추가하고 원하는 출력에 연결해줘.', en: 'Add a final result node and connect it to the output you want to finalize.' })
  const artifactsById = useMemo(() => new Map(artifacts.map((artifact) => [artifact.id, artifact])), [artifacts])
  const resolvedEntries = useMemo<ResolvedFinalResultEntry[]>(() => finalResults.map((finalResult) => {
    const finalNodeLabel = getNodeDisplayLabel(selectedGraph, finalResult.final_node_id, nodeLabelOverrides)
    const sourceNodeLabel = getNodeDisplayLabel(selectedGraph, finalResult.source_node_id, nodeLabelOverrides)

    return {
      finalResult,
      artifact: artifactsById.get(finalResult.source_artifact_id) ?? buildFallbackArtifact(finalResult),
      nodeLabel: finalNodeLabel,
      overlayLabel: getFinalResultOverlayLabel(finalNodeLabel),
      sourceNodeLabel: getFinalResultSourceNodeLabel(sourceNodeLabel, finalResult.source_node_id),
      sourcePortLabel: getFinalResultSourcePortLabel(finalResult.source_port_key, finalResult.artifact_type),
    }
  }), [artifactsById, finalResults, nodeLabelOverrides, selectedGraph])
  const { visualEntries, visualEntryByImageId, nonVisualEntries } = useMemo(() => {
    const nextVisualEntries: Array<{ entry: ResolvedFinalResultEntry; image: ImageRecord }> = []
    for (const entry of resolvedEntries) {
      const image = buildFinalResultImageRecord(entry)
      if (image) {
        nextVisualEntries.push({ entry, image })
      }
    }

    const nextVisualArtifactIds = new Set(nextVisualEntries.map((item) => item.entry.artifact.id))

    return {
      visualEntries: nextVisualEntries,
      visualEntryByImageId: new Map(nextVisualEntries.map((item) => [String(item.image.id), item.entry])),
      nonVisualEntries: resolvedEntries.filter((entry) => !nextVisualArtifactIds.has(entry.artifact.id)),
    }
  }, [resolvedEntries])

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span>{t({ ko: '결과물', en: 'Results' })}</span>
        <Badge variant="outline">{resolvedEntries.length}</Badge>
        {resolvedEntries.length > 0 ? (
          <>
            <Badge variant={visualEntries.length > 0 ? 'secondary' : 'outline'}>{t({ ko: '미디어 {count}', en: 'Media {count}' }, { count: visualEntries.length })}</Badge>
            {nonVisualEntries.length > 0 ? <Badge variant="outline">{t({ ko: '파일 {count}', en: 'Files {count}' }, { count: nonVisualEntries.length })}</Badge> : null}
          </>
        ) : null}
      </div>

      {resolvedEntries.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          <div>{resolvedEmptyLabel}</div>
          {selectedGraph ? <div className="mt-1 text-xs text-muted-foreground/90">{t({ ko: '시스템 모듈의 최종 결과를 추가한 뒤, 최종으로 확정할 출력 포트에 연결해줘.', en: 'Add a final result from a system module, then connect it to the output port you want to finalize.' })}</div> : null}
        </div>
      ) : (
        <div className="space-y-3">
          {visualEntries.length > 0 ? (
            <ImageList
              items={visualEntries.map((item) => item.image)}
              layout="grid"
              activationMode="none"
              getItemId={(image) => String(image.id)}
              minColumnWidth={160}
              gridItemHeight={240}
              columnGap={12}
              rowGap={12}
              className="workflow-final-results-list"
              showDefaultQuickActions={false}
              renderItemPersistentOverlay={(image) => {
                const entry = visualEntryByImageId.get(String(image.id))
                if (!entry?.overlayLabel && !entry?.sourceNodeLabel && !entry?.sourcePortLabel && !entry?.artifact.artifact_type) {
                  return null
                }
                const overlayText = [entry.overlayLabel, entry.sourceNodeLabel, entry.sourcePortLabel, entry.artifact.artifact_type].filter(Boolean).join(' · ')

                return (
                  <div className="pointer-events-none flex min-w-0 flex-wrap items-center gap-1.5 rounded-sm bg-black/62 px-2 py-1 text-[11px] text-white shadow-sm backdrop-blur-sm" title={overlayText} aria-label={overlayText}>
                    {entry.overlayLabel ? <span className="truncate font-medium">{entry.overlayLabel}</span> : null}
                    {entry.sourceNodeLabel ? <span className="truncate text-white/92">{entry.sourceNodeLabel}</span> : null}
                    {entry.sourcePortLabel ? <span className="truncate text-white/82">{entry.sourcePortLabel}</span> : null}
                    {entry.artifact.artifact_type ? <Badge variant="secondary" className="h-5 border-white/15 bg-white/14 px-1.5 text-[10px] text-white">{entry.artifact.artifact_type}</Badge> : null}
                  </div>
                )
              }}
            />
          ) : null}

          {nonVisualEntries.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {nonVisualEntries.map(({ finalResult, artifact, overlayLabel, sourceNodeLabel, sourcePortLabel }) => {
                const overlayText = [overlayLabel, sourceNodeLabel, sourcePortLabel].filter(Boolean).join(' · ') || undefined

                return (
                  <ExecutionArtifactCard
                    key={finalResult.id}
                    artifact={artifact}
                    compact
                    hideTitle
                    title={overlayText}
                    overlayLabel={overlayText}
                  />
                )
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
