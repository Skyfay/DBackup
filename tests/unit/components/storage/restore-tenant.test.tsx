/**
 * A customer's backup on a destination another tenant shares belongs to the customer, while the
 * destination belongs to the tenant that shares it. The restore address names the tenant of the
 * backup, so the restore page in All tenants opens it in the customer, and the run of a backup is
 * looked up in its own tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { TenantViewProvider } from "@/components/tenant/tenant-view";
import { restoreHref } from "@/components/dashboard/storage/restore-scope";
import { encodeUrlPayload } from "@/lib/url-payload";
import type { ExplorerDestination, ExplorerIndex } from "@/services/storage/explorer-types";
import { destination, file, ok } from "./explorer-fixtures";

let search = new URLSearchParams();
const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => search,
    usePathname: () => "/dashboard/backups/restore",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
const switchTenant = vi.fn();
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: (...args: unknown[]) => switchTenant(...args) }));
vi.mock("@/app/actions/storage/lock", () => ({ lockBackup: vi.fn() }));
vi.mock("@/components/dashboard/storage/download/download-dialog", () => ({ DownloadDialog: () => null }));
vi.mock("@/components/dashboard/storage/integrity/integrity-dialog", () => ({ IntegrityDialog: () => null }));
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({ EncryptionKeyResolutionDialog: () => null }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: {}, isListingStale: () => false }));

const { RestoreAllTenants } = await import("@/app/dashboard/backups/restore/restore-all-tenants");
const { useBackupActions } = await import("@/components/dashboard/storage/explorer/use-backup-actions");
const { StorageExplorerService } = await import("@/services/storage/explorer-service");

const TENANTS = [{ id: "default", name: "Platform" }, { id: "beta", name: "Beta AG" }];
const customerFile = file("Beta_shop.tar", 5, { path: "Shop nightly/Beta_shop.tar", jobId: "job-beta" });
// The platform shares its S3 with Beta. In All tenants the destination is listed for the platform.
const shared: ExplorerDestination = destination("msp-s3", "MSP S3", { tenantId: "default" });

describe("the restore address", () => {
    it("names the tenant of the backup beside its destination", () => {
        const href = restoreHref({ destinationId: "msp-s3", file: "payload", tenantId: "beta", mode: "databases", pick: ["shop"] });
        const params = new URLSearchParams(href.split("?")[1]);
        expect(Object.fromEntries(params)).toEqual({ destinationId: "msp-s3", file: "payload", mode: "databases", pick: "shop", tenant: "beta" });
    });

    it("comes from a backup the customer opens on the destination the platform shares", () => {
        // In Beta the shared destination lists Beta's backups, so the listing names Beta.
        const destinations = new Map([["msp-s3", { ...shared, tenantId: "beta", provider: "Platform" }]]);
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <TenantViewProvider value={{ tenants: TENANTS, activeTenantId: "beta", allTenants: false, isPlatformAdmin: false }}>{children}</TenantViewProvider>
        );
        const { result } = renderHook(() => useBackupActions({ canDownload: false, canRestore: true, canDelete: false, canManageVault: false, destinations, onChanged: vi.fn() }), { wrapper });

        result.current.handlersFor({ file: customerFile, destinationId: "msp-s3" }).onRestore?.("all");

        expect(push).toHaveBeenCalledWith(expect.stringContaining("&tenant=beta"));
    });
});

describe("the restore page in All tenants", () => {
    beforeEach(() => {
        push.mockClear();
        switchTenant.mockReset().mockResolvedValue({ success: true, data: { name: "Beta AG" } });
        const index: ExplorerIndex = { destinations: [shared], jobs: [] };
        vi.stubGlobal("fetch", vi.fn((url: string) => (url === "/api/storage/explorer" ? ok(index) : ok(null))));
    });

    it("opens a customer's backup on a shared destination in the customer, not in the tenant of the destination", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams({ destinationId: "msp-s3", file: encodeUrlPayload(customerFile), tenant: "beta" });
        render(
            <TenantViewProvider value={{ tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: true }}>
                <RestoreAllTenants />
            </TenantViewProvider>
        );

        expect(await screen.findByText("Open it in Beta AG to pick what comes back and where it goes.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Open in Beta AG" }));
        await waitFor(() => expect(switchTenant).toHaveBeenCalledWith("beta"));
    });

    it("still takes the tenant of the destination for an address without one", async () => {
        search = new URLSearchParams({ destinationId: "msp-s3", file: encodeUrlPayload(customerFile) });
        render(
            <TenantViewProvider value={{ tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: true }}>
                <RestoreAllTenants />
            </TenantViewProvider>
        );

        expect(await screen.findByText("Open it in Platform to pick what comes back and where it goes.")).toBeInTheDocument();
    });
});

describe("the run of a backup in All tenants", () => {
    it("is looked up in the tenant of the backup, since two tenants can have a backup at the same path", async () => {
        prismaMock.execution.findMany.mockResolvedValue([] as never);

        await new StorageExplorerService().getExecution("Shop nightly/Beta_shop.tar", "beta");

        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { path: { in: ["Shop nightly/Beta_shop.tar", "/Shop nightly/Beta_shop.tar"] }, tenantId: "beta" },
        }));
    });
});
