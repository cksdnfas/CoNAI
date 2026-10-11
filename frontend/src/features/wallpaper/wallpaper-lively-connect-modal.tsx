import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCopy, Download, ExternalLink, KeyRound, Monitor, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { copyTextToClipboard } from '@/lib/clipboard'
import { createWallpaperRuntimeToken, listWallpaperRuntimeTokens, revokeWallpaperRuntimeToken } from '@/lib/api-wallpaper-runtime'
import { buildWallpaperRuntimePath } from './wallpaper-layout-utils'
import { triggerBlobDownload } from '@/lib/api-client'
import { buildLivelyWallpaperPackage, buildWallpaperEnginePackage } from './wallpaper-host-package'
import type { WallpaperLayoutPreset } from './wallpaper-types'

const LIVELY_WALLPAPER_URL = 'https://github.com/rocksdanister/lively'
const TOKENS_QUERY_KEY = ['wallpaper-runtime-tokens'] as const

interface WallpaperLivelyConnectModalProps {
  open: boolean
  onClose: () => void
  presets: WallpaperLayoutPreset[]
  activePresetId: string | null
}

function absoluteUrl(path: string) {
  return typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString()
}

/** Issue view keys (plus quick-run presses) so logged-out kiosk browsers (Lively) can show a wallpaper; list and revoke them. */
export function WallpaperLivelyConnectModal({ open, onClose, presets, activePresetId }: WallpaperLivelyConnectModalProps) {
  const { t, formatDateTime } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [presetId, setPresetId] = useState<string>(activePresetId ?? '')
  const [issued, setIssued] = useState<{ name: string; url: string; presetId: string | null } | null>(null)

  const tokensQuery = useQuery({ queryKey: TOKENS_QUERY_KEY, queryFn: listWallpaperRuntimeTokens, enabled: open })
  const presetById = new Map(presets.map((preset) => [preset.id, preset]))

  const createMutation = useMutation({
    mutationFn: () => createWallpaperRuntimeToken({ name: name.trim(), presetId: presetId || null }),
    onSuccess: (token) => {
      const preset = (token.presetId ? presetById.get(token.presetId) : null) ?? (activePresetId ? presetById.get(activePresetId) : null)
      const path = preset ? buildWallpaperRuntimePath(preset, token.token) : `/#/wallpaper/runtime?k=${encodeURIComponent(token.token)}`
      setIssued({ name: token.name, url: absoluteUrl(path), presetId: preset?.id ?? null })
      setName('')
      void queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY })
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '키를 만들지 못했어.', en: 'Could not create the key.' }), tone: 'error' }),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: number) => revokeWallpaperRuntimeToken(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY }),
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '키를 폐기하지 못했어.', en: 'Could not revoke the key.' }), tone: 'error' }),
  })

  const copy = async (url: string) => {
    try {
      await copyTextToClipboard(url)
      showSnackbar({ message: t({ ko: 'URL을 복사했어.', en: 'Copied the URL.' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: 'URL을 복사하지 못했어.', en: 'Could not copy the URL.' }), tone: 'error' })
    }
  }

  const tokens = tokensQuery.data ?? []

  const downloadPackage = (host: 'lively' | 'wallpaper-engine') => {
    if (!issued) return
    const input = { name: issued.name, url: issued.url, presets, basePreset: issued.presetId ? presetById.get(issued.presetId) ?? null : null, t }
    const { fileName, blob } = host === 'lively' ? buildLivelyWallpaperPackage(input) : buildWallpaperEnginePackage(input)
    triggerBlobDownload(blob, fileName)
  }

  return (
    <Modal open={open} onClose={onClose} widthClassName="max-w-xl" title={t({ ko: 'Lively 연결', en: 'Connect Lively' })}>
      <div className="space-y-5">
        {issued ? (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t({ ko: '{name} · 월페이퍼 URL', en: '{name} · wallpaper URL' }, { name: issued.name })}</div>
            <div className="flex min-w-0 gap-2">
              <Input value={issued.url} readOnly className="font-mono text-xs" aria-label={t({ ko: '월페이퍼 URL', en: 'Wallpaper URL' })} onFocus={(event) => event.currentTarget.select()} />
              <IconButton variant="secondary" size="icon-sm" label={t({ ko: 'URL 복사', en: 'Copy URL' })} onClick={() => void copy(issued.url)}>
                <ClipboardCopy />
              </IconButton>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" className="gap-1.5" title={t({ ko: '설정·오디오·재생 중 곡을 쓰는 Lively 패키지 (zip을 Lively 창에 끌어다 놓기)', en: 'Lively package with settings, audio and now playing (drop the zip on Lively)' })} onClick={() => downloadPackage('lively')}>
                <Download className="size-4" />
                Lively
              </Button>
              <Button type="button" variant="secondary" size="sm" className="gap-1.5" title={t({ ko: 'Wallpaper Engine 웹 프로젝트 (압축을 풀어 myprojects에 넣기)', en: 'Wallpaper Engine web project (unzip into myprojects)' })} onClick={() => downloadPackage('wallpaper-engine')}>
                <Download className="size-4" />
                Wallpaper Engine
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">{t({ ko: '키는 지금만 보여. 보기 전용이고(빠른 실행 버튼만 예외) 언제든 폐기할 수 있어.', en: 'The key is shown only now. It only views (except quick-run buttons) and can be revoked any time.' })}</div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="min-w-0 flex-1"
            placeholder={t({ ko: '기기 이름 (예: 거실 PC)', en: 'Device name (e.g. Living room PC)' })}
            aria-label={t({ ko: '기기 이름', en: 'Device name' })}
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) createMutation.mutate() }}
          />
          <Select className="w-44" aria-label={t({ ko: '보여줄 월페이퍼', en: 'Wallpaper to show' })} value={presetId} onChange={(event) => setPresetId(event.target.value)}>
            <option value="">{t({ ko: '활성 월페이퍼 따라가기', en: 'Follow the active one' })}</option>
            {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </Select>
          <Button type="button" className="gap-1.5" disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
            <Plus className="size-4" />
            {t({ ko: '새 키', en: 'New key' })}
          </Button>
        </div>

        <div>
          <div className="pb-1 text-2xs font-semibold uppercase tracking-overline text-muted-foreground">{t({ ko: '발급한 키', en: 'Issued keys' })}</div>
          {tokens.length === 0 ? (
            <div className="py-3 text-sm text-muted-foreground">{t({ ko: '아직 발급한 키가 없어.', en: 'No keys yet.' })}</div>
          ) : tokens.map((token) => {
            const preset = token.presetId ? presetById.get(token.presetId) : null
            return (
              <div key={token.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
                <Monitor className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{token.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[
                      `${token.prefix}…`,
                      preset ? preset.name : t({ ko: '활성 월페이퍼', en: 'Active wallpaper' }),
                      token.lastUsedAt ? t({ ko: '{time} 사용', en: 'used {time}' }, { time: formatDateTime(token.lastUsedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }) : t({ ko: '아직 안 씀', en: 'never used' }),
                    ].join(' · ')}
                  </div>
                </div>
                <IconButton
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground"
                  label={t({ ko: '{name} 키 폐기', en: 'Revoke {name}' }, { name: token.name })}
                  disabled={revokeMutation.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t({ ko: '키 폐기', en: 'Revoke key' }),
                      description: t({ ko: "'{name}' 키를 폐기할까? 이 키로 연 월페이퍼는 더 이상 데이터를 못 받아.", en: "Revoke '{name}'? Wallpapers opened with it stop receiving data." }, { name: token.name }),
                      confirmLabel: t({ ko: '폐기', en: 'Revoke' }),
                      tone: 'destructive',
                    })
                    if (ok) revokeMutation.mutate(token.id)
                  }}
                >
                  <Trash2 />
                </IconButton>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 border-t border-line pt-3 text-xs text-muted-foreground">
          <KeyRound className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{t({ ko: 'Lively › 월페이퍼 추가 › 웹 페이지에 URL을 붙여 넣어.', en: 'Lively › Add wallpaper › Web page, then paste the URL.' })}</span>
          <a href={LIVELY_WALLPAPER_URL} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium text-secondary-text hover:underline">
            Lively
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </Modal>
  )
}
