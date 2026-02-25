"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RATE_LIMITS = exports.TIMEOUTS = exports.PORTS = void 0;
exports.PORTS = {
    BACKEND_DEFAULT: 1666,
    FRONTEND_DEFAULT: 1677,
    VITE_DEV: 5555,
};
exports.TIMEOUTS = {
    SERVER: 60000,
    KEEP_ALIVE: 65000,
    HEADERS: 66000,
    SHUTDOWN: 10000,
    REQUEST: 30000,
};
exports.RATE_LIMITS = {
    WINDOW_MS: 60000,
    MAX_REQUESTS: 1000,
};
//# sourceMappingURL=network.js.map