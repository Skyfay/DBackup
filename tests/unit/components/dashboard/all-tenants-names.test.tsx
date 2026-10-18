/**
 * In All tenants the lists hold the records of every tenant, so the Upcoming card of the Overview
 * and the freshness of the Backups page name the tenant of each job and destination, like the other
 * lists do. In one tenant they stay as they were.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantViewProvider, type TenantView } from "@/components/tenant/tenant-view";
import { UpcomingRuns } from "@/components/dashboard/widgets/upcoming-runs";
import { FreshnessButton } from "@/components/dashboard/storage/explorer/freshness-button";
import { destination } from "../storage/explorer-fixtures";

vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

const TENANTS = [{ id: "acme", name: "Acme GmbH" }, { id: "beta", name: "Beta AG" }];
const ALL: TenantView = { tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: true };
const ONE: TenantView = { tenants: TENANTS, activeTenantId: "acme", allTenants: false, isPlatformAdmin: true };

const start = Date.now();
const schedule = {
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(start + 48 * 3_600_000).toISOString(),
    slots: 1,
    jobs: [
        { id: "acme-shop", name: "Shop nightly", estimatedMs: 60_000, likelyToFail: false, tenantId: "acme" },
        { id: "beta-shop", name: "Shop nightly", estimatedMs: 60_000, likelyToFail: false, tenantId: "beta" },
    ],
    runs: [
        { jobId: "acme-shop", at: new Date(start + 3_600_000).toISOString() },
        { jobId: "beta-shop", at: new Date(start + 2 * 3_600_000).toISOString() },
    ],
    conflicts: [],
    truncated: false,
};

describe("the Upcoming card", () => {
    it("names the tenant of each job in All tenants, where two jobs can share a name", () => {
        render(<TenantViewProvider value={ALL}><UpcomingRuns schedule={schedule} /></TenantViewProvider>);

        expect(screen.getByText(/Shop nightly in Acme GmbH/)).toBeInTheDocument();
        expect(screen.getByText(/Shop nightly in Beta AG/)).toBeInTheDocument();
    });

    it("names no tenant inside one", () => {
        render(<TenantViewProvider value={ONE}><UpcomingRuns schedule={schedule} /></TenantViewProvider>);

        expect(screen.queryByText(/in Acme GmbH/)).not.toBeInTheDocument();
    });
});

describe("the freshness of the Backups page", () => {
    const destinations = [destination("acme-nas", "NAS", { tenantId: "acme" }), destination("beta-nas", "NAS", { tenantId: "beta" })];

    it("names the tenant of each destination in All tenants", async () => {
        const user = userEvent.setup();
        render(<TenantViewProvider value={ALL}><FreshnessButton destinations={destinations} onCheckNow={vi.fn()} /></TenantViewProvider>);

        await user.click(screen.getByRole("button", { name: "How old the lists are" }));

        expect(await screen.findByText(/Acme GmbH ·/)).toBeInTheDocument();
        expect(screen.getByText(/Beta AG ·/)).toBeInTheDocument();
    });

    it("names no tenant inside one", async () => {
        const user = userEvent.setup();
        render(<TenantViewProvider value={ONE}><FreshnessButton destinations={destinations} onCheckNow={vi.fn()} /></TenantViewProvider>);

        await user.click(screen.getByRole("button", { name: "How old the lists are" }));

        expect(await screen.findAllByText("NAS")).toHaveLength(2);
        expect(screen.queryByText(/Acme GmbH ·/)).not.toBeInTheDocument();
    });
});
