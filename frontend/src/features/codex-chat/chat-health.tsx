import { useCallback, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { CHAT_HEALTH_QUERY_KEY, getChatHealth, type ChatConnectionDownReason, type ChatProfileConnectionDown } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'

type Translate = ReturnType<typeof useI18n>['t']

/**
 * Which profiles cannot chat because their connection is down. The server checks for free (model lists, CLI status)
 * and remembers real requests; a down connection is asked again every minute so a server that comes back clears.
 */
export function useChatHealth(enabled = true) {
  const query = useQuery({
    queryKey: CHAT_HEALTH_QUERY_KEY,
    queryFn: () => getChatHealth(),
    enabled,
    staleTime: 2 * 60_000,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (current) => Object.keys(current.state.data?.profiles ?? {}).length > 0 ? 60_000 : false,
  })
  const profiles = query.data?.profiles
  return useCallback((profileId: number | null | undefined): ChatProfileConnectionDown | null => (
    profileId === null || profileId === undefined ? null : profiles?.[String(profileId)] ?? null
  ), [profiles])
}

/** Check every connection again now (the composer's retry button). */
export function useChatHealthRecheck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => getChatHealth(true),
    onSuccess: (data) => queryClient.setQueryData(CHAT_HEALTH_QUERY_KEY, data),
  })
}

function reasonLabel(reason: ChatConnectionDownReason, t: Translate) {
  switch (reason) {
    case 'unreachable': return t({ ko: '꺼짐', en: 'offline' })
    case 'auth': return t({ ko: '키 오류', en: 'key refused' })
    case 'quota': return t({ ko: '크레딧·한도 초과', en: 'out of credits or rate limited' })
    case 'model_missing': return t({ ko: '모델 없음', en: 'model not found' })
    case 'disabled': return t({ ko: '연결 꺼짐', en: 'connection off' })
    case 'not_installed': return t({ ko: '설치 안 됨', en: 'not installed' })
    case 'not_signed_in': return t({ ko: '로그인 필요', en: 'sign-in needed' })
  }
}

/** `스트라다 꺼짐`: the connection and why it is down. */
export function chatHealthLine(down: ChatProfileConnectionDown, t: Translate) {
  return `${down.connection} ${reasonLabel(down.reason, t)}`
}

/** What a down profile's tooltip says: the connection, why, and when it was checked. */
export function ChatHealthTip({ down }: { down: ChatProfileConnectionDown }) {
  const { t } = useI18n()
  const minutes = Math.floor((Date.now() - new Date(down.checkedAt).getTime()) / 60_000)
  const checked = Number.isFinite(minutes) && minutes >= 1
    ? t({ ko: '{count}분 전 확인', en: 'Checked {count} min ago' }, { count: minutes })
    : t({ ko: '방금 확인', en: 'Just checked' })
  return <span className="flex flex-col">
    <span className="font-semibold">{chatHealthLine(down, t)}</span>
    <span className="text-muted-foreground">{checked} · {t({ ko: '채팅 불가', en: 'Cannot chat' })}</span>
  </span>
}

/** The red dot on a profile's avatar while its connection is down; its tooltip says why. */
export function ChatHealthDot({ down, children, className }: { down: ChatProfileConnectionDown | null; children: ReactNode; className?: string }) {
  const { t } = useI18n()
  if (!down) return <>{children}</>
  return <span className={cn('relative inline-flex shrink-0', className)}>
    {children}
    <Tip content={<ChatHealthTip down={down} />}>
      <span role="img" aria-label={chatHealthLine(down, t)} className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-destructive ring-2 ring-background" />
    </Tip>
  </span>
}
