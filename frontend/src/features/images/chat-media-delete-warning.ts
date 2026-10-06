import type { useI18n } from '@/i18n'
import { getChatMediaUsage } from '@/lib/api-codex-chat'

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
