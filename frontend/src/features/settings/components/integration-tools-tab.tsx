import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { buildApiUrl, triggerBlobDownload } from '@/lib/api-client'
import { getDownloadFileName, readDownloadError } from '@/lib/download-utils'
import { useI18n } from '@/i18n'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'

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
    <RowGroup
      heading={t({ ko: 'ComfyUI 연동', en: 'ComfyUI integration' })}
      actions={
        <Button type="button" size="sm" variant="secondary" onClick={() => void handleDownload()} disabled={isDownloading}>
          <Download className="h-4 w-4" />
          {isDownloading ? t({ ko: '다운로드 중', en: 'Downloading' }) : t({ ko: 'ZIP 다운로드', en: 'Download ZIP' })}
        </Button>
      }
    >
      <SettingRow label={t({ ko: '패키지', en: 'Package' })}>
        <span className="text-sm text-muted-foreground">CoNAI Helper</span>
      </SettingRow>
      <SettingRow label={t({ ko: '대상', en: 'Target' })}>
        <span className="font-mono text-xs text-muted-foreground">ComfyUI custom_nodes</span>
      </SettingRow>
      <SettingRow label={t({ ko: '노드', en: 'Node' })}>
        <span className="text-sm text-muted-foreground">CoNAI Helper: Artifact Output</span>
      </SettingRow>
    </RowGroup>
  )
}
