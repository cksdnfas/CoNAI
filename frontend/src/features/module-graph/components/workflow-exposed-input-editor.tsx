import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, CircleHelp, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleRow } from '@/components/ui/toggle-row'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { cn } from '@/lib/utils'
import type { GraphWorkflowExposedInput } from '@/lib/api'
import { NaiCharacterPromptsInput, isNaiCharacterPromptPort } from './nai-character-prompts-input'
import { NaiReusableAssetInput, isNaiCharacterReferencePort, isNaiVibePort } from './nai-reusable-assets-input'

type WorkflowExposedInputEditorProps = {
  candidates: GraphWorkflowExposedInput[]
  selectedInputs: GraphWorkflowExposedInput[]
  onToggleInput: (inputDefinition: GraphWorkflowExposedInput) => void
  onUpdateInput: (inputId: string, patch: Partial<GraphWorkflowExposedInput>) => void
  onMoveInput: (inputId: string, direction: 'up' | 'down') => void
  onChangeDefaultImage: (inputId: string, image?: SelectedImageDraft) => Promise<void> | void
  showHeader?: boolean
}

function hasExplicitValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

/** Render a compact tooltip icon for internal node and port references. */
function TechnicalReferenceHint({ title, label }: { title: string; label: string }) {
  return (
    <span className="inline-flex cursor-help text-muted-foreground" title={title} aria-label={label}>
      <CircleHelp className="h-3.5 w-3.5" />
    </span>
  )
}

