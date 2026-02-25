"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanPromptTerm = exports.parsePromptWithLoRAs = exports.removeLoRAWeight = exports.isLoRAModel = exports.refinePrimaryPrompt = exports.convertNAISyntax = exports.splitMultiWordBrackets = exports.deduplicatePrompts = exports.comparePrompts = exports.normalizeSearchTerm = exports.parsePrompt = exports.parsePromptTerms = exports.removeWeights = void 0;
const removeWeights = (prompt) => {
    if (!prompt)
        return '';
    return prompt.replace(/\(([^:)]+):[+-]?[\d.]+\)/g, '$1');
};
exports.removeWeights = removeWeights;
const parsePromptTerms = (prompt) => {
    if (!prompt)
        return [];
    return prompt
        .split(',')
        .map(term => term.trim())
        .filter(term => term.length > 0)
        .map(term => (0, exports.removeWeights)(term));
};
exports.parsePromptTerms = parsePromptTerms;
const parsePrompt = (prompt) => {
    const cleaned = (0, exports.removeWeights)(prompt);
    const terms = (0, exports.parsePromptTerms)(cleaned);
    return {
        original: prompt,
        cleaned,
        terms
    };
};
exports.parsePrompt = parsePrompt;
const normalizeSearchTerm = (searchTerm) => {
    return (0, exports.removeWeights)(searchTerm.trim());
};
exports.normalizeSearchTerm = normalizeSearchTerm;
const comparePrompts = (prompt1, prompt2) => {
    const normalized1 = (0, exports.normalizeSearchTerm)(prompt1);
    const normalized2 = (0, exports.normalizeSearchTerm)(prompt2);
    return normalized1.toLowerCase() === normalized2.toLowerCase();
};
exports.comparePrompts = comparePrompts;
const deduplicatePrompts = (prompts) => {
    const seen = new Set();
    const result = [];
    for (const prompt of prompts) {
        const normalized = (0, exports.normalizeSearchTerm)(prompt).toLowerCase();
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push((0, exports.removeWeights)(prompt));
        }
    }
    return result;
};
exports.deduplicatePrompts = deduplicatePrompts;
const splitMultiWordBrackets = (prompt) => {
    if (!prompt)
        return '';
    let result = prompt;
    const bracketPattern = /([(\[{]+)([^)\]}]+)([)\]}]+)/g;
    result = result.replace(bracketPattern, (match, openBrackets, content, closeBrackets) => {
        if (!content.includes(',')) {
            return match;
        }
        const terms = content.split(',').map((term) => term.trim()).filter((term) => term.length > 0);
        return terms.map((term) => `${openBrackets}${term}${closeBrackets}`).join(', ');
    });
    return result;
};
exports.splitMultiWordBrackets = splitMultiWordBrackets;
const convertNAISyntax = (prompt) => {
    if (!prompt)
        return '';
    let result = prompt;
    const naiPattern = /[^a-zA-Z0-9\s,.:_<>()[\]{}]*\s*([-+]?[\d.]+)::(.*?)::/g;
    result = result.replace(naiPattern, (_match, weight, text) => {
        const trimmedText = text.trim();
        if (!trimmedText)
            return '';
        return `(${trimmedText}:${weight})`;
    });
    return result;
};
exports.convertNAISyntax = convertNAISyntax;
const refinePrimaryPrompt = (prompt) => {
    if (!prompt)
        return '';
    let result = prompt;
    result = (0, exports.convertNAISyntax)(result);
    result = (0, exports.splitMultiWordBrackets)(result);
    result = result.replace(/\s*,\s*,\s*/g, ', ').replace(/,\s*$/, '').trim();
    return result;
};
exports.refinePrimaryPrompt = refinePrimaryPrompt;
const isLoRAModel = (term) => {
    if (!term)
        return false;
    const trimmed = term.trim();
    return trimmed.startsWith('<lora:') && trimmed.includes('>');
};
exports.isLoRAModel = isLoRAModel;
const removeLoRAWeight = (lora) => {
    if (!lora)
        return '';
    return lora.replace(/(<lora:[^:>]+):[^>]+>/, '$1>');
};
exports.removeLoRAWeight = removeLoRAWeight;
const parsePromptWithLoRAs = (prompt) => {
    if (!prompt)
        return { loras: [], terms: [] };
    const loras = [];
    const terms = [];
    const parts = prompt.split(',').map(part => part.trim()).filter(part => part.length > 0);
    for (const part of parts) {
        if ((0, exports.isLoRAModel)(part)) {
            loras.push(part);
        }
        else {
            terms.push(part);
        }
    }
    return { loras, terms };
};
exports.parsePromptWithLoRAs = parsePromptWithLoRAs;
const cleanPromptTerm = (term) => {
    if (!term)
        return '';
    let cleaned = term;
    let prevLength = 0;
    while (cleaned.length !== prevLength) {
        prevLength = cleaned.length;
        cleaned = cleaned.replace(/[()[\]{}]/g, '');
    }
    cleaned = cleaned.replace(/:[+-]?[\d.]+/g, '');
    cleaned = cleaned.replace(/_/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
};
exports.cleanPromptTerm = cleanPromptTerm;
//# sourceMappingURL=promptParser.js.map