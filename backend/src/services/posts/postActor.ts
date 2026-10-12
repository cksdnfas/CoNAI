import type { Request } from 'express';
import type { McpRequester } from '../../mcp/context';
import { isRequesterAdmin, requesterPermissionKeys } from '../../middleware/featureAccess';
import { getRequesterAccountId, isAdminRequest } from '../../routes/requester-session-helpers';

/**
 * Who acts on posts. A person through the web, or a bot (chat profile `profileId`) running as `accountId` — the
 * account that called it (comments) or saved its routine. Keys are the account's current permission keys.
 */
export type PostActor = {
  accountId: number | null;
  isAdmin: boolean;
  keys: ReadonlySet<string>;
  /** The chat profile writing, when a bot acts. */
  profileId: number | null;
  /** Server supplied; an external MCP key without a profile is still automation. */
  origin?: 'human' | 'mcp' | 'chat' | 'automation';
};

export class PostError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) { super(message); }
}

/** `requirePermission` refreshed the session's keys just before the route ran. */
export function actorFromRequest(req: Request): PostActor {
  return { accountId: getRequesterAccountId(req), isAdmin: isAdminRequest(req), keys: new Set(req.session?.permissionKeys ?? []), profileId: null, origin: 'human' };
}

/** A bot turn's tools act as the run-as account and write as the profile. */
export function actorFromRequester(requester: McpRequester, profileId: number | null): PostActor {
  return { accountId: requester.accountId, isAdmin: isRequesterAdmin(requester), keys: new Set(requesterPermissionKeys(requester)), profileId, origin: profileId === null ? 'mcp' : 'chat' };
}

export const isHumanPostActor = (actor: PostActor) => actor.profileId === null && (actor.origin === undefined || actor.origin === 'human');

export function requireHumanPostActor(actor: PostActor) {
  if (!isHumanPostActor(actor)) throw new PostError('지식 문서의 직접 변경은 사람의 승인으로만 가능해. posts_propose_knowledge로 변경안을 제출해줘.', 403, 'KNOWLEDGE_PROPOSAL_REQUIRED');
}

export const postActorAccountKey = (actor: PostActor) => actor.accountId === null ? 'local-owner' : `account:${actor.accountId}`;

export function requireKey(actor: PostActor, key: string) {
  if (!actor.isAdmin && !actor.keys.has(key)) throw new PostError(`권한이 없어: ${key}`, 403);
}
