import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { LEVEL_RULES } from "@/lib/auth/password-policy";
import { ValidationError } from "@/lib/logging/errors";

const { assertPasswordAllowed, getPasswordPolicy, savePasswordPolicy } = await import("@/services/auth/password-policy-service");

function stored(rows: Record<string, string>) {
    prismaMock.systemSetting.findMany.mockResolvedValue(Object.entries(rows).map(([key, value]) => ({ key, value })) as never);
}

describe("the password rules of the instance", () => {
    beforeEach(() => {
        stored({});
        prismaMock.$transaction.mockResolvedValue([] as never);
        prismaMock.systemSetting.upsert.mockImplementation(((args: unknown) => args) as never);
    });

    it("asks for Standard on a new instance, where nothing is stored", async () => {
        expect(await getPasswordPolicy()).toEqual({ level: "standard", ...LEVEL_RULES.standard });
    });

    it("keeps Basic where the migration stored it for an instance from before the rules", async () => {
        stored({ "auth.password.level": "basic" });

        expect(await getPasswordPolicy()).toEqual({ level: "basic", ...LEVEL_RULES.basic });
    });

    it("follows the rules of a level, not the ones stored beside it", async () => {
        stored({ "auth.password.level": "strong", "auth.password.minLength": "9", "auth.password.special": "0" });

        expect(await getPasswordPolicy()).toEqual({ level: "strong", ...LEVEL_RULES.strong });
    });

    it("reads custom rules and keeps a broken value within its limits", async () => {
        stored({
            "auth.password.level": "custom",
            "auth.password.minLength": "4",
            "auth.password.upper": "false",
            "auth.password.lower": "true",
            "auth.password.digits": "true",
            "auth.password.special": "99",
            "auth.password.notName": "false",
        });

        expect(await getPasswordPolicy()).toEqual({ level: "custom", minLength: 8, upper: false, lower: true, digits: true, special: 8, notName: false });
    });

    it("saves a level with the rules it stands for, so Custom starts from them", async () => {
        await savePasswordPolicy({ level: "strong", minLength: 9, upper: false, lower: false, digits: false, special: 0, notName: false });

        const written = Object.fromEntries(prismaMock.systemSetting.upsert.mock.calls.map(([args]) => [args.where.key, args.update.value]));
        expect(written).toEqual({
            "auth.password.level": "strong",
            "auth.password.minLength": "16",
            "auth.password.upper": "true",
            "auth.password.lower": "true",
            "auth.password.digits": "true",
            "auth.password.special": "1",
            "auth.password.notName": "true",
        });
        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it("refuses a new password that breaks a rule, with the rule it breaks", async () => {
        const refusal = assertPasswordAllowed("harbor-lamp-42", { name: "Lena Graf", email: "lena@example.ch" });

        await expect(refusal).rejects.toBeInstanceOf(ValidationError);
        await expect(refusal).rejects.toThrow("The password needs an upper and a lower case letter.");
        await expect(assertPasswordAllowed("Harbor-Lamp-42", { name: "Lena Graf", email: "lena@example.ch" })).resolves.toBeUndefined();
    });
});
