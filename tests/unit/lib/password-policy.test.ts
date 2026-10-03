import { describe, expect, it } from "vitest";
import {
    GENERATED_SPECIALS,
    LEVEL_RULES,
    checkPassword,
    describePolicy,
    generatePassword,
    ownerWords,
    passwordProblem,
    policyOf,
    type PasswordRules,
} from "@/lib/auth/password-policy";

const CUSTOM: PasswordRules = { minLength: 20, upper: false, lower: true, digits: true, special: 3, notName: true };
const LENA = { name: "Lena Graf", email: "lena.graf@example.ch" };

describe("the rules of a new password", () => {
    it("keeps Basic at the 8 characters DBackup asked until now, and makes Standard and Strong ask for more", () => {
        expect(policyOf("basic")).toEqual({ level: "basic", minLength: 8, upper: false, lower: false, digits: false, special: 0, notName: false });
        expect(policyOf("standard")).toMatchObject({ minLength: 12, upper: true, lower: true, digits: true, special: 0, notName: true });
        expect(policyOf("strong")).toMatchObject({ minLength: 16, special: 1 });
    });

    it("takes the rules of a level whatever came along, and the custom ones as they are", () => {
        expect(policyOf("strong", CUSTOM)).toEqual({ level: "strong", ...LEVEL_RULES.strong });
        expect(policyOf("custom", CUSTOM)).toEqual({ level: "custom", ...CUSTOM });
    });

    it("ticks off each rule a password holds, and none of an empty one", () => {
        expect(checkPassword("harbor-lamp", LEVEL_RULES.standard).map((check) => [check.label, check.met])).toEqual([
            ["12 characters or more", false],
            ["An upper and a lower case letter", false],
            ["A number", false],
            ["Not the name or the email", true],
        ]);
        expect(checkPassword("", LEVEL_RULES.standard).every((check) => !check.met)).toBe(true);
    });

    it("counts every special character a person types, not only the ones Generate uses", () => {
        const rules = { ...LEVEL_RULES.basic, special: 2 };

        expect(passwordProblem("Kaffee#mit€Zucker", rules)).toBeNull();
        expect(passwordProblem("Grüße aus Zürich", rules)).toBe("The password needs 2 special characters like ! or #.");
    });

    it("counts letters of every language as letters, so é is no special character", () => {
        expect(passwordProblem("ÉCOLE été 2026", { ...LEVEL_RULES.standard, notName: false })).toBeNull();
        expect(passwordProblem("école été 2026!", { ...LEVEL_RULES.basic, special: 2 })).toBe("The password needs 2 special characters like ! or #.");
    });

    it("refuses a password with a word of the name or of the email before the @", () => {
        expect(ownerWords(LENA)).toEqual(["lena", "graf"]);
        expect(passwordProblem("Grafenried-2026", LEVEL_RULES.standard, LENA)).toBe("The password may not contain the name or the email.");
        expect(passwordProblem("Harbor-42-Lamp", LEVEL_RULES.standard, LENA)).toBeNull();
        // Words shorter than 3 letters would forbid too much.
        expect(ownerWords({ name: "Al Bo", email: "a.b@example.ch" })).toEqual([]);
    });

    it("names the first rule a password breaks as one sentence", () => {
        expect(passwordProblem("short", LEVEL_RULES.basic)).toBe("The password needs 8 characters or more.");
        expect(passwordProblem("harbor-lamp-42", LEVEL_RULES.standard)).toBe("The password needs an upper and a lower case letter.");
        expect(passwordProblem("Harbor-Lamp-Kite", LEVEL_RULES.standard)).toBe("The password needs a number.");
        expect(passwordProblem("x".repeat(129), LEVEL_RULES.basic)).toBe("The password can have at most 128 characters.");
    });

    it("says the rules in one sentence", () => {
        expect(describePolicy(LEVEL_RULES.basic)).toBe("A new password needs 8 characters or more.");
        expect(describePolicy(LEVEL_RULES.strong)).toBe(
            "A new password needs 16 characters or more, an upper and a lower case letter, a number and a special character like ! or #, and not the name or the email."
        );
        expect(describePolicy({ ...CUSTOM, notName: false })).toBe("A new password needs 20 characters or more, a lower case letter, a number and 3 special characters like ! or #.");
    });
});

describe("Generate", () => {
    const levels: [string, PasswordRules][] = [
        ["Basic", LEVEL_RULES.basic],
        ["Standard", LEVEL_RULES.standard],
        ["Strong", LEVEL_RULES.strong],
        ["a custom level", CUSTOM],
    ];

    it.each(levels)("makes passwords that hold %s", (_level, rules) => {
        for (let round = 0; round < 200; round++) {
            expect(passwordProblem(generatePassword(rules, LENA), rules, LENA)).toBeNull();
        }
    });

    it("makes 16 characters, or the minimum when it is longer", () => {
        expect(generatePassword(LEVEL_RULES.standard)).toHaveLength(16);
        expect(generatePassword({ ...LEVEL_RULES.basic, minLength: 40 })).toHaveLength(40);
    });

    it("puts in no special character but ! @ * - _ and .", () => {
        for (let round = 0; round < 200; round++) {
            const password = generatePassword(CUSTOM);
            const specials = [...password].filter((character) => !/[A-Za-z0-9]/.test(character));
            expect(specials.length).toBeGreaterThanOrEqual(3);
            expect(specials.every((character) => GENERATED_SPECIALS.includes(character))).toBe(true);
        }
    });

    it("leaves out characters that look alike when read out", () => {
        for (let round = 0; round < 200; round++) {
            expect(generatePassword(LEVEL_RULES.strong)).not.toMatch(/[0O1lI]/);
        }
    });
});
