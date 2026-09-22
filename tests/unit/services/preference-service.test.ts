import { describe, it, expect } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { getTablePreferences, getViewMode, resetTablePreferences, saveTablePreferences, saveViewMode } from "@/services/user/preference-service";

const layout = { order: ["status", "host"], hidden: ["host"], density: "compact" as const };

describe("getTablePreferences", () => {
    it("returns the saved layouts by table id and skips one that no longer validates", async () => {
        prismaMock.userPreference.findMany.mockResolvedValue([
            { key: "table:connections.databases", value: JSON.stringify(layout) },
            { key: "table:connections.notifications", value: "{\"order\":\"broken\"}" },
        ] as never);

        const layouts = await getTablePreferences("user-1", ["connections.databases", "connections.notifications"]);

        expect(layouts).toEqual({ "connections.databases": layout });
    });

    it("falls back to the defaults when the layouts can not be read", async () => {
        prismaMock.userPreference.findMany.mockRejectedValue(new Error("no such table: UserPreference"));

        await expect(getTablePreferences("user-1", ["connections.databases"])).resolves.toEqual({});
    });
});

describe("saveTablePreferences", () => {
    it("stores the layout as JSON under the table key", async () => {
        await saveTablePreferences("user-1", "connections.databases", layout);

        expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId_key: { userId: "user-1", key: "table:connections.databases" } },
            create: { userId: "user-1", key: "table:connections.databases", value: JSON.stringify(layout) },
        }));
    });

    it("refuses a row height that does not exist", async () => {
        await expect(
            saveTablePreferences("user-1", "connections.databases", { ...layout, density: "huge" } as never)
        ).rejects.toThrow();
    });
});

describe("resetTablePreferences", () => {
    it("deletes only that user's layout of that table", async () => {
        await resetTablePreferences("user-1", "connections.databases");

        expect(prismaMock.userPreference.deleteMany).toHaveBeenCalledWith({
            where: { userId: "user-1", key: "table:connections.databases" },
        });
    });
});

describe("getViewMode and saveViewMode", () => {
    it("returns the view a user picked for a page", async () => {
        prismaMock.userPreference.findUnique.mockResolvedValue({ value: JSON.stringify("cards") } as never);

        await expect(getViewMode("user-1", "connections")).resolves.toBe("cards");
        expect(prismaMock.userPreference.findUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId_key: { userId: "user-1", key: "view:connections" } },
        }));
    });

    it("has no view for a user who never picked one or whose value is garbage", async () => {
        prismaMock.userPreference.findUnique.mockResolvedValueOnce(null);
        await expect(getViewMode("user-1", "connections")).resolves.toBeNull();

        prismaMock.userPreference.findUnique.mockResolvedValueOnce({ value: "\"gallery\"" } as never);
        await expect(getViewMode("user-1", "connections")).resolves.toBeNull();
    });

    it("refuses to store a view that does not exist", async () => {
        await expect(saveViewMode("user-1", "connections", "gallery" as never)).rejects.toThrow();
        expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled();
    });
});
