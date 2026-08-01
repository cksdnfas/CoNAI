import fs from 'fs';
import path from 'path';
import util from 'util';
import { runtimePaths } from '../config/runtimePaths';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'VERBOSE';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    VERBOSE: 4,
};

const INSPECT_DEPTH = 4;
const MAX_FORMATTED_ARG_LENGTH = 10_000;

/** Resolve the maximum level written to disk (LOG_LEVEL env, default INFO). */
function resolveFileLevelThreshold(): number {
    const configured = (process.env.LOG_LEVEL || '').trim().toUpperCase();
    if (configured && configured in LOG_LEVEL_PRIORITY) {
        return LOG_LEVEL_PRIORITY[configured as LogLevel];
    }
    return LOG_LEVEL_PRIORITY.INFO;
}

class LoggerService {
    private logFile = '';
    private logStream: fs.WriteStream | null = null;
    private initialized = false;
    private currentLogDate = '';
    private readonly fileLevelThreshold = resolveFileLevelThreshold();

    constructor() {
        this.ensureLogDir();
        this.rotateLogFileIfNeeded();
    }

    private ensureLogDir() {
        if (!fs.existsSync(runtimePaths.logsDir)) {
            try {
                fs.mkdirSync(runtimePaths.logsDir, { recursive: true });
            } catch (err) {
                console.error('Failed to create log directory:', err);
            }
        }
    }

    /** Point the stream at today's file, rolling over when the date changes mid-process. */
    private rotateLogFileIfNeeded() {
        const today = new Date().toISOString().split('T')[0];
        if (today === this.currentLogDate && this.logStream) {
            return;
        }

        this.currentLogDate = today;
        this.logFile = path.join(runtimePaths.logsDir, `app-${today}.log`);
        this.logStream?.end();
        this.logStream = null;
        this.createLogStream();
    }

    private createLogStream() {
        try {
            this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
            this.initialized = true;
        } catch (err) {
            console.error('Failed to create log stream:', err);
        }
    }

    private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
        const timestamp = new Date().toISOString();
        let formattedArgs = '';

        if (args.length > 0) {
            formattedArgs = ' ' + args.map(arg => {
                if (arg instanceof Error) {
                    return arg.stack || arg.message;
                }
                if (typeof arg === 'object') {
                    const inspected = util.inspect(arg, { depth: INSPECT_DEPTH, colors: false });
                    return inspected.length > MAX_FORMATTED_ARG_LENGTH
                        ? `${inspected.slice(0, MAX_FORMATTED_ARG_LENGTH)}... [truncated]`
                        : inspected;
                }
                return String(arg);
            }).join(' ');
        }

        return `[${timestamp}] [${level}] ${message}${formattedArgs}\n`;
    }

    private writeToFile(message: string) {
        this.rotateLogFileIfNeeded();

        if (this.initialized && this.logStream) {
            this.logStream.write(message);
        } else {
            // Fallback if stream fails
            try {
                fs.appendFileSync(this.logFile, message);
            } catch (e) {
                // Silent fail to avoid infinite loops if disk is full etc
            }
        }
    }

    public log(level: LogLevel, message: string, ...args: any[]) {
        // Write to file only when the level passes the configured threshold
        if (LOG_LEVEL_PRIORITY[level] <= this.fileLevelThreshold) {
            this.writeToFile(this.formatMessage(level, message, ...args));
        }

        // Write to console based on level
        // VERBOSE and DEBUG are file-only by default in this implementation context
        // unless we want to control it via environment variable, but for this specific task
        // the user wants specific logs to be file-only.
        if (level === 'INFO') {
            console.log(message, ...args);
        } else if (level === 'WARN') {
            console.warn(message, ...args);
        } else if (level === 'ERROR') {
            console.error(message, ...args);
        }
        // DEBUG and VERBOSE are intentionally omitted from console to reduce noise
    }

    public info(message: string, ...args: any[]) {
        this.log('INFO', message, ...args);
    }

    public warn(message: string, ...args: any[]) {
        this.log('WARN', message, ...args);
    }

    public error(message: string, ...args: any[]) {
        this.log('ERROR', message, ...args);
    }

    public debug(message: string, ...args: any[]) {
        this.log('DEBUG', message, ...args);
    }

    public verbose(message: string, ...args: any[]) {
        this.log('VERBOSE', message, ...args);
    }

    /** Flush and close the log stream before a hard process exit. */
    public close(callback?: () => void) {
        const stream = this.logStream;
        this.logStream = null;
        this.initialized = false;

        if (stream) {
            stream.end(callback);
        } else {
            callback?.();
        }
    }
}

export const logger = new LoggerService();
