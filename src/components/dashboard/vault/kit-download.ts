import { toast } from "sonner";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "kit-download" });

/** The file name the server gave, from `filename*` when it is there, since it keeps any character. */
export function fileNameOf(disposition: string | null): string | null {
    if (!disposition) return null;
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (encoded) {
        try {
            return decodeURIComponent(encoded[1]);
        } catch {
            // Falls through to the plain name.
        }
    }
    return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

/**
 * Downloads the recovery kit of these keys. Fetched rather than followed as a link, so the page
 * knows when the kit is built, can say when it failed, and loads the keys again afterwards, since
 * the server notes the kit on each of them. False when it failed, which a toast explains.
 */
export async function downloadRecoveryKit(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;
    try {
        const response = await fetch(`/api/vault/recovery-kit?ids=${ids.map(encodeURIComponent).join(",")}`);
        if (!response.ok) {
            const reason = await response.text().catch(() => "");
            toast.error(reason && reason.length < 200 ? reason : "The recovery kit could not be built.");
            return false;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameOf(response.headers.get("Content-Disposition")) ?? "recovery_kit.zip";
        link.click();
        // Later rather than right away, which cancels the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return true;
    } catch (error) {
        log.error("Downloading a recovery kit failed", { keys: ids.length }, wrapError(error));
        toast.error("The recovery kit could not be downloaded.");
        return false;
    }
}
