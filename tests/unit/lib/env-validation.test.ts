import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateEnvironment } from '@/lib/server/env-validation';

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    },
}));

const VALID_SECRET = 'a-valid-secret-with-sufficient-length';
const VALID_KEY = 'a'.repeat(64);

const MANAGED_ENV_VARS = [
    'BETTER_AUTH_SECRET', 'ENCRYPTION_KEY', 'BETTER_AUTH_URL',
    'PORT', 'LOG_LEVEL', 'TZ', 'DATABASE_URL', 'TMPDIR',
    'DISABLE_HTTPS', 'CERTS_DIR', 'DATA_DIR', 'TRUSTED_ORIGINS',
    'SQLITE_WAL_MODE',
];

describe('validateEnvironment', () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        MANAGED_ENV_VARS.forEach(k => {
            saved[k] = process.env[k];
            delete process.env[k];
        });
    });

    afterEach(() => {
        MANAGED_ENV_VARS.forEach(k => {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        });
    });

    it('returns parsed env with defaults when required vars are set', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        process.env.ENCRYPTION_KEY = VALID_KEY;

        const env = validateEnvironment();

        expect(env.BETTER_AUTH_SECRET).toBe(VALID_SECRET);
        expect(env.ENCRYPTION_KEY).toBe(VALID_KEY);
        expect(env.PORT).toBe('3000');
        expect(env.LOG_LEVEL).toBe('info');
        expect(env.TZ).toBe('UTC');
        expect(env.DATABASE_URL).toBe('file:./prisma/dev.db');
        expect(env.DISABLE_HTTPS).toBe('false');
        expect(env.SQLITE_WAL_MODE).toBe('true');
    });

    it('respects overridden optional values', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        process.env.ENCRYPTION_KEY = VALID_KEY;
        process.env.PORT = '8080';
        process.env.LOG_LEVEL = 'debug';
        process.env.TZ = 'Europe/Berlin';

        const env = validateEnvironment();

        expect(env.PORT).toBe('8080');
        expect(env.LOG_LEVEL).toBe('debug');
        expect(env.TZ).toBe('Europe/Berlin');
    });

    it('throws when BETTER_AUTH_SECRET is missing', () => {
        process.env.ENCRYPTION_KEY = VALID_KEY;
        expect(() => validateEnvironment()).toThrow('Startup aborted');
    });

    it('throws when ENCRYPTION_KEY is missing', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        expect(() => validateEnvironment()).toThrow('Startup aborted');
    });

    it('throws when BETTER_AUTH_SECRET is shorter than 16 characters', () => {
        process.env.BETTER_AUTH_SECRET = 'tooshort';
        process.env.ENCRYPTION_KEY = VALID_KEY;
        expect(() => validateEnvironment()).toThrow('Startup aborted');
    });

    it('throws when ENCRYPTION_KEY is not exactly 64 characters', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        process.env.ENCRYPTION_KEY = 'a'.repeat(32);
        expect(() => validateEnvironment()).toThrow('Startup aborted');
    });

    it('logs a warning and propagates when an optional field has an invalid value', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        process.env.ENCRYPTION_KEY = VALID_KEY;
        process.env.LOG_LEVEL = 'verbose'; // not in the allowed enum
        // Non-critical failures still result in a thrown error (from the fallback re-parse)
        expect(() => validateEnvironment()).toThrow();
    });
});
