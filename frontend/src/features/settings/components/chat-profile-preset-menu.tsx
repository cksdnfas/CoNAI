import { useQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { getLlmPresetOptions, type LlmPresetOptionRecord } from '@/lib/api-settings-llm'

/**
 * The LLM presets (Settings → LLM) inside the profile editor: a system prompt preset fills the system prompt, a prompt
 * preset is added as a section of its own.
 */
export function ChatProfilePresetMenu({ open, onSystemPrompt, onSection }: {
  open: boolean
  onSystemPrompt: (preset: LlmPresetOptionRecord) => void
  onSection: (preset: LlmPresetOptionRecord) => void
}) {
  const { t } = useI18n()
  const presetsQuery = useQuery({ queryKey: ['llm-preset-options', 'chat-profile-editor'], queryFn: getLlmPresetOptions, enabled: open, staleTime: 30_000 })
  const systemPresets = presetsQuery.data?.systemPromptPresets ?? []
  const promptPresets = presetsQuery.data?.promptPresets ?? []
  const label = t({ ko: '프리셋 불러오기', en: 'Load a preset' })

  return (
    <DropdownMenu>
      <Tip content={label}>
        <DropdownMenuTrigger asChild>
          <IconButton size="icon-sm" variant="ghost" label={label} tooltip={false} disabled={systemPresets.length + promptPresets.length === 0}>
            <BookOpen />
          </IconButton>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="max-h-96 min-w-60 overflow-y-auto">
        {systemPresets.length > 0 ? (
          <>
            <DropdownMenuLabel>{t({ ko: '시스템 프롬프트로', en: 'As system prompt' })}</DropdownMenuLabel>
            {systemPresets.map((preset) => <DropdownMenuItem key={preset.id} onSelect={() => onSystemPrompt(preset)}>{preset.name}</DropdownMenuItem>)}
          </>
        ) : null}
        {systemPresets.length > 0 && promptPresets.length > 0 ? <DropdownMenuSeparator /> : null}
        {promptPresets.length > 0 ? (
          <>
            <DropdownMenuLabel>{t({ ko: '섹션으로 추가', en: 'Add as a section' })}</DropdownMenuLabel>
            {promptPresets.map((preset) => <DropdownMenuItem key={preset.id} onSelect={() => onSection(preset)}>{preset.name}</DropdownMenuItem>)}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
