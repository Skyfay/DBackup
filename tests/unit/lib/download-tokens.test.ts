import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    generateDownloadToken,
    consumeDownloadToken,
    markTokenUsed,
    getTokenStoreSize
} from '@/lib/download-tokens';

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
