import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({ getCurrentUserWithGroup: vi.fn() }));
vi.mock("@/services/user/preference-service", () => ({
    saveTablePreferences: vi.fn(),
    resetTablePreferences: vi.fn(),
    saveViewMode: vi.fn(),
    setTableDefaults: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { resetTablePreferences, saveTablePreferences, saveViewMode, setTableDefaults } from "@/services/user/preference-service";
import { saveTableDefaults, saveTableLayout, saveViewLayout } from "@/app/actions/auth/table-preferences";

const layout = { order: ["status"], hidden: [], density: "comfortable" as const };

describe("saveTableLayout", () => {
    beforeEach(() => {
        vi.mocked(getCurrentUserWithGroup).mockResolvedValue({ id: "user-1" } as never);
    });

    it("refuses a visitor without a session", async () => {
        vi.mocked(getCurrentUserWithGroup).mockResolvedValue(null);

        await expect(saveTableLayout("connections.databases", layout)).resolves.toEqual({ success: false, error: "Unauthorized" });
        expect(saveTablePreferences).not.toHaveBeenCalled();
    });

    it("saves the layout for the signed-in user only", async () => {
        await expect(saveTableLayout("connections.databases", layout)).resolves.toEqual({ success: true });
        expect(saveTablePreferences).toHaveBeenCalledWith("user-1", "connections.databases", layout);
    });

    it("clears the layout when it is reset", async () => {
        await saveTableLayout("connections.databases", null);

        expect(resetTablePreferences).toHaveBeenCalledWith("user-1", "connections.databases");
    });

    it("rejects a table id that could reach other preference keys", async () => {
        await expect(saveTableLayout("../view:admin", layout)).resolves.toMatchObject({ success: false });
        expect(saveTablePreferences).not.toHaveBeenCalled();
    });
});

describe("saveViewLayout", () => {
    beforeEach(() => {
        vi.mocked(getCurrentUserWithGroup).mockResolvedValue({ id: "user-1" } as never);
    });

    it("saves the picked view for the signed-in user", async () => {
        await expect(saveViewLayout("connections", "cards")).resolves.toEqual({ success: true });
        expect(saveViewMode).toHaveBeenCalledWith("user-1", "connections", "cards");
    });

    it("refuses a view that does not exist and a visitor without a session", async () => {
        await expect(saveViewLayout("connections", "gallery" as never)).resolves.toMatchObject({ success: false });

        vi.mocked(getCurrentUserWithGroup).mockResolvedValue(null);
        await expect(saveViewLayout("connections", "cards")).resolves.toMatchObject({ success: false, error: "Unauthorized" });
        expect(saveViewMode).not.toHaveBeenCalled();
    });
});

describe("saveTableDefaults", () => {
    beforeEach(() => {
        vi.mocked(getCurrentUserWithGroup).mockResolvedValue({ id: "user-1" } as never);
    });

    it("saves the defaults of the signed-in user and renders the dashboard again, whose tables read them", async () => {
        await expect(saveTableDefaults({ pageSize: 50, density: "compact" })).resolves.toEqual({ success: true });
        expect(setTableDefaults).toHaveBeenCalledWith("user-1", { pageSize: 50, density: "compact" });
        expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
    });

    it("refuses a page size no table offers and a visitor without a session", async () => {
        await expect(saveTableDefaults({ pageSize: 7, density: "compact" })).resolves.toMatchObject({ success: false });

        vi.mocked(getCurrentUserWithGroup).mockResolvedValue(null);
        await expect(saveTableDefaults({ pageSize: 50, density: "compact" })).resolves.toMatchObject({ success: false, error: "Unauthorized" });
        expect(setTableDefaults).not.toHaveBeenCalled();
    });
});
