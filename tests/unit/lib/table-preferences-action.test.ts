import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/access-control", () => ({ getCurrentUserWithGroup: vi.fn() }));
vi.mock("@/services/user/preference-service", () => ({
    saveTablePreferences: vi.fn(),
    resetTablePreferences: vi.fn(),
}));

import { getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { resetTablePreferences, saveTablePreferences } from "@/services/user/preference-service";
import { saveTableLayout } from "@/app/actions/auth/table-preferences";

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
