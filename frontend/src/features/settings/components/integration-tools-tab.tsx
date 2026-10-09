import { useState } from 'react'
import { Download, RefreshCcw } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { buildApiUrl, triggerBlobDownload } from '@/lib/api-client'
import { getDownloadFileName, readDownloadError } from '@/lib/download-utils'
import { useI18n } from '@/i18n'
import { RowGroup } from '@/components/ui/row-group'

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

  const downloadLabel = isDownloading
    ? t({ ko: '다운로드 중', en: 'Downloading' })
    : t({ ko: 'CoNAI Helper 커스텀 노드 ZIP 다운로드', en: 'Download the CoNAI Helper custom node ZIP' })

  return (
    <RowGroup
      heading={t({ ko: 'ComfyUI 연동', en: 'ComfyUI integration' })}
      actions={
        // Package details live in the button's tooltip instead of static rows.
        <Tip
          className="whitespace-pre-line"
          content={[
            downloadLabel,
            t({ ko: '패키지: CoNAI Helper', en: 'Package: CoNAI Helper' }),
            t({ ko: '대상: ComfyUI custom_nodes', en: 'Target: ComfyUI custom_nodes' }),
            t({ ko: '노드: CoNAI Helper: Artifact Output', en: 'Node: CoNAI Helper: Artifact Output' }),
          ].join('\n')}
        >
          <IconButton size="icon-sm" variant="secondary" tooltip={false} label={downloadLabel} onClick={() => void handleDownload()} disabled={isDownloading}>
            {isDownloading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </IconButton>
        </Tip>
      }
    />
  )
}
