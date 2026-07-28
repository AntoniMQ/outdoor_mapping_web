type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const REDACT = [/api[-_]?key/i, /authorization/i, /token/i, /secret/i, /password/i];

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACT.some((r) => r.test(key)) ? '[redacted]' : redact(val);
  }
  return out;
}

function currentLevel(): Level {
  const raw = process.env.LOG_LEVEL as Level | undefined;
  return raw && raw in ORDER ? raw : 'info';
}

export interface LogContext {
  requestId?: string;
  [key: string]: unknown;
}

function emit(level: Exclude<Level, 'silent'>, message: string, context?: LogContext): void {
  if (ORDER[level] < ORDER[currentLevel()]) return;
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.warn(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit('debug', m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => emit('info', m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => emit('warn', m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => emit('error', m, { ...base, ...c }),
    };
  },
};

export function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Math.random().toString(36).slice(2, 12)}`;
}
