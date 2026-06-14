import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { useI18n } from '@/i18n'
import { NodeArtifactPreviewBody } from '../module-graph-node-artifact-preview'
import type { ModuleGraphNode } from '../../module-graph-shared'
import { stopNodeActionEvent } from '../module-graph-port-cells'

export function NodeArtifactOutputs({
  data,
  moduleName,
  isFinalResult,
  visibleOutputPortKeys,
}: {
  data: ModuleGraphNode['data']
  moduleName: string
  isFinalResult: boolean
  visibleOutputPortKeys: Set<string>
}) {
  const { t } = useI18n()
  const [expandedOutputGroupKeys, setExpandedOutputGroupKeys] = useState<string[]>([])
  const [artifactTextModal, setArtifactTextModal] = useState<{ title: string; text: string } | null>(null)
  const hasArtifactPreview = Boolean(data.latestArtifactPreviewUrl || data.latestArtifactTextPreview)
  const outputGroups = (data.executionOutputGroups ?? []).filter((group) => visibleOutputPortKeys.has(group.portKey))
  const expandedOutputGroupKeySet = useMemo(() => new Set(expandedOutputGroupKeys), [expandedOutputGroupKeys])
  const hasOutputGroups = outputGroups.length > 0
  const hasStandaloneArtifactPreview = hasArtifactPreview && !hasOutputGroups

  return (
    <>
      {hasStandaloneArtifactPreview ? (
        <div className="mt-2 border-t border-border/20 pt-1.5">
          <div className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>{isFinalResult ? 'result' : 'output'}</span>
          </div>
          <NodeArtifactPreviewBody
            previewUrl={data.latestArtifactPreviewUrl}
            previewAlt={data.latestArtifactLabel || `${moduleName} output`}
            textPreview={data.latestArtifactTextPreview}
            textValue={data.latestArtifactTextValue}
            compact={isFinalResult}
            onOpenText={() =>
              setArtifactTextModal({
                title: data.latestArtifactLabel || `${moduleName} output`,
                text: data.latestArtifactTextValue ?? data.latestArtifactTextPreview ?? '',
              })
            }
          />
        </div>
      ) : null}

      {hasOutputGroups ? (
        <div className="mt-2 border-t border-border/20 pt-1.5">
          {outputGroups.map((group) => {
            const isExpanded = expandedOutputGroupKeySet.has(group.portKey)

            return (
              <div key={group.portKey} className="border-b border-border/20 py-0.5 last:border-b-0">
                <button
                  type="button"
                  className="nodrag nowheel flex min-h-[28px] w-full items-center justify-between gap-2 px-1 text-left"
                  onMouseDown={stopNodeActionEvent}
                  onClick={(event) => {
                    stopNodeActionEvent(event)
                    setExpandedOutputGroupKeys((current) => (
                      current.includes(group.portKey)
                        ? current.filter((key) => key !== group.portKey)
                        : [...current, group.portKey]
                    ))
                  }}
                  title={`${group.portLabel} output`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate text-[11px] font-medium text-foreground">{group.portLabel}</span>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{group.artifactCount}</span>
                </button>

                {isExpanded ? (
                  <div className="pb-1 pl-5 pr-1">
                    <NodeArtifactPreviewBody
                      previewUrl={group.latestArtifactPreviewUrl}
                      previewAlt={group.latestArtifactLabel || `${moduleName} ${group.portLabel}`}
                      textPreview={group.latestArtifactTextPreview}
                      textValue={group.latestArtifactTextValue}
                      compact={isFinalResult}
                      onOpenText={() =>
                        setArtifactTextModal({
                          title: `${moduleName} · ${group.portLabel}`,
                          text: group.latestArtifactTextValue ?? group.latestArtifactTextPreview ?? '',
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <SettingsModal
        open={Boolean(artifactTextModal)}
        title={artifactTextModal?.title ?? t({ ko: '출력 내용', en: 'Output content' })}
        widthClassName="max-w-3xl"
        onClose={() => setArtifactTextModal(null)}
      >
        <pre className="max-h-[70vh] overflow-auto rounded-sm border border-border/70 bg-surface-low p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
          {artifactTextModal?.text ?? ''}
        </pre>
      </SettingsModal>
    </>
  )
}
