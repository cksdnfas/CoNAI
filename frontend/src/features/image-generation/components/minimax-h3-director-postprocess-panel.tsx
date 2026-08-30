import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { FormField } from '../image-generation-shared'
import type {
  MiniMaxH3DirectorGraphInputKey,
  MiniMaxH3DirectorPostprocessState,
  MiniMaxH3DirectorRtxSettings,
} from './minimax-h3-director-dasiwa-utils'

type MiniMaxH3DirectorPostprocessPanelProps = {
  value: MiniMaxH3DirectorPostprocessState
  onChange: (value: MiniMaxH3DirectorPostprocessState) => void
  renderInputPort?: (inputKey: MiniMaxH3DirectorGraphInputKey) => ReactNode
}

const QUALITY_OPTIONS = ['Low', 'Medium', 'High', 'Ultra'] as const

function ToggleRow({ checked, label, hint, onChange, port }: { checked: boolean; label: string; hint?: string; onChange: (checked: boolean) => void; port?: ReactNode }) {
  return (
    <label className="flex min-w-0 items-start gap-2 rounded-sm border border-border/70 bg-background/25 px-3 py-2">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-foreground">{label}</span>
        {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
      {port}
    </label>
  )
}

/** v16 post-processing chain merged behind the v0.4.30 Director output. */
export function MiniMaxH3DirectorPostprocessPanel({ value, onChange, renderInputPort }: MiniMaxH3DirectorPostprocessPanelProps) {
  const { t } = useI18n()
  const patchRtx = (next: Partial<MiniMaxH3DirectorRtxSettings>) => onChange({ ...value, rtx: { ...value.rtx, ...next } })

  return (
    <section className="space-y-3 rounded-sm border border-border/80 bg-surface-low/50 p-3">
      <div>
        <div className="text-xs font-semibold text-foreground">{t({ ko: '업스케일 및 후처리', en: 'Upscaling and post-processing' })}</div>
        <div className="text-[11px] text-muted-foreground">{t({ ko: '활성화한 단계는 위에서 아래 순서로 연결돼. 기본값은 전부 꺼짐이야.', en: 'Enabled stages run from top to bottom. All stages are off by default.' })}</div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <ToggleRow
          checked={value.simple.enabled}
          label={t({ ko: '단순 2× 리사이즈', en: 'Simple 2× resize' })}
          hint="DaSiWa Torch Resize · Lanczos"
          port={renderInputPort?.('postprocess.simple.enabled')}
          onChange={(enabled) => onChange({ ...value, simple: { enabled } })}
        />
        <ToggleRow
          checked={value.model.enabled}
          label={t({ ko: '업스케일 모델', en: 'Upscale model' })}
          hint="ImageUpscaleWithModel"
          port={renderInputPort?.('postprocess.model.enabled')}
          onChange={(enabled) => onChange({ ...value, model: { ...value.model, enabled } })}
        />
        <ToggleRow
          checked={value.rtx.enabled}
          label={t({ ko: 'RTX Upscaler & Refiner', en: 'RTX Upscaler & Refiner' })}
          hint={t({ ko: 'NVIDIA RTX 전용', en: 'NVIDIA RTX only' })}
          port={renderInputPort?.('postprocess.rtx.enabled')}
          onChange={(enabled) => patchRtx({ enabled })}
        />
      </div>

      {value.model.enabled ? (
        <div className="space-y-1">
          {renderInputPort?.('postprocess.model.model_name')}
          <FormField label={t({ ko: '업스케일 모델 파일', en: 'Upscale model file' })}>
            <Input value={value.model.model_name} onChange={(event) => onChange({ ...value, model: { ...value.model, model_name: event.target.value } })} />
          </FormField>
        </div>
      ) : null}

      {value.rtx.enabled ? (
        <div className="space-y-3 rounded-sm border border-border/70 bg-background/20 p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <ToggleRow checked={value.rtx.denoise} label={t({ ko: 'RTX 노이즈 제거', en: 'RTX denoise' })} port={renderInputPort?.('postprocess.rtx.denoise')} onChange={(denoise) => patchRtx({ denoise })} />
            <div className="space-y-1">
              {renderInputPort?.('postprocess.rtx.denoise_quality')}
              <FormField label={t({ ko: '노이즈 제거 품질', en: 'Denoise quality' })}>
                <Select value={value.rtx.denoise_quality} onChange={(event) => patchRtx({ denoise_quality: event.target.value as MiniMaxH3DirectorRtxSettings['denoise_quality'] })}>{QUALITY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</Select>
              </FormField>
            </div>
            <ToggleRow checked={value.rtx.deblur} label={t({ ko: 'RTX 디블러', en: 'RTX deblur' })} port={renderInputPort?.('postprocess.rtx.deblur')} onChange={(deblur) => patchRtx({ deblur })} />
            <div className="space-y-1">
              {renderInputPort?.('postprocess.rtx.deblur_quality')}
              <FormField label={t({ ko: '디블러 품질', en: 'Deblur quality' })}>
                <Select value={value.rtx.deblur_quality} onChange={(event) => patchRtx({ deblur_quality: event.target.value as MiniMaxH3DirectorRtxSettings['deblur_quality'] })}>{QUALITY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</Select>
              </FormField>
            </div>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}>
            <div className="space-y-1">
              {renderInputPort?.('postprocess.rtx.upscale')}
              <FormField label={t({ ko: 'RTX 업스케일 모드', en: 'RTX upscale mode' })}>
                <Select value={value.rtx.upscale} onChange={(event) => patchRtx({ upscale: event.target.value as MiniMaxH3DirectorRtxSettings['upscale'] })}><option>Off</option><option>VSR</option><option>High Bitrate</option></Select>
              </FormField>
            </div>
            <div className="space-y-1">
              {renderInputPort?.('postprocess.rtx.upscale_quality')}
              <FormField label={t({ ko: '업스케일 품질', en: 'Upscale quality' })}>
                <Select value={value.rtx.upscale_quality} onChange={(event) => patchRtx({ upscale_quality: event.target.value as MiniMaxH3DirectorRtxSettings['upscale_quality'] })}>{QUALITY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</Select>
              </FormField>
            </div>
            <div className="space-y-1">
              {renderInputPort?.('postprocess.rtx.resize_type')}
              <FormField label={t({ ko: '출력 크기 방식', en: 'Output size mode' })}>
                <Select value={value.rtx.resize_type} onChange={(event) => patchRtx({ resize_type: event.target.value as MiniMaxH3DirectorRtxSettings['resize_type'] })}><option>Scale</option><option>Keep Ratio</option><option>Preset Ratio</option><option>Manual</option><option>Same Size</option></Select>
              </FormField>
            </div>
            <div className="space-y-1">
              {renderInputPort?.('postprocess.rtx.divisible_by')}
              <FormField label={t({ ko: '픽셀 배수', en: 'Divisible by' })}>
                <Select value={value.rtx.divisible_by} onChange={(event) => patchRtx({ divisible_by: event.target.value as MiniMaxH3DirectorRtxSettings['divisible_by'] })}>{['8', '16', '32', '64', '128'].map((option) => <option key={option}>{option}</option>)}</Select>
              </FormField>
            </div>
          </div>

          {value.rtx.resize_type === 'Scale' ? (
            <div className="max-w-xs space-y-1">{renderInputPort?.('postprocess.rtx.scale')}<FormField label={t({ ko: '배율', en: 'Scale' })}><NumberStepperInput min={1} max={4} step={0.05} value={String(value.rtx.scale)} onValueCommit={(next) => patchRtx({ scale: Number(next) })} /></FormField></div>
          ) : value.rtx.resize_type === 'Keep Ratio' || value.rtx.resize_type === 'Preset Ratio' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">{renderInputPort?.('postprocess.rtx.megapixels')}<FormField label={t({ ko: '목표 MP', en: 'Target MP' })}><NumberStepperInput min={0.01} max={64} step={0.01} value={String(value.rtx.megapixels)} onValueCommit={(next) => patchRtx({ megapixels: Number(next) })} /></FormField></div>
              {value.rtx.resize_type === 'Preset Ratio' ? <div className="space-y-1">{renderInputPort?.('postprocess.rtx.ratio_preset')}<FormField label={t({ ko: '목표 비율', en: 'Target ratio' })}><Select value={value.rtx.ratio_preset} onChange={(event) => patchRtx({ ratio_preset: event.target.value as MiniMaxH3DirectorRtxSettings['ratio_preset'] })}>{['1:1', '4:3', '3:2', '16:9', '21:9'].map((option) => <option key={option}>{option}</option>)}</Select></FormField></div> : null}
            </div>
          ) : value.rtx.resize_type === 'Manual' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">{renderInputPort?.('postprocess.rtx.width')}<FormField label={t({ ko: 'RTX 너비', en: 'RTX width' })}><NumberStepperInput min={64} max={8192} step={8} value={String(value.rtx.width)} onValueCommit={(next) => patchRtx({ width: Number(next) })} /></FormField></div>
              <div className="space-y-1">{renderInputPort?.('postprocess.rtx.height')}<FormField label={t({ ko: 'RTX 높이', en: 'RTX height' })}><NumberStepperInput min={64} max={8192} step={8} value={String(value.rtx.height)} onValueCommit={(next) => patchRtx({ height: Number(next) })} /></FormField></div>
            </div>
          ) : null}

          {(value.rtx.resize_type === 'Preset Ratio' || value.rtx.resize_type === 'Manual') ? (
            <div className="max-w-sm space-y-1">{renderInputPort?.('postprocess.rtx.resize_method')}<FormField label={t({ ko: '비율 불일치 처리', en: 'Aspect mismatch' })}><Select value={value.rtx.resize_method} onChange={(event) => patchRtx({ resize_method: event.target.value as MiniMaxH3DirectorRtxSettings['resize_method'] })}><option>Center Crop (Fill)</option><option>Letterbox (Fit)</option></Select></FormField></div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">{renderInputPort?.('postprocess.rtx.device_id')}<FormField label={t({ ko: 'RTX GPU 번호', en: 'RTX GPU index' })}><NumberStepperInput min={0} max={8} step={1} value={String(value.rtx.device_id)} onValueCommit={(next) => patchRtx({ device_id: Math.trunc(Number(next)) })} /></FormField></div>
            <ToggleRow checked={value.rtx.empty_cache} label={t({ ko: '실행 전 캐시 비우기', en: 'Empty cache first' })} port={renderInputPort?.('postprocess.rtx.empty_cache')} onChange={(empty_cache) => patchRtx({ empty_cache })} />
            <ToggleRow checked={value.rtx.use_mmap} label={t({ ko: '디스크 mmap 허용', en: 'Allow disk mmap' })} port={renderInputPort?.('postprocess.rtx.use_mmap')} onChange={(use_mmap) => patchRtx({ use_mmap })} />
            <ToggleRow checked={value.rtx.auto_unload_models} label={t({ ko: '모델 자동 언로드', en: 'Auto-unload models' })} port={renderInputPort?.('postprocess.rtx.auto_unload_models')} onChange={(auto_unload_models) => patchRtx({ auto_unload_models })} />
          </div>
        </div>
      ) : null}
    </section>
  )
}
