export function cleanPrompt(prompt: string | undefined | null): string {
  if (!prompt) {
    return ''
  }

  const parts = prompt.split(',')

  const cleanedParts = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  return cleanedParts.join(', ')
}

export function isPromptEmpty(prompt: string | undefined | null): boolean {
  const cleaned = cleanPrompt(prompt)
  return cleaned.length === 0
}

export function cleanPrompts<T extends Record<string, string | undefined | null>>(prompts: T): T {
  const result = { ...prompts } as T

  for (const key in result) {
    if (typeof result[key] === 'string') {
      result[key] = cleanPrompt(result[key] as string) as T[Extract<keyof T, string>]
    }
  }

  return result
}
