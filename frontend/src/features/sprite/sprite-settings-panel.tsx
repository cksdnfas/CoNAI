import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SPRITE_DEFAULT_ALPHA_THRESHOLD } from '@conai/shared'
import { Pipette, Plus, Wand2, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { SliderRow } from '@/components/ui/slider-row'
import { SwitchLine } from '@/components/ui/switch-line'
import { Tip } from '@/components/ui/tooltip'
import { SegmentedControl } from '@/components/common/segmented-control'
import { useI18n } from '@/i18n'
import { getGroupsHierarchyAll, GROUPS_HIERARCHY_ALL_QUERY_KEY } from '@/lib/api-groups'
import type { SpriteVideoInfo } from '@/lib/api-sprite'
import { cn } from '@/lib/utils'
import { MAX_KEY_COLORS, MAX_SHEET_DIMENSION, MAX_SPRITE_FRAMES, normalizeHex, withDespill, type ExtractForm, type OutputForm, type SaveForm } from './sprite-options'
import { HexInput } from './sprite-result-panel'
import { MiniField, SpriteSection } from './sprite-ui'

const COLUMN_PRESETS = [0, 2, 3, 4, 6, 8]
const SPRITE_GROUP = '스프라이트'

/** The right column: every setting the run uses, the same for every video in the list. */
export function SpriteSettingsPanel({ form, setForm, output, setOutput, save, setSave, info, multiple, picking, onPickingChange, activeColor, onActiveColorChange, onDetectBackground, canSave }: {
  form: ExtractForm
  setForm: (next: ExtractForm) => void
  output: OutputForm
  setOutput: (next: OutputForm) => void
  save: SaveForm
  setSave: (next: SaveForm) => void
  /** The selected video, for size limits and the pre-crop box; null when nothing is selected. */
  info: SpriteVideoInfo | null
  /** Several videos: the interval is in seconds, since frame counts differ per video. */
  multiple: boolean
  picking: boolean
  onPickingChange: (picking: boolean) => void
  activeColor: number
  onActiveColorChange: (index: number) => void
  onDetectBackground: () => void
  canSave: boolean
}) {
  const { t } = useI18n()
  const update = (patch: Partial<ExtractForm>) => setForm({ ...form, ...patch })
  const setColor = (index: number, value: string) => {
    const hex = normalizeHex(value)
    if (hex) update({ keyColors: form.keyColors.map((color, position) => position === index ? hex : color) })
  }
  const groups = useQuery({ queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY, queryFn: getGroupsHierarchyAll, staleTime: 60_000, enabled: canSave })
  const groupPaths = useMemo(() => {
    const list = groups.data ?? []
    const byId = new Map(list.map((group) => [group.id, group]))
    const pathOf = (id: number, guard = 0): string => {
      const group = byId.get(id)
      if (!group) return ''
      const parent = group.parent_id && guard < 8 ? pathOf(group.parent_id, guard + 1) : ''
      return parent ? `${parent}/${group.name}` : group.name
    }
    const paths = [...new Set(list.map((group) => pathOf(group.id)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ko'))
    return paths.filter((path) => path !== SPRITE_GROUP)
  }, [groups.data])
  const intervalUnit = multiple ? 'seconds' : form.intervalUnit

  return (
    <div className="flex min-w-0 flex-col">
      <SpriteSection title={t({ ko: '추출', en: 'Frames' })} actions={<SegmentedControl size="sm" value={form.samplingMode} onChange={(mode) => update({ samplingMode: mode as ExtractForm['samplingMode'] })} items={[{ value: 'count', label: t({ ko: '개수', en: 'Count' }) }, { value: 'interval', label: t({ ko: '간격', en: 'Interval' }) }]} ariaLabel={t({ ko: '추출 방식', en: 'Sampling' })} />}>
        {form.samplingMode === 'count' ? (
          <div className="flex items-center justify-end gap-3 text-sm">
            <Tip content={t({ ko: '영상마다 뽑을 컷 수', en: 'Frames to take from each video' })}>
              <span className="inline-flex">
                <NumberStepperInput className="w-28" value={form.sampleCount} min={2} max={MAX_SPRITE_FRAMES} step={1} onValueCommit={(value) => update({ sampleCount: Math.max(2, Math.min(MAX_SPRITE_FRAMES, Number(value) || 2)) })} aria-label={t({ ko: '영상마다 뽑을 컷 수', en: 'Frames per video' })} />
              </span>
            </Tip>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3 text-sm">
            <span className="flex items-center gap-2">
              <Tip content={t({ ko: '이 간격마다 한 컷씩 뽑아', en: 'Take one frame every interval' })}>
                <span className="inline-flex">
                  <NumberStepperInput className="w-28" value={form.intervalValue} min={intervalUnit === 'frames' ? 1 : 0.001} step={intervalUnit === 'frames' ? 1 : 0.01} onValueCommit={(value) => update({ intervalValue: Math.max(0.001, Number(value) || 1) })} aria-label={t({ ko: '간격', en: 'Interval' })} />
                </span>
              </Tip>
              <SegmentedControl
                size="sm"
                value={intervalUnit}
                onChange={(unit) => {
                  const fps = info?.fps ?? 30
                  const next = unit as ExtractForm['intervalUnit']
                  if (next === form.intervalUnit) return
                  update({ intervalUnit: next, intervalValue: next === 'frames' ? Math.max(1, Math.round(form.intervalValue * fps)) : Number((form.intervalValue / fps).toFixed(4)) })
                }}
                items={[{ value: 'seconds', label: t({ ko: '초', en: 'sec' }) }, { value: 'frames', label: t({ ko: '프레임', en: 'frames' }), disabled: multiple }]}
                ariaLabel={t({ ko: '간격 단위', en: 'Interval unit' })}
              />
            </span>
          </div>
        )}
        <SwitchLine
          label={t({ ko: '연속 중복 프레임 빼기', en: 'Drop repeated frames' })}
          checked={form.removeDuplicateFrames}
          onCheckedChange={(checked) => update({ removeDuplicateFrames: checked })}
        />
        {form.removeDuplicateFrames ? (
          <div className="border-l-2 border-line pl-3">
            <MiniField label={t({ ko: '중복 유사도 %', en: 'Duplicate similarity %' })} className="w-32">
              <NumberStepperInput value={form.similarityPercent} min={1} max={100} step={0.5} onValueCommit={(value) => update({ similarityPercent: Math.max(1, Math.min(100, Number(value) || 99)) })} aria-label={t({ ko: '중복 유사도 %', en: 'Duplicate similarity %' })} />
            </MiniField>
          </div>
        ) : null}
      </SpriteSection>

      <SpriteSection title={t({ ko: '배경', en: 'Background' })}>
        <div className="flex flex-col gap-1.5">
          {form.keyColors.map((color, index) => (
            <div key={index} className="flex items-center gap-2">
              <label className={cn('relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-sm border-2', index === activeColor && !form.despill ? 'border-foreground' : 'border-line')} style={{ background: color }} onClick={() => onActiveColorChange(index)}>
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={color.toLowerCase()} aria-label={t({ ko: '색 고르기', en: 'Choose colour' })} onChange={(event) => setColor(index, event.target.value)} />
              </label>
              <HexInput value={color} label={t({ ko: '색 코드', en: 'Colour code' })} onCommit={(value) => setColor(index, value)} />
              <span className="flex-1" />
              {index === 0 ? (
                <>
                  <IconButton variant="secondary" size="icon-sm" disabled={!info} label={t({ ko: '가장자리에서 배경색 찾기', en: 'Find the background from the border' })} onClick={onDetectBackground}><Wand2 /></IconButton>
                  <IconButton variant="secondary" size="icon-sm" active={picking} disabled={!info} label={t({ ko: '영상에서 색 찍기', en: 'Pick from the video' })} onClick={() => onPickingChange(!picking)}><Pipette /></IconButton>
                  <IconButton variant="secondary" size="icon-sm" disabled={form.despill || form.keyColors.length >= MAX_KEY_COLORS} label={form.despill ? t({ ko: '디스필은 색 하나만 써', en: 'Despill uses one colour' }) : t({ ko: '색 추가', en: 'Add colour' })} onClick={() => { update({ keyColors: [...form.keyColors, '#00FF00'] }); onActiveColorChange(form.keyColors.length) }}><Plus /></IconButton>
                </>
              ) : (
                <IconButton variant="ghost" size="icon-sm" label={t({ ko: '색 빼기', en: 'Remove colour' })} onClick={() => { update({ keyColors: form.keyColors.filter((_, position) => position !== index) }); onActiveColorChange(0) }}><X /></IconButton>
              )}
            </div>
          ))}
        </div>
        <SliderRow label={t({ ko: '허용치', en: 'Tolerance' })} value={form.tolerancePercent} min={1} max={100} readout={`${Math.round(form.tolerancePercent)}%`} onChange={(value) => update({ tolerancePercent: value })} />
        <SliderRow label={t({ ko: '부드러움', en: 'Softness' })} value={form.softnessPercent} min={form.despill ? 1 : 0} max={100} readout={`${Math.round(form.softnessPercent)}%`} onChange={(value) => update({ softnessPercent: value })} />
        <SwitchLine label={t({ ko: '디스필', en: 'Despill' })} checked={form.despill} onCheckedChange={(checked) => { setForm(withDespill(form, checked)); onActiveColorChange(0) }} />
        {form.despill ? (
          <div className="border-l-2 border-line pl-3">
            <SwitchLine muted label={t({ ko: '가장자리 정리', en: 'Edge clean-up' })} checked={form.edgeCleanup} onCheckedChange={(checked) => update({ edgeCleanup: checked })} />
          </div>
        ) : null}
      </SpriteSection>

      <SpriteSection title={t({ ko: '보정·크기', en: 'Clean-up and size' })}>
        <SwitchLine
          label={t({ ko: '자동 크롭', en: 'Auto crop' })}
          checked={form.autoCrop}
          onCheckedChange={(checked) => update({ autoCrop: checked })}
        />
        {form.autoCrop ? (
          <div className="border-l-2 border-line pl-3">
            <MiniField label={t({ ko: '알파 임계값', en: 'Alpha threshold' })} className="w-32">
              <NumberStepperInput value={form.alphaThreshold} min={1} max={255} step={1} onValueCommit={(value) => update({ alphaThreshold: Math.max(1, Math.min(255, Number(value) || SPRITE_DEFAULT_ALPHA_THRESHOLD)) })} aria-label={t({ ko: '알파 임계값', en: 'Alpha threshold' })} />
            </MiniField>
          </div>
        ) : null}
        <SwitchLine
          label={t({ ko: '사전 크롭', en: 'Pre-crop' })}
          checked={Boolean(form.preCrop)}
          disabled={!info}
          onCheckedChange={(checked) => update({ preCrop: checked && info ? { x: Math.round(info.width * 0.1), y: Math.round(info.height * 0.1), width: Math.round(info.width * 0.8), height: Math.round(info.height * 0.8) } : null })}
        />
        {form.preCrop ? (
          <div className="grid grid-cols-2 gap-2">
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <MiniField key={key} label={key === 'x' ? 'X' : key === 'y' ? 'Y' : key === 'width' ? 'W' : 'H'}>
                <NumberStepperInput value={form.preCrop![key]} min={key === 'width' || key === 'height' ? 1 : 0} max={key === 'x' || key === 'width' ? info?.width : info?.height} step={1} onValueCommit={(value) => update({ preCrop: { ...form.preCrop!, [key]: Math.max(0, Math.round(Number(value) || 0)) } })} />
              </MiniField>
            ))}
          </div>
        ) : null}
        <SegmentedControl
          size="sm"
          value={form.resizeMode}
          onChange={(mode) => update({ resizeMode: mode as ExtractForm['resizeMode'] })}
          items={[{ value: 'none', label: t({ ko: '원본', en: 'Original' }) }, { value: 'contain', label: t({ ko: '맞춤', en: 'Fit' }) }, { value: 'cover', label: t({ ko: '채움', en: 'Fill' }) }, { value: 'stretch', label: t({ ko: '늘림', en: 'Stretch' }) }]}
          ariaLabel={t({ ko: '크기 조정', en: 'Resize' })}
        />
        {form.resizeMode !== 'none' ? (
          <div className="grid grid-cols-2 gap-3">
            <MiniField label={t({ ko: '가로', en: 'Width' })}><NumberStepperInput value={form.outputWidth} min={1} max={MAX_SHEET_DIMENSION} step={1} onValueCommit={(value) => update({ outputWidth: Math.max(1, Number(value) || 1) })} /></MiniField>
            <MiniField label={t({ ko: '세로', en: 'Height' })}><NumberStepperInput value={form.outputHeight} min={1} max={MAX_SHEET_DIMENSION} step={1} onValueCommit={(value) => update({ outputHeight: Math.max(1, Number(value) || 1) })} /></MiniField>
          </div>
        ) : null}
      </SpriteSection>

      <SpriteSection title={t({ ko: '시트', en: 'Sheet' })}>
        <MiniField label={t({ ko: '열 수', en: 'Columns' })}>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              value={COLUMN_PRESETS.includes(output.columns) ? String(output.columns) : ''}
              onChange={(value) => setOutput({ ...output, columns: Number(value) })}
              items={COLUMN_PRESETS.map((columns) => ({ value: String(columns), label: columns === 0 ? t({ ko: '자동', en: 'Auto' }) : String(columns) }))}
              ariaLabel={t({ ko: '열 빠른 선택', en: 'Column presets' })}
            />
            <NumberStepperInput className="w-32" value={output.columns} min={0} max={64} step={1} onValueCommit={(value) => setOutput({ ...output, columns: Math.max(0, Math.min(64, Math.round(Number(value) || 0))) })} aria-label={t({ ko: '열 수 (0은 자동)', en: 'Columns (0 = auto)' })} />
          </div>
        </MiniField>
        <div className="grid grid-cols-2 gap-2">
          <MiniField label={t({ ko: '셀 간격 (px)', en: 'Cell spacing (px)' })}>
            <NumberStepperInput value={output.spacing} min={0} max={64} step={1} onValueCommit={(value) => setOutput({ ...output, spacing: Math.max(0, Math.min(64, Math.round(Number(value) || 0))) })} aria-label={t({ ko: '셀 간격 (px)', en: 'Cell spacing (px)' })} />
          </MiniField>
          <MiniField label={t({ ko: '형식', en: 'Format' })}>
            <SegmentedControl size="sm" fullWidth value={output.format} onChange={(format) => setOutput({ ...output, format: format as OutputForm['format'] })} items={[{ value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} ariaLabel={t({ ko: '형식', en: 'Format' })} />
          </MiniField>
        </div>
        {output.format === 'webp' ? <SliderRow label={t({ ko: '품질', en: 'Quality' })} value={output.quality} min={1} max={100} onChange={(quality) => setOutput({ ...output, quality })} /> : null}
      </SpriteSection>

      {canSave ? (
        <SpriteSection title={t({ ko: '출력', en: 'Output' })}>
          <MiniField label={t({ ko: '저장할 그룹', en: 'Group to save in' })}>
            <Select value={save.groupPath ?? ''} onChange={(event) => setSave({ ...save, groupPath: event.target.value || null })} aria-label={t({ ko: '저장할 그룹', en: 'Group to save in' })}>
              <option value="">{SPRITE_GROUP}</option>
              {save.groupPath && !groupPaths.includes(save.groupPath) && save.groupPath !== SPRITE_GROUP ? <option value={save.groupPath}>{save.groupPath}</option> : null}
              {groupPaths.map((path) => <option key={path} value={path}>{path}</option>)}
            </Select>
          </MiniField>
          <SwitchLine label={t({ ko: 'ZIP으로도 받기', en: 'Also download a ZIP' })} checked={save.zip} onCheckedChange={(zip) => setSave({ ...save, zip })} />
        </SpriteSection>
      ) : null}
    </div>
  )
}
