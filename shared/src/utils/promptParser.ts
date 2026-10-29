/**
 * Prompt parsing utilities
 * Handles weight removal, prompt cleaning, and term parsing
 *
 * This module is shared between backend and frontend to ensure consistent
 * prompt parsing behavior across the entire application.
 */

const WEIGHT_NUMBER_SOURCE = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const WEIGHTED_PARENTHESES_PATTERN = new RegExp(`\\(([^()]+(?:[^()]*)?):${WEIGHT_NUMBER_SOURCE}\\)`, 'g');
const WEIGHTED_SQUARE_BRACKETS_PATTERN = new RegExp(`\\[([^\\[\\]]+(?:[^\\[\\]]*)?):${WEIGHT_NUMBER_SOURCE}\\]`, 'g');
const WEIGHTED_CURLY_BRACKETS_PATTERN = new RegExp(`\\{([^{}]+(?:[^{}]*)?):${WEIGHT_NUMBER_SOURCE}\\}`, 'g');

/**
 * Remove explicit prompt weights while preserving non-weight bracket text.
 * Examples:
 *   (대한민국:1.2) -> 대한민국
 *   (artist:yuuinami:1.23) -> artist:yuuinami
 *   stocking_(psg) -> stocking_(psg) (no change)
 */
export const removeWeights = (prompt: string): string => {
  if (!prompt) return '';

  let cleaned = prompt;
  let previous = '';

  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned
      .replace(WEIGHTED_PARENTHESES_PATTERN, '$1')
      .replace(WEIGHTED_SQUARE_BRACKETS_PATTERN, '$1')
      .replace(WEIGHTED_CURLY_BRACKETS_PATTERN, '$1');
  }

  return cleaned;
};

/**
 * Normalize search term for consistent search behavior
 * Removes weights for search matching
 */
export const normalizeSearchTerm = (searchTerm: string): string => {
  return removeWeights(searchTerm.trim());
};

// =============================================================================
// Prompt tokenizer
// =============================================================================

/** One prompt term: `display` keeps its own emphasis syntax, `value` is the plain tag for search and collection. */
export interface PromptTerm {
  display: string;
  value: string;
}

export interface TokenizedPrompt {
  /** Raw `<lora:...>` tags in prompt order. */
  loras: string[];
  terms: PromptTerm[];
}

type PromptBracket = '(' | '[' | '{';
/** `nai` is NovelAI numeric emphasis: `1.2::text::`. */
type PromptGroupBracket = PromptBracket | 'nai';

interface PromptGroupNode {
  type: 'group';
  bracket: PromptGroupBracket;
  children: PromptNode[];
  weight?: string;
}

type PromptNode = { type: 'text'; text: string } | { type: 'separator' } | PromptGroupNode;

const CLOSING_BRACKET: Record<PromptBracket, string> = { '(': ')', '[': ']', '{': '}' };
const OPENING_BRACKET: Record<string, PromptBracket | undefined> = { ')': '(', ']': '[', '}': '{' };
const ESCAPABLE_CHARACTERS = '()[]{}\\';
const SEPARATOR_NODE: PromptNode = { type: 'separator' };
/** Bounds recursion and closer lookup for crafted prompts with thousands of nested brackets. */
const MAX_GROUP_DEPTH = 32;
const TRAILING_WEIGHT_PATTERN = new RegExp(`:\\s*(${WEIGHT_NUMBER_SOURCE})\\s*$`);
const NAI_WEIGHT_OPENER_PATTERN = new RegExp(`(${WEIGHT_NUMBER_SOURCE})::`, 'y');
const LORA_TAG_PATTERN = /<lora:[^>,\n\r]*>/iy;
/** Danbooru emoticon tags such as `:)` or `;(` whose brackets are literal text. */
const EMOTICON_TERM_PATTERN = /^>?[:;=]-?[()[\]]$/;
/** Leftover weight syntax without a tag, such as `:0.5`. Integers are kept for emoticon tags like `:3`. */
const NOISE_TERM_PATTERN = /^:+\s*(?:[+-]?\d*\.\d+)?$/;
const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}_.]/u;

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER_PATTERN.test(character);
}

function isSeparatorCharacter(character: string): boolean {
  return character === ',' || character === '\n' || character === '\r';
}

