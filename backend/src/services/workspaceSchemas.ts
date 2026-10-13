import { z } from 'zod'
export const workspaceIdSchema = z.string().regex(/^[a-f0-9]{32}$/)
const target = z.string().min(1).max(1000)
const rev = z.string().regex(/^[a-f0-9]{64}$/)
export const workspaceReadSchema = z.object({ targets: z.array(z.object({ target, offset: z.number().int().min(0).optional(), limit: z.number().int().min(4).max(1048576).optional(), revision: rev.optional() })).min(1).max(32) })
export const workspaceListSchema = z.object({ target: z.string().max(1000).default(''), offset: z.number().int().min(0).max(1000000).default(0) })
export const workspaceSearchSchema = z.object({ query: z.string().trim().min(1).max(500), offset: z.number().int().min(0).max(1000000).default(0) })
export const workspaceApplySchema = z.object({
  requestId: z.string().regex(/^[\w-]{8,100}$/),
  operations: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('mkdir'), target }),
    z.object({ kind: z.literal('write'), target, text: z.string().max(8 * 1024 * 1024), expectedRevision: rev.nullable() }),
    z.object({ kind: z.literal('edit'), target, edits: z.array(z.object({ old_text: z.string().min(1), new_text: z.string(), replace_all: z.boolean().optional() })).min(1).max(100), expectedRevision: rev }),
    z.object({ kind: z.literal('move'), target, destination: target, expectedRevision: rev }),
  ])).min(1).max(100),
})
