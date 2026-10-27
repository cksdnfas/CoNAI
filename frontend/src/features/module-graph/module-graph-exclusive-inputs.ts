import type { ModuleGraphNode } from './module-graph-types'

/** The input key that names a character library setting by id (picked from the library, not typed). */
export const CHARACTER_SETTING_INPUT_KEY = 'character_setting_id'

/**
 * Inputs a node takes one of, never both: a chat profile or a character library setting (generate with a chat
 * generation preset). Giving one a value clears the other on that node.
 */
const EXCLUSIVE_INPUT_PARTNERS: Readonly<Record<string, string>> = {
  profile_id: CHARACTER_SETTING_INPUT_KEY,
  [CHARACTER_SETTING_INPUT_KEY]: 'profile_id',
}

/** The node's input values after setting `portKey`, without the partner input the new value excludes. */
export function setExclusiveNodeInputValue(node: ModuleGraphNode, portKey: string, value: unknown) {
  const values = { ...node.data.inputValues, [portKey]: value }
  const partner = EXCLUSIVE_INPUT_PARTNERS[portKey]
  const hasValue = value !== undefined && value !== null && value !== ''
  const takesBoth = partner && (node.data.module.exposed_inputs ?? []).some((port) => port.key === partner)
  if (hasValue && takesBoth) delete values[partner]
  return values
}
