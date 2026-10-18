/**
 * In All tenants the Overview holds the records of every tenant, so a run, a destination and the
 * next scheduled run name their tenant, the way the other lists of All tenants do. Two "Local"
 * destinations of different tenants would otherwise look the same.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { TenantViewProvider, type TenantView } from "@/components/tenant/tenant-view";
import type { LatestJobEntry, StorageVolumeEntry } from "@/services/dashboard-service";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard" }));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: vi.fn() }));
vi.mock("@/hooks/use-user-preferences", () => ({ useUserPreferences: () => ({ autoRedirectOnJobStart: false }) }));

const { ExecutionsList } = await import("@/components/dashboard/widgets/executions-list");
const { StorageDestinations } = await import("@/components/dashboard/widgets/storage-destinations");
const { StatusBanner } = await import("@/components/dashboard/widgets/status-banner");

const TENANTS = [{ id: "acme", name: "Acme GmbH" }, { id: "globex", name: "Globex AG" }];
const ALL: TenantView = { tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: true };
const IN_ACME: TenantView = { tenants: TENANTS, activeTenantId: "acme", allTenants: false, isPlatformAdmin: true };

const inView = (view: TenantView, children: ReactNode) => render(<TenantViewProvider value={view}>{children}</TenantViewProvider>);

const RUN: LatestJobEntry = {
    id: "run-1", type: "Backup", status: "Success", jobName: "Backup of shop_acme", sub: "Backup · on Shared MySQL", tenantId: "acme",
    sourceName: null, sourceType: null, startedAt: new Date("2026-10-17T10:00:00Z"), duration: 60_000, size: 1024,
};
const LOCALS: StorageVolumeEntry[] = [
    { configId: "acme-local", tenantId: "acme", name: "Local", adapterId: "local-filesystem", size: 2048, count: 2 },
    { configId: "globex-local", tenantId: "globex", name: "Local", adapterId: "local-filesystem", size: 1024, count: 1 },
];

describe("the Overview in All tenants", () => {
    it("names the tenant of each of the latest executions beside what it did", () => {
        inView(ALL, <ExecutionsList executions={[RUN]} canViewHistory={false} />);

        expect(screen.getByText("Backup of shop_acme")).toBeInTheDocument();
        expect(screen.getByText("Acme GmbH · Backup · on Shared MySQL")).toBeInTheDocument();
    });

    it("names the tenant of each destination, so two of the same name stay apart", () => {
        inView(ALL, <StorageDestinations entries={LOCALS} updatedAt={null} />);

        expect(screen.getByText(/Acme GmbH ·/)).toBeInTheDocument();
        expect(screen.getByText(/Globex AG ·/)).toBeInTheDocument();
    });

    it("names the tenant of the next scheduled run", () => {
        inView(ALL, <StatusBanner health={{ state: "healthy", lastRunAt: null, nextRun: { jobName: "Nightly", at: "2026-10-18T03:00:00.000Z", tenantId: "globex" } }} canExecute={false} canViewHistory={false} canManageJobs={false} />);

        expect(screen.getByText(/in Globex AG at/)).toBeInTheDocument();
    });

    it("names no tenant inside one tenant, where every record is its own", () => {
        inView(IN_ACME, (
            <>
                <ExecutionsList executions={[RUN]} canViewHistory={false} />
                <StorageDestinations entries={LOCALS.slice(0, 1)} updatedAt={null} />
                <StatusBanner health={{ state: "healthy", lastRunAt: null, nextRun: { jobName: "Nightly", at: "2026-10-18T03:00:00.000Z", tenantId: "acme" } }} canExecute={false} canViewHistory={false} canManageJobs={false} />
            </>
        ));

        expect(screen.getByText("Backup · on Shared MySQL")).toBeInTheDocument();
        expect(screen.queryByText(/Acme GmbH/)).not.toBeInTheDocument();
    });
});