/** Render workflow-level exposed input selection and presentation editing for the runner form. */
export function WorkflowExposedInputEditor({
  candidates,
  selectedInputs,
  onToggleInput,
  onUpdateInput,
  onMoveInput,
  onChangeDefaultImage,
  showHeader = true,
}: WorkflowExposedInputEditorProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showAvailableInputs, setShowAvailableInputs] = useState(false)
  const [expandedInputId, setExpandedInputId] = useState<string | null>(null)
  const [availableSearchQuery, setAvailableSearchQuery] = useState('')

  const selectedIds = new Set(selectedInputs.map((inputDefinition) => inputDefinition.id))
  const availableCandidates = candidates.filter((candidate) => !selectedIds.has(candidate.id))
  const filteredAvailableCandidates = useMemo(() => {
    const query = availableSearchQuery.trim().toLowerCase()
    if (query.length === 0) {
      return availableCandidates
    }

    return availableCandidates.filter((candidate) => {
      const haystack = [candidate.label, candidate.description ?? '', candidate.module_name ?? '', candidate.node_id, candidate.port_key, candidate.data_type].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [availableCandidates, availableSearchQuery])

  const renderDefaultValueEditor = (inputDefinition: GraphWorkflowExposedInput) => {
    const rawValue = inputDefinition.default_value

    if (isNaiCharacterPromptPort(inputDefinition.port_key, inputDefinition.data_type)) {
      return (
        <NaiCharacterPromptsInput
          value={rawValue}
          onChange={(value) => onUpdateInput(inputDefinition.id, { default_value: value })}
        />
      )
    }

    if (isNaiVibePort(inputDefinition.port_key, inputDefinition.data_type)) {
      return (
        <NaiReusableAssetInput
          kind="vibes"
          value={rawValue}
          onChange={(value) => onUpdateInput(inputDefinition.id, { default_value: value })}
        />
      )
    }

    if (isNaiCharacterReferencePort(inputDefinition.port_key, inputDefinition.data_type)) {
      return (
        <NaiReusableAssetInput
          kind="character_refs"
          value={rawValue}
          onChange={(value) => onUpdateInput(inputDefinition.id, { default_value: value })}
        />
      )
    }

    if (inputDefinition.ui_data_type === 'select' && Array.isArray(inputDefinition.options) && inputDefinition.options.length > 0) {
      return (
        <Select
          value={typeof rawValue === 'string' ? rawValue : rawValue == null ? '' : String(rawValue)}
          onChange={(event) => onUpdateInput(inputDefinition.id, { default_value: event.target.value || undefined })}
        >
          <option value="">기본값 없음</option>
          {inputDefinition.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </Select>
      )
    }

    if (inputDefinition.data_type === 'prompt' || inputDefinition.data_type === 'json') {
      return (
        <Textarea
          rows={inputDefinition.data_type === 'json' ? 5 : 3}
          value={typeof rawValue === 'string' ? rawValue : rawValue ? JSON.stringify(rawValue, null, 2) : ''}
          onChange={(event) => onUpdateInput(inputDefinition.id, { default_value: event.target.value })}
          placeholder="기본값 (선택)"
        />
      )
    }

    if (inputDefinition.data_type === 'number') {
      return (
        <Input
          type="number"
          value={typeof rawValue === 'number' ? String(rawValue) : typeof rawValue === 'string' ? rawValue : ''}
          onChange={(event) => onUpdateInput(inputDefinition.id, { default_value: event.target.value === '' ? undefined : Number(event.target.value) })}
          placeholder="기본값 (선택)"
        />
      )
    }

    if (inputDefinition.data_type === 'boolean') {
      return (
        <Select
          value={typeof rawValue === 'boolean' ? String(rawValue) : ''}
          onChange={(event) => onUpdateInput(inputDefinition.id, { default_value: event.target.value === '' ? undefined : event.target.value === 'true' })}
        >
          <option value="">기본값 없음</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      )
    }

    if (inputDefinition.data_type === 'image' || inputDefinition.data_type === 'mask') {
      return (
        <div className="space-y-2">
          <ImageAttachmentPickerButton label={hasExplicitValue(rawValue) ? '기본 이미지 변경' : '기본 이미지 선택'} modalTitle={inputDefinition.label} allowSaveDialog={false} onSelect={(image) => void onChangeDefaultImage(inputDefinition.id, image)} />
          {typeof rawValue === 'string' && rawValue.startsWith('data:image/') ? (
            <img src={rawValue} alt={inputDefinition.label} className="max-h-36 rounded-sm border border-border object-contain" />
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onUpdateInput(inputDefinition.id, { default_value: undefined })}
            disabled={!hasExplicitValue(rawValue)}
          >
            기본 이미지 지우기
          </Button>
        </div>
      )
    }

    return (
      <Input
        value={typeof rawValue === 'string' ? rawValue : rawValue ? String(rawValue) : ''}
        onChange={(event) => onUpdateInput(inputDefinition.id, { default_value: event.target.value || undefined })}
        placeholder="기본값 (선택)"
      />
    )
  }

  const collapseButton = (
    <Button type="button" size="sm" variant="ghost" onClick={() => setIsCollapsed((current) => !current)}>
      <ChevronDown className={cn('h-4 w-4 transition-transform', isCollapsed ? '-rotate-90' : 'rotate-0')} />
    </Button>
  )

  return (
    <Card>
      {!isCollapsed ? (
        <CardContent className="space-y-5">
          {showHeader ? (
            <SectionHeading
              variant="inside"
              heading="Exposed Run Inputs"
              actions={
                <>
                  <Badge variant="outline">{selectedInputs.length} selected</Badge>
                  {collapseButton}
                </>
              }
            />
          ) : (
            <div className="flex items-center justify-between gap-3">
              <Badge variant="outline">{selectedInputs.length} selected</Badge>
              {collapseButton}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">Selected Inputs</div>
            </div>
            {selectedInputs.length === 0 ? (
              <Alert>
                <AlertTitle>노출된 실행 입력이 없어</AlertTitle>
                <AlertDescription>아래 입력에서 추가해.</AlertDescription>
              </Alert>
            ) : (
              selectedInputs.map((inputDefinition, index) => {
                const expanded = expandedInputId === inputDefinition.id
                return (
                  <div key={inputDefinition.id} className="rounded-sm border border-primary/25 bg-surface-low">
                    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpandedInputId(expanded ? null : inputDefinition.id)}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">#{index + 1}</Badge>
                          <span className="font-medium text-foreground">{inputDefinition.label}</span>
                          <Badge variant="outline">{inputDefinition.data_type}</Badge>
                          {inputDefinition.required ? <Badge variant="outline">required</Badge> : null}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <span>{inputDefinition.module_name || '연결된 모듈 입력'}</span>
                          <TechnicalReferenceHint
                            title={`module ${inputDefinition.module_name || '-'}\nnode ${inputDefinition.node_id}\nport ${inputDefinition.port_key}`}
                            label="선택 입력의 내부 연결 정보 보기"
                          />
                        </div>
                      </button>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => onMoveInput(inputDefinition.id, 'up')} disabled={index === 0}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => onMoveInput(inputDefinition.id, 'down')} disabled={index === selectedInputs.length - 1}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setExpandedInputId(expanded ? null : inputDefinition.id)}>
                          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded ? 'rotate-0' : '-rotate-90')} />
                          {expanded ? '접기' : '편집'}
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => onToggleInput(inputDefinition)}>
                          <Trash2 className="h-4 w-4" />
                          제외
                        </Button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="space-y-4 border-t border-border px-4 py-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Label</div>
                            <Input
                              value={inputDefinition.label}
                              onChange={(event) => onUpdateInput(inputDefinition.id, { label: event.target.value })}
                              placeholder="사용자에게 보일 이름"
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Placeholder</div>
                            <Input
                              value={inputDefinition.placeholder ?? ''}
                              onChange={(event) => onUpdateInput(inputDefinition.id, { placeholder: event.target.value || undefined })}
                              placeholder="입력 칸 힌트"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Description</div>
                          <Textarea
                            rows={2}
                            value={inputDefinition.description ?? ''}
                            onChange={(event) => onUpdateInput(inputDefinition.id, { description: event.target.value || undefined })}
                            placeholder="사용자에게 보여줄 설명"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-6">
                          <ToggleRow variant="detail" className="cursor-pointer px-3 py-2">
                            <input
                              type="checkbox"
                              checked={!!inputDefinition.required}
                              onChange={(event) => onUpdateInput(inputDefinition.id, { required: event.target.checked })}
                            />
                            <span>필수 입력</span>
                          </ToggleRow>
                        </div>

                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Default Value</div>
                          {renderDefaultValueEditor(inputDefinition)}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">Available Inputs</div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowAvailableInputs((current) => !current)}>
                <ChevronDown className={cn('h-4 w-4 transition-transform', showAvailableInputs ? 'rotate-0' : '-rotate-90')} />
                {showAvailableInputs ? '접기' : '펼치기'}
              </Button>
            </div>

            {showAvailableInputs ? (
              <div className="space-y-3">
                <Input value={availableSearchQuery} onChange={(event) => setAvailableSearchQuery(event.target.value)} placeholder="추가할 입력 검색" />
                {candidates.length === 0 ? (
                  <Alert>
                    <AlertTitle>노출 가능한 입력이 없어</AlertTitle>
                    <AlertDescription>먼저 모듈을 배치해.</AlertDescription>
                  </Alert>
                ) : filteredAvailableCandidates.length === 0 ? (
                  <Alert>
                    <AlertTitle>추가 가능한 입력이 없어</AlertTitle>
                    <AlertDescription>이미 모두 선택했거나 검색 결과가 없어.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                    {filteredAvailableCandidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => onToggleInput(candidate)}
                        className={cn('block w-full rounded-sm border border-border bg-surface-low px-3 py-3 text-left transition-colors hover:bg-surface-high')}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{candidate.label}</span>
                          <Badge variant="outline">{candidate.data_type}</Badge>
                          {candidate.module_name ? <Badge variant="outline">{candidate.module_name}</Badge> : null}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="min-w-0 flex-1 truncate">{candidate.description || '연결 가능한 입력'}</span>
                          <TechnicalReferenceHint
                            title={`module ${candidate.module_name || '-'}\nnode ${candidate.node_id}\nport ${candidate.port_key}`}
                            label="추가 가능한 입력의 내부 연결 정보 보기"
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </CardContent>
      ) : (
        <CardContent>
          {showHeader ? (
            <SectionHeading
              variant="inside"
              heading="Exposed Run Inputs"
              actions={
                <>
                  <Badge variant="outline">{selectedInputs.length} selected</Badge>
                  {collapseButton}
                </>
              }
            />
          ) : (
            <div className="flex justify-between gap-3">
              <Badge variant="outline">{selectedInputs.length} selected</Badge>
              {collapseButton}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
