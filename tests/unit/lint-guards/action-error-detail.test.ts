// @vitest-environment node
/**
 * A Server Action that broke answers a fixed sentence, while the error itself goes to the log. The
 * message of an error can name a path, a host, a line of a driver or the storage of a destination
 * that another tenant shares, so an action passes it on only when DBackup wrote it for the user:
 * through `userMessage` in `src/lib/logging/user-message.ts`, or on a line that checks the error
 * with `instanceof` of a class written for the user (`WRITTEN_FOR_USER`).
 *
 * The guard refuses every `getErrorMessage(` in an action, and every `.message` on a line without
 * such a check, apart from the first issue of a Zod parse and the lines of `ALLOWED`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS = path.resolve(__dirname, "../../../src/app/actions");

/** Files outside the actions whose words reach the user the same way: `runBulk` answers every failed row of a bulk action. */
const ANSWERING = [path.resolve(__dirname, "../../../src/lib/core/bulk.ts")];

/** The errors whose sentence is written for the user, and the helpers that check for them. */
const WRITTEN_FOR_USER = /\binstanceof\s+(?:PermissionError|ValidationError|NotFoundError|ConflictError|ServiceError|TenantAdminRefusal)\b|\bisRefusal\(|\bisUserMessage\(/;

/** The first issue of a Zod parse, which names the field the user filled in. */
const ZOD_ISSUE = /issues\[0\]\??\.message/g;

/** Lines that read `.message` of something that is no caught error, by file and a part of the line, with why. */
const ALLOWED: { file: string; line: string; why: string }[] = [];

function actionFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return actionFiles(full);
        return entry.name.endsWith(".ts") ? [full] : [];
    });
}

/** A line without its comment, so a sentence about `.message` in a comment does not count. */
const code = (line: string) => (line.trimStart().startsWith("*") || line.trimStart().startsWith("/*") ? "" : line.replace(/\/\/.*$/, ""));

function leaks(file: string): string[] {
    const relative = path.relative(ACTIONS, file);
    return fs.readFileSync(file, "utf8").split("\n").flatMap((raw, index) => {
        const line = code(raw);
        const where = `${relative}:${index + 1}: ${raw.trim()}`;
        if (line.includes("getErrorMessage(")) return [where];
        if (!/\.message\b/.test(line.replace(ZOD_ISSUE, ""))) return [];
        if (WRITTEN_FOR_USER.test(line)) return [];
        if (ALLOWED.some((entry) => entry.file === relative && raw.includes(entry.line))) return [];
        return [where];
    });
}

describe("the answers of Server Actions", () => {
    it("never pass on the words of an error DBackup did not write for the user", () => {
        expect([...actionFiles(ACTIONS), ...ANSWERING].flatMap(leaks)).toEqual([]);
    });

    it("finds a raw message, and lets one through that is checked or goes through userMessage", () => {
        const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "action-guard-"));
        try {
            const sample = path.join(dir, "sample.ts");
            fs.writeFileSync(sample, [
                "return { success: false, error: getErrorMessage(error) };",
                "return { success: false, error: (error as Error).message };",
                "if (error instanceof ValidationError) return { success: false, error: error.message };",
                "return { success: false, error: parsed.error.issues[0]?.message ?? \"Invalid request\" };",
                "return { success: false, error: userMessage(error, \"Fixed.\", log, \"Failed\") };",
                "// The .message of a driver stays in the log.",
            ].join("\n"));
            expect(leaks(sample).map((entry) => entry.split(":")[1])).toEqual(["1", "2"]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
