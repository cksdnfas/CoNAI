import { CircleAlert, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'

type TranslateFn = ReturnType<typeof useI18n>['t']

/** A one-line, human reason for a failed reply; the raw provider text stays available in the popover. */
export function summarizeChatError(error: string, t: TranslateFn) {
  const status = /LLM 요청 실패 \((\d{3})\)/.exec(error)?.[1]
  if (/connection error|연결하지 못했어|ECONNREFUSED|fetch failed|ENOTFOUND|socket hang up/i.test(error)) {
    return t({ ko: 'LLM 서버에 연결하지 못했어', en: 'Could not reach the LLM server' })
  }
  if (/너무 오래 멈춰|timed? ?out/i.test(error)) {
    return t({ ko: 'LLM 응답이 너무 오래 걸렸어', en: 'The LLM took too long to answer' })
  }
  if (status === '401' || status === '403') {
    return t({ ko: 'LLM 연결의 인증이 거부됐어 ({status})', en: 'The LLM connection was refused ({status})' }, { status })
  }
  if (status === '404') {
    return t({ ko: 'LLM 모델이나 주소를 찾지 못했어 (404)', en: 'The LLM model or address was not found (404)' })
  }
  if (status === '429') {
    return t({ ko: 'LLM 요청 한도에 걸렸어 (429)', en: 'The LLM rate limit was hit (429)' })
  }
  if (/context|maximum.*tokens|too long/i.test(error)) {
    return t({ ko: '요청이 모델의 컨텍스트 길이를 넘었어', en: 'The request exceeded the model’s context length' })
  }
  if (status) {
    return t({ ko: 'LLM 서버 오류 ({status})', en: 'LLM server error ({status})' }, { status })
  }
  const firstLine = error.split('\n')[0].trim()
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine || t({ ko: '응답 실패', en: 'Reply failed' })
}

/** A failed reply as a small chip; the popover holds the full error for diagnosis. */
export function ChatErrorChip({ error }: { error: string | null }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const detail = error?.trim() || t({ ko: '응답 실패', en: 'Reply failed' })
  const summary = error ? summarizeChatError(error, t) : t({ ko: '응답 실패', en: 'Reply failed' })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="destructive" size="xs" className="max-w-full">
          <CircleAlert />
          <span className="truncate">{summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(32rem,90vw)] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{t({ ko: '오류 내용', en: 'Error details' })}</span>
          <IconButton
            size="icon-xs"
            variant="ghost"
            label={t({ ko: '복사', en: 'Copy' })}
            onClick={() => {
              void navigator.clipboard?.writeText(detail).then(
                () => showSnackbar({ message: t({ ko: '복사했어.', en: 'Copied.' }) }),
                () => undefined,
              )
            }}
          >
            <Copy />
          </IconButton>
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-low p-2.5 font-mono text-xs leading-relaxed">{detail}</pre>
      </PopoverContent>
    </Popover>
  )
}
