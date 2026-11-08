/**
 * Coverage tests for update-service.ts prerelease/compareSemver paths.
 * Mocks package.json so we can test beta-channel and invalid-version behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';

vi.mock('@/lib/logging/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));
vi.mock('@/lib/logging/errors', () => ({
    wrapError: (e: unknown) => e,
}));

// Mock package.json to a beta version so the beta channel is active
vi.mock('../../../package.json', () => ({
    default: { version: '2.0.0-beta' },
    version: '2.0.0-beta',
}));

const globalFetch = vi.fn();
vi.stubGlobal('fetch', globalFetch);

// Import after mocks are set up
import { updateService } from '@/services/system/update-service';

function makeTags(...names: string[]) {
    return names.map(name => ({ name }));
}

describe('updateService.checkForUpdates() - beta channel (package.json mocked to 2.0.0-beta)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    });

    it('beta user receives a newer beta update', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v2.1.0-beta', 'v2.0.0-beta'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(true);
        expect(result.latestVersion).toBe('v2.1.0-beta');
    });

    it('beta user: rc tag (stability 0) is filtered out - hits getStability return 0 in filter', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            // beta stability=2, rc stability=0 → rc filtered out for beta user (2)
            json: async () => makeTags('v3.0.0-rc', 'v2.0.0-beta'),
        });

        const result = await updateService.checkForUpdates();

        // rc is filtered (stability 0 < 2), only 2.0.0-beta passes which is not newer
        expect(result.updateAvailable).toBe(false);
    });

    it('compareSemver two betas with same patch - hits localeCompare path (line 187)', async () => {
        // Both 3.0.0-beta.2 and 3.0.0-beta.1 have the same M.M.P → compareSemver compares prerelease
        // s1 = getStability('beta.2') = 2, s2 = getStability('beta.1') = 2 → s1 === s2
        // → falls through to localeCompare('beta.2', 'beta.1')
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v3.0.0-beta.2', 'v3.0.0-beta.1', 'v2.0.0-beta'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(true);
        expect(result.latestVersion).toBe('v3.0.0-beta.2');
    });

    it('counts the number of a beta as a number, so beta.10 is newer than beta.9', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v3.0.0-beta.9', 'v3.0.0-beta.10', 'v3.0.0-beta.2'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.latestVersion).toBe('v3.0.0-beta.10');
    });

    it('offers the release a beta previews over every beta of it', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v3.0.0-beta.10', 'v3.0.0', 'v3.0.0-beta.2'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.latestVersion).toBe('v3.0.0');
    });

    it('compareSemver beta vs dev with same patch - hits s1 !== s2 return path (line 182)', async () => {
        // 3.0.0-beta and 3.0.0-dev have the same M.M.P
        // s1 = getStability('beta') = 2, s2 = getStability('dev') = 1 → s1 !== s2 → return s1-s2
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v3.0.0-beta', 'v3.0.0-dev', 'v2.0.0-beta'),
        });

        const result = await updateService.checkForUpdates();

        // 3.0.0-beta has higher stability than 3.0.0-dev, so it ranks higher
        expect(result.updateAvailable).toBe(true);
        expect(result.latestVersion).toBe('v3.0.0-beta');
    });

    it('stable version outranks same-patch beta - hits null vs non-null prerelease comparison (line 171)', async () => {
        // 3.0.0 (stable, prerelease=null) vs 3.0.0-beta → stable outranks beta at same M.M.P
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v3.0.0', 'v3.0.0-beta'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(true);
        expect(result.latestVersion).toBe('v3.0.0');
    });
});
