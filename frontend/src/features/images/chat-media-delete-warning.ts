import type { useI18n } from '@/i18n'
import { useI18n as useI18nContext } from '@/i18n'
import { createElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getChatMediaUsage } from '@/lib/api-codex-chat'
import { getAppSettings } from '@/lib/api-settings-general'

type Translate = ReturnType<typeof useI18n>['t']

/**
 * A line for the delete confirmation when chat profiles or messages show some of these images (card images copied into
 * the library); empty when none do or the check fails, so deleting never waits on it.
 */
export async function chatMediaDeleteWarning(compositeHashes: string[], t: Translate) {
  try {
    const usage = await getChatMediaUsage(compositeHashes.slice(0, 500))
    if (usage.profiles.length > 0) {
      const names = usage.profiles.slice(0, 3).join(', ') + (usage.profiles.length > 3 ? t({ ko: ' 외 {count}개', en: ' and {count} more' }, { count: usage.profiles.length - 3 }) : '')
      return t({ ko: '채팅 프로필({names})에서 쓰는 이미지가 있어. 지우면 채팅에서 안 보여.', en: 'Chat profiles ({names}) show some of these. They will be missing in chat.' }, { names })
    }
    if (usage.messages > 0) {
      return t({ ko: '채팅 메시지 {count}개에 들어간 이미지가 있어. 지우면 채팅에서 안 보여.', en: '{count} chat messages show some of these. They will be missing in chat.' }, { count: usage.messages })
    }
  } catch {
    // The warning is a courtesy; the delete itself does not depend on it.
  }
  return ''
}

/** The confirmation text with the chat warning (if any) below it. */
export async function withChatMediaDeleteWarning(description: string, compositeHashes: string[], t: Translate) {
  const warning = await chatMediaDeleteWarning(compositeHashes, t)
  return warning ? `${description}\n\n${warning}` : description
}

function ImageDeleteDescription({ compositeHashes }: { compositeHashes: string[] }) {
  const { t, language } = useI18nContext()
  const auth = useAuthStatusQuery().data
  const protectedDelete = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
    enabled: (query) => auth?.isAdmin === true && query.state.data === undefined,
    retry: false,
  }).data?.general.deleteProtection.enabled
  const description = protectedDelete === true
    ? t({ ko: '휴지통으로 보내고 되돌릴 수 있어.', en: 'Moves to the Recycle Bin and can be undone.' })
    : protectedDelete === false
      ? t({ ko: '영구 삭제돼. 되돌릴 수 없어.', en: 'Permanently deleted. This cannot be undone.' })
      : t({ ko: '보호 설정에 따라 영구 삭제될 수 있어.', en: 'Deletion may be permanent depending on the protection setting.' })
  const hashes = compositeHashes.slice(0, 500)
  const warning = useQuery({
    queryKey: ['chat-media-delete-usage', auth?.accountId ?? null, auth?.accountType ?? null, language, hashes],
    queryFn: () => chatMediaDeleteWarning(hashes, t),
    staleTime: 30_000,
  }).data
  return createElement('span', { 'aria-live': 'polite' }, warning ? `${description}\n\n${warning}` : description)
}

/** Open immediately; cached protection and asynchronous admin/usage queries update the mounted description. */
export function useConfirmImageDelete() {
  const confirm = useConfirm()
  const { t } = useI18nContext()
  return (compositeHashes: string[], title: string) => confirm({
      title,
      description: createElement(ImageDeleteDescription, { compositeHashes }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
}

export function useChatMediaDeleteDescription(compositeHashes: string[], enabled: boolean) {
  const { t, language } = useI18nContext()
  const auth = useAuthStatusQuery().data
  const description = t({
    ko: '이미지를 삭제해. 보호 설정에 따라 영구 삭제될 수 있어.',
    en: 'Delete the images. Deletion may be permanent depending on the protection setting.',
  })
  const hashes = compositeHashes.slice(0, 500)
  return useQuery({
    queryKey: ['chat-media-delete-warning', auth?.accountId ?? null, auth?.accountType ?? null, language, hashes],
    queryFn: async () => (await withChatMediaDeleteWarning(description, hashes, t)).slice(0, 500),
    enabled: enabled && hashes.length > 0,
    staleTime: 30_000,
  }).data
}
