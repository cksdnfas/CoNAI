import assert from 'node:assert/strict';

import { WildcardService } from '../services/wildcardService';
import type { WildcardItem, WildcardWithItems } from '../models/Wildcard';

type WildcardServiceInternals = {
  splitChainTokens(text: string): string[];
  parseChains(
    text: string,
    wildcardMap: Map<string, WildcardWithItems>,
    tool: 'general' | 'comfyui' | 'nai' | 'codex'
  ): string;
};

const wildcardService = WildcardService as unknown as WildcardServiceInternals;

function makeItem(wildcardId: number, content: string): WildcardItem {
  return {
    id: wildcardId * 100,
    wildcard_id: wildcardId,
    tool: 'general',
    content,
    weight: 1,
    order_index: 0,
    created_date: '2026-05-13T00:00:00.000Z'
  };
}

function makeChain(
  id: number,
  name: string,
  chainOption: 'replace' | 'append',
  content: string
): WildcardWithItems {
  return {
    id,
    name,
    description: '',
    parent_id: null,
    include_children: 0,
    only_children: 0,
    type: 'chain',
    chain_option: chainOption,
    created_date: '2026-05-13T00:00:00.000Z',
    updated_date: '2026-05-13T00:00:00.000Z',
    items: [makeItem(id, content)]
  };
}

const wildcardMap = new Map<string, WildcardWithItems>([
  ['mood_chain', makeChain(1, 'mood_chain', 'replace', 'bright mood')],
  ['style_chain', makeChain(2, 'style_chain', 'append', 'cinematic lighting')]
]);

assert.deepEqual(
  wildcardService.splitChainTokens('mood_chain, (tag, 0.8, 1.1), [left, right], {a, b}, escaped\\, comma'),
  ['mood_chain', '(tag, 0.8, 1.1)', '[left, right]', '{a, b}', 'escaped\\, comma']
);

assert.equal(
  wildcardService.parseChains('mood_chain, (tag, 0.8, 1.1), [left, right], escaped\\, comma', wildcardMap, 'nai'),
  'bright mood, (tag, 0.8, 1.1), [left, right], escaped\\, comma'
);

assert.equal(
  wildcardService.parseChains('style_chain, (tag, 0.8, 1.1)', wildcardMap, 'comfyui'),
  'style_chain, cinematic lighting, (tag, 0.8, 1.1)'
);

assert.equal(
  wildcardService.parseChains('(mood_chain, literal), mood_chain', wildcardMap, 'general'),
  '(mood_chain, literal), bright mood'
);

console.log('✅ Wildcard chain parsing contracts passed');
