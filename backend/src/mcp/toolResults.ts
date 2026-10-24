export function textResult(value: unknown, extra: Record<string, unknown> = {}) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...extra };
}

export function errorResult(error: unknown, prefix?: string) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text' as const, text: prefix === undefined ? message : `${prefix}: ${message}` }] };
}

export async function runToolResult(action: () => unknown) {
  try { return textResult(await action()); } catch (error) { return errorResult(error); }
}
