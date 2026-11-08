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
    'SQLITE_WAL_MODE', 'DISABLE_EMAIL_LOGIN', 'OIDC_AUTO_REDIRECT',
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
        expect(env.DISABLE_EMAIL_LOGIN).toBe('false');
        expect(env.OIDC_AUTO_REDIRECT).toBeUndefined();
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

    it('refuses a key of 64 characters that are not all hex, which would fail at the first secret', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        for (const key of ['g'.repeat(64), `${'a'.repeat(63)}z`, `${'a'.repeat(62)} b`, 'Z'.repeat(32) + 'f'.repeat(32), `${'a'.repeat(60)}-0ab`]) {
            process.env.ENCRYPTION_KEY = key;
            expect(() => validateEnvironment(), key).toThrow('ENCRYPTION_KEY must hold hex characters only');
        }
    });

    it('takes a key of 64 hex characters in either case, like the output of openssl rand -hex 32', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        process.env.ENCRYPTION_KEY = '0123456789abcdefABCDEF'.repeat(3).slice(0, 64);

        expect(validateEnvironment().ENCRYPTION_KEY).toHaveLength(64);
    });

    it('accepts a disabled email login and an SSO provider ID', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        process.env.ENCRYPTION_KEY = VALID_KEY;
        process.env.DISABLE_EMAIL_LOGIN = 'true';
        process.env.OIDC_AUTO_REDIRECT = 'authentik-742';

        const env = validateEnvironment();

        expect(env.DISABLE_EMAIL_LOGIN).toBe('true');
        expect(env.OIDC_AUTO_REDIRECT).toBe('authentik-742');
    });

    it('rejects an OIDC_AUTO_REDIRECT that is not a provider ID', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        process.env.ENCRYPTION_KEY = VALID_KEY;
        // Uppercase and spaces are not valid in a providerId
        process.env.OIDC_AUTO_REDIRECT = 'Authentik Main';
        expect(() => validateEnvironment()).toThrow();
    });

    it('rejects a non-boolean DISABLE_EMAIL_LOGIN', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        process.env.ENCRYPTION_KEY = VALID_KEY;
        process.env.DISABLE_EMAIL_LOGIN = 'yes';
        expect(() => validateEnvironment()).toThrow();
    });

    it('logs a warning and propagates when an optional field has an invalid value', () => {
        process.env.BETTER_AUTH_SECRET = VALID_SECRET;
        process.env.ENCRYPTION_KEY = VALID_KEY;
        process.env.LOG_LEVEL = 'verbose'; // not in the allowed enum
        // Non-critical failures still result in a thrown error (from the fallback re-parse)
        expect(() => validateEnvironment()).toThrow();
    });
});
