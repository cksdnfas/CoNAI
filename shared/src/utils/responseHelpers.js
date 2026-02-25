"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.successResponse = successResponse;
exports.errorResponse = errorResponse;
exports.paginatedResponse = paginatedResponse;
function successResponse(data, message) {
    const response = {
        success: true,
        data
    };
    if (message) {
        response.message = message;
    }
    return response;
}
function errorResponse(error, details) {
    return {
        success: false,
        error: error instanceof Error ? error.message : error,
        ...(details && { details })
    };
}
function paginatedResponse(items, total, page, limit) {
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
//# sourceMappingURL=responseHelpers.js.map