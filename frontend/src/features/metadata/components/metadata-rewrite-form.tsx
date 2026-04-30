import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { RewriteFormat, RewriteMetadataDraft } from '../use-metadata-rewrite-draft'

interface MetadataRewriteFormProps {
  draft: RewriteMetadataDraft
  disabled?: boolean
  formatLabel?: string
  showHeader?: boolean
  /** Apply a partial draft update from one form field. */
  onDraftChange: (patch: Partial<RewriteMetadataDraft>) => void
}

/** Render reusable metadata rewrite controls for prompt and generation fields. */
export function MetadataRewriteForm({ draft, disabled = false, formatLabel, showHeader = true, onDraftChange }: MetadataRewriteFormProps) {
  const { t } = useI18n()
  const resolvedFormatLabel = formatLabel ?? t('metadata.components.metadata.rewrite.form.output.format')

  return (
    <div className={showHeader ? 'space-y-4 rounded-sm bg-surface-container p-4' : 'space-y-4'}>
      {showHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-foreground">{t('metadata.components.metadata.rewrite.form.edit.metadata')}</div>
          <Badge variant="outline">rewrite</Badge>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">{resolvedFormatLabel}</span>
          <Select value={draft.format} onChange={(event) => onDraftChange({ format: event.target.value as RewriteFormat })} disabled={disabled}>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </Select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">{t({ ko: '스텝', en: 'Steps' })}</span>
          <Input value={draft.steps} onChange={(event) => onDraftChange({ steps: event.target.value })} placeholder={t('metadata.components.metadata.rewrite.form.e.g.28')} disabled={disabled} />
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">{t({ ko: '샘플러', en: 'Sampler' })}</span>
          <Input value={draft.sampler} onChange={(event) => onDraftChange({ sampler: event.target.value })} placeholder={t('metadata.components.metadata.rewrite.form.e.g.euler.a')} disabled={disabled} />
        </label>

        <label className="space-y-2 text-sm md:col-span-2 xl:col-span-3">
          <span className="text-muted-foreground">{t({ ko: '프롬프트', en: 'Prompt' })}</span>
          <Textarea value={draft.prompt} onChange={(event) => onDraftChange({ prompt: event.target.value })} placeholder={t({ ko: '긍정 프롬프트', en: 'Positive prompt' })} className="min-h-28" disabled={disabled} />
        </label>

        <label className="space-y-2 text-sm md:col-span-2 xl:col-span-3">
          <span className="text-muted-foreground">{t({ ko: '네거티브 프롬프트', en: 'Negative prompt' })}</span>
          <Textarea value={draft.negativePrompt} onChange={(event) => onDraftChange({ negativePrompt: event.target.value })} placeholder={t({ ko: '네거티브 프롬프트', en: 'Negative prompt' })} className="min-h-24" disabled={disabled} />
        </label>

        <label className="space-y-2 text-sm md:col-span-2 xl:col-span-3">
          <span className="text-muted-foreground">{t({ ko: '모델', en: 'Model' })}</span>
          <Input value={draft.model} onChange={(event) => onDraftChange({ model: event.target.value })} placeholder={t('metadata.components.metadata.rewrite.form.e.g.animemodel')} disabled={disabled} />
        </label>
      </div>
    </div>
  )
}
