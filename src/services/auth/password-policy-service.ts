/**
 * The rules of new passwords under Settings > Passwords: read with Standard as the default of a
 * new instance, saved as a whole, and checked for every new password the server sets.
 */

import prisma from "@/lib/prisma";
import { ValidationError } from "@/lib/logging/errors";
import {
    DEFAULT_PASSWORD_LEVEL,
    LEVEL_RULES,
    MAX_PASSWORD_LENGTH,
    MAX_SPECIAL_CHARACTERS,
    MIN_PASSWORD_LENGTH,
    PASSWORD_LEVELS,
    passwordProblem,
    policyOf,
    type PasswordOwner,
    type PasswordPolicy,
    type PasswordRules,
} from "@/lib/auth/password-policy";

/** Where each part is stored. A level stores the rules it stands for as well, so Custom starts from them. */
export const PASSWORD_KEYS: Record<keyof PasswordPolicy, string> = {
    level: "auth.password.level",
    minLength: "auth.password.minLength",
    upper: "auth.password.upper",
    lower: "auth.password.lower",
    digits: "auth.password.digits",
    special: "auth.password.special",
    notName: "auth.password.notName",
};

/** A whole number from storage within its limits, or the fallback when it is missing or broken. */
function whole(value: string | undefined, fallback: number, min: number, max: number): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function flag(value: string | undefined, fallback: boolean): boolean {
    return value === undefined ? fallback : value === "true";
}

export async function getPasswordPolicy(): Promise<PasswordPolicy> {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: Object.values(PASSWORD_KEYS) } }, select: { key: true, value: true } });
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const level = PASSWORD_LEVELS.find((entry) => entry === stored.get(PASSWORD_KEYS.level)) ?? DEFAULT_PASSWORD_LEVEL;
    const fallback = LEVEL_RULES[DEFAULT_PASSWORD_LEVEL];
    const custom: PasswordRules = {
        minLength: whole(stored.get(PASSWORD_KEYS.minLength), fallback.minLength, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH),
        upper: flag(stored.get(PASSWORD_KEYS.upper), fallback.upper),
        lower: flag(stored.get(PASSWORD_KEYS.lower), fallback.lower),
        digits: flag(stored.get(PASSWORD_KEYS.digits), fallback.digits),
        special: whole(stored.get(PASSWORD_KEYS.special), fallback.special, 0, MAX_SPECIAL_CHARACTERS),
        notName: flag(stored.get(PASSWORD_KEYS.notName), fallback.notName),
    };
    return policyOf(level, custom);
}

/** Saves the level with the rules it stands for, or the custom rules as they are. */
export async function savePasswordPolicy(next: PasswordPolicy): Promise<void> {
    const policy = policyOf(next.level, next);
    await prisma.$transaction(
        (Object.keys(PASSWORD_KEYS) as (keyof PasswordPolicy)[]).map((field) => {
            const key = PASSWORD_KEYS[field];
            const value = String(policy[field]);
            return prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
        })
    );
}

/** Refuses a new password that breaks a rule, named by the first one it breaks. */
export async function assertPasswordAllowed(password: string, owner: PasswordOwner): Promise<void> {
    const problem = passwordProblem(password, await getPasswordPolicy(), owner);
    if (problem) throw new ValidationError(problem, { field: "password" });
}
