import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    generateDownloadToken,
    consumeDownloadToken,
    markTokenUsed,
    getTokenStoreSize,
    generateSelectionDownloadToken,
    consumeSelectionDownloadToken
} from '@/lib/auth/download-tokens';

describe('Download Tokens', () => {
    beforeEach(() => {
        // Reset the token store before each test by clearing all tokens
        // We do this by consuming/marking used all existing tokens
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('generateDownloadToken', () => {
        it('should generate a unique token string', () => {
            const token1 = generateDownloadToken('storage-1', '/path/to/file.sql');
            const token2 = generateDownloadToken('storage-1', '/path/to/file.sql');

            expect(token1).toBeTypeOf('string');
            expect(token2).toBeTypeOf('string');
            expect(token1).toHaveLength(64); // 32 bytes hex = 64 chars
            expect(token2).toHaveLength(64);
            expect(token1).not.toBe(token2); // Each token should be unique
        });

        it('should store token data correctly', () => {
            const storageId = 'test-storage-id';
            const file = '/backups/test.sql.gz.enc';
            const decrypt = true;

            const token = generateDownloadToken(storageId, file, decrypt);
            const data = consumeDownloadToken(token);

            expect(data).not.toBeNull();
            expect(data?.storageId).toBe(storageId);
            expect(data?.file).toBe(file);
            expect(data?.decrypt).toBe(decrypt);
            expect(data?.used).toBe(false);
        });

        it('should default decrypt to true', () => {
            const token = generateDownloadToken('storage', '/file.sql');
            const data = consumeDownloadToken(token);

            expect(data?.decrypt).toBe(true);
        });

        it('should respect decrypt=false parameter', () => {
            const token = generateDownloadToken('storage', '/file.sql.enc', false);
            const data = consumeDownloadToken(token);

            expect(data?.decrypt).toBe(false);
        });

        it('should set correct expiration time (5 minutes)', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            const token = generateDownloadToken('storage', '/file.sql');
            const data = consumeDownloadToken(token);

            expect(data?.createdAt).toBe(now);
            expect(data?.expiresAt).toBe(now + 5 * 60 * 1000);
        });
    });

    describe('consumeDownloadToken', () => {
        it('should return null for non-existent token', () => {
            const result = consumeDownloadToken('non-existent-token');
            expect(result).toBeNull();
        });

        it('should return null for expired token', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            const token = generateDownloadToken('storage', '/file.sql');

            // Advance time by 6 minutes (past 5-min expiration)
            vi.setSystemTime(now + 6 * 60 * 1000);

            const result = consumeDownloadToken(token);
            expect(result).toBeNull();
        });

        it('should return data for valid token within expiration', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            const token = generateDownloadToken('storage', '/file.sql');

            // Advance time by 4 minutes (within 5-min expiration)
            vi.setSystemTime(now + 4 * 60 * 1000);

            const result = consumeDownloadToken(token);
            expect(result).not.toBeNull();
            expect(result?.storageId).toBe('storage');
        });

        it('should return null for already-used token', () => {
            const token = generateDownloadToken('storage', '/file.sql');

            // First consume - should work
            const firstResult = consumeDownloadToken(token);
            expect(firstResult).not.toBeNull();

            // Mark as used
            markTokenUsed(token);

            // Second consume - should fail
            const secondResult = consumeDownloadToken(token);
            expect(secondResult).toBeNull();
        });

        it('should not mark token as used automatically', () => {
            const token = generateDownloadToken('storage', '/file.sql');

            // Consume once
            const firstResult = consumeDownloadToken(token);
            expect(firstResult).not.toBeNull();
            expect(firstResult?.used).toBe(false);

            // Consume again without marking used - should still work
            const secondResult = consumeDownloadToken(token);
            expect(secondResult).not.toBeNull();
        });
    });

    describe('markTokenUsed', () => {
        it('should mark token as used', () => {
            const token = generateDownloadToken('storage', '/file.sql');

            // Token should be valid initially
            const beforeMark = consumeDownloadToken(token);
            expect(beforeMark).not.toBeNull();

            // Mark as used
            markTokenUsed(token);

            // Token should now be rejected
            const afterMark = consumeDownloadToken(token);
            expect(afterMark).toBeNull();
        });

        it('should handle non-existent token gracefully', () => {
            // Should not throw
            expect(() => markTokenUsed('non-existent-token')).not.toThrow();
        });
    });

    describe('Token Workflow', () => {
        it('should support the two-step consume-then-mark pattern', () => {
            const token = generateDownloadToken('storage-id', '/backup.sql', true);

            // Step 1: Validate token (simulating download start)
            const tokenData = consumeDownloadToken(token);
            expect(tokenData).not.toBeNull();
            expect(tokenData?.storageId).toBe('storage-id');
            expect(tokenData?.file).toBe('/backup.sql');
            expect(tokenData?.decrypt).toBe(true);

            // Simulate: Download could fail here
            // Token should still be usable since we didn't mark it used
            const retryData = consumeDownloadToken(token);
            expect(retryData).not.toBeNull();

            // Step 2: Mark as used after successful download
            markTokenUsed(token);

            // Now token should be invalid
            const finalData = consumeDownloadToken(token);
            expect(finalData).toBeNull();
        });

        it('should allow retry if download fails before markTokenUsed', () => {
            const token = generateDownloadToken('storage', '/file.sql');

            // First attempt - validate
            const attempt1 = consumeDownloadToken(token);
            expect(attempt1).not.toBeNull();

            // Simulate download failure (don't call markTokenUsed)

            // Second attempt - should still work
            const attempt2 = consumeDownloadToken(token);
            expect(attempt2).not.toBeNull();

            // Third attempt - still works until marked
            const attempt3 = consumeDownloadToken(token);
            expect(attempt3).not.toBeNull();

            // Now mark as used (simulating successful download)
            markTokenUsed(token);

            // Fourth attempt - should fail
            const attempt4 = consumeDownloadToken(token);
            expect(attempt4).toBeNull();
        });
    });

    describe('getTokenStoreSize', () => {
        it('should return the number of tokens in store', () => {
            const initialSize = getTokenStoreSize();

            generateDownloadToken('storage-1', '/file1.sql');
            expect(getTokenStoreSize()).toBe(initialSize + 1);

            generateDownloadToken('storage-2', '/file2.sql');
            expect(getTokenStoreSize()).toBe(initialSize + 2);

            generateDownloadToken('storage-3', '/file3.sql');
            expect(getTokenStoreSize()).toBe(initialSize + 3);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty string storage ID', () => {
            const token = generateDownloadToken('', '/file.sql');
            const data = consumeDownloadToken(token);

            expect(data).not.toBeNull();
            expect(data?.storageId).toBe('');
        });

        it('should handle special characters in file path', () => {
            const specialPath = '/backups/my db/file with spaces & special.sql';
            const token = generateDownloadToken('storage', specialPath);
            const data = consumeDownloadToken(token);

            expect(data).not.toBeNull();
            expect(data?.file).toBe(specialPath);
        });

        it('should handle a selection token the same way', () => {
            const token = generateSelectionDownloadToken({
                storageId: 'storage', file: 'Job/backup.tar', userId: 'user-1', fileName: 'backup-files.tar.gz',
            });

            expect(consumeSelectionDownloadToken(token, 'user-1')?.file).toBe('Job/backup.tar');
        });

        it('should handle very long file paths', () => {
            const longPath = '/backups/' + 'a'.repeat(1000) + '.sql';
            const token = generateDownloadToken('storage', longPath);
            const data = consumeDownloadToken(token);

            expect(data).not.toBeNull();
            expect(data?.file).toBe(longPath);
        });

        it('should handle token at exact expiration boundary', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            const token = generateDownloadToken('storage', '/file.sql');

            // Set time to exactly 5 minutes later (edge case)
            vi.setSystemTime(now + 5 * 60 * 1000);

            // At exactly 5 minutes, should still work (not expired yet, uses > not >=)
            const result = consumeDownloadToken(token);
            expect(result).not.toBeNull();
        });

        it('should expire token after 5 minutes', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            const token = generateDownloadToken('storage', '/file.sql');

            // Set time to 5 minutes + 1ms later (just past expiration)
            vi.setSystemTime(now + 5 * 60 * 1000 + 1);

            const result = consumeDownloadToken(token);
            expect(result).toBeNull();
        });
    });
});

