import { toast } from "sonner";

/**
 * Downloads a selection out of a seekable archive: files, database dumps, or both.
 *
 * Two steps on purpose. The first call only validates the request and returns a handle, the
 * browser then fetches the result itself, so the bytes go straight to disk through its
 * download manager instead of through the page. A selection can be far larger than this
 * machine's RAM, which buffering it in the tab would require.
 *
 * @param intercept - The page's key-recovery hook. Returns true when it opened the key dialog,
 * which retries on its own once the user has answered.
 */
export async function startPreparedArchiveDownload(params: {
    destinationId: string;
    body: {
        file: string;
        selections?: { src: string; paths?: string[] }[];
        databases?: string[];
        excludePatterns?: string[];
        profileIdOverride?: string;
    };
    intercept: (response: Response) => Promise<boolean>;
    preparingLabel?: string;
}): Promise<void> {
    const { destinationId, body, intercept } = params;
    const endpoint = `/api/storage/${destinationId}/restore-files`;
    const toastId = toast.loading(params.preparingLabel ?? "Preparing download...");

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, target: { kind: "download" }, prepare: true }),
        });

        if (await intercept(res)) {
            toast.dismiss(toastId);
            return;
        }

        const payload = await res.json().catch(() => ({ error: "Download failed" }));
        if (!res.ok || !payload?.data?.token) {
            throw new Error(payload.error || "Download failed");
        }

        const anchor = document.createElement("a");
        anchor.href = `${endpoint}?token=${encodeURIComponent(payload.data.token)}`;
        anchor.download = payload.data.fileName;
        anchor.click();

        toast.success("Download started - see your browser downloads for progress", { id: toastId });
    } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : String(e), { id: toastId });
    }
}
