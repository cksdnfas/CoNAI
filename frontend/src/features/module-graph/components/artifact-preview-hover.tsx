import { useI18n } from '@/i18n'
import { Badge } from '@/components/ui/badge'

/** Hover / focus scrim with a centred "보기" key over an artifact preview; the parent button carries `group relative`. */
export function ArtifactPreviewHoverOverlay() {
  const { t } = useI18n()

  return (
    <>
      <div className="pointer-events-none absolute inset-0 transition-colors duration-200 group-hover:bg-backdrop/30 group-focus-visible:bg-backdrop/30" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <Badge variant="overlay">{t({ ko: '보기', en: 'View' })}</Badge>
      </div>
    </>
  )
}
