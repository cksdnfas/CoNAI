import { useNavigate } from 'react-router-dom'
import type { ActionMenuAction } from '@/components/ui/action-menu'
import { usePluginImagePages } from '@/features/plugins/use-plugin-pages'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'

/** ⋯ menu entries that open this still image in every enabled plugin page declaring `opensImages`. */
export function useImagePluginMenuActions(image?: ImageRecord): ActionMenuAction[] {
  const { t } = useI18n()
  const navigate = useNavigate()
  const pages = usePluginImagePages()
  if (!image?.composite_hash || !image.mime_type?.startsWith('image/')) return []
  const compositeHash = image.composite_hash
  return pages.map((page) => ({
    key: page.key,
    icon: page.icon,
    label: t({ ko: '{title}에서 열기', en: 'Open in {title}' }, { title: page.title }),
    onSelect: () => void navigate(`/ext/${encodeURIComponent(page.pluginId)}/${encodeURIComponent(page.pageId)}?image=${encodeURIComponent(compositeHash)}`),
  }))
}
