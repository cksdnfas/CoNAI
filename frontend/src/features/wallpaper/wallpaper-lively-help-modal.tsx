import { ClipboardCopy, ExternalLink, MonitorPlay, Server, Wallpaper } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { useI18n } from '@/i18n'

interface WallpaperLivelyHelpModalProps {
  open: boolean
  runtimeUrl: string
  onClose: () => void
  onCopyRuntimeUrl: () => void
}

const LIVELY_WALLPAPER_URL = 'https://github.com/rocksdanister/lively'

export function WallpaperLivelyHelpModal({ open, runtimeUrl, onClose, onCopyRuntimeUrl }: WallpaperLivelyHelpModalProps) {
  const { t } = useI18n()

  return (
    <Modal
      open={open}
      onClose={onClose}
      widthClassName="max-w-2xl"
      title={t({ ko: 'Lively Wallpaper 연결 도움말', en: 'Connect with Lively Wallpaper' })}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 border-b border-line pb-3">
          <Wallpaper className="h-5 w-5 shrink-0 text-secondary-text" />
          <div className="min-w-0 flex-1 font-semibold text-foreground">Lively Wallpaper</div>
          <a
            href={LIVELY_WALLPAPER_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-secondary-text hover:underline"
          >
            {t({ ko: 'Lively Wallpaper 받기', en: 'Get Lively Wallpaper' })}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <ol className="grid gap-5 sm:grid-cols-3">
          {[
            {
              icon: MonitorPlay,
              title: t({ ko: '1. 월페이퍼 저장', en: '1. Save wallpaper' }),
              body: null,
            },
            {
              icon: ClipboardCopy,
              title: t({ ko: '2. URL 복사', en: '2. Copy URL' }),
              body: null,
            },
            {
              icon: Wallpaper,
              title: t({ ko: '3. Lively에 추가', en: '3. Add to Lively' }),
              body: t({ ko: 'Lively의 월페이퍼 추가에서 웹 페이지를 선택하고 URL을 붙여 넣어.', en: 'In Lively, add a wallpaper, choose Web Page, and paste the URL.' }),
            },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Icon className="mb-3 h-4 w-4 text-secondary-text" />
              <div className="text-sm font-semibold text-foreground">{title}</div>
              {body ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p> : null}
            </li>
          ))}
        </ol>

        {runtimeUrl ? (
          <div className="flex min-w-0 gap-2">
            <Input value={runtimeUrl} readOnly aria-label={t({ ko: '현재 월페이퍼 URL', en: 'Current wallpaper URL' })} onFocus={(event) => event.currentTarget.select()} />
            <IconButton variant="secondary" size="icon-sm" onClick={onCopyRuntimeUrl} label={t({ ko: 'URL 복사', en: 'Copy URL' })}>
              <ClipboardCopy className="h-4 w-4" />
            </IconButton>
          </div>
        ) : null}

        <div className="flex items-start gap-3 border-t border-line pt-4 text-sm text-muted-foreground">
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-secondary-text" />
          <p className="leading-6">
            {t({
              ko: 'Lively가 URL을 계속 불러올 수 있도록 CoNAI 서버를 실행해 둬야 해. 주소의 호스트나 포트가 바뀌면 Lively에 등록한 URL도 갱신해야 해.',
              en: 'Keep the CoNAI server running so Lively can load the URL. Update the URL in Lively if the host or port changes.',
            })}
          </p>
        </div>
      </div>
    </Modal>
  )
}
