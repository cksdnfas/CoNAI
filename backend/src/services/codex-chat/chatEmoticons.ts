import { EMOTICON_PROMPT_BUDGET, EmoticonService } from '../emoticonService'
import type { ChatStyle } from './chatStyle'

/** The emoticons a profile's chats can use, from its linked emoticon groups (first group wins on shared keywords). */
export function listProfileEmoticons(style: Pick<ChatStyle, 'emoticonGroupIds'>) {
  return EmoticonService.forGroups(style.emoticonGroupIds)
}

/** System prompt part: the `&*keyword*&` syntax and the keywords in use, up to the prompt budget. */
export function buildEmoticonGuidance(style: Pick<ChatStyle, 'emoticonGroupIds'>) {
  if (style.emoticonGroupIds.length === 0) return ''
  const emoticons = listProfileEmoticons(style)
  if (emoticons.length === 0) return ''
  const shown = emoticons.slice(0, EMOTICON_PROMPT_BUDGET)
  return [
    'Emoticons: writing &*keyword*& shows the matching image in the chat. On a line of its own it shows as a sticker; inside a sentence it shows small, like an emoji.',
    'Use them on your own judgement where they fit the mood (not in every reply), and only with these keywords (words separated by / call up the same image):',
    ...shown.map((emoticon) => `- ${emoticon.keywords.join(' / ')}`),
    emoticons.length > shown.length ? `(${emoticons.length - shown.length} more are available through the list_emoticons tool.)` : '',
  ].filter(Boolean).join('\n')
}
