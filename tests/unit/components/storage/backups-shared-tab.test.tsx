import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { index, ok, runs } from "./explorer-fixtures";

let search = new URLSearchParams();
const replace = vi.fn((url: string) => {
    search = new URLSearchParams(url.split("?")[1] ?? "");
});
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace }),
    useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/app/actions/storage/lock", () => ({ lockBackup: vi.fn() }));
vi.mock("@/app/actions/auth/table-preferences", () => ({
    saveTableLayout: vi.fn().mockResolvedValue({ success: true }),
    saveViewLayout: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/components/dashboard/storage/download/download-dialog", () => ({ DownloadDialog: () => null }));
vi.mock("@/components/dashboard/storage/integrity/integrity-dialog", () => ({ IntegrityDialog: () => null }));
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({ EncryptionKeyResolutionDialog: () => null }));
vi.mock("@/app/actions/storage/storage-alerts", () => ({ updateStorageAlertSettings: vi.fn(), updateStorageAlertsOfMany: vi.fn() }));
const shared = vi.hoisted(() => ({ getSharedOverview: vi.fn(), downloadSharedBackup: vi.fn(), restoreSharedDatabase: vi.fn() }));
vi.mock("@/app/actions/tenant/shared-databases", () => shared);

import { StorageClient } from "@/app/dashboard/backups/storage-client";
import { SHARED_HREF } from "@/components/dashboard/storage/explorer/use-explorer-address";

Element.prototype.scrollIntoView = vi.fn();

const SHOP = { sourceId: "my", serverName: "MySQL shop", adapterId: "mysql", databaseName: "shop_a", providerName: "Skyfay Hosting", since: "2026-10-01T00:00:00.000Z", until: null };

function page(hasShared: boolean, own = index) {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
        if (url === "/api/storage/explorer") return ok(own);
        if (url === "/api/storage/explorer/runs") return ok({ runs: own === index ? runs : [] });
        return ok(null);
    }));
    return render(<StorageClient canDownload canRestore canDelete={false} canViewHistory hasShared={hasShared} initialLayout={null} initialViews={{ backups: "table", destinations: "table" }} />);
}

describe("the Backups page with databases shared with the tenant", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        replace.mockClear();
        shared.getSharedOverview.mockResolvedValue({ success: true, data: { databases: [SHOP], backups: [] } });
    });

    it("has no third tab while no other tenant shares a database with this one", async () => {
        page(false);
        expect(await screen.findByRole("tab", { name: /Backups/ })).toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: /Shared with you/ })).not.toBeInTheDocument();
    });

    it("adds Shared with you as a third tab, which lives in the address", async () => {
        const user = userEvent.setup();
        page(true);
        await user.click(await screen.findByRole("tab", { name: /Shared with you/ }));
        expect(replace).toHaveBeenLastCalledWith(SHARED_HREF, { scroll: false });
    });

    it("opens on the shared backups for a tenant with nothing of its own", async () => {
        page(true, { jobs: [], destinations: [] });
        expect(await screen.findByRole("tab", { name: /Shared with you/ })).toHaveAttribute("aria-selected", "true");
        expect(await screen.findByText("Shared databases")).toBeInTheDocument();
    });
});