function findSeparatorIndex(prompt: string, start: number): number {
  let index = start;
  while (index < prompt.length && !isSeparatorCharacter(prompt[index])) {
    index += 1;
  }
  return index;
}

/** Remove a trailing `:weight` from the group's last text and return the weight. */
function takeTrailingWeight(group: PromptGroupNode): string | undefined {
  const last = group.children[group.children.length - 1];
  if (!last || last.type !== 'text') {
    return undefined;
  }

  const match = TRAILING_WEIGHT_PATTERN.exec(last.text);
  if (!match) {
    return undefined;
  }

  last.text = last.text.slice(0, match.index);
  return match[1];
}

/** Build the bracket tree of a prompt and collect its LoRA tags. */
function parsePromptNodes(prompt: string, loras: string[]): PromptNode[] {
  const root: PromptGroupNode = { type: 'group', bracket: '(', children: [] };
  const stack: PromptGroupNode[] = [root];
  let text = '';
  let atTermStart = true;

  const current = () => stack[stack.length - 1];
  const flushText = () => {
    if (text) {
      current().children.push({ type: 'text', text });
      text = '';
    }
  };
  const pushSeparator = () => {
    flushText();
    current().children.push(SEPARATOR_NODE);
    atTermStart = true;
  };
  const openGroup = (bracket: PromptGroupBracket, weight?: string) => {
    flushText();
    // Openers past the depth limit are dropped; their closers then fall through as orphans.
    if (stack.length > MAX_GROUP_DEPTH) {
      return;
    }
    const group: PromptGroupNode = { type: 'group', bracket, children: [], weight };
    current().children.push(group);
    stack.push(group);
  };
  // An unclosed group keeps its content but loses its brackets. It is always its parent's last child.
  const dissolveTopGroup = () => {
    const group = stack.pop() as PromptGroupNode;
    takeTrailingWeight(group);
    const parent = current();
    parent.children.pop();
    for (const child of group.children) {
      parent.children.push(child);
    }
  };
  const closeGroup = (bracket: PromptGroupBracket) => {
    flushText();
    let index = stack.length - 1;
    while (index > 0 && stack[index].bracket !== bracket) {
      index -= 1;
    }

    if (index === 0) {
      // A closer without an opener is dropped together with the `:weight` dangling before it.
      takeTrailingWeight(current());
      return;
    }

    while (stack.length - 1 > index) {
      dissolveTopGroup();
    }

    const group = stack.pop() as PromptGroupNode;
    if (group.bracket !== 'nai') {
      group.weight = takeTrailingWeight(group);
    }
  };

  let index = 0;
  while (index < prompt.length) {
    const character = prompt[index];
    const next = prompt[index + 1];

    if (character === '\\' && next !== undefined && ESCAPABLE_CHARACTERS.includes(next)) {
      text += next;
      atTermStart = false;
      index += 2;
      continue;
    }

    if (isSeparatorCharacter(character)) {
      pushSeparator();
      index += 1;
      continue;
    }

    if (character === '<') {
      LORA_TAG_PATTERN.lastIndex = index;
      const lora = LORA_TAG_PATTERN.exec(prompt);
      if (lora) {
        loras.push(lora[0]);
        pushSeparator();
        index += lora[0].length;
        continue;
      }
    }

    if (character === 'B' && prompt.startsWith('BREAK', index) && !isWordCharacter(prompt[index - 1]) && !isWordCharacter(prompt[index + 5])) {
      pushSeparator();
      index += 5;
      continue;
    }

    if (atTermStart && ':;=>'.includes(character)) {
      const end = findSeparatorIndex(prompt, index);
      const candidate = prompt.slice(index, end).trim();
      if (EMOTICON_TERM_PATTERN.test(candidate)) {
        text += candidate;
        atTermStart = false;
        index = end;
        continue;
      }
    }

    if (!isWordCharacter(prompt[index - 1])) {
      NAI_WEIGHT_OPENER_PATTERN.lastIndex = index;
      const opener = NAI_WEIGHT_OPENER_PATTERN.exec(prompt);
      if (opener) {
        openGroup('nai', opener[1]);
        index += opener[0].length;
        continue;
      }
    }

    if (character === ':' && next === ':' && stack.some((group) => group.bracket === 'nai')) {
      closeGroup('nai');
      index += 2;
      continue;
    }

    if (character === '(' || character === '[' || character === '{') {
      openGroup(character);
      index += 1;
      continue;
    }

    const opening = OPENING_BRACKET[character];
    if (opening) {
      closeGroup(opening);
      index += 1;
      continue;
    }

    text += character;
    if (character.trim()) {
      atTermStart = false;
    }
    index += 1;
  }

  flushText();
  while (stack.length > 1) {
    dissolveTopGroup();
  }

  return root.children;
}

