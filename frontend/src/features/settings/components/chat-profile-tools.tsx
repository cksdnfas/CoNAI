import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import { listChatTools, type ChatScope } from '@/lib/api-codex-chat'
import { CollapsibleRow } from './chat-profile-sections'

function numberOrNull(value: string) {
  const number = Number(value)
  return value.trim() === '' || !Number.isFinite(number) ? null : number
}

/**
 * Folded "advanced" tool options: pick individual tools within the granted scopes (fewer tool schemas = a smaller
 * prompt for small-context models) and, for API LLM profiles, the tool-round and tool-output limits.
 */
export function ChatProfileToolsAdvanced({ open, scopes, allowlist, isLlm, maxToolRounds, toolOutputLimit, onChange }: {
  open: boolean
  scopes: ChatScope[]
  allowlist: string[] | null
  isLlm: boolean
  maxToolRounds: number
  toolOutputLimit: number
  onChange: (patch: { toolAllowlist?: string[] | null; maxToolRounds?: number; toolOutputLimit?: number }) => void
}) {
  const { t } = useI18n()
  const allToolsId = useId()
  const toolsQuery = useQuery({ queryKey: ['codex-chat-admin-tools'], queryFn: listChatTools, enabled: open, staleTime: 5 * 60 * 1000 })
  const tools = (toolsQuery.data ?? []).filter((tool) => tool.scope !== null && scopes.includes(tool.scope as ChatScope))
  const selected = allowlist === null ? tools.map((tool) => tool.name) : allowlist.filter((name) => tools.some((tool) => tool.name === name))

  const toggleTool = (name: string, checked: boolean) => {
    const next = checked ? [...selected, name] : selected.filter((entry) => entry !== name)
    onChange({ toolAllowlist: next })
  }

  return (
    <CollapsibleRow
      title={t({ ko: '고급 설정', en: 'Advanced' })}
      meta={allowlist !== null ? t({ ko: '도구 {count}개 선택', en: '{count} tools picked' }, { count: selected.length }) : null}
    >
      <div className="flex min-h-10 items-center justify-between gap-3 text-sm">
        <label htmlFor={allToolsId} className="flex-1 cursor-pointer">{t({ ko: '권한 안의 모든 도구 사용', en: 'Use every tool in the scopes' })}</label>
        <Switch id={allToolsId} checked={allowlist === null} onCheckedChange={(all) => onChange({ toolAllowlist: all ? null : tools.map((tool) => tool.name) })} />
      </div>
      {allowlist !== null ? (
        <div className="space-y-3">
          {scopes.map((scope) => {
            const scopeTools = tools.filter((tool) => tool.scope === scope)
            if (scopeTools.length === 0) return null
            return (
              <div key={scope} className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground">{getChatScopeCopy(scope, t).label}</div>
                <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {scopeTools.map((tool) => (
                    <Tip key={tool.name} content={tool.description} side="bottom" align="start">
                      <label className="flex min-w-0 cursor-pointer items-center gap-2 text-xs">
                        <Checkbox checked={selected.includes(tool.name)} onCheckedChange={(checked) => toggleTool(tool.name, checked === true)} />
                        <span className="truncate font-mono">{tool.name}</span>
                      </label>
                    </Tip>
                  ))}
                </div>
              </div>
            )
          })}
          {toolsQuery.isPending ? <p className="text-xs text-muted-foreground">{t({ ko: '도구 목록을 불러오는 중…', en: 'Loading tools…' })}</p> : null}
        </div>
      ) : null}
      {isLlm ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t({ ko: '도구 호출 반복 한도', en: 'Tool round limit' })}>
            <NumberStepperInput variant="settings" step={1} min={1} max={20} value={maxToolRounds} onValueCommit={(value) => onChange({ maxToolRounds: numberOrNull(value) ?? maxToolRounds })} />
          </Field>
          <Field label={t({ ko: '도구 결과 최대 길이 (글자)', en: 'Tool result limit (chars)' })}>
            <NumberStepperInput variant="settings" step={1000} min={500} max={100000} value={toolOutputLimit} onValueCommit={(value) => onChange({ toolOutputLimit: numberOrNull(value) ?? toolOutputLimit })} />
          </Field>
        </div>
      ) : null}
    </CollapsibleRow>
  )
}
