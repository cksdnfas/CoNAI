import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { buildApiUrl, triggerBlobDownload } from '@/lib/api-client'
import { getDownloadFileName, readDownloadError } from '@/lib/download-utils'
import { useI18n } from '@/i18n'
import { SettingsInsetBlock, SettingsSection, SettingsValueTile } from './settings-primitives'

const CONAI_HELPER_DOWNLOAD_PATH = '/api/settings/resources/comfyui-helper/download'
const CONAI_HELPER_PACKAGE_FILENAME = 'conai-helper-comfyui-custom-node.zip'

export function IntegrationToolsTab() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = async () => {
    if (isDownloading) {
      return
    }

    try {
      setIsDownloading(true)
      const response = await fetch(buildApiUrl(CONAI_HELPER_DOWNLOAD_PATH), {
        credentials: 'include',
        headers: { Accept: 'application/zip' },
      })
      if (!response.ok) {
        throw new Error(await readDownloadError(response))
      }

      const blob = await response.blob()
      const fileName = getDownloadFileName(response.headers.get('Content-Disposition'), CONAI_HELPER_PACKAGE_FILENAME)
      triggerBlobDownload(blob, fileName)
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '다운로드에 실패했어.', en: 'Download failed.' }),
        tone: 'error',
      })
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        heading={t({ ko: 'ComfyUI 연동', en: 'ComfyUI integration' })}
        actions={
          <Button type="button" size="sm" onClick={() => void handleDownload()} disabled={isDownloading}>
            <Download className="h-4 w-4" />
            {isDownloading ? t({ ko: '다운로드 중', en: 'Downloading' }) : t({ ko: 'ZIP 다운로드', en: 'Download ZIP' })}
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <SettingsValueTile label={t({ ko: '패키지', en: 'Package' })} value="CoNAI Helper" />
          <SettingsValueTile label={t({ ko: '대상', en: 'Target' })} value="ComfyUI custom_nodes" />
          <SettingsValueTile label={t({ ko: '노드', en: 'Node' })} value="CoNAI Helper: Artifact Output" />
        </div>

        <SettingsInsetBlock>
          <p className="text-sm text-muted-foreground">
            {t({
              ko: 'ComfyUI에서 생성된 파일이나 폴더 단위 결과물을 CoNAI 아티팩트로 넘기기 위한 커스텀 노드입니다. ZIP을 풀어 ComfyUI custom_nodes 아래에 넣고 ComfyUI를 재시작하세요.',
              en: 'Custom node for passing ComfyUI file or folder outputs to CoNAI artifacts. Extract the ZIP into ComfyUI custom_nodes, then restart ComfyUI.',
            })}
          </p>
        </SettingsInsetBlock>
      </SettingsSection>
    </div>
  )
}
