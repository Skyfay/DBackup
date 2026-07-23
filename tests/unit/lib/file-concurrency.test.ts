import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ default: { systemSetting: { findUnique } } }));

const { getMaxConcurrentFiles, DEFAULT_MAX_CONCURRENT_FILES, MAX_CONCURRENT_FILES_LIMIT } =
    await import("@/lib/settings/file-concurrency");

beforeEach(() => vi.clearAllMocks());

describe("getMaxConcurrentFiles", () => {
    it("returns the default when the setting was never saved", async () => {
        findUnique.mockResolvedValue(null);
        expect(await getMaxConcurrentFiles()).toBe(DEFAULT_MAX_CONCURRENT_FILES);
    });

    it("returns the stored value within range", async () => {
        findUnique.mockResolvedValue({ value: "8" });
        expect(await getMaxConcurrentFiles()).toBe(8);
    });

    it("clamps a value above the limit down to the cap", async () => {
        // A hand-edited DB row must not widen concurrency past what the form allows.
        findUnique.mockResolvedValue({ value: "999" });
        expect(await getMaxConcurrentFiles()).toBe(MAX_CONCURRENT_FILES_LIMIT);
    });

    it("clamps a value below 1 up to 1", async () => {
        findUnique.mockResolvedValue({ value: "0" });
        expect(await getMaxConcurrentFiles()).toBe(1);
    });

    it("falls back to the default for a non-numeric value", async () => {
        findUnique.mockResolvedValue({ value: "abc" });
        expect(await getMaxConcurrentFiles()).toBe(DEFAULT_MAX_CONCURRENT_FILES);
    });
});