/**
 * Tokens for archive-selection downloads.
 *
 * These exist so the browser can fetch a selection as a plain GET and write it straight to
 * disk, which is the only way a selection larger than the machine's RAM can be downloaded.
 * That also means the token travels in a URL, so the owner check below is the thing standing
 * between a stray link and someone else's backup.
 */
describe('Selection download tokens', () => {
    const params = {
        storageId: 'cfg-1',
        file: 'Job/backup.tar',
        userId: 'user-1',
        fileName: 'backup-files.tar.gz',
        selections: [{ src: 'src-1', paths: ['www/index.php'] }],
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('returns the parked selection to the session that prepared it', () => {
        const token = generateSelectionDownloadToken(params);

        const claim = consumeSelectionDownloadToken(token, 'user-1');

        expect(claim?.storageId).toBe('cfg-1');
        expect(claim?.file).toBe('Job/backup.tar');
        expect(claim?.selection.fileName).toBe('backup-files.tar.gz');
        expect(claim?.selection.selections).toEqual(params.selections);
    });

    it('refuses a token presented by a different user', () => {
        const token = generateSelectionDownloadToken(params);

        expect(consumeSelectionDownloadToken(token, 'someone-else')).toBeNull();
    });

    it('refuses a plain single-file token, which carries no owner', () => {
        // Single-file tokens are not bound to a user, so accepting one here would hand out a
        // selection download to whoever presents it.
        const plain = generateDownloadToken('cfg-1', '/backup.sql');

        expect(consumeSelectionDownloadToken(plain, 'user-1')).toBeNull();
    });

    it('refuses a token that was never issued', () => {
        expect(consumeSelectionDownloadToken('not-a-token', 'user-1')).toBeNull();
    });

    it('stops honouring a token once it has expired', () => {
        const now = Date.now();
        vi.setSystemTime(now);
        const token = generateSelectionDownloadToken(params);

        vi.setSystemTime(now + 5 * 60 * 1000 + 1);

        expect(consumeSelectionDownloadToken(token, 'user-1')).toBeNull();
    });

    it('stays claimable within its lifetime, so a browser retry still works', () => {
        // Consuming on first use would break a download the browser retries or resumes.
        const now = Date.now();
        vi.setSystemTime(now);
        const token = generateSelectionDownloadToken(params);

        expect(consumeSelectionDownloadToken(token, 'user-1')).not.toBeNull();
        vi.setSystemTime(now + 60 * 1000);
        expect(consumeSelectionDownloadToken(token, 'user-1')).not.toBeNull();
    });

    it('carries no selection paths when the whole snapshot was requested', () => {
        const token = generateSelectionDownloadToken({ ...params, selections: undefined });

        expect(consumeSelectionDownloadToken(token, 'user-1')?.selection.selections).toBeUndefined();
    });
});
