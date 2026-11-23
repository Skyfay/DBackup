/**
 * A storage that puts a path into a URL reads its percent escapes, an escaped separator included,
 * so one part of a path can hold several parts there. A `..` among them leaves the folder of the
 * view just like a plain one, so the parts of a part are checked once its escapes are read.
 */
import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/logging/errors";
import { cleanPath } from "@/lib/tenant/storage-view";

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

describe("a path that leaves its folder only once its escapes are read", () => {
    it.each([
        "a%2F..%2Fb",
        "Shop/a%2f..%2fb.tar",
        "Shop/x%5C..%5Cy",
        "Shop/a%2F..%20%2Fb",
        "Shop/a%2F...%2Fb",
        "a%2F.%2Fb",
        "%2E%2E%5Csecret",
        "Shop/backup.tar%2F..",
    ])("refuses %s", (remotePath) => {
        expect(() => cleanPath(remotePath)).toThrow(ValidationError);
    });
});

describe("a path that stays in its folder", () => {
    it.each([
        ["Shop/backup.tar", "Shop/backup.tar"],
        ["Shop/report%20final.tar", "Shop/report%20final.tar"],
        ["Shop/file..name.tar", "Shop/file..name.tar"],
        ["Shop/.hidden", "Shop/.hidden"],
        ["Shop/a%2Fb.tar", "Shop/a%2Fb.tar"],
        ["Shop/a%2F.b%2Fc", "Shop/a%2F.b%2Fc"],
        ["/Shop/./backup.tar", "Shop/backup.tar"],
    ])("keeps %s", (remotePath, clean) => {
        expect(cleanPath(remotePath)).toBe(clean);
    });
});
