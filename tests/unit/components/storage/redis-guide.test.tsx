import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

import { RedisGuide } from "@/components/dashboard/storage/restore/redis-guide";
import type { FileInfo } from "@/components/dashboard/storage/file-info";

const LINK = "https://dbackup.test/api/storage/public-download?token=abc";
const FILE = {
    name: "Cache_nightly_2026-09-24.tar", path: "Cache nightly/Cache_nightly_2026-09-24.tar", size: 48 * 1024 ** 2, lastModified: "2026-09-24T02:00:00.000Z",
    createdAt: "2026-09-24T02:00:00.000Z", jobName: "Cache nightly", sourceType: "redis", hasFileIndex: true,
} as FileInfo;

/** The text of every code block on the page, the script first. */
const codes = () => [...document.querySelectorAll("pre code")].map((code) => code.textContent ?? "");

describe("Redis restore guide", () => {
    beforeEach(() => {
        // The same answer the download-url route gives.
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, url: LINK, expiresIn: "5 minutes", singleUse: true }) }) as Response));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("writes the link into the script and into the manual steps once it is made", async () => {
        const user = userEvent.setup();
        render(<RedisGuide file={FILE} destinationId="nas" engine="Redis" canDownload />);

        expect(codes()[0]).toContain('curl -fo dump.rdb "<make the link in DBackup first>"');
        await user.click(screen.getByRole("button", { name: "Make the link" }));

        expect(await screen.findByText("The link is in the commands")).toBeInTheDocument();
        expect(codes()[0]).toContain(`curl -fo dump.rdb "${LINK}"`);
        expect(codes()[0]).toContain("# Restores Cache nightly of 2026-09-24 02:00 into the Docker container redis.");
        expect(fetch).toHaveBeenCalledWith("/api/storage/nas/download-url", expect.objectContaining({ method: "POST", body: JSON.stringify({ file: FILE.path }) }));

        await user.click(screen.getByRole("tab", { name: "Manual" }));
        expect(codes()).toContain(`curl -fo dump.rdb "${LINK}"`);
        expect(screen.queryByRole("button", { name: "Download the script" })).not.toBeInTheDocument();
    });

    it("writes the commands for where Redis runs, PowerShell on Windows", async () => {
        const user = userEvent.setup();
        render(<RedisGuide file={FILE} destinationId="nas" engine="Redis" canDownload />);

        await user.click(screen.getByRole("radio", { name: /Linux service/ }));
        expect(screen.getByRole("textbox", { name: "Service" })).toHaveValue("redis-server");
        expect(codes()[0]).toContain('sudo systemctl stop "$SERVICE"');

        await user.click(screen.getByRole("radio", { name: /Windows service/ }));
        expect(screen.getByRole("textbox", { name: "Data folder" })).toHaveValue("C:\\Program Files\\Redis");
        expect(screen.getByRole("button", { name: "Copy restore-cache-nightly.ps1" })).toBeInTheDocument();
        expect(codes()[0]).toContain("Stop-Service -Name $Service -ErrorAction Stop");

        await user.click(screen.getByRole("switch", { name: "Redis asks for a password" }));
        expect(codes()[0]).not.toContain("REDISCLI_AUTH =");
    });

    it("says when the link in the commands ran out and offers a new one", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<RedisGuide file={FILE} destinationId="nas" engine="Redis" canDownload />);
        await user.click(screen.getByRole("button", { name: "Make the link" }));
        await screen.findByText("The link is in the commands");

        await act(async () => {
            vi.advanceTimersByTime(5 * 60 * 1000);
        });

        expect(screen.getByText("The link in the commands has run out")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "New link" })).toBeEnabled();
    });

    it("tells someone who may not download why the commands have no link", () => {
        render(<RedisGuide file={FILE} destinationId="nas" engine="Valkey" canDownload={false} />);

        expect(screen.getByText("The dump needs the Download permission")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Make the link" })).not.toBeInTheDocument();
        expect(codes()[0]).toContain("valkey-cli");
    });
});
