import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalSearch } from "@/components/layout/global-search";
import { HeaderLinks } from "@/components/layout/header-links";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { SearchHit } from "@/services/search/search-types";

const mocks = vi.hoisted(() => ({ push: vi.fn(), setTheme: vi.fn(), startRun: vi.fn(), hits: [] as unknown[] }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => "/dashboard" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: mocks.setTheme }) }));
vi.mock("@/components/dashboard/history/run-actions", () => ({ startRun: (...args: unknown[]) => mocks.startRun(...args) }));

const job: SearchHit = { kind: "job", id: "j1", name: "Nightly MySQL", enabled: true, schedule: "0 2 * * *", adapterId: "mysql", lastStatus: "Failed" };
const run: SearchHit = { kind: "run", id: "r1", name: "Nightly MySQL", status: "Success", startedAt: new Date().toISOString(), adapterId: "mysql" };

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { hits: mocks.hits } }) }));

// Node 25 has a localStorage of its own that does nothing without a file, over the one of jsdom.
function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        get length() {
            return data.size;
        },
        clear: () => data.clear(),
        getItem: (key) => data.get(key) ?? null,
        key: (index) => [...data.keys()][index] ?? null,
        removeItem: (key) => void data.delete(key),
        setItem: (key, value) => void data.set(key, String(value)),
    };
}

function renderSearch(permissions: string[] = [PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.EXECUTE, PERMISSIONS.HISTORY.READ], props: React.ComponentProps<typeof GlobalSearch> = {}) {
    render(<PermissionsProvider permissions={permissions}><GlobalSearch {...props} /></PermissionsProvider>);
    return userEvent.setup();
}

/** A person opened from the search before, kept for whoever the key names. */
const keptUser = { key: "recent:/dashboard/users?tab=users&open=u9", group: "recent", title: "Alex", sub: "alex@example.com · Operators", kind: "User", href: "/dashboard/users?tab=users&open=u9", icon: "user", needs: [PERMISSIONS.USERS.READ] };

async function searchFor(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));
    await user.type(await screen.findByRole("combobox"), text);
    return screen.findByRole("option", { name: /^Nightly MySQL/ });
}

