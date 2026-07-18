import { describe, it, expect, vi } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { OidcProviderService, type CreateSsoProviderInput } from '@/services/sso/oidc-provider-service';

vi.mock('@/lib/crypto', () => ({
    encrypt: vi.fn((value: string) => `encrypted:${value}`),
    decrypt: vi.fn((value: string) => value.replace('encrypted:', '')),
}));

const baseInput: CreateSsoProviderInput = {
    name: 'My SSO',
    adapterId: 'authentik',
    type: 'oidc',
    providerId: 'my-sso',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    authorizationEndpoint: 'https://auth.example.com/authorize',
    tokenEndpoint: 'https://auth.example.com/token',
    userInfoEndpoint: 'https://auth.example.com/userinfo',
    issuer: 'https://auth.example.com',
};

const mockProvider = {
    id: 'prov-1',
    ...baseInput,
    clientId: 'encrypted:client-id',
    clientSecret: 'encrypted:client-secret',
    enabled: true,
    allowProvisioning: true,
    domain: null,
    oidcConfig: null,
    adapterConfig: null,
    jwksEndpoint: null,
    discoveryEndpoint: null,
    scope: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('OidcProviderService', () => {
    describe('getProviders()', () => {
        it('returns all providers ordered by createdAt desc', async () => {
            prismaMock.ssoProvider.findMany.mockResolvedValue([mockProvider] as any);

            const result = await OidcProviderService.getProviders();

            expect(prismaMock.ssoProvider.findMany).toHaveBeenCalledWith({
                orderBy: { createdAt: 'desc' },
            });
            expect(result).toEqual([mockProvider]);
        });
    });

    describe('getProviderById()', () => {
        it('returns provider by id', async () => {
            prismaMock.ssoProvider.findUnique.mockResolvedValue(mockProvider as any);

            const result = await OidcProviderService.getProviderById('prov-1');

            expect(prismaMock.ssoProvider.findUnique).toHaveBeenCalledWith({ where: { id: 'prov-1' } });
            expect(result).toEqual(mockProvider);
        });

        it('returns null for unknown id', async () => {
            prismaMock.ssoProvider.findUnique.mockResolvedValue(null);

            const result = await OidcProviderService.getProviderById('missing');

            expect(result).toBeNull();
        });
    });

    describe('getEnabledProviders()', () => {
        it('returns only enabled providers without secrets', async () => {
            prismaMock.ssoProvider.findMany.mockResolvedValue([mockProvider] as any);

            await OidcProviderService.getEnabledProviders();

            expect(prismaMock.ssoProvider.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { enabled: true },
                    select: expect.not.objectContaining({ clientId: expect.anything() }),
                })
            );
        });
    });

    describe('createProvider()', () => {
        it('encrypts clientId and clientSecret before storing', async () => {
            prismaMock.ssoProvider.create.mockResolvedValue(mockProvider as any);

            await OidcProviderService.createProvider(baseInput);

            expect(prismaMock.ssoProvider.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        clientId: 'encrypted:client-id',
                        clientSecret: 'encrypted:client-secret',
                    }),
                })
            );
        });

        it('uses issuer to build discoveryEndpoint fallback', async () => {
            prismaMock.ssoProvider.create.mockResolvedValue(mockProvider as any);

            await OidcProviderService.createProvider(baseInput);

            const callData = prismaMock.ssoProvider.create.mock.calls[0][0].data;
            const oidcConfig = JSON.parse(callData.oidcConfig as string);
            expect(oidcConfig.discoveryEndpoint).toContain('/.well-known/openid-configuration');
        });

        it('sets skipDiscovery to true', async () => {
            prismaMock.ssoProvider.create.mockResolvedValue(mockProvider as any);

            await OidcProviderService.createProvider(baseInput);

            const callData = prismaMock.ssoProvider.create.mock.calls[0][0].data;
            const oidcConfig = JSON.parse(callData.oidcConfig as string);
            expect(oidcConfig.skipDiscovery).toBe(true);
        });

        it('sets enabled=true by default', async () => {
            prismaMock.ssoProvider.create.mockResolvedValue(mockProvider as any);

            await OidcProviderService.createProvider(baseInput);

            expect(prismaMock.ssoProvider.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ enabled: true }),
                })
            );
        });
    });

    describe('deleteProvider()', () => {
        it('deletes the provider and its linked accounts inside a transaction', async () => {
            prismaMock.$transaction.mockImplementation((cb: any) => cb(prismaMock));
            prismaMock.ssoProvider.findUniqueOrThrow.mockResolvedValue(mockProvider as any);
            prismaMock.account.deleteMany.mockResolvedValue({ count: 1 } as any);
            prismaMock.ssoProvider.delete.mockResolvedValue(mockProvider as any);

            await OidcProviderService.deleteProvider('prov-1');

            expect(prismaMock.ssoProvider.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'prov-1' } });
            expect(prismaMock.account.deleteMany).toHaveBeenCalledWith({ where: { providerId: mockProvider.providerId } });
            expect(prismaMock.ssoProvider.delete).toHaveBeenCalledWith({ where: { id: 'prov-1' } });
        });
    });

    describe('toggleProvider()', () => {
        it('updates enabled status', async () => {
            prismaMock.ssoProvider.update.mockResolvedValue({ ...mockProvider, enabled: false } as any);

            await OidcProviderService.toggleProvider('prov-1', false);

            expect(prismaMock.ssoProvider.update).toHaveBeenCalledWith({
                where: { id: 'prov-1' },
                data: { enabled: false },
            });
        });
    });

    describe('updateProvider()', () => {
        it('throws when provider does not exist', async () => {
            prismaMock.ssoProvider.findUnique.mockResolvedValue(null);

            await expect(
                OidcProviderService.updateProvider('missing', { name: 'Updated' })
            ).rejects.toThrow('Provider not found');
        });

        it('updates non-OIDC fields without regenerating oidcConfig', async () => {
            prismaMock.ssoProvider.findUnique.mockResolvedValue(mockProvider as any);
            prismaMock.ssoProvider.update.mockResolvedValue(mockProvider as any);

            await OidcProviderService.updateProvider('prov-1', { name: 'Renamed' });

            const callData = prismaMock.ssoProvider.update.mock.calls[0][0].data;
            expect(callData.oidcConfig).toBeUndefined();
        });

        it('regenerates oidcConfig when authorizationEndpoint is updated', async () => {
            prismaMock.ssoProvider.findUnique.mockResolvedValue(mockProvider as any);
            prismaMock.ssoProvider.update.mockResolvedValue(mockProvider as any);

            await OidcProviderService.updateProvider('prov-1', {
                authorizationEndpoint: 'https://new.example.com/authorize',
            });

            const callData = prismaMock.ssoProvider.update.mock.calls[0][0].data;
            const oidcConfig = JSON.parse(callData.oidcConfig as string);
            expect(oidcConfig.authorizationEndpoint).toBe('https://new.example.com/authorize');
            expect(oidcConfig.skipDiscovery).toBe(true);
        });

        it('regenerates oidcConfig when clientId is updated and encrypts it', async () => {
            prismaMock.ssoProvider.findUnique.mockResolvedValue(mockProvider as any);
            prismaMock.ssoProvider.update.mockResolvedValue(mockProvider as any);

            await OidcProviderService.updateProvider('prov-1', {
                clientId: 'new-client-id',
                clientSecret: 'new-client-secret',
            });

            const callData = prismaMock.ssoProvider.update.mock.calls[0][0].data;
            expect(callData.clientId).toBe('encrypted:new-client-id');
            expect(callData.clientSecret).toBe('encrypted:new-client-secret');

            const oidcConfig = JSON.parse(callData.oidcConfig as string);
            expect(oidcConfig.clientId).toBe('encrypted:new-client-id');
        });

        it('uses provided discoveryEndpoint directly without building fallback', async () => {
            prismaMock.ssoProvider.findUnique.mockResolvedValue(mockProvider as any);
            prismaMock.ssoProvider.update.mockResolvedValue(mockProvider as any);

            await OidcProviderService.updateProvider('prov-1', {
                authorizationEndpoint: 'https://new.example.com/authorize',
                discoveryEndpoint: 'https://new.example.com/.well-known/custom',
            });

            const callData = prismaMock.ssoProvider.update.mock.calls[0][0].data;
            const oidcConfig = JSON.parse(callData.oidcConfig as string);
            expect(oidcConfig.discoveryEndpoint).toBe('https://new.example.com/.well-known/custom');
        });

        it('falls back to issuer-based discoveryEndpoint when none is provided', async () => {
            prismaMock.ssoProvider.findUnique.mockResolvedValue({
                ...mockProvider,
                issuer: 'https://auth.example.com',
            } as any);
            prismaMock.ssoProvider.update.mockResolvedValue(mockProvider as any);

            await OidcProviderService.updateProvider('prov-1', {
                authorizationEndpoint: 'https://auth.example.com/authorize',
            });

            const callData = prismaMock.ssoProvider.update.mock.calls[0][0].data;
            const oidcConfig = JSON.parse(callData.oidcConfig as string);
            expect(oidcConfig.discoveryEndpoint).toContain('/.well-known/openid-configuration');
        });
    });

    describe('createProvider() - additional branches', () => {
        it('uses provided discoveryEndpoint directly instead of building from issuer', async () => {
            prismaMock.ssoProvider.create.mockResolvedValue(mockProvider as any);

            await OidcProviderService.createProvider({
                ...baseInput,
                discoveryEndpoint: 'https://auth.example.com/application/o/my-app/.well-known/openid-configuration',
            });

            const callData = prismaMock.ssoProvider.create.mock.calls[0][0].data;
            const oidcConfig = JSON.parse(callData.oidcConfig as string);
            expect(oidcConfig.discoveryEndpoint).toBe(
                'https://auth.example.com/application/o/my-app/.well-known/openid-configuration'
            );
        });

        it('does not generate oidcConfig for saml type', async () => {
            prismaMock.ssoProvider.create.mockResolvedValue(mockProvider as any);

            await OidcProviderService.createProvider({
                ...baseInput,
                type: 'saml',
            });

            const callData = prismaMock.ssoProvider.create.mock.calls[0][0].data;
            expect(callData.oidcConfig).toBeUndefined();
        });

        it('sets discoveryEndpoint to undefined when neither issuer nor discoveryEndpoint is provided', async () => {
            prismaMock.ssoProvider.create.mockResolvedValue(mockProvider as any);

            const inputWithoutIssuer = { ...baseInput };
            delete (inputWithoutIssuer as any).issuer;

            await OidcProviderService.createProvider(inputWithoutIssuer);

            const callData = prismaMock.ssoProvider.create.mock.calls[0][0].data;
            const oidcConfig = JSON.parse(callData.oidcConfig as string);
            expect(oidcConfig.discoveryEndpoint).toBeUndefined();
        });
    });
});
