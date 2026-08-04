import express, { type RequestHandler } from 'express';
import { IMAGE_PROCESSING } from '@conai/shared';

/**
 * Request body size policy.
 *
 * A single global 50MB `express.json` limit meant every endpoint — including anonymous-reachable
 * search routes — could be asked to buffer and synchronously parse 50MB on the one event loop the
 * whole server shares. The limit is therefore scoped per API mount:
 *
 * - `default` — scalar/filter payloads. Measured worst case is far under 1MB.
 * - `bulk` — user-supplied JSON documents (prompt/wildcard imports) and unbounded id arrays.
 *   Bulk selection routes have no explicit element cap, so the byte limit is their real bound.
 * - `media` — routes that legitimately carry base64 data URLs inside the JSON body
 *   (image editor canvas saves, NAI img2img/vibe/character references, ComfyUI image fields,
 *   graph workflows whose node input values embed data URLs). These keep the historical limit.
 *
 * Every tier is environment-overridable so an operator can restore the previous behaviour
 * (`JSON_BODY_LIMIT_MB=50`) without a code change.
 */
export type RequestBodyLimitTier = 'default' | 'bulk' | 'media';

/** Parse a positive numeric env override, ignoring blank/invalid values. */
function resolveEnvLimitMb(envName: string, fallbackMb: number): number {
  const rawValue = process.env[envName];
  if (rawValue === undefined) {
    return fallbackMb;
  }

  const parsed = Number(rawValue.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
}

/** Resolve the configured body limit (MB) for each tier, honoring env overrides. */
export function resolveRequestBodyLimitsMb(): Record<RequestBodyLimitTier, number> {
  return {
    // 실측: 그래프 저장 446KB, ComfyUI workflow_json 최대 ~2MB. 5MB는 그 위로 10배 여유.
    default: resolveEnvLimitMb('JSON_BODY_LIMIT_MB', 5),
    // 프롬프트/와일드카드 임포트 문서와 상한 없는 대량 선택 배열(해시 1개당 ~52B)을 흡수한다.
    bulk: resolveEnvLimitMb('BULK_JSON_BODY_LIMIT_MB', 25),
    // base64 data URL이 JSON 바디에 그대로 실리는 경로. 기존 동작(50MB)을 그대로 유지한다.
    media: resolveEnvLimitMb('MEDIA_JSON_BODY_LIMIT_MB', IMAGE_PROCESSING.MAX_FILE_SIZE_MB),
  };
}

/**
 * Mount paths that need more than the default limit, longest-prefix first.
 * Anything not listed here falls back to `default`, so a new route is bounded by construction.
 */
const REQUEST_BODY_LIMIT_TIER_BY_MOUNT: ReadonlyArray<readonly [string, RequestBodyLimitTier]> = [
  // --- media: JSON body carries base64 data URLs ---
  // 캔버스 원본 해상도 PNG data URL (image-editor.routes.ts save/save-output/save-webp)
  ['/api/image-editor', 'media'],
  // img2img image·inpaint mask·vibe encoded·character reference (routes/nai/generate.ts, store.ts)
  ['/api/nai', 'media'],
  // request_payload 안의 novelai/codex/comfyui 이미지 입력 (queue-action-routes.ts)
  ['/api/generation-queue', 'media'],
  // graph_json 노드 inputValues 및 실행 input_values 의 data URL (graph-workflows/*)
  ['/api/graph-workflows', 'media'],
  // NAI/Codex 스냅샷에서 유입되는 image/mask data URL (moduleDefinitions.ts)
  ['/api/module-definitions', 'media'],
  // prompt_data ComfyUIImageFieldValue.dataUrl (public-workflows.routes.ts queue)
  ['/api/public-workflows', 'media'],
  // /:id/generate 의 prompt_data image 필드 + source_image (workflows/execution.routes.ts)
  ['/api/workflows', 'media'],

  // --- bulk: user JSON documents and uncapped id arrays ---
  // bulk 삭제/배치 태깅의 compositeHashes·image_ids (개수 상한 없음)
  ['/api/images', 'bulk'],
  // 그룹 이미지 bulk add/remove 의 composite_hashes (개수 상한 없음)
  ['/api/groups', 'bulk'],
  // batch-assign/resolve-groups 프롬프트 배열
  ['/api/prompt-collection', 'bulk'],
  // 프롬프트 그룹 라이브러리 통째 임포트
  ['/api/prompt-groups', 'bulk'],
  ['/api/negative-prompt-groups', 'bulk'],
  // 와일드카드 항목 대량 저장
  ['/api/wildcards', 'bulk'],
  // appearance presetSlots / wallpaperLayoutPresets 묶음 저장
  ['/api/settings', 'bulk'],
  // 모델 목록 등 대형 드롭다운 항목
  ['/api/custom-dropdown-lists', 'bulk'],
];

/** Resolve the body limit tier for one request path. Unknown paths stay on the default tier. */
export function resolveRequestBodyLimitTier(pathname: string): RequestBodyLimitTier {
  // Express mount matching is case-insensitive by default; mirror that so a differently cased
  // path cannot be routed to a media endpoint while being parsed with the default limit.
  const normalizedPath = pathname.toLowerCase();

  for (const [mountPath, tier] of REQUEST_BODY_LIMIT_TIER_BY_MOUNT) {
    if (normalizedPath === mountPath || normalizedPath.startsWith(`${mountPath}/`)) {
      return tier;
    }
  }

  return 'default';
}

/** All mount paths that were granted a non-default tier, for startup logging and contracts. */
export function listRequestBodyLimitMounts(): ReadonlyArray<readonly [string, RequestBodyLimitTier]> {
  return REQUEST_BODY_LIMIT_TIER_BY_MOUNT;
}

/**
 * Build the tiered JSON/urlencoded body parsers.
 * The parsers are created once per tier and dispatched per request, so no parser instance is
 * rebuilt on the hot path.
 */
export function createTieredBodyParsers(): { json: RequestHandler; urlencoded: RequestHandler } {
  const limitsMb = resolveRequestBodyLimitsMb();
  const tiers = Object.keys(limitsMb) as RequestBodyLimitTier[];

  const jsonParsers = {} as Record<RequestBodyLimitTier, RequestHandler>;
  const urlencodedParsers = {} as Record<RequestBodyLimitTier, RequestHandler>;

  for (const tier of tiers) {
    const limit = `${limitsMb[tier]}mb`;
    // strict:false is preserved from the previous global parser so top-level scalars keep parsing.
    jsonParsers[tier] = express.json({ limit, strict: false });
    urlencodedParsers[tier] = express.urlencoded({ extended: true, limit });
  }

  return {
    json: (req, res, next) => jsonParsers[resolveRequestBodyLimitTier(req.path)](req, res, next),
    urlencoded: (req, res, next) => urlencodedParsers[resolveRequestBodyLimitTier(req.path)](req, res, next),
  };
}
