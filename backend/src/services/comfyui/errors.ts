import axios from 'axios';

export function resolveAxiosErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;
    if (typeof responseData === 'string' && responseData.trim().length > 0) {
      return `${error.message} | ${responseData.trim()}`;
    }

    if (responseData && typeof responseData === 'object') {
      try {
        return `${error.message} | ${JSON.stringify(responseData)}`;
      } catch {
        // fall through to the base axios message
      }
    }

    return error.message;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}
