import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavUser } from "@/components/layout/nav-user";
import { SidebarProvider } from "@/components/ui/sidebar";

const mocks = vi.hoisted(() => ({ setTheme: vi.fn(), signOut: vi.fn(), push: vi.fn(), twoFactor: true }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => "/dashboard" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark", setTheme: mocks.setTheme }) }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({
        data: { user: { name: "Manu", email: "skyfay@skymail.one", image: null, twoFactorEnabled: mocks.twoFactor } },
        isPending: false,
    }),
    signOut: (...args: unknown[]) => mocks.signOut(...args),
}));

async function openMenu() {
    render(<SidebarProvider><NavUser groupName="SuperAdmin" version="3.4.0" /></SidebarProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: /Manu/ }));
    return screen.findByRole("menu");
}

describe("the menu of the person in the sidebar", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.twoFactor = true;
    });

    it("names the person with their group and email, and leads straight to the parts of the profile", async () => {
        await openMenu();

        expect(screen.getByText("SuperAdmin · skyfay@skymail.one")).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "/dashboard/profile");
        expect(screen.getByRole("menuitem", { name: /^Security,\s*2FA on$/ })).toHaveAttribute("href", "/dashboard/profile?part=security");
        expect(screen.getByRole("menuitem", { name: "Colors" })).toHaveAttribute("href", "/dashboard/profile?part=colors");
    });

    it("says nothing about a second factor while there is none", async () => {
        mocks.twoFactor = false;
        await openMenu();

        expect(screen.getByRole("menuitem", { name: "Security" })).toBeInTheDocument();
        expect(screen.queryByText("2FA on")).toBeNull();
    });

    it("switches the theme in the menu and stays open, so the change shows at once", async () => {
        await openMenu();

        expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
        await userEvent.setup().click(screen.getByRole("menuitemradio", { name: "Light" }));

        expect(mocks.setTheme).toHaveBeenCalledWith("light");
        expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("opens the help in a new tab, What's new with the version of this DBackup", async () => {
        await openMenu();

        expect(screen.getByRole("menuitem", { name: "Guides" })).toHaveAttribute("target", "_blank");
        expect(screen.getByRole("menuitem", { name: "API reference" })).toHaveAttribute("href", "/docs/api");
        expect(screen.getByRole("menuitem", { name: "API reference online" })).toHaveAttribute("href", "https://api.dbackup.app");
        expect(screen.getByRole("menuitem", { name: "What's new in v3.4.0" })).toHaveAttribute("href", "https://docs.dbackup.app/changelog");
    });

    it("logs out from the red entry at the end", async () => {
        await openMenu();
        const logOut = screen.getByRole("menuitem", { name: "Log out" });

        expect(logOut).toHaveAttribute("data-variant", "destructive");
        await userEvent.setup().click(logOut);
        expect(mocks.signOut).toHaveBeenCalled();
    });
});
