// @vitest-environment node
/**
 * A route that broke answers a fixed sentence with its 500, while the error itself goes to the log
 * with `wrapError`. The message of an error can name a path, a host, a line of a driver or the
 * settings of a destination of another tenant. A refusal written for the user, a `ValidationError`,
 * `NotFoundError`, `ConflictError` or `PermissionError`, answers with its own sentence and its own
 * status through `requestRefusal` or `serviceRefusal` in `src/lib/server/permission-refusal.ts`.
 *
 * The guard looks at every `Response.json` and `NextResponse.json` of a route whose status is 500 or
 * not written as a number below 500, and refuses one whose body holds `.message` or
 * `getErrorMessage(`, or a variable the catch around it filled from one of them. Inside a catch it
 * also looks at every other answer, a redirect, a local helper that redirects, and a JSON answer of
 * any status or none, and refuses one that carries the words of the caught error, unless the
 * statement only answers an error written for the user (`WRITTEN_FOR_USER`).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API = path.resolve(__dirname, "../../../src/app/api");

/**
 * The routes whose purpose is the answer of a server the caller points them at, a connection form
 * or a picker that reads it, where what the server said, like a refused login or a missing
 * database, is what the caller has to fix.
 */
const SERVER_ANSWERS = new Set([
    "adapters/access-check/route.ts",
    "adapters/database-stats/route.ts",
    "adapters/database-table-data/route.ts",
    "adapters/database-tables/route.ts",
    "adapters/[id]/browse/route.ts",
    "adapters/[id]/databases/route.ts",
    "adapters/test-ssh/route.ts",
    "system/filesystem/remote/route.ts",
    // The restore page reads the answer of the target server to its check, like missing rights to
    // create a database, and offers to sign in as an admin of it.
    "storage/[id]/restore/route.ts",
    // The snapshot check of a connection form answers what the server the form points at said, like
    // a VSS agent that does not answer, to whoever fills in that form.
    "adapters/check-snapshot/route.ts",
]);

/**
 * The errors whose sentence is written for the user, the refusals of `serviceRefusal`, the subclasses
 * of them a route answers with a body of its own, and `ServiceError`, which `userMessage` passes too.
 */
const WRITTEN_FOR_USER = /\binstanceof\s+(?:PermissionError|ValidationError|NotFoundError|ConflictError|UnsupportedSettingError|TenantNotEmptyError|ServiceError)\b/;

const LEAK = /\.message\b|getErrorMessage\(/;
const CALL = /(?:NextResponse|Response)\.json\(/g;

function routeFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return routeFiles(full);
        return entry.name.endsWith(".ts") ? [full] : [];
    });
}

/** The text of the call that starts at `start`, up to its closing parenthesis. */
function callAt(source: string, start: number): string {
    let depth = 0;
    for (let index = source.indexOf("(", start); index < source.length; index++) {
        if (source[index] === "(") depth++;
        if (source[index] === ")" && --depth === 0) return source.slice(start, index + 1);
    }
    return source.slice(start);
}

/** The index of the bracket that closes the one at `open`. */
function closingAt(source: string, open: number, opening: string, closing: string): number {
    let depth = 0;
    for (let index = open; index < source.length; index++) {
        if (source[index] === opening) depth++;
        if (source[index] === closing && --depth === 0) return index;
    }
    return source.length;
}

/** The variable and the start of the body of the innermost catch around `at`, or null outside one. */
function catchAround(source: string, at: number): { name: string; body: number } | null {
    let found: { name: string; body: number } | null = null;
    for (const clause of source.slice(0, at).matchAll(/catch\s*\(\s*(\w+)[^)]*\)\s*\{/g)) {
        const body = clause.index + clause[0].length - 1;
        if (closingAt(source, body, "{", "}") > at) found = { name: clause[1], body };
    }
    return found;
}

/**
 * The places inside a catch that answer with the words of the caught error, whatever the status,
 * and the redirects that carry them, as `line` numbers.
 */
