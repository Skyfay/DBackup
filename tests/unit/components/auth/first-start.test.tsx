import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirstStart } from "@/components/auth/first-start";
import { LEVEL_RULES } from "@/lib/auth/password-policy";

const mocks = vi.hoisted(() => ({ push: vi.fn(), signUp: vi.fn(), keys: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/auth/client", () => ({ signUp: { email: mocks.signUp }, useSession: () => ({ data: null }) }));
vi.mock("@/components/dashboard/vault/kit-file", () => ({ keysFromFile: (...args: unknown[]) => mocks.keys(...args) }));

const KEY = "a".repeat(64);
const STANDARD = LEVEL_RULES.standard;

describe("the first start of a new DBackup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("offers a first account and a restore, and shows the runner without a way in", () => {
        render(<FirstStart allowSignUp passwordRules={STANDARD} />);

        expect(screen.getByRole("button", { name: /Start fresh/ })).toBeEnabled();
        expect(screen.getByRole("button", { name: /Restore a backup/ })).toBeEnabled();
        expect(screen.getByText("Use it as a runner")).toBeInTheDocument();
        expect(screen.getByText("Soon")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /runner/ })).not.toBeInTheDocument();
    });

    it("keeps only the restore while DISABLE_EMAIL_LOGIN turns passwords off", () => {
        render(<FirstStart allowSignUp={false} passwordRules={STANDARD} />);

        expect(screen.getByRole("button", { name: /Start fresh/ })).toBeDisabled();
        expect(screen.getByRole("button", { name: /Restore a backup/ })).toBeEnabled();
    });

    it("creates the first account and ticks off at the field what the password still needs", async () => {
        const user = userEvent.setup();
        mocks.signUp.mockImplementation(async ({ fetchOptions }: { fetchOptions: { onSuccess: () => void } }) => fetchOptions.onSuccess());
        render(<FirstStart allowSignUp passwordRules={STANDARD} />);

        await user.click(screen.getByRole("button", { name: /Start fresh/ }));
        await user.type(screen.getByLabelText("Email"), "manu@example.ch");
        await user.type(screen.getByLabelText("Password"), "Short1");
        const needs = screen.getByRole("list", { name: "What the password needs" });
        expect(needs).toHaveTextContent("12 characters or more · 6 now, still missing");
        expect(needs).toHaveTextContent("A number, done");
        await user.click(screen.getByRole("button", { name: "Create account" }));
        expect(await screen.findByText("The password needs 12 characters or more.", { selector: "[data-slot=form-message]" })).toBeInTheDocument();
        expect(mocks.signUp).not.toHaveBeenCalled();

        await user.type(screen.getByLabelText("Password"), " and longer");
        await user.click(screen.getByRole("button", { name: "Create account" }));

        await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: "manu@example.ch", name: "manu", password: "Short1 and longer" })));
        expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    });

    it("keeps the name and the email out of the first password", async () => {
        const user = userEvent.setup();
        render(<FirstStart allowSignUp passwordRules={STANDARD} />);

        await user.click(screen.getByRole("button", { name: /Start fresh/ }));
        await user.type(screen.getByLabelText("Email"), "manu@example.ch");
        await user.type(screen.getByLabelText("Password"), "Manu-Backups-2026");
        await user.click(screen.getByRole("button", { name: "Create account" }));

        expect(await screen.findByText("The password may not contain the name or the email.", { selector: "[data-slot=form-message]" })).toBeInTheDocument();
        expect(mocks.signUp).not.toHaveBeenCalled();
    });

    it("takes the backup and its metadata in one drop, and the key from the recovery kit", async () => {
        const user = userEvent.setup();
        mocks.keys.mockResolvedValue([{ name: null, profileId: null, key: KEY }]);
        const fetchMock = vi.fn(async () => ({ json: async () => ({ success: false, error: "The backup could not be read." }) }));
        vi.stubGlobal("fetch", fetchMock);
        render(<FirstStart allowSignUp passwordRules={STANDARD} />);

        await user.click(screen.getByRole("button", { name: /Restore a backup/ }));
        const backup = new File(["x"], "config_backup.db.gz.enc");
        const meta = new File(["{}"], "config_backup.db.gz.enc.meta.json");
        fireEvent.drop(screen.getByText("Drop the backup and its .meta.json, or pick them").closest("div")!, { dataTransfer: { files: [backup, meta] } });
        fireEvent.drop(screen.getByLabelText("Its key"), { dataTransfer: { files: [new File(["zip"], "recovery-kit.zip")] } });

        expect(screen.getByText("config_backup.db.gz.enc")).toBeInTheDocument();
        expect(screen.getByText("config_backup.db.gz.enc.meta.json")).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText("Its key")).toHaveValue(KEY));

        await user.click(screen.getByRole("button", { name: "Check the backup" }));
        const body = (fetchMock.mock.calls[0] as unknown as [string, { body: FormData }])[1].body;
        expect(body.get("backupFile")).toBe(backup);
        expect(body.get("metaFile")).toBe(meta);
        expect(body.get("encryptionKeyHex")).toBe(KEY);
        expect(await screen.findByText("The backup could not be read.")).toBeInTheDocument();
        vi.unstubAllGlobals();
    });
});
