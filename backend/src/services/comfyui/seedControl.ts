import { randomInt } from 'crypto';

/** Seed inputs CoNAI rolls per run; other seed-like inputs (`seed_override`, `seed_value`) mean something else. */
export const COMFY_SEED_INPUT_NAMES: ReadonlySet<string> = new Set(['seed', 'noise_seed']);

/** `_meta` key listing seed inputs the ComfyUI editor had on "fixed"; those keep their number. */
export const COMFY_FIXED_SEEDS_META_KEY = 'conai_fixed_seeds';

/** The rule below in words, for tool descriptions and chat page guidance. */
export const COMFY_SEED_RULE = 'ComfyUI seeds (`seed`/`noise_seed`) roll a new random number every run, unless a marked field gives a value ≥ 0 for that run or the node lists it in `_meta.conai_fixed_seeds` (ComfyUI "fixed"). Empty or -1 = new seed each run.';

/** int32-safe: some nodes cap seeds at 2^31-1 and numpy-backed ones reject 2^32 and above. */
const RANDOM_SEED_LIMIT = 2 ** 31;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isComfySeedJsonPath(jsonPath: string) {
  const match = /\.inputs\.([^.]+)$/.exec(jsonPath);
  return Boolean(match && COMFY_SEED_INPUT_NAMES.has(match[1]));
}

/**
 * ComfyUI rolls seeds in its own editor ("control after generate"), so a submitted prompt keeps whatever number it
 * carries and an unchanged prompt comes back from cache. Roll every literal seed per run, except ones a marked field
 * set or the ComfyUI editor had on "fixed". Negative seeds (rgthree's -1) always roll.
 */
export function randomizeComfyWorkflowSeeds(workflow: Record<string, any>, pinnedJsonPaths: ReadonlySet<string>) {
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!isRecord(node) || !isRecord(node.inputs)) continue;
    const fixedSeeds = node._meta?.[COMFY_FIXED_SEEDS_META_KEY];
    for (const name of COMFY_SEED_INPUT_NAMES) {
      const value = node.inputs[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const pinned = pinnedJsonPaths.has(`${nodeId}.inputs.${name}`) || (Array.isArray(fixedSeeds) && fixedSeeds.includes(name));
      if (value >= 0 && pinned) continue;
      node.inputs[name] = randomInt(0, RANDOM_SEED_LIMIT);
    }
  }
}
