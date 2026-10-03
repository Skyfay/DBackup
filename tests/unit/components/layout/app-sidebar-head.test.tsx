import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({
    // eslint-disable-next-line @next/next/no-img-element
    default: ({ alt, priority: _priority, ...props }: Record<string, unknown>) => <img alt={alt as string} {...props} />,
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: vi.fn() }) }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { name: "Manu", email: "skyfay@skymail.one", image: null } }, isPending: false }),
    signOut: vi.fn(),
}));

const head = () => screen.getByRole("link", { name: /DBackup Logo/ });

describe("the head of the sidebar", () => {
    it("names DBackup with its version while the instance has no name", () => {
        render(<SidebarProvider><AppSidebar currentVersion="3.4.0" /></SidebarProvider>);

        expect(head()).toHaveTextContent(/^DBackupv3\.4\.0$/);
        expect(head()).toHaveAttribute("href", "/dashboard");
    });

    it("names the instance from General and keeps DBackup beside the version", () => {
        render(<SidebarProvider><AppSidebar currentVersion="3.4.0" instanceName="Backup Zürich" /></SidebarProvider>);

        expect(head()).toHaveTextContent(/^Backup ZürichDBackup v3\.4\.0$/);
    });
});
