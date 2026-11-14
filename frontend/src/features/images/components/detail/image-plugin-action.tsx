import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import type { ActionMenuAction } from '@/components/ui/action-menu'
import { IconButton } from '@/components/ui/icon-button'
import { usePluginImagePages } from '@/features/plugins/use-plugin-pages'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'

type ImagePluginAction = ActionMenuAction & { label: string; icon: LucideIcon }

/** Matching prompt declarations move to the action row; every other declaration stays in ⋯. */
export function useImagePluginActions(image?: ImageRecord, onOpened?: () => void): { menu: ImagePluginAction[]; buttons: ImagePluginAction[] } {
  const { t } = useI18n()
  const navigate = useNavigate()
  const pages = usePluginImagePages()
  const menu: ImagePluginAction[] = [], buttons: ImagePluginAction[] = []
  if (!image?.composite_hash || !image.mime_type?.startsWith('image/')) return { menu, buttons }
  const compositeHash = image.composite_hash
  for (const page of pages) {
    const target = page.prompt?.test(image.ai_metadata?.prompts?.prompt ?? '') ? buttons : menu
    target.push({
      key: page.key,
      icon: page.icon,
      label: t({ ko: '{title}에서 열기', en: 'Open in {title}' }, { title: page.title }),
      onSelect: () => {
        void navigate(`/ext/${encodeURIComponent(page.pluginId)}/${encodeURIComponent(page.pageId)}?image=${encodeURIComponent(compositeHash)}`)
        onOpened?.()
      },
    })
  }
  return { menu, buttons }
}

export function ImagePluginActionButtons({ actions, variant }: { actions: ImagePluginAction[]; variant: 'ghost' | 'overlay' }) {
  return actions.map(({ key, label, icon: Icon, onSelect }) => (
    <IconButton key={key} label={label} variant={variant} size="icon-sm" onClick={onSelect}><Icon className="size-4" /></IconButton>
  ))
}
