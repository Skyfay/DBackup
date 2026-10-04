/**
 * The rules a new password follows, set under Settings > Passwords. The server checks every new
 * password against them, and the browser ticks each one off under the field and makes a password
 * that holds them with Generate. Plain functions, so both sides judge a password the same way.
 *
 * A level is a set of rules DBackup keeps, Custom holds rules of its own. Passwords that are set
 * stay valid, the rules apply from their next change.
 */

export const PASSWORD_LEVELS = ["basic", "standard", "strong", "custom"] as const;
export type PasswordLevel = (typeof PASSWORD_LEVELS)[number];
type NamedLevel = Exclude<PasswordLevel, "custom">;

export interface PasswordRules {
    /** From 8 to 128 characters. */
    minLength: number;
    upper: boolean;
    lower: boolean;
    digits: boolean;
    /** How many special characters it needs at least, 0 for none. */
    special: number;
    /** Neither the name nor the part of the email before the @ may stand in it. */
    notName: boolean;
}

export interface PasswordPolicy extends PasswordRules {
    level: PasswordLevel;
}

/** What better-auth asks at least, so no rule goes below it. */
export const MIN_PASSWORD_LENGTH = 8;
/** What better-auth takes at most. */
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_SPECIAL_CHARACTERS = 8;

export const LEVEL_RULES: Record<NamedLevel, PasswordRules> = {
    basic: { minLength: 8, upper: false, lower: false, digits: false, special: 0, notName: false },
    standard: { minLength: 12, upper: true, lower: true, digits: true, special: 0, notName: true },
    strong: { minLength: 16, upper: true, lower: true, digits: true, special: 1, notName: true },
};

/** The level of a new instance. One from before the rules keeps Basic, which its migration stores. */
export const DEFAULT_PASSWORD_LEVEL: NamedLevel = "standard";

export const LEVEL_NAMES: Record<PasswordLevel, string> = { basic: "Basic", standard: "Standard", strong: "Strong", custom: "Custom" };

/** The policy of a level: the rules DBackup keeps for it, or the custom ones as given. */
export function policyOf(level: PasswordLevel, custom: PasswordRules = LEVEL_RULES[DEFAULT_PASSWORD_LEVEL]): PasswordPolicy {
    const { minLength, upper, lower, digits, special, notName } = level === "custom" ? custom : LEVEL_RULES[level];
    return { level, minLength, upper, lower, digits, special, notName };
}

const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const DIGIT = /\p{Nd}/u;
/** Anything but a letter, a mark, a number or a space, so # and € count while é and a space do not. */
const SPECIAL = /[^\p{L}\p{M}\p{N}\s]/gu;

/** Whose password it is, for the rule that it may not hold their name or email. */
export interface PasswordOwner {
    name?: string | null;
    email?: string | null;
}

/** The words of the name and of the part of the email before the @, from 3 characters on, in lower case. */
export function ownerWords(owner: PasswordOwner): string[] {
    const local = owner.email?.split("@")[0] ?? "";
    const words = `${owner.name ?? ""} ${local}`.toLowerCase().split(/[^\p{L}\p{N}]+/u);
    return [...new Set(words.filter((word) => word.length >= 3))];
}

export type PasswordRuleId = "length" | "letters" | "digits" | "special" | "notName";

export interface PasswordCheck {
    id: PasswordRuleId;
    /** What the rule asks, like "12 characters or more". */
    label: string;
    met: boolean;
}