function containsSeparator(nodes: PromptNode[]): boolean {
  return nodes.some((node) => node.type === 'separator' || (node.type === 'group' && containsSeparator(node.children)));
}

function renderGroup(group: PromptGroupNode, inner: string, withWeight: boolean): string {
  if (group.bracket === 'nai') {
    return withWeight ? `${group.weight}::${inner}::` : inner;
  }

  const weight = withWeight && group.weight !== undefined ? `:${group.weight}` : '';
  return `${group.bracket}${inner}${weight}${CLOSING_BRACKET[group.bracket]}`;
}

/** Render separator-free nodes that stay inside one term. */
function renderInlineNodes(nodes: PromptNode[], withWeight: boolean): string {
  let rendered = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      rendered += node.text;
    } else if (node.type === 'group') {
      const inner = renderInlineNodes(node.children, withWeight);
      if (inner.trim()) {
        rendered += renderGroup(node, inner, withWeight);
      }
    }
  }
  return rendered;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function collectPromptTerms(nodes: PromptNode[], wrappers: PromptGroupNode[], terms: PromptTerm[]): void {
  let display = '';
  let value = '';

  const flush = () => {
    const plainValue = collapseWhitespace(value);
    if (plainValue && !NOISE_TERM_PATTERN.test(plainValue)) {
      terms.push({
        display: wrappers.reduceRight((inner, group) => renderGroup(group, inner, true), collapseWhitespace(display)),
        value: plainValue,
      });
    }
    display = '';
    value = '';
  };

  for (const node of nodes) {
    if (node.type === 'separator') {
      flush();
    } else if (node.type === 'text') {
      display += node.text;
      value += node.text;
    } else if (node.weight === undefined && node.bracket === '(' && value.trim() && !containsSeparator(node.children)) {
      // An unweighted parenthesis after text is part of the tag, e.g. `nahida (genshin impact)`.
      display += renderInlineNodes([node], true);
      value += renderInlineNodes([node], false);
    } else {
      // Emphasis applies to every term inside the group, across commas too: `(a, b:1.2)` → `(a:1.2)`, `(b:1.2)`.
      flush();
      collectPromptTerms(node.children, [...wrappers, node], terms);
    }
  }

  flush();
}

/**
 * Split a prompt into terms and LoRA tags.
 * Understands A1111/ComfyUI emphasis `(a, b:1.2)` and `[a]`, NovelAI `{a}` and `1.2::a::`, escaped brackets,
 * `BREAK` and newlines. Broken syntax degrades to plain terms: closers without an opener and their dangling
 * `:weight` are dropped, unclosed groups lose their brackets and empty groups disappear.
 *
 * Example:
 *   `best quality, :0.5) (realistic, :1.2) <lora:a:1> 1girl` → best quality, (realistic:1.2), 1girl + <lora:a:1>
 */
export const tokenizePrompt = (prompt: string | null | undefined): TokenizedPrompt => {
  const loras: string[] = [];
  const terms: PromptTerm[] = [];
  if (prompt) {
    collectPromptTerms(parsePromptNodes(prompt, loras), [], terms);
  }
  return { loras, terms };
};

// =============================================================================
// STEP 3: LoRA and Term Cleaning Functions
// =============================================================================

/**
 * Remove weight from LoRA model notation
 *
 * Examples:
 *   <lora:Model_Name:0.8> → <lora:Model_Name>
 *   <lora:Model_Name> → <lora:Model_Name> (no change)
 */
export const removeLoRAWeight = (lora: string): string => {
  if (!lora) return '';

  // Pattern: <lora:name:weight> → <lora:name>
  return lora.replace(/(<lora:[^:>]+):[^>]+>/, '$1>');
};

