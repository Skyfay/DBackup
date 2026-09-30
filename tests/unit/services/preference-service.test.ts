import { describe, it, expect } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import {
    getTableDefaults, getTablePreferences, getTaskColors, getViewMode, resetTablePreferences, saveTablePreferences, saveViewMode, setTableDefaults, setTaskColors,
} from "@/services/user/preference-service";
import { DEFAULT_TASK_COLORS } from "@/lib/core/task-colors";

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

describe("getTableDefaults and setTableDefaults", () => {
    it("returns the rows per page and row height a user set, under a key no table id reaches", async () => {
        prismaMock.userPreference.findUnique.mockResolvedValue({ value: JSON.stringify({ pageSize: 50, density: "compact" }) } as never);

        await expect(getTableDefaults("user-1")).resolves.toEqual({ pageSize: 50, density: "compact" });
        expect(prismaMock.userPreference.findUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId_key: { userId: "user-1", key: "defaults:tables" } },
        }));
    });

    it("falls back to 20 comfortable rows when nothing is set, the value is garbage or the read fails", async () => {
        prismaMock.userPreference.findUnique.mockResolvedValueOnce(null);
        await expect(getTableDefaults("user-1")).resolves.toEqual({ pageSize: 20, density: "comfortable" });

        prismaMock.userPreference.findUnique.mockResolvedValueOnce({ value: JSON.stringify({ pageSize: 7, density: "compact" }) } as never);
        await expect(getTableDefaults("user-1")).resolves.toEqual({ pageSize: 20, density: "comfortable" });

        prismaMock.userPreference.findUnique.mockRejectedValueOnce(new Error("no such table: UserPreference"));
        await expect(getTableDefaults("user-1")).resolves.toEqual({ pageSize: 20, density: "comfortable" });
    });

    it("stores the defaults and refuses a page size no table offers", async () => {
        await setTableDefaults("user-1", { pageSize: 100, density: "compact" });
        expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: { userId: "user-1", key: "defaults:tables", value: JSON.stringify({ pageSize: 100, density: "compact" }) },
        }));

        await expect(setTableDefaults("user-1", { pageSize: 5000, density: "compact" })).rejects.toThrow();
    });
});

describe("the colors of the tasks of a user", () => {
    it("reads a saved choice and falls back to the default for one that no longer validates", async () => {
        const mine = { ...DEFAULT_TASK_COLORS, destructive: "orange" };
        prismaMock.userPreference.findUnique.mockResolvedValueOnce({ value: JSON.stringify(mine) } as never);
        await expect(getTaskColors("user-1")).resolves.toEqual(mine);

        prismaMock.userPreference.findUnique.mockResolvedValueOnce({ value: JSON.stringify({ ...mine, pick: "gold" }) } as never);
        await expect(getTaskColors("user-1")).resolves.toEqual(DEFAULT_TASK_COLORS);

        prismaMock.userPreference.findUnique.mockRejectedValueOnce(new Error("no such table: UserPreference"));
        await expect(getTaskColors("user-1")).resolves.toEqual(DEFAULT_TASK_COLORS);
    });

    it("stores a choice of its own and forgets the default, so a later default reaches the user", async () => {
        await setTaskColors("user-1", { ...DEFAULT_TASK_COLORS, success: "teal" });
        expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId_key: { userId: "user-1", key: "appearance:colors" } },
            update: { value: JSON.stringify({ ...DEFAULT_TASK_COLORS, success: "teal" }) },
        }));

        await setTaskColors("user-1", DEFAULT_TASK_COLORS);
        expect(prismaMock.userPreference.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1", key: "appearance:colors" } });
    });
});
