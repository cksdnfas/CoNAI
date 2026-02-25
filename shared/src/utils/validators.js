"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationError = void 0;
exports.validateId = validateId;
exports.validateRequiredString = validateRequiredString;
exports.validateEnum = validateEnum;
exports.validateRange = validateRange;
exports.validateMinMax = validateMinMax;
exports.validateAndParseJSON = validateAndParseJSON;
exports.validateRegexPattern = validateRegexPattern;
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
function validateId(id, fieldName = 'ID') {
    const numId = typeof id === 'string' ? parseInt(id, 10) : id;
    if (isNaN(numId) || numId < 0 || !Number.isFinite(numId)) {
        throw new ValidationError(`Invalid ${fieldName}`);
    }
    return numId;
}
function validateRequiredString(value, fieldName, minLength = 1) {
    if (!value || typeof value !== 'string') {
        throw new ValidationError(`${fieldName} is required`);
    }
    const trimmed = value.trim();
    if (trimmed.length < minLength) {
        throw new ValidationError(`${fieldName} must be at least ${minLength} character(s)`);
    }
    return trimmed;
}
function validateEnum(value, validValues, fieldName) {
    if (!validValues.includes(value)) {
        throw new ValidationError(`Invalid ${fieldName}. Must be one of: ${validValues.join(', ')}`);
    }
    return value;
}
function validateRange(value, min, max, fieldName) {
    if (value === undefined)
        return;
    if (typeof value !== 'number' || isNaN(value)) {
        throw new ValidationError(`${fieldName} must be a valid number`);
    }
    if (value < min || value > max) {
        throw new ValidationError(`${fieldName} must be between ${min} and ${max}`);
    }
}
function validateMinMax(min, max, fieldName) {
    if (min !== undefined && max !== undefined && min >= max) {
        throw new ValidationError(`${fieldName} min must be less than max`);
    }
}
function validateAndParseJSON(jsonString, fieldName = 'JSON') {
    try {
        return JSON.parse(jsonString);
    }
    catch (error) {
        throw new ValidationError(`Invalid ${fieldName}: must be valid JSON`);
    }
}
function validateRegexPattern(pattern, fieldName = 'Pattern') {
    try {
        return new RegExp(pattern);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new ValidationError(`Invalid ${fieldName}: ${message}`);
    }
}
//# sourceMappingURL=validators.js.map