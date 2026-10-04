import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginLookField } from "@/components/dashboard/settings/login-look-field";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), success: vi.fn(), error: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

const image = { fileName: "alps.jpg", mimeType: "image/jpeg" as const, size: 840_000, updatedAt: "2026-10-01T10:00:00.000Z" };

describe("what the login page shows, under Settings, Sign-in", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("offers the logos and an own picture, and changes the choice for Save", async () => {
        const onChange = vi.fn();
        render(<LoginLookField value="logos" onChange={onChange} image={image} readOnly={false} />);

        await userEvent.setup().click(screen.getByRole("radio", { name: /Your own image/ }));

        expect(onChange).toHaveBeenCalledWith("image");
        expect(screen.getByText("alps.jpg")).toBeInTheDocument();
    });

    it("keeps a dropped picture at once and picks it for the next Save", async () => {
        const onChange = vi.fn();
        fetchMock.mockResolvedValue({ json: async () => ({ success: true }) });
        const { container } = render(<LoginLookField value="logos" onChange={onChange} image={null} readOnly={false} />);

        const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "alps.jpg", { type: "image/jpeg" });
        await userEvent.setup().upload(container.querySelector("input[type=file]") as HTMLInputElement, file);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/login-image", expect.objectContaining({ method: "POST" })));
        expect((fetchMock.mock.calls[0][1] as { body: FormData }).body.get("file")).toBe(file);
        expect(onChange).toHaveBeenCalledWith("image");
        expect(mocks.refresh).toHaveBeenCalled();
    });

    it("says why the server refused a picture", async () => {
        fetchMock.mockResolvedValue({ json: async () => ({ success: false, error: "Only a PNG, JPG or WebP picture works here." }) });
        const { container } = render(<LoginLookField value="logos" onChange={vi.fn()} image={null} readOnly={false} />);

        await userEvent.setup().upload(container.querySelector("input[type=file]") as HTMLInputElement, new File(["x"], "logo.png", { type: "image/png" }));

        await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Only a PNG, JPG or WebP picture works here."));
    });

    it("removes the picture after asking, and the logos are back", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        fetchMock.mockResolvedValue({ ok: true });
        render(<LoginLookField value="image" onChange={onChange} image={image} readOnly={false} />);

        await user.click(screen.getByRole("button", { name: "Remove" }));
        await user.click(await screen.findByRole("button", { name: "Remove" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/login-image", { method: "DELETE" }));
        expect(onChange).toHaveBeenCalledWith("logos");
    });

    it("offers no upload to someone who may only read the settings", () => {
        render(<LoginLookField value="image" onChange={vi.fn()} image={image} readOnly />);

        expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
        expect(screen.getByRole("radio", { name: /DBackup logos/ })).toBeDisabled();
    });
});
