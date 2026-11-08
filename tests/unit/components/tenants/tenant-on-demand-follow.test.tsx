import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

const overrides = [
    { kind: "database", id: "a-1", sourceId: "srv-1", serverName: "Shared MySQL", providerId: "default", providerName: "Main", name: "shop", perDay: 0 },
    { kind: "rule", id: "r-1", sourceId: "srv-2", serverName: "Partner Postgres", providerId: null, providerName: "Another tenant", name: "crm_*", perDay: 4, beyondReach: true },
];

vi.mock("@/app/actions/tenant/tenant-on-demand", () => ({
    getTenantOnDemand: vi.fn().mockResolvedValue({ success: true, data: { name: "Acme", perDay: 2, overrides } }),
    followTenantOnDemand: vi.fn(),
}));

const { OnDemandPane } = await import("@/components/dashboard/tenants/tenant-edit-panes");

type Tenant = ComponentProps<typeof OnDemandPane>["tenant"];

describe("the databases and rules of a customer that set their own number of backups on demand", () => {
    it("offer Follow only where the server belongs to a tenant the viewer reaches", async () => {
        render(
            <OnDemandPane
                tenant={{ id: "acme", name: "Acme" } as Tenant}
                value={{ on: true, perDay: 2 }}
                onChange={() => {}}
                disabled={false}
                canManage
                onChanged={() => {}}
            />,
        );

        expect(await screen.findByRole("button", { name: "Let shop follow Acme" })).toBeInTheDocument();
        expect(screen.getByText("crm_*")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Let crm_* follow Acme" })).toBeNull();
    });
});
