/**
 * A destination another tenant shares can take only encrypted backups. The Quick Setup knows that
 * when it is picked and asks for a key before the job, also from someone who may not create one,
 * instead of failing at Create the job.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupWizard } from "@/components/dashboard/setup/setup-wizard";
import { toEntry } from "@/components/dashboard/setup/existing-list";
import { setupSteps } from "@/components/dashboard/setup/setup-model";
import type { AdapterConfig } from "@/components/adapter/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/app/actions/backup/encryption", () => ({ createEncryptionProfile: vi.fn() }));

const SHARED: AdapterConfig = {
    id: "dest-msp", name: "MSP vault", adapterId: "s3-generic", type: "storage", config: "{}", createdAt: "2026-10-01T00:00:00.000Z",
    provided: { providerId: "default", providerName: "Platform", encryptedOnly: true, ownRecipients: false },
};

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
const mockFetch = vi.fn((url: string, _init?: RequestInit) => {
    if (url === "/api/system/timezone") return json({ schedulerTimezone: "UTC" });
    if (url === "/api/adapters?type=database") return json([{ id: "db-9", name: "CRM", adapterId: "postgres", type: "database", config: "{}" }]);
    if (url === "/api/adapters?type=storage&role=DESTINATION") return json([SHARED]);
    if (url.startsWith("/api/adapters?type=")) return json([]);
    if (url === "/api/jobs") return json({ id: "job-1", name: "CRM backup" });
    return json({ error: `Unexpected ${url}` }, false);
});

const openPart = (question: string) => screen.getByRole("heading", { level: 2, name: question });

describe("a destination that takes only encrypted backups in the Quick Setup", () => {
    beforeEach(() => {
        mockFetch.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("carries the term of the destination into the part that picks it", () => {
        expect(toEntry(SHARED)).toMatchObject({ encryptedOnly: true, detail: expect.stringContaining("only encrypted backups") });
        expect(toEntry({ ...SHARED, provided: { ...SHARED.provided!, encryptedOnly: false } }).encryptedOnly).toBeUndefined();
    });

    it("makes Encryption a part that cannot be skipped, also for someone who may not create a key", () => {
        const steps = setupSteps({ canCreateVault: false, canCreateNotification: false, encryptionRequired: true });
        expect(steps.map((step) => step.id)).toEqual(["database", "destination", "encryption", "job"]);
        expect(steps.find((step) => step.id === "encryption")?.optional).toBe(false);
        expect(setupSteps({ canCreateVault: false, canCreateNotification: false }).map((step) => step.id)).toEqual(["database", "destination", "job"]);
    });

    it("asks for a key of the Vault before the job and creates the job with it", async () => {
        const user = userEvent.setup();
        render(<SetupWizard canCreateVault={false} canCreateNotification={false} canRunJob={false} canOpenVault keys={[{ id: "key-9", name: "Customer key", detail: "" }]} />);

        await user.click(await screen.findByRole("radio", { name: /CRM/ }));
        await user.click(screen.getByRole("button", { name: "Use this database" }));
        await user.click(await screen.findByRole("radio", { name: /MSP vault.*only encrypted backups/ }));
        await user.click(screen.getByRole("button", { name: "Use this destination" }));

        expect(openPart("Should the backups be encrypted?")).toBeInTheDocument();
        expect(screen.getByText("MSP vault takes only encrypted backups, so the job needs a key.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Create key" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("radio", { name: /Customer key/ }));
        await user.click(screen.getByRole("button", { name: "Use this key" }));
        await user.click(await screen.findByRole("button", { name: "Create the job" }));

        await waitFor(() => expect(mockFetch.mock.calls.some(([url, init]) => url === "/api/jobs" && init?.method === "POST")).toBe(true));
        const call = mockFetch.mock.calls.find(([url, init]) => url === "/api/jobs" && init?.method === "POST");
        expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ encryptionProfileId: "key-9", destinations: [expect.objectContaining({ configId: "dest-msp" })] });
        expect(within(screen.getByRole("region", { name: "Encryption" })).getByText("Customer key")).toBeInTheDocument();
    });
});
