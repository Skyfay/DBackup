import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/lib/clipboard";

/** What the copy command of the browser put on the clipboard, from the selection it copied. */
let copied: string | null = null;

function clipboard(value: unknown) {
    Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

describe("copying text to the clipboard", () => {
    beforeEach(() => {
        copied = null;
        document.execCommand = vi.fn((command: string) => {
            if (command !== "copy") return false;
            copied = document.getSelection()?.toString() ?? null;
            return true;
        });
    });

    afterEach(() => {
        // Drops the own property again, so the clipboard of the test environment shows through.
        delete (navigator as { clipboard?: unknown }).clipboard;
        document.body.innerHTML = "";
    });

    it("uses the Clipboard API where the browser offers it", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        clipboard({ writeText });

        await expect(copyToClipboard("dbackup_123")).resolves.toBe(true);

        expect(writeText).toHaveBeenCalledWith("dbackup_123");
        expect(document.execCommand).not.toHaveBeenCalled();
    });

    it("copies over plain HTTP, where the browser has no Clipboard API, line breaks and all", async () => {
        clipboard(undefined);

        await expect(copyToClipboard("code-1\ncode-2")).resolves.toBe(true);

        expect(copied).toBe("code-1\ncode-2");
        // Nothing of it stays on the page.
        expect(document.body.textContent).toBe("");
    });

    it("falls back to the copy command when the browser refuses the Clipboard API", async () => {
        clipboard({ writeText: vi.fn().mockRejectedValue(new Error("Document is not focused")) });

        await expect(copyToClipboard("abc")).resolves.toBe(true);

        expect(copied).toBe("abc");
    });

    it("says so when nothing arrived, so no Copy button claims it", async () => {
        clipboard(undefined);
        vi.mocked(document.execCommand).mockReturnValue(false);

        await expect(copyToClipboard("abc")).resolves.toBe(false);
    });

    it("leaves what the person had selected as it was", async () => {
        clipboard(undefined);
        const paragraph = document.createElement("p");
        paragraph.textContent = "picked by hand";
        document.body.appendChild(paragraph);
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        document.getSelection()?.addRange(range);

        await copyToClipboard("abc");

        expect(copied).toBe("abc");
        expect(document.getSelection()?.toString()).toBe("picked by hand");
    });
});
