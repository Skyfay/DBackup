import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), info: vi.fn(), pathname: "/dashboard/settings" }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
    usePathname: () => mocks.pathname,
}));
vi.mock("sonner", () => ({ toast: { info: (...args: unknown[]) => mocks.info(...args) } }));

const { announceTenantSwitch, followsSwitch, TenantSync } = await import("@/components/tenant/tenant-sync");

/** A switch made in another tab, as it reaches this one. */
const other = (tenantId: string, at = Date.now() + 1000) => ({ tenantId, name: tenantId === "*" ? "All tenants" : "Globex", tab: "another-tab", at });

/** Posts a switch on the channel the tabs share, from a tab of its own. */
async function fromAnotherTab(message: object) {
    const channel = new BroadcastChannel("dbackup:tenant");
    channel.postMessage(message);
    channel.close();
    // The channel delivers on a later turn.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

describe("a switch of the tenant in another tab", () => {
    it("is followed by a tab that still shows another tenant", () => {
        const tab = { shown: "acme", since: 1000, handled: 0 };

        expect(followsSwitch(other("globex", 2000), tab, "this-tab")).toBe(true);
        expect(followsSwitch(other("*", 2000), tab, "this-tab")).toBe(true);
    });

    it("is not followed by the tab that made it, one that shows that tenant already, or one that loaded after it", () => {
        const tab = { shown: "acme", since: 1000, handled: 0 };

        expect(followsSwitch({ ...other("globex", 2000), tab: "this-tab" }, tab, "this-tab")).toBe(false);
        expect(followsSwitch(other("acme", 2000), tab, "this-tab")).toBe(false);
        expect(followsSwitch(other("globex", 500), tab, "this-tab")).toBe(false);
        expect(followsSwitch(null, tab, "this-tab")).toBe(false);
    });

    it("is followed once, also when the tab sees it again on the channel and in the storage", () => {
        const tab = { shown: "acme", since: 1000, handled: 2000 };

        expect(followsSwitch(other("globex", 2000), tab, "this-tab")).toBe(false);
        expect(followsSwitch(other("globex", 3000), tab, "this-tab")).toBe(true);
    });
});

describe("the tabs of a browser while the tenant switches", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pathname = "/dashboard/settings";
        localStorage.clear();
    });

    afterEach(() => cleanup());

    it("loads the page again in the tenant another tab opened, and says so", async () => {
        render(<TenantSync shown="acme" />);

        await fromAnotherTab(other("globex"));

        expect(mocks.info).toHaveBeenCalledWith("You work in Globex now, opened in another tab");
        expect(mocks.refresh).toHaveBeenCalledOnce();
        expect(mocks.push).not.toHaveBeenCalled();
    });

    it("leaves the page of a record the next tenant does not hold for the Overview", async () => {
        mocks.pathname = "/dashboard/history/run";
        render(<TenantSync shown="acme" />);

        await fromAnotherTab(other("*"));

        expect(mocks.info).toHaveBeenCalledWith("You see every tenant now, opened in another tab");
        expect(mocks.push).toHaveBeenCalledWith("/dashboard");
        expect(mocks.refresh).toHaveBeenCalledOnce();
    });

    it("ignores its own switch and one into the tenant it shows", async () => {
        render(<TenantSync shown="acme" />);

        act(() => announceTenantSwitch("globex", "Globex"));
        await fromAnotherTab(other("acme"));

        expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("catches up on a switch it missed once it shows again", async () => {
        render(<TenantSync shown="acme" />);
        localStorage.setItem("dbackup:tenant-switch", JSON.stringify(other("globex")));

        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        expect(mocks.refresh).toHaveBeenCalledOnce();
    });
});
