/**
 * A passing connection test reports the SSH host key it saw, and the save pins it. A test still
 * running while the host is changed tried the server of the old values, so its key is never pinned
 * for the new one, which would fail its first login as a changed key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/adapter/host-local-access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/components/adapter/host-local-access")>()),
    useMayReachServer: () => false,
}));

import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { useConnectionForm } from "@/components/adapter/use-connection-form";

const sftp = getAdapterDefinition("sftp")!;
const KEY_OF_A = { type: "ssh-ed25519", key: "a2V5LW9mLWE=", fingerprint: "SHA256:key-of-a" };

/** The test answers when the test calls `finishTest`, the save answers at once. */
let finishTest: (() => void) | null = null;
const saves: Record<string, unknown>[] = [];

beforeEach(() => {
    saves.length = 0;
    finishTest = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/adapters/test-connection") {
            await new Promise<void>((resolve) => { finishTest = resolve; });
            return new Response(JSON.stringify({ success: true, message: "ok", hostKey: KEY_OF_A }));
        }
        saves.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "new-connection" }));
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function renderForm() {
    const { result } = renderHook(() => useConnectionForm({ adapter: sftp, onSaved: vi.fn() }));
    act(() => {
        result.current.form.setValue("name", "Offsite");
        result.current.form.setValue("config.host", "a.example.test");
        result.current.form.setValue("config.port", 22);
    });
    return result;
}

/** Runs the test of the form, with whatever `during` changes while it runs. */
async function runTest(result: ReturnType<typeof renderForm>, during: () => void = () => {}) {
    let running!: Promise<void>;
    act(() => { running = result.current.runTest(); });
    await vi.waitFor(() => expect(finishTest).not.toBeNull());
    act(during);
    await act(async () => {
        finishTest!();
        await running;
    });
}

describe("the host key a connection test saw", () => {
    it("is pinned by the save of the values it tested", async () => {
        const result = renderForm();
        await runTest(result);

        await act(async () => { await result.current.onValid(result.current.form.getValues()); });

        expect(saves[0]?.sshHostKey).toEqual({ type: KEY_OF_A.type, key: KEY_OF_A.key });
    });

    it("is not pinned for another host the form was changed to while the test ran", async () => {
        const result = renderForm();
        await runTest(result, () => result.current.form.setValue("config.host", "b.example.test"));

        await act(async () => { await result.current.onValid(result.current.form.getValues()); });

        expect(saves[0]?.config).toMatchObject({ host: "b.example.test" });
        expect(saves[0]).not.toHaveProperty("sshHostKey");
    });

    it("is not pinned for another port either", async () => {
        const result = renderForm();
        await runTest(result, () => result.current.form.setValue("config.port", 2222));

        await act(async () => { await result.current.onValid(result.current.form.getValues()); });

        expect(saves[0]).not.toHaveProperty("sshHostKey");
    });
});
