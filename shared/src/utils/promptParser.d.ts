export interface ParsedPrompt {
    original: string;
    cleaned: string;
    terms: string[];
}
export declare const removeWeights: (prompt: string) => string;
export declare const parsePromptTerms: (prompt: string) => string[];
export declare const parsePrompt: (prompt: string) => ParsedPrompt;
export declare const normalizeSearchTerm: (searchTerm: string) => string;
export declare const comparePrompts: (prompt1: string, prompt2: string) => boolean;
export declare const deduplicatePrompts: (prompts: string[]) => string[];
export declare const splitMultiWordBrackets: (prompt: string) => string;
export declare const convertNAISyntax: (prompt: string) => string;
export declare const refinePrimaryPrompt: (prompt: string) => string;
export declare const isLoRAModel: (term: string) => boolean;
export declare const removeLoRAWeight: (lora: string) => string;
export declare const parsePromptWithLoRAs: (prompt: string) => {
    loras: string[];
    terms: string[];
};
export declare const cleanPromptTerm: (term: string) => string;
//# sourceMappingURL=promptParser.d.ts.map