function caughtWordsAnswers(source: string): number[] {
    const helpers = [...source.matchAll(/const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::\s*\w+\s*)?=>\s*(?:NextResponse|Response)\.redirect\(/g)].map((found) => found[1]);
    const answer = new RegExp(`(?:(?:NextResponse|Response)\\.(?:json|redirect)${helpers.map((name) => `|\\b${name}`).join("")})\\(`, "g");
    const lines: number[] = [];
    for (const match of source.matchAll(answer)) {
        const caught = catchAround(source, match.index);
        if (!caught) continue;
        const call = source.slice(match.index, closingAt(source, source.indexOf("(", match.index), "(", ")") + 1);
        const name = caught.name;
        const words = new RegExp(`\\b${name}\\b[^,;)]*?\\)?\\.message\\b|getErrorMessage\\(\\s*${name}\\b|String\\(\\s*${name}\\s*\\)|\\$\\{\\s*${name}\\s*\\}`);
        const before = source.slice(caught.body, match.index);
        const statement = source.slice(Math.max(source.lastIndexOf(";", match.index), source.lastIndexOf("}", match.index)), match.index);
        if (WRITTEN_FOR_USER.test(statement) || WRITTEN_FOR_USER.test(call)) continue;
        if (/\bstatus\s*=\s*refusalStatus\(/.test(before)) continue;
        const filled = [...before.matchAll(/(?:const|let)\s+(\w+)\s*=([^;]*)/g)].filter((found) => words.test(found[2])).map((found) => found[1]);
        if (words.test(call) || filled.some((filledName) => new RegExp(`\\b${filledName}\\b`).test(call))) {
            lines.push(source.slice(0, match.index).split("\n").length);
        }
    }
    return lines;
}

/** The places in a source that answer a failure with the words of an error, as `line` numbers. */
function leakingAnswers(source: string): number[] {
    const lines: number[] = caughtWordsAnswers(source);
    for (const match of source.matchAll(CALL)) {
        const call = callAt(source, match.index);
        const status = /status:\s*(\w+)|\{\s*status\s*\}/.exec(call);
        if (!status) continue;
        const code = status[1] ?? "status";
        if (/^\d+$/.test(code) && Number(code) < 500) continue;
        const catchAt = source.lastIndexOf("catch", match.index);
        const before = catchAt >= 0 ? source.slice(catchAt, match.index) : "";
        // A status from `refusalStatus` is one of the refusals, never 500.
        if (code === "status" && /\bstatus\s*=\s*refusalStatus\(/.test(before)) continue;
        const filled = [...before.matchAll(/(?:const|let)\s+(\w+)\s*=[^;]*?(?:\.message\b|getErrorMessage\()/g)].map((found) => found[1]);
        if (LEAK.test(call) || filled.some((name) => new RegExp(`\\b${name}\\b`).test(call))) {
            lines.push(source.slice(0, match.index).split("\n").length);
        }
    }
    return [...new Set(lines)].sort((a, b) => a - b);
}

describe("the answer of a route that broke", () => {
    it("is a fixed sentence, never the message of the error", () => {
        const leaking = routeFiles(API)
            .map((file) => path.relative(API, file).split(path.sep).join("/"))
            .filter((file) => !SERVER_ANSWERS.has(file))
            .flatMap((file) => leakingAnswers(fs.readFileSync(path.join(API, file), "utf8")).map((line) => `${file}:${line}`));
        expect(leaking, "Answer a fixed sentence and log the error with wrapError, see serviceRefusal for refusals").toEqual([]);
    });

    it("finds the message of an error however the answer carries it", () => {
        const answer = (body: string) => `try { work(); } catch (error) {\n${body}\n}`;
        expect(leakingAnswers(answer(`return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });`))).toEqual([2]);
        expect(leakingAnswers(answer(`const message = error instanceof Error ? error.message : "x";\nreturn NextResponse.json({ error: message }, { status: 500 });`))).toEqual([3]);
        expect(leakingAnswers(answer(`const message = getErrorMessage(error);\nconst status = message.includes("x") ? 409 : 500;\nreturn NextResponse.json({ error: message }, { status });`))).toEqual([4]);
        expect(leakingAnswers(answer(`if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });\nreturn NextResponse.json({ error: "Failed" }, { status: 500 });`))).toEqual([]);
        expect(leakingAnswers(answer(`const status = refusalStatus(error);\nif (status) return NextResponse.json({ error: (error as Error).message }, { status });`))).toEqual([]);
    });

    it("finds the words of a caught error in an answer below 500 and in a redirect", () => {
        const answer = (body: string) => `try { work(); } catch (error) {\n${body}\n}`;
        // The validate-token routes answered the words of the provider with 200.
        expect(leakingAnswers(answer(`const message = error instanceof Error ? error.message : String(error);\nreturn NextResponse.json({ valid: false, message });`))).toEqual([3]);
        expect(leakingAnswers(answer(`return NextResponse.json({ error: (error as Error).message }, { status: 400 });`))).toEqual([2]);
        expect(leakingAnswers(answer("return NextResponse.redirect(`/x?message=${encodeURIComponent(getErrorMessage(error))}`);"))).toEqual([2]);
        // The OAuth callbacks redirected through a helper of their own.
        const helper = "const fail = (message: string) =>\n    NextResponse.redirect(`/x?message=${encodeURIComponent(message)}`);\n";
        expect(leakingAnswers(`${helper}try { work(); } catch (err) {\nreturn fail(err instanceof Error ? err.message : "OAuth callback failed");\n}`)).toEqual([4]);
        expect(leakingAnswers(`${helper}try { work(); } catch (err) {\nreturn fail("The authorization could not be completed.");\n}`)).toEqual([]);
        expect(leakingAnswers(`${helper}const caller = check();\nif (!caller.ok) return fail(caller.message);`)).toEqual([]);
        expect(leakingAnswers(answer(`if (error instanceof TenantNotEmptyError) return NextResponse.json({ error: error.message }, { status: 409 });`))).toEqual([]);
    });

    it("keeps the list of routes that pass the answer of a server current", () => {
        const gone = [...SERVER_ANSWERS].filter((file) => !fs.existsSync(path.join(API, file)));
        expect(gone).toEqual([]);
    });
});
