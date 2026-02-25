export declare class ValidationError extends Error {
    constructor(message: string);
}
export declare function validateId(id: string | number, fieldName?: string): number;
export declare function validateRequiredString(value: string | undefined | null, fieldName: string, minLength?: number): string;
export declare function validateEnum<T extends string>(value: string, validValues: readonly T[], fieldName: string): T;
export declare function validateRange(value: number | undefined, min: number, max: number, fieldName: string): void;
export declare function validateMinMax(min: number | undefined, max: number | undefined, fieldName: string): void;
export declare function validateAndParseJSON<T = any>(jsonString: string, fieldName?: string): T;
export declare function validateRegexPattern(pattern: string, fieldName?: string): RegExp;
//# sourceMappingURL=validators.d.ts.map