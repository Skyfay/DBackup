/**
 * The indexes parsed at the same time stay within one budget of the text they may inflate to, so
 * concurrent requests for crafted sidecars cannot each grow the heap of the shared process to the
 * largest index `limits.ts` allows.
 */
import { describe, it, expect } from "vitest";
import { createParseBudget } from "@/services/backup/index-parse-budget";
import { INDEX_INFLATE_FLOOR } from "@/lib/archive/limits";

/** A parse that stays in flight until `finish` is called, and counts what runs beside it. */
function parses() {
    const state = { running: 0, most: 0, started: [] as string[] };
    const finishers = new Map<string, () => void>();
    const parse = (name: string) => () => {
        state.running++;
        state.most = Math.max(state.most, state.running);
        state.started.push(name);
        return new Promise<string>((resolve) => finishers.set(name, () => { state.running--; resolve(name); }));
    };
    const finish = async (name: string) => {
        finishers.get(name)!();
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { state, parse, finish };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the budget of the index parses of the process", () => {
    it("runs one parse at a time where each may inflate to the whole budget", async () => {
        const budget = createParseBudget(INDEX_INFLATE_FLOOR);
        const { state, parse, finish } = parses();

        const all = Promise.all(["a", "b", "c"].map((name) => budget(1, parse(name))));
        await tick();
        expect(state.started).toEqual(["a"]);
        await finish("a");
        await finish("b");
        await finish("c");

        await expect(all).resolves.toEqual(["a", "b", "c"]);
        expect(state.most).toBe(1);
    });

    it("runs small ones side by side as far as the budget goes", async () => {
        const budget = createParseBudget(2 * INDEX_INFLATE_FLOOR);
        const { state, parse, finish } = parses();

        const all = Promise.all(["a", "b", "c"].map((name) => budget(1, parse(name))));
        await tick();
        expect(state.started).toEqual(["a", "b"]);
        for (const name of ["a", "b", "c"]) await finish(name);

        await all;
        expect(state.most).toBe(2);
    });

    it("keeps a large index first in line ahead of the small ones that came after it", async () => {
        const budget = createParseBudget(2 * INDEX_INFLATE_FLOOR);
        const { state, parse, finish } = parses();

        const small = budget(1, parse("small"));
        await tick();
        // Claims the whole budget, from a stored size of a few MB.
        const large = budget(INDEX_INFLATE_FLOOR, parse("large"));
        const later = budget(1, parse("later"));
        await tick();
        expect(state.started).toEqual(["small"]);

        await finish("small");
        expect(state.started).toEqual(["small", "large"]);
        await finish("large");
        await finish("later");
        await Promise.all([small, large, later]);
    });

    it("gives the claim back when a parse fails", async () => {
        const budget = createParseBudget(INDEX_INFLATE_FLOOR);

        await expect(budget(1, async () => { throw new Error("damaged index"); })).rejects.toThrow("damaged index");
        await expect(budget(1, async () => "next")).resolves.toBe("next");
    });
});
