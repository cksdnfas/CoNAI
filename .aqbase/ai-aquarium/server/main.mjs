import { createVillage } from './village/village.mjs'

/** How often the always-on village loop steps. */
const TICK_MS = 500

/** The plugin's server module (`server.entry`): the village runs here whether or not a page is open. */
export function activate(conai) {
  const village = createVillage(conai)
  // Created at startup, so the loop's calls run as the enabling account rather than any page's request.
  setInterval(() => { village.tick().catch(error => conai.warn('village tick failed:', error)) }, TICK_MS)
}
