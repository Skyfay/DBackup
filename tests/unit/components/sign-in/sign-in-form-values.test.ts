import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/dashboard/users/user-columns", () => ({ NO_GROUP: "none" }));

const { changedFrom, configOf, groupIdOf, initialValues, problemOf } = await import("@/components/dashboard/sign-in/sign-in-form-values");
const { freeProviderId } = await import("@/components/dashboard/sign-in/sign-in-adapters");

const INPUTS = [
    { name: "baseUrl", label: "Pocket ID URL", type: "url" as const, required: true },
    { name: "note", label: "Note", type: "text" as const },
];
const MODEL = { providers: [{ name: "Pocket ID", providerId: "pocket-id" }] } as never;

describe("the form of a sign-in provider", () => {
    it("starts a new provider with a free name and ID, and no group picked yet", () => {
        const values = initialValues({ kind: "create" }, "pocket-id", INPUTS, MODEL);

        expect(values).toMatchObject({ name: "Pocket ID 2", providerId: "pocket-id-2", config: { baseUrl: "", note: "" }, replaceSecret: true, allowProvisioning: true, groupId: "" });
        expect(freeProviderId("authelia", ["pocket-id"])).toBe("authelia");
    });

    it("asks for what is missing in the order of the fields", () => {
        const values = initialValues({ kind: "create" }, "pocket-id", INPUTS, MODEL);
        const problem = (changes: object) => problemOf({ ...values, ...changes }, { kind: "create" }, INPUTS, ["pocket-id"])?.message;

        expect(problem({ name: " " })).toBe("Give the provider a name.");
        expect(problem({ providerId: "Pocket ID" })).toBe("Use lowercase letters, numbers, dashes and underscores.");
        expect(problem({ providerId: "pocket-id" })).toBe("Another provider has this ID.");
        expect(problem({})).toBe("The Pocket ID URL is missing.");
        expect(problem({ config: { baseUrl: "https://id.example.ch" } })).toBe("The client ID is missing.");
        expect(problem({ config: { baseUrl: "https://id.example.ch" }, clientId: "c" })).toBe("The client secret is missing.");
        expect(problem({ config: { baseUrl: "https://id.example.ch" }, clientId: "c", clientSecret: "s" })).toBe("Pick the group new people start in.");
        expect(problem({ config: { baseUrl: "https://id.example.ch" }, clientId: "c", clientSecret: "s", allowProvisioning: false })).toBeUndefined();
    });

    it("keeps the saved secret of an edit until Replace holds a new one", () => {
        const provider = { name: "Pocket ID", providerId: "pocket-id", config: { baseUrl: "https://id.example.ch" }, clientId: "c", domain: null, allowProvisioning: false, group: null } as never;
        const initial = initialValues({ kind: "edit", provider }, "pocket-id", INPUTS, MODEL);

        expect(initial).toMatchObject({ replaceSecret: false, clientSecret: "", groupId: "none" });
        expect(changedFrom(initial, initial)).toBe(false);
        expect(changedFrom(initial, { ...initial, replaceSecret: true })).toBe(false);
        expect(changedFrom(initial, { ...initial, replaceSecret: true, clientSecret: "new" })).toBe(true);
        expect(changedFrom(initial, { ...initial, name: "Pocket ID " })).toBe(false);
        expect(problemOf({ ...initial, replaceSecret: true }, { kind: "edit", provider }, INPUTS, [])?.message).toBe("Paste the new secret, or keep the saved one.");
    });

    it("saves the fields trimmed without the empty ones, and the group as the actions take it", () => {
        expect(configOf({ config: { baseUrl: " https://id.example.ch ", note: " " } } as never, INPUTS)).toEqual({ baseUrl: "https://id.example.ch" });
        expect([groupIdOf(""), groupIdOf("none"), groupIdOf("g-1")]).toEqual([undefined, null, "g-1"]);
    });
});
