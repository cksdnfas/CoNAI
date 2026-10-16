import { useState } from 'react'
import { Loader2, Puzzle } from 'lucide-react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useChatPage } from '@/features/codex-chat/chat-page-context'
import { GenerateActionBarIconButton } from '@/features/image-generation/components/generate-action-bar-icon-button'
import { useActiveGenerationLayoutSurface } from '@/features/image-generation/layout/generation-layout-context'
import { useI18n } from '@/i18n'
import { runPluginGenerationAction } from '@/lib/api-plugins'
import { usePluginGenerationContributions } from './plugin-generation'

/**
 * Plugin buttons next to Generate on the screen's layout surface. A click sends the screen's form to the plugin's
 * server module; the values it answers with are checked against the same fields before the form changes.
 */
export function PluginGenerationActions({ disabled = false }: { disabled?: boolean }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const surface = useActiveGenerationLayoutSurface()
  const page = useChatPage()
  const { buttons } = usePluginGenerationContributions()
  const [running, setRunning] = useState<string | null>(null)
  const shown = surface ? buttons.filter((button) => button.action.surfaces.includes(surface)) : []
  if (!surface || shown.length === 0) return null

  const run = async (button: (typeof shown)[number]) => {
    setRunning(button.key)
    try {
      const fields = page?.form()?.fields.map(({ id, label, type, value }) => ({ id, label, type, value })) ?? []
      const result = await runPluginGenerationAction(button.pluginId, button.action.id, { surface, fields })
      if (result.fill && Object.keys(result.fill).length) {
        if (!page) throw new Error(t({ ko: '이 화면에는 채울 입력이 없어.', en: 'This screen has no inputs to fill.' }))
        page.fillForm(result.fill)
      }
      if (result.message) showSnackbar({ message: result.message, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
    } finally {
      setRunning(null)
    }
  }

  return (
    <>
      {shown.map((button) => (
        <GenerateActionBarIconButton
          key={button.key}
          label={button.action.label === button.pluginName ? button.action.label : `${button.action.label} · ${button.pluginName}`}
          disabled={disabled || running !== null}
          aria-busy={running === button.key || undefined}
          onClick={() => void run(button)}
        >
          {running === button.key ? <Loader2 className="animate-spin" /> : <Puzzle />}
        </GenerateActionBarIconButton>
      ))}
    </>
  )
}
