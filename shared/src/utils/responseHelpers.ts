/**
 * Response helper utilities
 * Standardized API response formatting
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: any;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Create a success response
 */
export function successResponse<T>(data: T, message?: string): ApiResponse<T> {
  const response: ApiResponse<T> = {
    success: true,
    data
  };

  if (message) {
    (response as any).message = message;
  }

  return response;
}

/**
 * Create an error response
 */
export function errorResponse(error: string | Error, details?: any): ApiResponse {
  return {
    success: false,
    error: error instanceof Error ? error.message : error,
    ...(details && { details })
  };
}

/**
 * Create a paginated response
 */
export function paginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  limit: number
): ApiResponse<PaginatedResponse<T>> {
  return {
    success: true,
    data: {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
}
