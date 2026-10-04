import { describe, expect, it } from "vitest";
import {
    COLOR_FAMILIES,
    DEFAULT_TASK_COLORS,
    TaskColorsSchema,
    contrastRatio,
    darkShadeOf,
    foregroundOf,
    presetOf,
    shadesOf,
    taskColorCss,
    taskColorVars,
} from "@/lib/core/task-colors";

describe("the colors of the tasks", () => {
    it("adds nothing to the page for the default, so globals.css stays as it is", () => {
        expect(taskColorCss(DEFAULT_TASK_COLORS)).toBe("");
        expect(presetOf(DEFAULT_TASK_COLORS)?.name).toBe("Default");
    });

    it("sets a changed task for the light theme on :root and for the dark one on .dark, with the text on it", () => {
        const css = taskColorCss({ ...DEFAULT_TASK_COLORS, create: "orange" });

        expect(css).toBe(`:root{--create:${COLOR_FAMILIES.orange.light};--create-foreground:#fafafa}.dark{--create:${COLOR_FAMILIES.orange.dark};--create-foreground:#0f0f11}`);
        expect(css).not.toContain("--edit");
    });

    it("gives Delete a darker shade for text on its tint in the light theme", () => {
        const vars = taskColorVars({ ...DEFAULT_TASK_COLORS, destructive: "orange" }, "light");

        expect(vars["--destructive"]).toBe(COLOR_FAMILIES.orange.light);
        expect(contrastRatio(vars["--destructive-text"], "#ffffff")).toBeGreaterThan(contrastRatio(vars["--destructive"], "#ffffff"));
        expect(taskColorVars({ ...DEFAULT_TASK_COLORS, destructive: "orange" }, "dark")["--destructive-text"]).toBe(COLOR_FAMILIES.orange.dark);
    });

    it("works out a lighter shade of an own color for the dark theme and readable text on both", () => {
        const dark = darkShadeOf("#c2410c");

        expect(shadesOf("#c2410c")).toEqual({ light: "#c2410c", dark });
        expect(contrastRatio(dark, "#1a1a1c")).toBeGreaterThan(4.5);
        expect(foregroundOf("#c2410c")).toBe("#fafafa");
        expect(foregroundOf(dark)).toBe("#0f0f11");
    });

    it("measures contrast like WCAG", () => {
        expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
        expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    });

    it("takes families and #rrggbb only, so nothing else reaches the CSS of the page", () => {
        expect(TaskColorsSchema.safeParse({ ...DEFAULT_TASK_COLORS, pick: "#C2410C" }).data?.pick).toBe("#c2410c");
        expect(TaskColorsSchema.safeParse({ ...DEFAULT_TASK_COLORS, pick: "red;}body{display:none" }).success).toBe(false);
        expect(TaskColorsSchema.safeParse({ ...DEFAULT_TASK_COLORS, pick: "#fff" }).success).toBe(false);
        expect(TaskColorsSchema.safeParse({ ...DEFAULT_TASK_COLORS, pick: "gold" }).success).toBe(false);
    });

    it("names a choice after its preset, or none for one of a person's own", () => {
        expect(presetOf({ create: "blue", edit: "pink", pick: "sky", filter: "indigo", warning: "yellow", destructive: "orange", success: "teal" })?.name).toBe("Colorblind friendly");
        expect(presetOf({ ...DEFAULT_TASK_COLORS, success: "#123456" })).toBeNull();
    });
});
