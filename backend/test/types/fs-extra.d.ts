// Test-only typing: fs-extra comes from the root workspace without @types/fs-extra.
// Only the node:fs surface it re-exports is used by tests.
declare module 'fs-extra' {
  const fsExtra: typeof import('node:fs')
  export default fsExtra
}
