import { describe, it, expect } from 'vitest';
import { compareVersions } from '@/lib/utils';

describe('compareVersions', () => {
    it('should correctly compare simple versions', () => {
        expect(compareVersions('8.0.32', '5.7.41')).toBe(1);
        expect(compareVersions('5.7.41', '8.0.32')).toBe(-1);
        expect(compareVersions('8.0.32', '8.0.32')).toBe(0);
    });

    it('should handle complex strings', () => {
        expect(compareVersions('10.11.6-MariaDB-1:10.11.6+maria~ubu2204', '10.6.14-MariaDB')).toBe(1);
        expect(compareVersions('postgres:14.2', '14.2')).toBe(0); // Assuming extractVer handles this?
        // My current regex ^(\d+(?:\.\d+)*) won't handle "postgres:14.2" well unless it starts with digit.
        // Let's check regex behavior below.
    });

    it('should handle missing versions', () => {
        expect(compareVersions(undefined, '5.7')).toBe(0);
        expect(compareVersions('5.7', undefined)).toBe(0);
    });

    it('should handle partial versions', () => {
        expect(compareVersions('8.0', '8.0.1')).toBe(-1);
    });

    it('should handle Postgres strings', () => {
        expect(compareVersions('PostgreSQL 16.1', 'PostgreSQL 12.0')).toBe(1);
        expect(compareVersions('PostgreSQL 9.6.12', 'PostgreSQL 10.0')).toBe(-1);
    });
});
