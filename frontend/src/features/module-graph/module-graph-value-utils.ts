/** Check whether one inline value should count as user-provided content. */
export function hasMeaningfulValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}