describe("the search in the header", () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
    });

    beforeEach(() => {
        vi.stubGlobal("localStorage", memoryStorage());
        mocks.hits = [job, run];
    });

    it("opens with Ctrl K from anywhere", async () => {
        const user = renderSearch();

        await user.keyboard("{Control>}k{/Control}");

        expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();
    });

    it("opens from the first button of the group on the right of the header, where a phone has it", async () => {
        function Head() {
            const [open, setOpen] = useState(false);
            return (
                <PermissionsProvider permissions={[PERMISSIONS.JOBS.READ]}>
                    <TooltipProvider>
                        <GlobalSearch open={open} onOpenChange={setOpen} />
                        <HeaderLinks onSearch={() => setOpen(true)} />
                    </TooltipProvider>
                </PermissionsProvider>
            );
        }
        render(<Head />);
        const user = userEvent.setup();

        await user.click(screen.getByRole("button", { name: "Search" }));
        expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();

        // The keys still close it while the header holds whether it is open.
        await user.keyboard("{Control>}k{/Control}");
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument());
    });

    it("offers the pages the viewer may open and asks the server nothing while the field is empty", async () => {
        const user = renderSearch();
        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));

        expect(await screen.findByRole("option", { name: /^Jobs/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /^Settings/ })).not.toBeInTheDocument();
        expect(screen.getByRole("option", { name: /^Switch the theme/ })).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("asks the server once for a word typed quickly and opens what was picked", async () => {
        const user = renderSearch();

        await user.click(await searchFor(user, "nightly"));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("/api/search?q=nightly", expect.anything());
        expect(mocks.push).toHaveBeenCalledWith("/dashboard/jobs?job=j1");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("keeps what was opened for the next search, without how it was then", async () => {
        const user = renderSearch();
        await user.click(await searchFor(user, "nightly"));

        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));

        const recent = await screen.findByRole("group", { name: "Recent" });
        expect(within(recent).getByRole("option", { name: /^Nightly MySQL/ })).not.toHaveTextContent("failed");
    });

    it("narrows the hits to one kind with a chip, and Tab walks the chips", async () => {
        const user = renderSearch();
        await searchFor(user, "nightly");

        await user.click(screen.getByRole("button", { name: "Runs" }));

        expect(screen.getByRole("option", { name: /^Run of Nightly MySQL/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /^Nightly MySQL/ })).not.toBeInTheDocument();

        await user.click(screen.getByRole("combobox"));
        await user.keyboard("{Tab}");
        expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-pressed", "true");
    });

    it("starts a found job from the search for someone who may start jobs", async () => {
        const user = renderSearch();
        await searchFor(user, "nightly");

        await user.click(screen.getByRole("option", { name: /^Run Nightly MySQL now/ }));

        expect(mocks.startRun).toHaveBeenCalledWith("j1", "Nightly MySQL");
    });

    it("hides a recent entry once the viewer may no longer open its page", async () => {
        localStorage.setItem("dbackup.search.recent:u1", JSON.stringify([keptUser]));
        const user = renderSearch([PERMISSIONS.JOBS.READ], { userId: "u1" });

        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));

        expect(await screen.findByRole("option", { name: /^Jobs/ })).toBeInTheDocument();
        expect(screen.queryByRole("group", { name: "Recent" })).not.toBeInTheDocument();
        expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    });

    it("keeps the recent entries of each person apart", async () => {
        localStorage.setItem("dbackup.search.recent:u1", JSON.stringify([keptUser]));
        const user = renderSearch([PERMISSIONS.USERS.READ], { userId: "u2" });

        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));

        expect(await screen.findByRole("option", { name: /^Users & Groups/ })).toBeInTheDocument();
        expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    });

    it("shows a recent entry to the same person while they may open it", async () => {
        localStorage.setItem("dbackup.search.recent:u1", JSON.stringify([keptUser]));
        const user = renderSearch([PERMISSIONS.USERS.READ], { userId: "u1" });

        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));

        const recent = await screen.findByRole("group", { name: "Recent" });
        expect(within(recent).getByRole("option", { name: /^Alex/ })).toBeInTheDocument();
    });

    it("offers the chips of the kinds the viewer may see only", async () => {
        const user = renderSearch([PERMISSIONS.JOBS.READ]);
        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));

        const chips = within(await screen.findByRole("group", { name: "Kind" })).getAllByRole("button").map((chip) => chip.textContent);

        expect(chips).toEqual(["All", "Jobs", "Settings"]);
    });

    it("shows the keys of a Mac on a Mac and Ctrl everywhere else", () => {
        const { unmount } = render(<GlobalSearch apple />);
        expect(screen.getByRole("button", { name: /^Search jobs, connections/ })).toHaveTextContent(/CommandK$/);
        unmount();

        render(<GlobalSearch />);
        expect(screen.getByRole("button", { name: /^Search jobs, connections/ })).toHaveTextContent(/CtrlK$/);
    });

    it("offers no start to someone who may only look", async () => {
        const user = renderSearch([PERMISSIONS.JOBS.READ]);
        await searchFor(user, "nightly");

        expect(screen.queryByRole("option", { name: /^Run Nightly MySQL now/ })).not.toBeInTheDocument();
    });
});

describe("the links on the right of the header", () => {
    const renderLinks = (props: React.ComponentProps<typeof HeaderLinks>) => {
        render(<TooltipProvider><HeaderLinks {...props} /></TooltipProvider>);
        return userEvent.setup();
    };

    it("leads to the guides and to DBackup on GitHub, without an update while there is none", () => {
        renderLinks({});

        expect(screen.getByRole("link", { name: "Guides" })).toHaveAttribute("href", "https://docs.dbackup.app");
        expect(screen.getByRole("link", { name: "DBackup on GitHub" })).toHaveAttribute("href", "https://github.com/Skyfay/DBackup");
        expect(screen.queryByRole("button", { name: /is out/ })).not.toBeInTheDocument();
    });

    it("shows a newer version with how to get it", async () => {
        const user = renderLinks({ updateAvailable: true, currentVersion: "3.4.0", latestVersion: "3.5.0" });

        await user.click(screen.getByRole("button", { name: "v3.5.0 is out" }));

        const card = await screen.findByRole("dialog");
        expect(within(card).getByText("DBackup v3.5.0 is out")).toBeInTheDocument();
        expect(within(card).getByText("You run v3.4.0")).toBeInTheDocument();
        expect(within(card).getByText("docker compose pull && docker compose up -d")).toBeInTheDocument();
        await waitFor(() => expect(within(card).getByRole("link", { name: /What's new/ })).toHaveAttribute("href", "https://docs.dbackup.app/changelog"));
    });
});
