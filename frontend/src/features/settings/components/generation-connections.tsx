import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SETTINGS_ROW_BY_ID } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { ResourceRow } from '@/components/ui/resource-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { registerTranslationCatalog, useI18n } from '@/i18n'
import { imageGenerationCatalog } from '@/i18n/resources/image-generation'
import { getNaiUserData } from '@/lib/api-image-generation-nai'
import { getGenerationComfyUIServers } from '@/lib/api-image-generation-workflows'
import { NaiAuthModal } from '@/features/image-generation/components/nai-auth-modal'
import { NaiToolbarStatus } from '@/features/image-generation/components/nai-generation-panel-sections'
import { useNaiAuthController } from '@/features/image-generation/components/use-nai-auth-controller'
import { ComfyServerRegistrationModal } from '@/features/image-generation/components/comfy-server-registration-modal'
import { useComfyServerController } from '@/features/image-generation/components/use-comfy-server-controller'
import { SettingsGroup } from './settings-navigation'

registerTranslationCatalog(imageGenerationCatalog)

/**
 * The generation screen's controllers and editors remain the only implementation of connection changes. `comfyExtra`
 * joins the ComfyUI group (the helper custom node download).
 */
export function GenerationConnections({ comfyExtra }: { comfyExtra?: ReactNode }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  // Same cache as the generation screen, so a token connected here shows there at once.
  const naiQuery = useQuery({ queryKey: ['image-generation-nai-user'], queryFn: getNaiUserData, retry: false })
  const nai = useNaiAuthController({ refetchUserData: naiQuery.refetch, showSnackbar })
  const serversQuery = useQuery({ queryKey: ['generation-comfyui-servers', false], queryFn: () => getGenerationComfyUIServers(false) })
  const servers = serversQuery.data ?? []
  const comfy = useComfyServerController({ servers, activeServers: servers.filter((server) => server.is_active !== false), refetchServers: serversQuery.refetch, showSnackbar })
  return <>
    <SettingsGroup id="nai" title={t(SETTINGS_ROW_BY_ID['generation.nai'].label)}>
      <div data-setting-id="generation.nai">
        <p className="mb-3 text-sm text-muted-foreground">{t(SETTINGS_ROW_BY_ID['generation.nai'].description)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => nai.setIsAuthModalOpen(true)}>{t({ ko: 'NovelAI 토큰 연결', en: 'Connect NovelAI token' })}</Button>
          <NaiToolbarStatus
            connected={naiQuery.data?.connected === true}
            tierName={naiQuery.data?.subscription.tierName}
            anlasBalance={naiQuery.data?.anlasBalance}
            opusRemainingPercent={naiQuery.data?.opusRemainingPercent}
            onOpenAuth={() => nai.setIsAuthModalOpen(true)}
          />
        </div>
      </div>
      <NaiAuthModal open={nai.isAuthModalOpen} isSubmitting={nai.isLoggingIn} token={nai.tokenInput} connectionHint={nai.connectionHint} showStatusHint={naiQuery.isError} onClose={() => nai.setIsAuthModalOpen(false)} onTokenChange={nai.setTokenInput} onSubmit={() => void nai.handleSubmit()} />
    </SettingsGroup>
    <SettingsGroup id="comfyui" title={t(SETTINGS_ROW_BY_ID['generation.comfyui'].label)}>
      <div data-setting-id="generation.comfyui">
        <p className="mb-3 text-sm text-muted-foreground">{t(SETTINGS_ROW_BY_ID['generation.comfyui'].description)}</p>
        <Button variant="secondary" onClick={comfy.handleOpenCreateServer}>{t({ ko: '서버 등록', en: 'Register server' })}</Button>
        {servers.map((server) => <ResourceRow key={server.id} name={server.name} onOpen={() => comfy.handleEditServer(server.id)} aside={<>
          <Button variant="ghost" size="sm" onClick={() => void comfy.handleTestComfyServer(server.id)}>{t({ ko: '연결 확인', en: 'Test connection' })}</Button>
          <Button variant="ghost" size="sm" onClick={() => void comfy.handleDeleteServer(server.id)}>{t({ ko: '삭제', en: 'Delete' })}</Button>
        </>} />)}
        {serversQuery.isError ? <p role="alert" className="text-sm text-destructive">{serversQuery.error.message}</p> : null}
      </div>
      {comfyExtra}
      <ComfyServerRegistrationModal open={comfy.isServerModalOpen} form={comfy.comfyServerForm} mode={comfy.editingServerId === null ? 'create' : 'edit'} isSubmitting={comfy.isComfyServerSubmitting} onClose={comfy.handleCloseServerModal} onReset={comfy.resetComfyServerEditor} onFieldChange={comfy.handleComfyServerFieldChange} onSubmit={() => void comfy.handleSubmitComfyServer()} />
    </SettingsGroup>
  </>
}
