import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAdapterCredentials, validateOidcAutoRedirect } from '@/lib/server/startup-checks';
import prisma from '@/lib/prisma';
import { registry } from '@/lib/core/registry';
import { registerAdapters } from '@/lib/adapters';

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

vi.mock('@/lib/prisma', () => ({
    default: {
        adapterConfig: {
            findMany: vi.fn(),
            update: vi.fn(),
        },
        ssoProvider: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('@/lib/core/registry', () => ({
    registry: {
        get: vi.fn(),
    },
}));

vi.mock('@/lib/adapters', () => ({
    registerAdapters: vi.fn(),
}));

describe('validateAdapterCredentials', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue({ credentials: {} });
    });

    it('completes without error when there are no adapter configs', async () => {
        await expect(validateAdapterCredentials()).resolves.toBeUndefined();
        expect(registerAdapters).toHaveBeenCalled();
    });

    it('flags adapter OFFLINE when required primary credential is missing', async () => {
        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 'cfg1', name: 'My DB', adapterId: 'mysql', primaryCredentialId: null, lastStatus: 'ONLINE', lastError: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue({
            credentials: { primary: { label: 'Credential' } },
        });
        (prisma.adapterConfig.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

        await validateAdapterCredentials();

        expect(prisma.adapterConfig.update).toHaveBeenCalledWith({
            where: { id: 'cfg1' },
            data: { lastStatus: 'OFFLINE', lastError: 'No credential profile assigned' },
        });
    });

    it('skips update when adapter is already OFFLINE with the same error (idempotent)', async () => {
        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                id: 'cfg1', name: 'My DB', adapterId: 'mysql',
                primaryCredentialId: null,
                lastStatus: 'OFFLINE',
                lastError: 'No credential profile assigned',
            },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue({
            credentials: { primary: { label: 'Credential' } },
        });

        await validateAdapterCredentials();

        expect(prisma.adapterConfig.update).not.toHaveBeenCalled();
    });

    it('clears OFFLINE flag when a previously missing credential is now present', async () => {
        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                id: 'cfg1', name: 'My DB', adapterId: 'mysql',
                primaryCredentialId: 'cred-1',
                lastStatus: 'OFFLINE',
                lastError: 'No credential profile assigned',
            },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue({
            credentials: { primary: { label: 'Credential' } },
        });
        (prisma.adapterConfig.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

        await validateAdapterCredentials();

        expect(prisma.adapterConfig.update).toHaveBeenCalledWith({
            where: { id: 'cfg1' },
            data: { lastStatus: 'ONLINE', lastError: null, consecutiveFailures: 0 },
        });
    });

    it('does not flag adapter when no primary credential is required by the adapter', async () => {
        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 'cfg1', name: 'Storage', adapterId: 's3', primaryCredentialId: null, lastStatus: 'ONLINE', lastError: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue({ credentials: {} });

        await validateAdapterCredentials();

        expect(prisma.adapterConfig.update).not.toHaveBeenCalled();
    });

    it('does not flag adapter when the registry has no entry for the adapterId', async () => {
        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 'cfg1', name: 'Unknown', adapterId: 'unknown', primaryCredentialId: null, lastStatus: 'ONLINE', lastError: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

        await validateAdapterCredentials();

        expect(prisma.adapterConfig.update).not.toHaveBeenCalled();
    });

    it('swallows errors so they never block application startup', async () => {
        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB connection lost'));
        await expect(validateAdapterCredentials()).resolves.toBeUndefined();
    });
});

describe('validateOidcAutoRedirect', () => {
    const savedEnv = process.env.OIDC_AUTO_REDIRECT;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.OIDC_AUTO_REDIRECT;
    });

    afterEach(() => {
        if (savedEnv === undefined) delete process.env.OIDC_AUTO_REDIRECT;
        else process.env.OIDC_AUTO_REDIRECT = savedEnv;
    });

    it('does not touch the database when the variable is unset', async () => {
        await expect(validateOidcAutoRedirect()).resolves.toBeUndefined();
        expect(prisma.ssoProvider.findUnique).not.toHaveBeenCalled();
    });

    it('looks up the configured provider by its providerId', async () => {
        process.env.OIDC_AUTO_REDIRECT = 'authentik-742';
        (prisma.ssoProvider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
            providerId: 'authentik-742', name: 'Corporate Login', enabled: true,
        });

        await validateOidcAutoRedirect();

        expect(prisma.ssoProvider.findUnique).toHaveBeenCalledWith({
            where: { providerId: 'authentik-742' },
            select: { providerId: true, name: true, enabled: true, tenantId: true },
        });
    });

    it('starts normally when it names a provider of a tenant, which is never a target of the login page', async () => {
        process.env.OIDC_AUTO_REDIRECT = 'entra-acme';
        (prisma.ssoProvider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
            providerId: 'entra-acme', name: 'Acme Entra ID', enabled: true, tenantId: 'acme',
        });

        await expect(validateOidcAutoRedirect()).resolves.toBeUndefined();
    });

    it('starts normally when the provider does not exist', async () => {
        process.env.OIDC_AUTO_REDIRECT = 'gone';
        (prisma.ssoProvider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await expect(validateOidcAutoRedirect()).resolves.toBeUndefined();
    });

    it('starts normally when the provider exists but is disabled', async () => {
        process.env.OIDC_AUTO_REDIRECT = 'authentik-742';
        (prisma.ssoProvider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
            providerId: 'authentik-742', name: 'Corporate Login', enabled: false,
        });

        await expect(validateOidcAutoRedirect()).resolves.toBeUndefined();
    });

    it('swallows errors so they never block application startup', async () => {
        process.env.OIDC_AUTO_REDIRECT = 'authentik-742';
        (prisma.ssoProvider.findUnique as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB connection lost'));

        await expect(validateOidcAutoRedirect()).resolves.toBeUndefined();
    });
});
