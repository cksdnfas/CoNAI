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
export declare function successResponse<T>(data: T, message?: string): ApiResponse<T>;
export declare function errorResponse(error: string | Error, details?: any): ApiResponse;
export declare function paginatedResponse<T>(items: T[], total: number, page: number, limit: number): ApiResponse<PaginatedResponse<T>>;
//# sourceMappingURL=responseHelpers.d.ts.map