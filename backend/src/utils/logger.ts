import fs from 'fs';
import path from 'path';
import util from 'util';
import { runtimePaths } from '../config/runtimePaths';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'VERBOSE';

class LoggerService {
    private logFile: string;
    private logStream: fs.WriteStream | null = null;
    private initialized = false;

    constructor() {
        this.logFile = path.join(runtimePaths.logsDir, `app-${new Date().toISOString().split('T')[0]}.log`);
        this.ensureLogDir();
        this.createLogStream();
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
                    return util.inspect(arg, { depth: null, colors: false });
                }
                return String(arg);
            }).join(' ');
        }

        return `[${timestamp}] [${level}] ${message}${formattedArgs}\n`;
    }

    private writeToFile(message: string) {
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
        const formattedMessage = this.formatMessage(level, message, ...args);

        // Always write to file
        this.writeToFile(formattedMessage);

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
}

export const logger = new LoggerService();
