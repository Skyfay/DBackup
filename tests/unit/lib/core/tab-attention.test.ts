import { describe, expect, it } from "vitest";
import { attentionOf, combineAttention, namesFor } from "@/lib/core/tab-attention";

describe("the dot of a page tab", () => {
    it("names one, two, or the first and how many more", () => {
        expect(namesFor(["NAS"])).toBe("NAS");
        expect(namesFor(["NAS", "S3"])).toBe("NAS and S3");
        expect(namesFor(["NAS", "S3", "Drive"])).toBe("NAS and 2 more");
    });

    it("picks the verb for one or for more, and has nothing to say without names", () => {
        expect(attentionOf("destructive", ["NAS"], "does not answer", "do not answer")).toEqual({ tone: "destructive", note: "NAS does not answer" });
        expect(attentionOf("destructive", ["NAS", "S3"], "does not answer", "do not answer")).toEqual({ tone: "destructive", note: "NAS and S3 do not answer" });
        expect(attentionOf("warning", [], "has no group", "have no group")).toBeUndefined();
    });

    it("turns red when one reason is, and says the red one first", () => {
        expect(combineAttention(
            { tone: "warning", note: "S3 failed its last check" },
            undefined,
            { tone: "destructive", note: "NAS does not answer" },
        )).toEqual({ tone: "destructive", note: "NAS does not answer. S3 failed its last check" });
        expect(combineAttention(undefined, undefined)).toBeUndefined();
    });
});
