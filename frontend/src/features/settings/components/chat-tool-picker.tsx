import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCheck, Search, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { groupChatTools, matchesChatTool, type ChatToolGroup } from '@/features/codex-chat/chat-tool-catalog'
import { useI18n } from '@/i18n'
import { listChatTools, type ChatScope } from '@/lib/api-codex-chat'

/** The server's chat-grantable tools, grouped for the picker (cached: the catalog changes only with a deploy). */
export function useChatToolGroups(enabled: boolean) {
  const { t } = useI18n()
  const toolsQuery = useQuery({ queryKey: ['codex-chat-admin-tools'], queryFn: listChatTools, enabled, staleTime: 5 * 60 * 1000 })
  const groups = useMemo(() => groupChatTools(toolsQuery.data ?? [], t), [toolsQuery.data, t])
  return { groups, isPending: toolsQuery.isPending, isError: toolsQuery.isError }
}

/**
 * Pick the tools of a grant: the "every tool" switch, then per scope the groups of tools with a group-level all/none
 * toggle, a Korean-aware search box over labels, names and descriptions, and a plain label per tool (the tool name in the tooltip).
 * `allowlist` null means every tool the scopes allow.
 */
export function ChatToolPicker({ groups, scopes, allowlist, onChange, loading = false }: {
  groups: ChatToolGroup[]
  scopes: ChatScope[]
  allowlist: string[] | null
  onChange: (allowlist: string[] | null) => void
  loading?: boolean
}) {
  const { t } = useI18n()
  const allToolsId = useId()
  const [query, setQuery] = useState('')
  const visibleGroups = groups.filter((group) => scopes.includes(group.scope))
  const names = visibleGroups.flatMap((group) => group.tools.map((tool) => tool.name))
  const selected = allowlist === null ? names : allowlist.filter((name) => names.includes(name))
  const selectedSet = new Set(selected)

  const setMany = (toolNames: string[], checked: boolean) => {
    const next = checked ? [...new Set([...selected, ...toolNames])] : selected.filter((name) => !toolNames.includes(name))
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-10 items-center justify-between gap-3 text-sm">
        <label htmlFor={allToolsId} className="flex-1 cursor-pointer">{t({ ko: '권한 안의 모든 도구 사용', en: 'Use every tool in the scopes' })}</label>
        <Switch id={allToolsId} checked={allowlist === null} onCheckedChange={(all) => onChange(all ? null : names)} />
      </div>
      {allowlist !== null ? (
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input variant="settings" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t({ ko: '도구 찾기', en: 'Find a tool' })} className="pl-9" aria-label={t({ ko: '도구 찾기', en: 'Find a tool' })} />
          </div>
          {scopes.map((scope) => {
            const scopeGroups = visibleGroups.filter((group) => group.scope === scope)
            if (scopeGroups.length === 0) return null
            const scopeNames = scopeGroups.flatMap((group) => group.tools.map((tool) => tool.name))
            const scopeCount = scopeNames.filter((name) => selectedSet.has(name)).length
            return (
              <div key={scope} className="space-y-2">
                <div className="flex items-center justify-between gap-2 border-b border-line pb-1 text-xs font-semibold">
                  <span>{getChatScopeCopy(scope, t).label} <span className="font-normal text-muted-foreground">{scopeCount} / {scopeNames.length}</span></span>
                  <IconButton
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setMany(scopeNames, scopeCount < scopeNames.length)}
                    label={scopeCount < scopeNames.length ? t({ ko: '이 권한의 도구 전부 고르기', en: 'Select every tool in this scope' }) : t({ ko: '이 권한의 도구 전부 빼기', en: 'Clear every tool in this scope' })}
                  >
                    {scopeCount < scopeNames.length ? <CheckCheck /> : <X />}
                  </IconButton>
                </div>
                {scopeGroups.map((group) => {
                  const tools = group.tools.filter((tool) => matchesChatTool(tool, query))
                  if (tools.length === 0) return null
                  const groupNames = group.tools.map((tool) => tool.name)
                  const groupCount = groupNames.filter((name) => selectedSet.has(name)).length
                  return (
                    <div key={group.id} className="space-y-1 pl-3">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>{group.label} <span className="opacity-70">{groupCount} / {groupNames.length}</span></span>
                        <IconButton
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setMany(groupNames, groupCount < groupNames.length)}
                          label={groupCount < groupNames.length ? t({ ko: '이 묶음 전부 고르기', en: 'Select the whole group' }) : t({ ko: '이 묶음 전부 빼기', en: 'Clear the whole group' })}
                        >
                          {groupCount < groupNames.length ? <CheckCheck /> : <X />}
                        </IconButton>
                      </div>
                      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                        {tools.map((tool) => (
                          <Tip key={tool.name} content={<span className="block max-w-72"><span className="block">{tool.description}</span><span className="mt-1 block font-mono text-2xs opacity-70">{tool.name}</span></span>} side="bottom" align="start">
                            <label className="flex min-w-0 cursor-pointer items-center gap-2 py-0.5 text-xs">
                              <Checkbox checked={selectedSet.has(tool.name)} onCheckedChange={(checked) => setMany([tool.name], checked === true)} />
                              <span className="truncate">{tool.label}</span>
                            </label>
                          </Tip>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
          {loading ? <p className="text-xs text-muted-foreground">{t({ ko: '도구 목록을 불러오는 중…', en: 'Loading tools…' })}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
