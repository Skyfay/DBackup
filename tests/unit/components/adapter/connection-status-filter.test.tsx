/**
 * One quick filter for every list of connections: All, Online, Issues, Unused, and Provided while
 * the list holds anything another tenant gives. A server of another tenant has no health and no job
 * of the tenant, so it never counts as online, an issue or unused, and counts once as provided
 * however many of its databases the tenant holds.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionStatusFilter, effectiveStatusFilter, matchesStatus, statusFilterOptions, type StatusFilter } from "@/components/adapter/connection-status-filter";
import { connection, provided, sharedRow } from "./shared-database-fixtures";

const OFFLINE = connection("crm", { lastStatus: "OFFLINE" });
const IDLE = connection("old", { overview: { ...connection("x").overview!, usedBy: { jobs: 0, templates: 0 } } });
const ONLINE = connection("erp");
const SHOP = sharedRow([provided("acme_shop"), provided("acme_crm")]);
const CRM = sharedRow([provided("acme_reports")], { sourceId: "srv-pg", serverName: "Shared Postgres 16" });
const PROVIDED_DESTINATION = connection("nas", { type: "storage", provided: { providerId: "msp", providerName: "Skyfay Hosting", encryptedOnly: true, ownRecipients: false } });

const count = (configs: Parameters<typeof matchesStatus>[0][], filter: StatusFilter) => configs.filter((config) => matchesStatus(config, filter)).length;

describe("the quick filter of a list of connections", () => {
    it("offers Provided only while the list holds something another tenant gives", () => {
        expect(statusFilterOptions([ONLINE, OFFLINE], true)).toEqual(["all", "online", "issues", "unused"]);
        expect(statusFilterOptions([ONLINE, SHOP], true)).toEqual(["all", "online", "issues", "unused", "provided"]);
        expect(statusFilterOptions([PROVIDED_DESTINATION], true)).toContain("provided");
        // Channels have no health checks, so they filter by use and by whose they are.
        expect(statusFilterOptions([PROVIDED_DESTINATION], false)).toEqual(["all", "unused", "provided"]);
    });

    it("never counts a provided server as online, an issue or unused, and counts each server once as provided", () => {
        const configs = [ONLINE, OFFLINE, IDLE, SHOP, CRM];
        expect(count(configs, "all")).toBe(5);
        expect(count(configs, "online")).toBe(2);
        expect(count(configs, "issues")).toBe(1);
        expect(count(configs, "unused")).toBe(1);
        expect(count(configs, "provided")).toBe(2);
    });

    it("counts a destination another tenant shares as provided", () => {
        expect(matchesStatus(PROVIDED_DESTINATION, "provided")).toBe(true);
        expect(matchesStatus(ONLINE, "provided")).toBe(false);
    });

    it("shows everything again once the last provided row is gone while Provided was picked", () => {
        expect(effectiveStatusFilter("provided", [ONLINE, SHOP], true)).toBe("provided");
        expect(effectiveStatusFilter("provided", [ONLINE], true)).toBe("all");
        expect(effectiveStatusFilter("issues", [ONLINE], true)).toBe("issues");
    });

    it("is one row of chips with their counts, and a click picks Provided", async () => {
        const onChange = vi.fn();
        render(<ConnectionStatusFilter value="all" onChange={onChange} configs={[ONLINE, OFFLINE, SHOP, CRM]} withHealth />);

        const group = screen.getByRole("group", { name: "Filter by status" });
        expect(group).toHaveTextContent("All4Online1Issues1Unused0Provided2");
        await userEvent.setup().click(screen.getByRole("button", { name: /Provided/ }));
        expect(onChange).toHaveBeenCalledWith("provided");
        // The separate filter of whose a connection is went into this one.
        expect(screen.queryByRole("group", { name: "Filter by whose it is" })).toBeNull();
    });
});
