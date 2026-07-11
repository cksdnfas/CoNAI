import { ClipboardCopy, ExternalLink, MonitorPlay, Server, Wallpaper } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
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
    <SettingsModal
      open={open}
      onClose={onClose}
      widthClassName="max-w-2xl"
      title={t({ ko: 'Lively Wallpaper 연결 도움말', en: 'Connect with Lively Wallpaper' })}
      description={t({
        ko: 'CoNAI 월페이퍼는 웹 페이지 URL로 동작해. Lively Wallpaper 사용을 권장해.',
        en: 'CoNAI wallpapers run as web page URLs. We recommend Lively Wallpaper.',
      })}
    >
      <div className="space-y-5">
        <div className="rounded-sm border border-secondary/35 bg-secondary/8 p-4">
          <div className="flex items-start gap-3">
            <Wallpaper className="mt-0.5 h-5 w-5 shrink-0 text-secondary" />
            <div className="space-y-1">
              <div className="font-semibold text-foreground">Lively Wallpaper</div>
              <p className="text-sm leading-6 text-muted-foreground">
                {t({
                  ko: '무료 오픈소스 앱이야. CoNAI가 제공하는 웹 URL을 그대로 등록하면 이미지와 영상이 포함된 월페이퍼를 재생할 수 있어.',
                  en: 'It is a free, open-source app. Add the web URL from CoNAI to play wallpapers containing images and video.',
                })}
              </p>
              <a
                href={LIVELY_WALLPAPER_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-secondary hover:underline"
              >
                {t({ ko: 'Lively Wallpaper 받기', en: 'Get Lively Wallpaper' })}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>

        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: MonitorPlay,
              title: t({ ko: '1. 월페이퍼 저장', en: '1. Save wallpaper' }),
              body: t({ ko: '편집을 마친 뒤 저장해. 저장된 월페이퍼마다 고유 URL이 생겨.', en: 'Save after editing. Every saved wallpaper gets a unique URL.' }),
            },
            {
              icon: ClipboardCopy,
              title: t({ ko: '2. URL 복사', en: '2. Copy URL' }),
              body: t({ ko: '상단 월페이퍼 URL의 복사 버튼을 눌러 주소를 복사해.', en: 'Use the copy button beside the wallpaper URL.' }),
            },
            {
              icon: Wallpaper,
              title: t({ ko: '3. Lively에 추가', en: '3. Add to Lively' }),
              body: t({ ko: 'Lively의 월페이퍼 추가에서 웹 페이지를 선택하고 URL을 붙여 넣어.', en: 'In Lively, add a wallpaper, choose Web Page, and paste the URL.' }),
            },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-sm border border-border bg-surface-low p-3">
              <Icon className="mb-3 h-4 w-4 text-secondary" />
              <div className="text-sm font-semibold text-foreground">{title}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>

        <div className="space-y-2">
          <div className="text-xs font-semibold tracking-[0.16em] text-secondary uppercase">
            {t({ ko: '현재 월페이퍼 URL', en: 'Current wallpaper URL' })}
          </div>
          {runtimeUrl ? (
            <div className="flex min-w-0 gap-2">
              <Input value={runtimeUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
              <Button type="button" variant="outline" size="icon-sm" onClick={onCopyRuntimeUrl} aria-label={t({ ko: 'URL 복사', en: 'Copy URL' })}>
                <ClipboardCopy className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              {t({ ko: '월페이퍼를 먼저 저장하면 고유 URL이 표시돼.', en: 'Save the wallpaper first to get its unique URL.' })}
            </div>
          )}
        </div>

        <div className="flex items-start gap-3 rounded-sm border border-border bg-surface-low p-3 text-sm text-muted-foreground">
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
          <p className="leading-6">
            {t({
              ko: 'Lively가 URL을 계속 불러올 수 있도록 CoNAI 서버를 실행해 둬야 해. 주소의 호스트나 포트가 바뀌면 Lively에 등록한 URL도 갱신해야 해.',
              en: 'Keep the CoNAI server running so Lively can load the URL. Update the URL in Lively if the host or port changes.',
            })}
          </p>
        </div>
      </div>
    </SettingsModal>
  )
}
