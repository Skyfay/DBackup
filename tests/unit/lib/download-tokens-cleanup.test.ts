/**
 * Tests for the download token cleanup mechanism.
 *
 * This file installs fake timers and resets globalThis BEFORE importing the
 * module so that the module-level setInterval() is captured by the fake timer
 * and can be triggered via vi.advanceTimersByTime().
 */
import { describe, it, expect, vi, afterAll } from "vitest";

// Install fake timers before any module code runs.
vi.useFakeTimers();

// Reset globalThis so the cleanup interval is registered fresh in this worker.
const g = globalThis as unknown as {
  downloadTokenStore: Map<unknown, unknown> | undefined;
  downloadTokenCleanupStarted: boolean | undefined;
};
g.downloadTokenStore = undefined;
g.downloadTokenCleanupStarted = undefined;

// Dynamic import ensures the module runs AFTER fake timers are installed.
const { generateDownloadToken, markTokenUsed, getTokenStoreSize } = await import(
  "@/lib/auth/download-tokens"
);

afterAll(() => {
  vi.useRealTimers();
});

describe("Module initialization guards (hot-reload protection)", () => {
  it("should reuse existing store and skip interval registration when already initialized", async () => {
    vi.resetModules();

    // Simulate a hot-reload: store and interval are already initialized.
    const existingStore = new Map<string, unknown>();
    g.downloadTokenStore = existingStore as never;
    g.downloadTokenCleanupStarted = true;

    const mod = await import("@/lib/auth/download-tokens");

    // The module must use the existing store (else branch of store guard).
    mod.generateDownloadToken("hot-reload-storage", "/hot.sql");
    expect(existingStore.size).toBe(1);

    // Cleanup: remove the token we just added.
    existingStore.clear();
  });
});

describe("Download Token Cleanup (via setInterval)", () => {
  it("should remove expired tokens when cleanup interval fires", () => {
    const start = 1_000_000;
    vi.setSystemTime(start);

    const sizeBefore = getTokenStoreSize();
    generateDownloadToken("storage", "/expired.sql");
    expect(getTokenStoreSize()).toBe(sizeBefore + 1);

    // Advance past the 5-minute token TTL and then one full cleanup interval.
    vi.advanceTimersByTime(5 * 60 * 1000 + 60 * 1000 + 1);

    expect(getTokenStoreSize()).toBe(sizeBefore);
  });

  it("keeps a used link until it expires, so its maker can still see when it was fetched", () => {
    const start = 2_000_000;
    vi.setSystemTime(start);

    const sizeBefore = getTokenStoreSize();
    const token = generateDownloadToken("storage", "/used.sql");
    markTokenUsed(token);

    vi.advanceTimersByTime(2 * 60 * 1000 + 1);
    expect(getTokenStoreSize()).toBe(sizeBefore + 1);

    // Past the 5-minute TTL and one more cleanup interval it is gone like any other.
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(getTokenStoreSize()).toBe(sizeBefore);
  });

  it("should keep valid unexpired tokens through the cleanup interval", () => {
    const start = 3_000_000;
    vi.setSystemTime(start);

    const sizeBefore = getTokenStoreSize();
    generateDownloadToken("storage", "/valid.sql");

    // Advance by exactly one cleanup interval (1 min). Token expires in 5 min,
    // so it must survive.
    vi.advanceTimersByTime(60 * 1000 + 1);

    expect(getTokenStoreSize()).toBe(sizeBefore + 1);
  });
});
