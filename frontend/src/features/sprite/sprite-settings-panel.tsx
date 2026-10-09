import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pipette, Plus, Wand2, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import { SegmentedControl } from '@/components/common/segmented-control'
import { useI18n } from '@/i18n'
import { getGroupsHierarchyAll } from '@/lib/api-groups'
import type { SpriteVideoInfo } from '@/lib/api-sprite'
import { cn } from '@/lib/utils'
import { MAX_KEY_COLORS, MAX_SPRITE_FRAMES, normalizeHex, withDespill, type ExtractForm, type OutputForm, type SaveForm } from './sprite-options'
import { HexInput } from './sprite-result-panel'
import { MiniField, SliderLine, SpriteSection, SwitchLine } from './sprite-ui'

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
  const groups = useQuery({ queryKey: ['groups', 'hierarchy-all'], queryFn: getGroupsHierarchyAll, staleTime: 60_000, enabled: canSave })
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
          onChange={(checked) => update({ removeDuplicateFrames: checked })}
          extra={form.removeDuplicateFrames ? <NumberStepperInput className="h-7 w-32 text-xs" value={form.similarityPercent} min={1} max={100} step={0.5} onValueCommit={(value) => update({ similarityPercent: Math.max(1, Math.min(100, Number(value) || 99)) })} aria-label={t({ ko: '유사도 %', en: 'Similarity %' })} /> : undefined}
        />
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
        <SliderLine label={t({ ko: '허용치', en: 'Tolerance' })} value={form.tolerancePercent} min={1} max={100} format={(value) => `${Math.round(value)}%`} onChange={(value) => update({ tolerancePercent: value })} />
        <SliderLine label={t({ ko: '부드러움', en: 'Softness' })} value={form.softnessPercent} min={form.despill ? 1 : 0} max={100} format={(value) => `${Math.round(value)}%`} onChange={(value) => update({ softnessPercent: value })} />
        <SwitchLine label={t({ ko: '디스필', en: 'Despill' })} checked={form.despill} onChange={(checked) => { setForm(withDespill(form, checked)); onActiveColorChange(0) }} />
        {form.despill ? (
          <div className="border-l-2 border-line pl-3">
            <SwitchLine muted label={t({ ko: '가장자리 정리', en: 'Edge clean-up' })} checked={form.edgeCleanup} onChange={(checked) => update({ edgeCleanup: checked })} />
          </div>
        ) : null}
      </SpriteSection>

      <SpriteSection title={t({ ko: '보정·크기', en: 'Clean-up and size' })}>
        <SwitchLine
          label={t({ ko: '자동 크롭', en: 'Auto crop' })}
          checked={form.autoCrop}
          onChange={(checked) => update({ autoCrop: checked })}
          extra={form.autoCrop ? <NumberStepperInput className="h-7 w-32 text-xs" value={form.alphaThreshold} min={1} max={255} step={1} onValueCommit={(value) => update({ alphaThreshold: Math.max(1, Math.min(255, Number(value) || 20)) })} aria-label={t({ ko: '알파 임계값', en: 'Alpha threshold' })} /> : undefined}
        />
        <SwitchLine
          label={t({ ko: '사전 크롭', en: 'Pre-crop' })}
          checked={Boolean(form.preCrop)}
          disabled={!info}
          onChange={(checked) => update({ preCrop: checked && info ? { x: Math.round(info.width * 0.1), y: Math.round(info.height * 0.1), width: Math.round(info.width * 0.8), height: Math.round(info.height * 0.8) } : null })}
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
            <MiniField label={t({ ko: '가로', en: 'Width' })}><NumberStepperInput value={form.outputWidth} min={1} max={16384} step={1} onValueCommit={(value) => update({ outputWidth: Math.max(1, Number(value) || 1) })} /></MiniField>
            <MiniField label={t({ ko: '세로', en: 'Height' })}><NumberStepperInput value={form.outputHeight} min={1} max={16384} step={1} onValueCommit={(value) => update({ outputHeight: Math.max(1, Number(value) || 1) })} /></MiniField>
          </div>
        ) : null}
      </SpriteSection>

      <SpriteSection title={t({ ko: '시트', en: 'Sheet' })}>
        <div className="flex items-center justify-end gap-3 text-sm">
          <Tip content={t({ ko: '시트 열 수 (0은 자동)', en: 'Sheet columns (0 = auto)' })}>
            <span className="inline-flex">
              <NumberStepperInput className="w-28" value={output.columns} min={0} max={64} step={1} onValueCommit={(value) => setOutput({ ...output, columns: Math.max(0, Math.min(64, Math.round(Number(value) || 0))) })} aria-label={t({ ko: '열 수 (0은 자동)', en: 'Columns (0 = auto)' })} />
            </span>
          </Tip>
        </div>
        <SegmentedControl
          size="sm"
          fullWidth
          value={COLUMN_PRESETS.includes(output.columns) ? String(output.columns) : ''}
          onChange={(value) => setOutput({ ...output, columns: Number(value) })}
          items={COLUMN_PRESETS.map((columns) => ({ value: String(columns), label: columns === 0 ? t({ ko: '자동', en: 'Auto' }) : String(columns) }))}
          ariaLabel={t({ ko: '열 빠른 선택', en: 'Column presets' })}
        />
        <div className="flex items-center justify-end gap-3 text-sm">
          <Tip content={t({ ko: '셀 사이 간격 (px)', en: 'Gap between cells (px)' })}>
            <span className="inline-flex">
              <NumberStepperInput className="w-28" value={output.spacing} min={0} max={64} step={1} onValueCommit={(value) => setOutput({ ...output, spacing: Math.max(0, Math.min(64, Math.round(Number(value) || 0))) })} aria-label={t({ ko: '셀 사이 간격 (px)', en: 'Cell spacing (px)' })} />
            </span>
          </Tip>
        </div>
        <div className="flex items-center justify-end gap-3 text-sm">
          <SegmentedControl size="sm" value={output.format} onChange={(format) => setOutput({ ...output, format: format as OutputForm['format'] })} items={[{ value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} ariaLabel={t({ ko: '포맷', en: 'Format' })} />
        </div>
        {output.format === 'webp' ? <SliderLine label={t({ ko: '품질', en: 'Quality' })} value={output.quality} min={1} max={100} onChange={(quality) => setOutput({ ...output, quality })} /> : null}
      </SpriteSection>

      {canSave ? (
        <SpriteSection title={t({ ko: '출력', en: 'Output' })}>
          <div className="flex items-center justify-end gap-3 text-sm">
            <Tip content={t({ ko: '라이브러리에 저장할 그룹', en: 'Library group to save in' })}>
              <Select className="h-8 min-w-0 max-w-56" value={save.groupPath ?? ''} onChange={(event) => setSave({ ...save, groupPath: event.target.value || null })} aria-label={t({ ko: '저장할 그룹', en: 'Group to save in' })}>
                <option value="">{SPRITE_GROUP}</option>
                {save.groupPath && !groupPaths.includes(save.groupPath) && save.groupPath !== SPRITE_GROUP ? <option value={save.groupPath}>{save.groupPath}</option> : null}
                {groupPaths.map((path) => <option key={path} value={path}>{path}</option>)}
              </Select>
            </Tip>
          </div>
          <SwitchLine label={t({ ko: 'ZIP으로도 받기', en: 'Also download a ZIP' })} checked={save.zip} onChange={(zip) => setSave({ ...save, zip })} />
        </SpriteSection>
      ) : null}
    </div>
  )
}