/** Each rule with whether the password holds it, in the order the field lists them. An empty password holds none. */
export function checkPassword(password: string, rules: PasswordRules, owner: PasswordOwner = {}): PasswordCheck[] {
    const checks: PasswordCheck[] = [{ id: "length", label: `${rules.minLength} characters or more`, met: password.length >= rules.minLength }];
    if (rules.upper || rules.lower) {
        const label = rules.upper && rules.lower ? "An upper and a lower case letter" : rules.upper ? "An upper case letter" : "A lower case letter";
        checks.push({ id: "letters", label, met: (!rules.upper || UPPER.test(password)) && (!rules.lower || LOWER.test(password)) });
    }
    if (rules.digits) checks.push({ id: "digits", label: "A number", met: DIGIT.test(password) });
    if (rules.special > 0) {
        const label = rules.special === 1 ? "A special character like ! or #" : `${rules.special} special characters like ! or #`;
        checks.push({ id: "special", label, met: (password.match(SPECIAL)?.length ?? 0) >= rules.special });
    }
    if (rules.notName) {
        const lower = password.toLowerCase();
        checks.push({ id: "notName", label: "Not the name or the email", met: password.length > 0 && !ownerWords(owner).some((word) => lower.includes(word)) });
    }
    return checks;
}

/** What a new password lacks as one sentence, or null when it holds every rule. */
export function passwordProblem(password: string, rules: PasswordRules, owner: PasswordOwner = {}): string | null {
    if (password.length > MAX_PASSWORD_LENGTH) return `The password can have at most ${MAX_PASSWORD_LENGTH} characters.`;
    const missing = checkPassword(password, rules, owner).find((check) => !check.met);
    if (!missing) return null;
    if (missing.id === "notName") return "The password may not contain the name or the email.";
    return `The password needs ${missing.label.charAt(0).toLowerCase()}${missing.label.slice(1)}.`;
}

/** The rules as one sentence, like "A new password needs 12 characters or more, ... and a number." */
export function describePolicy(rules: PasswordRules): string {
    const needs = checkPassword("", rules)
        .filter((check) => check.id !== "notName")
        .map((check, index) => (index === 0 ? check.label : `${check.label.charAt(0).toLowerCase()}${check.label.slice(1)}`));
    const list = needs.length > 1 ? `${needs.slice(0, -1).join(", ")} and ${needs[needs.length - 1]}` : needs[0];
    return `A new password needs ${list}${rules.notName ? ", and not the name or the email" : ""}.`;
}

/** Letters and digits nobody mixes up when reading them out, so no l and 1 or O and 0. */
const UPPERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERS = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const LETTERS_AND_DIGITS = UPPERS + LOWERS + DIGITS;

/** The special characters Generate uses. Every keyboard has them, and no shell or URL trips over them. */
export const GENERATED_SPECIALS = "!@*-_.";
/** How long a password from Generate is, unless the rules ask for more. */
export const GENERATED_LENGTH = 16;

/** A random whole number below `size`, without the bias of a plain remainder. */
function randomBelow(size: number): number {
    const limit = Math.floor(0x100000000 / size) * size;
    const value = new Uint32Array(1);
    do crypto.getRandomValues(value);
    while (value[0] >= limit);
    return value[0] % size;
}

const pick = (set: string) => set[randomBelow(set.length)];

/**
 * A password that holds the rules: 16 characters or the minimum length when it is longer, one of
 * every kind the rules ask for, and letters and digits for the rest. Special characters come only
 * from `GENERATED_SPECIALS`. In the rare case a word of the name turns up, it tries again.
 */
export function generatePassword(rules: PasswordRules, owner: PasswordOwner = {}): string {
    const length = Math.min(MAX_PASSWORD_LENGTH, Math.max(GENERATED_LENGTH, rules.minLength));
    for (let attempt = 1; ; attempt++) {
        const characters = [
            ...(rules.upper ? [pick(UPPERS)] : []),
            ...(rules.lower ? [pick(LOWERS)] : []),
            ...(rules.digits ? [pick(DIGITS)] : []),
            ...Array.from({ length: rules.special }, () => pick(GENERATED_SPECIALS)),
        ];
        while (characters.length < length) characters.push(pick(LETTERS_AND_DIGITS));
        // The kinds the rules ask for would stand first, so the whole is shuffled.
        for (let index = characters.length - 1; index > 0; index--) {
            const other = randomBelow(index + 1);
            [characters[index], characters[other]] = [characters[other], characters[index]];
        }
        const password = characters.join("");
        if (attempt >= 20 || passwordProblem(password, rules, owner) === null) return password;
    }
}
