import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface SourceReaderOptions {
  normalizeLineEndings?: boolean
}

interface ExtractFunctionOptions {
  requireExport?: boolean
}

/** Create a UTF-8 source reader rooted at one directory without adding a test harness. */
export function createSourceReader(baseDirectory: string | URL, options: SourceReaderOptions = {}) {
  const basePath = baseDirectory instanceof URL ? fileURLToPath(baseDirectory) : baseDirectory
  return (relativePath: string) => {
    const contents = readFileSync(resolve(basePath, relativePath), 'utf8')
    return options.normalizeLineEndings ? contents.replace(/\r\n/g, '\n') : contents
  }
}

/** Extract one declared function through its balanced brace boundary for legacy structural contracts. */
export function extractFunction(sourceText: string, functionName: string, options: ExtractFunctionOptions = {}) {
  const exportedDeclarations = [
    `export async function ${functionName}`,
    `export function ${functionName}`,
  ]
  const declarationStarts = [
    ...exportedDeclarations,
    `async function ${functionName}`,
    `function ${functionName}`,
  ]
    .filter((declaration) => !options.requireExport || exportedDeclarations.includes(declaration))
    .map((declaration) => sourceText.indexOf(declaration))
    .filter((index) => index >= 0)
  const start = declarationStarts.length > 0 ? Math.min(...declarationStarts) : -1
  assertContract(start >= 0, options.requireExport ? `${functionName} export must exist` : `${functionName} function must exist`)

  const signatureStart = sourceText.indexOf('(', start)
  assertContract(signatureStart >= 0, `${functionName} parameter signature must exist`)

  let signatureDepth = 0
  let signatureEnd = -1
  for (let index = signatureStart; index < sourceText.length; index += 1) {
    const char = sourceText[index]
    if (char === '(') signatureDepth += 1
    else if (char === ')') {
      signatureDepth -= 1
      if (signatureDepth === 0) {
        signatureEnd = index
        break
      }
    }
  }
  assertContract(signatureEnd >= 0, `${functionName} parameter signature must be closed`)

  const bodyStart = sourceText.indexOf('{', signatureEnd)
  assertContract(bodyStart >= 0, `${functionName} body must exist`)

  let depth = 0
  for (let index = bodyStart; index < sourceText.length; index += 1) {
    const char = sourceText[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return sourceText.slice(start, index + 1)
    }
  }

  throw new Error(`${functionName} body must be closed`)
}

export function assertContract(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

export function reportVerificationSuccess(message: string) {
  console.log(message)
}

// Root scripts are CommonJS-scoped while frontend verify scripts are ESM-scoped; keep one interop object over the same four APIs.
export default {
  assertContract,
  createSourceReader,
  extractFunction,
  reportVerificationSuccess,
}
