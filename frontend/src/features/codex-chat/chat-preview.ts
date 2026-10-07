/** Parsed before generated markup. Later policies can narrow this policy, never relax it. */
export function isolatedChatPreview(source: string) {
  const policy = "default-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:"
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${source}`
}
