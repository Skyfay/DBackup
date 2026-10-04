import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { version as CURRENT_VERSION } from '../../../package.json';

vi.mock('@/lib/logging/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));
vi.mock('@/lib/logging/errors', () => ({
    wrapError: (e: unknown) => e,
}));

// Import after mocks
import { updateService } from '@/services/system/update-service';

// Helper to create a minimal GitHub tags response
function makeTags(...names: string[]) {
    return names.map(name => ({ name }));
}

/** Bumps one semver component of CURRENT_VERSION, so "a newer/older version" tests survive package.json version bumps. */
function bump(part: 'major' | 'minor' | 'patch', by = 1): string {
    const [major, minor, patch] = CURRENT_VERSION.split('.').map(Number);
    if (part === 'major') return `${major + by}.0.0`;
    if (part === 'minor') return `${major}.${minor + by}.0`;
    return `${major}.${minor}.${patch + by}`;
}

const globalFetch = vi.fn();
vi.stubGlobal('fetch', globalFetch);

describe('updateService.checkForUpdates()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: updates enabled (no setting override)
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── Enabled/Disabled ─────────────────────────────────────

    it('returns no update when checkForUpdates is disabled in settings', async () => {
        prismaMock.systemSetting.findUnique.mockResolvedValue({
            key: 'general.checkForUpdates',
            value: 'false',
        } as any);

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
        expect(globalFetch).not.toHaveBeenCalled();
    });

    it('checks updates when setting is explicitly set to true', async () => {
        prismaMock.systemSetting.findUnique.mockResolvedValue({
            key: 'general.checkForUpdates',
            value: 'true',
        } as any);
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v2.0.0'),
        });

        const result = await updateService.checkForUpdates();

        expect(globalFetch).toHaveBeenCalled();
        expect(result.updateAvailable).toBe(false);
    });

    // ── GitHub API errors ─────────────────────────────────────

    it('returns no update and error message when fetch throws', async () => {
        globalFetch.mockRejectedValue(new Error('Network error'));

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
        expect(result.error).toBe('Failed to check for updates');
    });

    it('returns no update and error when GitHub API returns non-ok status', async () => {
        globalFetch.mockResolvedValue({
            ok: false,
            statusText: 'Rate limit exceeded',
            json: async () => [],
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
        expect(result.error).toBe('Failed to check for updates');
    });

    it('returns no update when GitHub returns empty tag list', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => [],
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
        expect(result.updateAvailable).toBe(false);
    });

    it('returns no update when all tags are non-semver', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('nightly', 'main', 'latest'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
    });

    // ── Version comparison - stable channel ──────────────────

    it('detects a newer stable version', async () => {
        const newer = bump('major');
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags(`v${newer}`, `v${CURRENT_VERSION}`, 'v0.1.0'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(true);
        expect(result.latestVersion).toBe(`v${newer}`);
    });

    it('returns no update when current version is already the latest', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags(`v${CURRENT_VERSION}`, 'v1.9.0'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
        expect(result.latestVersion).toBe(CURRENT_VERSION);
    });

    it('returns no update when only older versions exist', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v1.9.9', 'v1.0.0'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
    });

    it('picks the highest stable version when multiple newer tags exist', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v2.1.0', 'v2.0.1', 'v2.0.0', `v${bump('major')}`, `v${bump('minor', 2)}`),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(true);
        expect(result.latestVersion).toBe(`v${bump('major')}`);
    });

    // ── Stability channel filtering ───────────────────────────

    it('stable channel user does not receive beta update', async () => {
        // Current: 2.0.0 (stable) - should NOT see 2.1.0-beta
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v2.1.0-beta', 'v2.0.0'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
    });

    it('stable channel user does not receive dev update', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v2.1.0-dev', 'v2.0.0'),
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
    });

    // ── currentVersion always reported ───────────────────────

    it('always includes currentVersion in the result', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags(`v${CURRENT_VERSION}`),
        });

        const result = await updateService.checkForUpdates();

        expect(result.currentVersion).toBe(CURRENT_VERSION);
    });

    it('includes currentVersion even when fetch fails', async () => {
        globalFetch.mockRejectedValue(new Error('offline'));

        const result = await updateService.checkForUpdates();

        expect(result.currentVersion).toBe(CURRENT_VERSION);
    });

    // ── AbortController timeout ───────────────────────────────

    it('handles fetch timeout (AbortError) gracefully', async () => {
        globalFetch.mockImplementation(() => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            return Promise.reject(err);
        });

        const result = await updateService.checkForUpdates();

        expect(result.updateAvailable).toBe(false);
        expect(result.error).toBe('Failed to check for updates');
    });

    // ── Unknown prerelease type (rc, alpha, etc.) ─────────────

    it('filters out rc prerelease tag for stable user - hits getStability return 0 path', async () => {
        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => makeTags('v3.0.0-rc.1', 'v3.0.0-rc', `v${CURRENT_VERSION}`),
        });

        const result = await updateService.checkForUpdates();

        // rc tags (stability 0) are filtered out for a stable user (stability 3)
        expect(result.updateAvailable).toBe(false);
    });
});
