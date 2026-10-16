import type { ChatModelOption, ModelRouteKey } from '@/lib/api-codex-chat'

/**
 * The models any chat user can pick, as select options valued by row id: the representative models first (`part`'s own
 * on top, with the model each reaches), a separator, then the connections' models. Ones that cannot be used are greyed out.
 */
export function ChatModelOptionItems({ models, part }: { models: ChatModelOption[]; part?: ModelRouteKey }) {
  const routes = models.filter((model) => model.kind === 'route').sort((a, b) => Number(b.routeKey === part) - Number(a.routeKey === part))
  const rows = models.filter((model) => model.kind !== 'route')
  return (
    <>
      {routes.map((model) => <option key={model.id} value={String(model.id)} disabled={!model.ready}>{model.model ? `${model.label} (${model.model})` : model.label}</option>)}
      {routes.length > 0 && rows.length > 0 ? <option value="__separator" disabled>──────────</option> : null}
      {rows.map((model) => <option key={model.id} value={String(model.id)} disabled={!model.ready}>{model.label}</option>)}
    </>
  )
}
