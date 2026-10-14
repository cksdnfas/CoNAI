# App workbench

Optional, reusable starter for custom app extensions. Build `node scripts/build-plugin.mjs app-workbench`, install the ZIP, then enable it as an app feature. It is not installed by the standard app image.

The same `serverActions` declarations power its buttons, connected-page assistant actions and headless MCP `run_plugin_action`. `pages[].serverActions` automatically supplies the page schemas and host handlers; do not duplicate handlers in the iframe. Native account permissions govern all calls; `appTools` and `capabilities` declarations are optional legacy metadata. The sample reads library groups, workflows and audio projects, creates a new image group and saves a board draft. It never publishes a post automatically.

Extend the manifest with tools discovered through `/api/plugins/app-tools` in the authenticated host. `api.app.tools({ tool: "name" })` returns an available tool's schema. `api.app.call(name, args, requestId)` composes custom browser workflows; `api.app.run(actionId, args, requestId)` invokes the shared server contract. Omitted request IDs are generated once per call; retain an explicit ID when retrying a mutation. `$input` mappings insert validated action input into native tool arguments; constants such as `status: "draft"` cannot be overridden by the caller.

Read operations return native tool results immediately. Button-initiated mutations start persistent jobs immediately. Page-assistant and headless MCP mutations return approval requests; human Apply runs their stored arguments. Status and results remain available after closing the plugin through `get_plugin_action` or `api.app.getRequest`. No approval method is exposed to plugin code or MCP. Existing account permissions and external MCP key permission groups still apply. Native tools not offered to an unbound external key (including private/account-bound services) are not made available by this bridge.

This extension demonstrates app composition, not arbitrary server JavaScript. Its domain logic stays in this package and declared operation mappings. For long app jobs, use the returned native job ID and the corresponding native status/cancel tools.
