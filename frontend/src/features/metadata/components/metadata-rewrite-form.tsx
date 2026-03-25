import { Badge } from '@/components/ui/badge'
import type { RewriteFormat, RewriteMetadataDraft } from '../use-metadata-rewrite-draft'

interface MetadataRewriteFormProps {
  draft: RewriteMetadataDraft
  disabled?: boolean
  /** Apply a partial draft update from one form field. */
  onDraftChange: (patch: Partial<RewriteMetadataDraft>) => void
}

/** Render reusable metadata rewrite controls for prompt and generation fields. */
export function MetadataRewriteForm({ draft, disabled = false, onDraftChange }: MetadataRewriteFormProps) {
  return (
    <div className="space-y-4 rounded-sm bg-surface-high p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground">메타 수정</div>
        <Badge variant="outline">rewrite</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">출력 포맷</span>
          <select
            value={draft.format}
            onChange={(event) => onDraftChange({ format: event.target.value as RewriteFormat })}
            className="h-9 w-full rounded-sm border border-border bg-surface-low px-3 text-sm text-foreground outline-none transition focus:border-primary"
            disabled={disabled}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">steps</span>
          <input
            value={draft.steps}
            onChange={(event) => onDraftChange({ steps: event.target.value })}
            placeholder="예: 28"
            className="h-9 w-full rounded-sm border border-border bg-surface-low px-3 text-sm text-foreground outline-none transition focus:border-primary"
            disabled={disabled}
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">sampler</span>
          <input
            value={draft.sampler}
            onChange={(event) => onDraftChange({ sampler: event.target.value })}
            placeholder="예: Euler a"
            className="h-9 w-full rounded-sm border border-border bg-surface-low px-3 text-sm text-foreground outline-none transition focus:border-primary"
            disabled={disabled}
          />
        </label>

        <label className="space-y-2 text-sm md:col-span-2 xl:col-span-3">
          <span className="text-muted-foreground">prompt</span>
          <textarea
            value={draft.prompt}
            onChange={(event) => onDraftChange({ prompt: event.target.value })}
            placeholder="positive prompt"
            className="min-h-28 w-full rounded-sm border border-border bg-surface-low px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
            disabled={disabled}
          />
        </label>

        <label className="space-y-2 text-sm md:col-span-2 xl:col-span-3">
          <span className="text-muted-foreground">negative prompt</span>
          <textarea
            value={draft.negativePrompt}
            onChange={(event) => onDraftChange({ negativePrompt: event.target.value })}
            placeholder="negative prompt"
            className="min-h-24 w-full rounded-sm border border-border bg-surface-low px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
            disabled={disabled}
          />
        </label>

        <label className="space-y-2 text-sm md:col-span-2 xl:col-span-3">
          <span className="text-muted-foreground">model</span>
          <input
            value={draft.model}
            onChange={(event) => onDraftChange({ model: event.target.value })}
            placeholder="예: animeModel"
            className="h-9 w-full rounded-sm border border-border bg-surface-low px-3 text-sm text-foreground outline-none transition focus:border-primary"
            disabled={disabled}
          />
        </label>
      </div>
    </div>
  )
}
