/** The bridge accepts JSON, not JS objects with optional undefined properties.
 * Apply at the shared call boundary, including nested structured schemas. */
export const jsonData = value => JSON.parse(JSON.stringify(value))
