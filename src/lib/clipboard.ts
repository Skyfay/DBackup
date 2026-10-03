/**
 * Puts text on the clipboard, also for a DBackup served over plain HTTP on an address of the
 * local network. The Clipboard API exists only in a secure context, so there the text is selected
 * in an element off screen and copied with the copy command of the browser instead. Every Copy
 * button goes through here and says Copied only when the text arrived.
 */

/** The toast of a copy that failed, which leaves the text on the screen to select by hand. */
export const COPY_FAILED = "Copying failed. Select the text and copy it by hand.";

/** Answers whether the text is on the clipboard now. */
export async function copyToClipboard(text: string): Promise<boolean> {
    // A browser leaves `navigator.clipboard` out entirely outside a secure context.
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Refused, like while the page has no focus. The copy command may still work.
        }
    }
    return copyWithSelection(text);
}

/**
 * Selects the text in an element off screen and copies the selection. A selection rather than a
 * field, since a field would take the focus, which the focus trap of an open dialog takes back.
 */
function copyWithSelection(text: string): boolean {
    if (typeof document === "undefined" || !document.body) return false;
    const holder = document.createElement("span");
    holder.textContent = text;
    // Kept as written, with its line breaks, but out of sight and out of the way of the page.
    holder.style.whiteSpace = "pre";
    holder.style.position = "fixed";
    holder.style.top = "0";
    holder.style.clip = "rect(0, 0, 0, 0)";
    holder.style.userSelect = "text";
    holder.setAttribute("aria-hidden", "true");
    document.body.appendChild(holder);

    const selection = document.getSelection();
    const before = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    let copied = false;
    try {
        const range = document.createRange();
        range.selectNodeContents(holder);
        selection?.removeAllRanges();
        selection?.addRange(range);
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    } finally {
        selection?.removeAllRanges();
        if (before) selection?.addRange(before);
        holder.remove();
    }
    return copied;
}
