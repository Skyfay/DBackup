import { describe, it, expect, vi } from "vitest";
import { render as renderWithoutProvider, screen } from "@testing-library/react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PERMISSIONS } from "@/lib/auth/permissions";

// The sidebar reads its collapsed state from the provider, which the dashboard layout supplies.
const render = (ui: React.ReactElement) => renderWithoutProvider(<SidebarProvider>{ui}</SidebarProvider>);

// Mock next/navigation
vi.mock("next/navigation", () => ({
    usePathname: () => "/dashboard",
    useRouter: () => ({
        push: vi.fn(),
    }),
}));

// Mock next/image
vi.mock("next/image", () => ({
    // eslint-disable-next-line @next/next/no-img-element
    default: ({ alt, ...props }: Record<string, unknown>) => <img alt={alt as string} {...props} />,
}));

// Mock auth-client
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({
        data: {
            user: { name: "Test User", email: "test@test.com", image: null },
        },
        isPending: false,
    }),
    signOut: vi.fn(),
}));

// Mock next-themes
vi.mock("next-themes", () => ({
    useTheme: () => ({
        setTheme: vi.fn(),
    }),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => {
    const Icon = ({ children, ...props }: Record<string, unknown>) => <span {...props}>{children as React.ReactNode}</span>;
    return new Proxy({ __esModule: true, then: undefined } as Record<string, unknown>, {
        get: (target, prop) => {
            if (prop === "then") return undefined;
            if (prop === "__esModule") return true;
            return Icon;
        },
        has: () => true,
    });
});

describe("Sidebar - Quick Setup visibility", () => {
    const allPermissions = [
        PERMISSIONS.SOURCES.WRITE,
        PERMISSIONS.SOURCES.READ,
        PERMISSIONS.DESTINATIONS.WRITE,
        PERMISSIONS.DESTINATIONS.READ,
        PERMISSIONS.JOBS.WRITE,
        PERMISSIONS.JOBS.READ,
        PERMISSIONS.NOTIFICATIONS.READ,
        PERMISSIONS.STORAGE.READ,
        PERMISSIONS.HISTORY.READ,
        PERMISSIONS.VAULT.READ,
        PERMISSIONS.SETTINGS.READ,
    ];

    it("should NOT show Quick Setup when showQuickSetup is false", () => {
        render(
            <AppSidebar
                permissions={allPermissions}
                isSuperAdmin={false}
                showQuickSetup={false}
            />
        );

        expect(screen.queryByText("Quick Setup")).not.toBeInTheDocument();
    });

    it("should show Quick Setup when showQuickSetup is true", () => {
        render(
            <AppSidebar
                permissions={allPermissions}
                isSuperAdmin={false}
                showQuickSetup={true}
            />
        );

        expect(screen.getByText("Quick Setup")).toBeInTheDocument();
    });

    it("should NOT show Quick Setup by default (no prop passed)", () => {
        render(
            <AppSidebar
                permissions={allPermissions}
                isSuperAdmin={false}
            />
        );

        expect(screen.queryByText("Quick Setup")).not.toBeInTheDocument();
    });

    it("should NOT show Quick Setup even for SuperAdmin when showQuickSetup is false", () => {
        render(
            <AppSidebar
                permissions={[]}
                isSuperAdmin={true}
                showQuickSetup={false}
            />
        );

        expect(screen.queryByText("Quick Setup")).not.toBeInTheDocument();
    });

    it("should show Quick Setup for SuperAdmin when showQuickSetup is true", () => {
        render(
            <AppSidebar
                permissions={[]}
                isSuperAdmin={true}
                showQuickSetup={true}
            />
        );

        expect(screen.getByText("Quick Setup")).toBeInTheDocument();
    });

    it("should NOT show Quick Setup when user lacks write permissions even if showQuickSetup is true", () => {
        render(
            <AppSidebar
                permissions={[PERMISSIONS.SOURCES.READ]}
                isSuperAdmin={false}
                showQuickSetup={true}
            />
        );

        // Lacks SOURCES.WRITE, DESTINATIONS.WRITE, JOBS.WRITE → permission check fails
        expect(screen.queryByText("Quick Setup")).not.toBeInTheDocument();
    });

    it("should show Quick Setup when user has required write permissions and showQuickSetup is true", () => {
        render(
            <AppSidebar
                permissions={[
                    PERMISSIONS.SOURCES.WRITE,
                    PERMISSIONS.DESTINATIONS.WRITE,
                    PERMISSIONS.JOBS.WRITE,
                ]}
                isSuperAdmin={false}
                showQuickSetup={true}
            />
        );

        expect(screen.getByText("Quick Setup")).toBeInTheDocument();
    });

    it("should show Quick Setup link pointing to /dashboard/setup", () => {
        render(
            <AppSidebar
                permissions={allPermissions}
                isSuperAdmin={false}
                showQuickSetup={true}
            />
        );

        const quickSetupLink = screen.getByText("Quick Setup").closest("a");
        expect(quickSetupLink).toHaveAttribute("href", "/dashboard/setup");
    });
});
