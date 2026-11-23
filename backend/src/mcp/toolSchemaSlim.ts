/** Keys whose value is a map of names to schemas: the names are data, never keywords to drop. */
const SCHEMA_MAPS = new Set(['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas']);
/** Keys whose value is data, not a schema. */
const VERBATIM = new Set(['enum', 'const', 'default', 'examples', 'required']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A tool's input schema as a chat model reads it: every constraint that tells the model something, without the parts
 * that tell it nothing — the dialect line, the safe-integer bounds zod writes on every integer, the long pattern beside
 * `format: "uuid"`, and "any string key, any value" on free-form objects. These go out with every request (tool
 * definitions) and with every opened catalog schema. The server still validates calls against the full schema.
 */
export function slimToolSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((entry) => slimToolSchema(entry)) as T;
  if (!isPlainObject(schema)) return schema;
  const slim: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    if (key === 'maximum' && value === Number.MAX_SAFE_INTEGER) continue;
    if (key === 'minimum' && value === Number.MIN_SAFE_INTEGER) continue;
    if (key === 'pattern' && schema.format === 'uuid') continue;
    if (key === 'propertyNames' && isPlainObject(value) && Object.keys(value).length === 1 && value.type === 'string') continue;
    if (key === 'additionalProperties' && isPlainObject(value) && Object.keys(value).length === 0) continue;
    if (VERBATIM.has(key)) slim[key] = value;
    else if (SCHEMA_MAPS.has(key) && isPlainObject(value)) slim[key] = Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, slimToolSchema(entry)]));
    else slim[key] = slimToolSchema(value);
  }
  return slim as T;
}
