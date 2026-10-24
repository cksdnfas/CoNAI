import { fromJsonSchema } from '@modelcontextprotocol/server';

// Forwarded tools validate their own schema; the proxy still requires an object.
const OBJECT_ARGUMENTS_VALIDATOR = {
  getValidator: () => (data: unknown) => data && typeof data === 'object' && !Array.isArray(data)
    ? { valid: true as const, data, errorMessage: undefined }
    : { valid: false as const, data: undefined, errorMessage: 'Arguments must be an object.' },
};

export function forwardedToolInputSchema(schema: unknown) {
  return fromJsonSchema(schema as never, OBJECT_ARGUMENTS_VALIDATOR as never);
}
