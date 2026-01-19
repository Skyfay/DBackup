import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  if (!bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatTwoFactorCode(value: string): string {
  // Remove non-digits and limit to 6 characters
  return value.replace(/\D/g, '').slice(0, 6);
}

/**
 * Compares two version strings (SemVer-like).
 * Returns 1 if v1 > v2 (v1 is newer), -1 if v1 < v2 (v1 is older), 0 if equal.
 * Example: compareVersions('8.0.4', '5.7') -> 1
 */
export function compareVersions(v1: string | undefined, v2: string | undefined): number {
  if (!v1 || !v2) return 0;

  // Normalize: get the first sequence of digits/dots.
  // e.g. "8.0.32-0ubuntu0.22.04.2" -> "8.0.32"
  // Some DBs return "10.11.6-MariaDB-..."
  // Postgres returns "PostgreSQL 16.1 ..."

  const extractVer = (v: string) => {
      // Find first occurrence of a version-like number (digits + optional dots)
      const match = v.match(/(\d+(?:\.\d+)*)/);
      return match ? match[1] : '';
  };

  const parts1 = extractVer(v1).split('.').map(Number);
  const parts2 = extractVer(v2).split('.').map(Number);

  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
      const val1 = parts1[i] || 0;
      const val2 = parts2[i] || 0;

      if (val1 > val2) return 1;
      if (val1 < val2) return -1;
  }

  return 0;
}

