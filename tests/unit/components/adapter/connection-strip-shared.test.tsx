/**
 * The numbers of the Databases tab count the servers of other tenants among the connections, with
 * how many of their databases the tenant got, and leave them out of whether the connections answer,
 * their response and their jobs, which stay with the provider.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionStrip } from "@/components/adapter/connection-strip";
import { connection, provided, sharedBackup, sharedRow } from "./shared-database-fixtures";

const tileOf = (label: string) => screen.getByText(label).closest(".rounded-lg") as HTMLElement;

describe("the numbers of the Databases tab", () => {
    it("count the provided servers with their databases and leave them out of the health numbers", () => {
        render(<ConnectionStrip kind="database" configs={[
            connection("erp"),
            connection("crm", { lastStatus: "OFFLINE" }),
            sharedRow([provided("acme_shop", null, sharedBackup("b5", "acme_shop", "2026-10-17T02:14:00.000Z")), provided("acme_crm")]),
            sharedRow([provided("acme_reports")], { sourceId: "srv-pg", serverName: "Shared Postgres 16" }),
        ]} />);

        const count = tileOf("Connections, 2 provided, 3 databases");
        expect(count).toHaveTextContent("4");
        expect(count).toHaveTextContent("Shared MySQL 8.0 and Shared Postgres 16 from Skyfay Hosting");
        expect(tileOf("Answering")).toHaveTextContent("1of 2");
        expect(tileOf("In a job")).toHaveTextContent("2of 2");
        expect(tileOf("Last backup")).toHaveTextContent("of Shared MySQL 8.0");
    });

    it("stay as before for a tenant without shared databases", () => {
        render(<ConnectionStrip kind="database" configs={[connection("erp"), connection("crm")]} />);
        expect(tileOf("Databases")).toHaveTextContent("2");
        expect(screen.queryByText(/provided, /)).toBeNull();
    });
});
