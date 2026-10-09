import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
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
        <div className="mt-2 border-t border-outline-subtle pt-1.5">
          <Text as="div" variant="overline" className="px-1">{isFinalResult ? 'result' : 'output'}</Text>
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
        <div className="mt-2 border-t border-outline-subtle pt-1.5">
          {outputGroups.map((group) => {
            const isExpanded = expandedOutputGroupKeySet.has(group.portKey)

            return (
              <div key={group.portKey} className="border-b border-outline-subtle py-0.5 last:border-b-0">
                <Tip content={isExpanded ? t({ ko: '{label} 출력 접기', en: 'Collapse {label} output' }, { label: group.portLabel }) : t({ ko: '{label} 출력 펼치기', en: 'Expand {label} output' }, { label: group.portLabel })}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-expanded={isExpanded}
                    className="nodrag nowheel min-h-[28px] w-full justify-between px-1 text-left"
                    onMouseDown={stopNodeActionEvent}
                    onClick={(event) => {
                      stopNodeActionEvent(event)
                      setExpandedOutputGroupKeys((current) => (
                        current.includes(group.portKey)
                          ? current.filter((key) => key !== group.portKey)
                          : [...current, group.portKey]
                      ))
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {isExpanded ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                      <span className="truncate text-2xs font-medium text-foreground">{group.portLabel}</span>
                    </span>
                    <span className="shrink-0 text-2xs text-muted-foreground">{group.artifactCount}</span>
                  </Button>
                </Tip>

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

      <Modal
        open={Boolean(artifactTextModal)}
        title={artifactTextModal?.title ?? t({ ko: '출력 내용', en: 'Output content' })}
        widthClassName="max-w-3xl"
        onClose={() => setArtifactTextModal(null)}
      >
        <pre className="max-h-[70vh] overflow-auto rounded-sm bg-surface-low p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
          {artifactTextModal?.text ?? ''}
        </pre>
      </Modal>
    </>
  )
}
