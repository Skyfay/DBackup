/**
 * The menus of a server of another tenant: Back up now names each of its databases the tenant holds,
 * with what is left today, switched off where the provider allows none, the day is used up or one
 * runs. Then Show details and Show its backups. The menu of one database in the panel restores or
 * downloads its newest backup. Edit, test, clone and delete never show, they stay with the provider.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { backUpLine, sharedDatabaseMenu, sharedServerBackupsHref, sharedServerMenu, type SharedServerAccess } from "@/components/adapter/shared-server-actions";
import { SharedServerContextMenu } from "@/components/adapter/shared-server-menus";
import { provided, serverTerms, sharedBackup } from "./shared-database-fixtures";

const ALL: SharedServerAccess = { canBackUp: true, canRestore: true, canViewBackups: true, canDownload: true };
const NONE: SharedServerAccess = { canBackUp: false, canRestore: false, canViewBackups: false, canDownload: false };

const SHOP = provided("acme_shop", { perDay: 4, usedToday: 2, active: null }, sharedBackup("b5", "acme_shop", "2026-10-17T02:14:00.000Z"));
const CRM = provided("acme_crm", null, sharedBackup("c3", "acme_crm", "2026-10-16T02:13:00.000Z"));
const TICKETS = provided("acme_tickets", { perDay: 4, usedToday: 1, active: { requestId: "req-1", state: "running" } });
const BLOG = provided("acme_blog", { perDay: 4, usedToday: 4, active: null });

const handlers = (starting: string | null = null) => ({ onBackUp: vi.fn(), onShowDetails: vi.fn(), onShowBackups: vi.fn(), starting });

const flat = (groups: ReturnType<typeof sharedServerMenu>) =>
    groups.map((group) => [group.label ?? null, group.entries.map((entry) => [entry.label, entry.note ?? null, entry.disabled ?? false])]);

describe("the row menu of a provided server", () => {
    it("offers Back up now per database, with what is left today or why it is off", () => {
        const terms = serverTerms([SHOP, CRM, TICKETS, BLOG]);
        expect(flat(sharedServerMenu(terms, ALL, handlers()))).toEqual([
            ["Back up now", [
                ["acme_shop", "2 of 4 left today", false],
                ["acme_crm", "Skyfay Hosting allows none", true],
                ["acme_tickets", "A backup runs now", true],
                ["acme_blog", "All 4 of today used, the next one tomorrow", true],
            ]],
            [null, [
                ["Show details", null, false],
                ["Show its backups", "2 of acme_shop and 3 more", false],
            ]],
        ]);
    });

    it("starts the backup of the database picked and opens the details", () => {
        const handled = handlers();
        const [backUp, rest] = sharedServerMenu(serverTerms([SHOP, CRM]), ALL, handled);
        backUp.entries[0].onSelect();
        rest.entries[0].onSelect();

        expect(handled.onBackUp).toHaveBeenCalledWith(SHOP.database);
        expect(handled.onShowDetails).toHaveBeenCalled();
    });

    it("switches every Back up now off while one starts", () => {
        const [backUp] = sharedServerMenu(serverTerms([SHOP]), ALL, handlers("srv-mysql/acme_crm"));
        expect(backUp.entries[0].disabled).toBe(true);
    });

    it("hides what the viewer may not do and keeps Show details", () => {
        const terms = serverTerms([SHOP, CRM]);
        expect(flat(sharedServerMenu(terms, NONE, handlers()))).toEqual([[null, [["Show details", null, false]]]]);
        expect(sharedServerMenu(terms, { ...NONE, canViewBackups: true }, handlers())[0].entries.map((entry) => entry.id)).toEqual(["details", "backups"]);
    });

    it("links to the backups of its one database, or of all of its databases in the Job filter", () => {
        expect(sharedServerBackupsHref(serverTerms([SHOP]))).toBe("/dashboard/backups?quick=shared&shared=srv-mysql%2Facme_shop");
        expect(sharedServerBackupsHref(serverTerms([SHOP, CRM]))).toBe(
            "/dashboard/backups?quick=shared&job=shared%3Asrv-mysql%2Facme_shop&job=shared%3Asrv-mysql%2Facme_crm",
        );
        expect(backUpLine(CRM.database, "Skyfay Hosting")).toBe("Skyfay Hosting allows none");
    });

    it("says in the right click menu whose server it is and that edit, test and delete stay with them", () => {
        const terms = serverTerms([SHOP, CRM]);
        render(
            <ContextMenu>
                <ContextMenuTrigger>row</ContextMenuTrigger>
                <SharedServerContextMenu terms={terms} adapterId="mysql" groups={sharedServerMenu(terms, ALL, handlers())} />
            </ContextMenu>
        );
        fireEvent.contextMenu(screen.getByText("row"));

        const menu = screen.getByRole("menu");
        expect(menu).toHaveTextContent("Shared MySQL 8.0");
        expect(menu).toHaveTextContent("from Skyfay Hosting · 2 databases yours");
        expect(menu).toHaveTextContent("Back up now");
        expect(menu).toHaveTextContent("Skyfay Hosting runs the server. Edit, test and delete stay with them.");
        expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
            "acme_shop2 of 4 left today",
            "acme_crmSkyfay Hosting allows none",
            "Show details",
            "Show its backups2 of acme_shop and acme_crm",
        ]);
        for (const word of ["Edit", "Clone", "Delete", "Test connection"]) {
            expect(screen.queryByRole("menuitem", { name: word })).toBeNull();
        }
    });
});

describe("the menu of one database in the panel", () => {
    const databaseHandlers = { onRestore: vi.fn(), onDownload: vi.fn(), downloading: false, when: () => "Oct 17, 2:14 AM" };

    it("restores and downloads its newest backup, each for whoever may", () => {
        expect(sharedDatabaseMenu(SHOP, ALL, databaseHandlers).map((entry) => [entry.label, entry.note, entry.tone])).toEqual([
            ["Restore the newest", "Oct 17, 2:14 AM into acme_shop", "warning"],
            ["Download the newest", "The dump of Oct 17, 2:14 AM", "neutral"],
        ]);
        expect(sharedDatabaseMenu(SHOP, { ...NONE, canDownload: true }, databaseHandlers).map((entry) => entry.id)).toEqual(["download"]);
        expect(sharedDatabaseMenu(SHOP, NONE, databaseHandlers)).toEqual([]);
    });

    it("offers nothing before the first backup, or while the viewer gets no backups", () => {
        expect(sharedDatabaseMenu(TICKETS, ALL, databaseHandlers)).toEqual([]);
    });

    it("hands the database to the restore", () => {
        sharedDatabaseMenu(SHOP, ALL, databaseHandlers)[0].onSelect();
        expect(databaseHandlers.onRestore).toHaveBeenCalledWith(SHOP);
    });
});
