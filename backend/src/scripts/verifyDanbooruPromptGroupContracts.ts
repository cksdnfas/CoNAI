import { equal } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');
}

const danbooruBrowserServiceSource = source('services/danbooruBrowserService.ts');
const wildcardServiceSource = source('services/wildcardService.ts');

equal(
  danbooruBrowserServiceSource.includes('expandPromptGroups(text: string): string'),
  true,
  'Danbooru browser service must expose prompt group expansion',
);
equal(
  danbooruBrowserServiceSource.includes("text.replace(/__([^_\\r\\n][^\\r\\n]*?)__/g"),
  true,
  '__Group__ syntax should be parsed by a dedicated group token pattern',
);
equal(
  danbooruBrowserServiceSource.includes('parseCompactCount(usageMatch[1])'),
  true,
  'usage filters like <1k> and <-100> must use compact count parsing',
);
equal(
  danbooruBrowserServiceSource.includes('pickRange = {'),
  true,
  'prompt group syntax must parse exact and ranged pick counts',
);
equal(
  danbooruBrowserServiceSource.includes('ORDER BY RANDOM()'),
  true,
  'prompt group expansion should randomly select tags from the group',
);
equal(
  danbooruBrowserServiceSource.includes('const hasDb = this.hasAvailableDb()'),
  true,
  'prompt group expansion should still consume __Group__ tokens when the Danbooru DB is unavailable',
);
equal(
  danbooruBrowserServiceSource.includes("return tags.length > 0 ? tags.join(', ') : '';"),
  true,
  'unresolved prompt groups should be removed instead of preserved literally',
);
equal(
  danbooruBrowserServiceSource.includes('tags.post_count >= ?'),
  true,
  'prompt group expansion should support minimum usage filters',
);
equal(
  danbooruBrowserServiceSource.includes('tags.post_count <= ?'),
  true,
  'prompt group expansion should support maximum usage filters',
);

const groupExpansionIndex = wildcardServiceSource.indexOf('danbooruBrowserService.expandPromptGroups(result)');
const chainExpansionIndex = wildcardServiceSource.indexOf('this.parseChains(result, wildcardMap, tool)');
const wildcardExpansionIndex = wildcardServiceSource.indexOf('this.parseRecursive(result, wildcardMap, tool, new Set())');
const compactPromptIndex = wildcardServiceSource.indexOf('return this.compactPromptSegments(result)');
equal(groupExpansionIndex >= 0, true, 'wildcard service must call Danbooru group expansion');
equal(
  groupExpansionIndex < chainExpansionIndex && chainExpansionIndex < wildcardExpansionIndex,
  true,
  'runtime priority must be __ groups > preprocess chains > ++ wildcards',
);
equal(
  compactPromptIndex > wildcardExpansionIndex,
  true,
  'failed __ and ++ prompt segments should be compacted out after wildcard expansion',
);

console.log('Danbooru prompt group contracts verified');
