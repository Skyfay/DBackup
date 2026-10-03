import { describe, expect, it } from "vitest";
import { describeProblem } from "@/services/history/known-problems";
import { buildProblems, markSteps, rawOf, subjectOf } from "@/services/history/run-problems";
import { buildSteps } from "@/services/history/run-steps";
import type { RunNotification } from "@/services/history/run-types";
import { destinations, offsiteLog } from "./run-fixtures";

const targets = { jobName: "Shop offsite", destinations, sourceName: "Shop cluster", sourceId: "src-1" };
const telegram: RunNotification = {
    id: "n1", channelId: "tg", channelName: "Telegram Manu", adapterId: "telegram", status: "Failed", error: "403 Forbidden: bot was blocked by the user", title: "Backup partial", sentAt: "2026-09-27T04:07:14.000Z",
};

describe("subjectOf and rawOf", () => {
    it("split the destination in brackets off a line and keep what the server wrote", () => {
        expect(subjectOf("[Google Drive] Upload FAILED: 403 quota")).toEqual({ subject: "Google Drive", text: "Upload FAILED: 403 quota" });
        expect(rawOf("Upload FAILED: 403 quota")).toBe("403 quota");
        expect(subjectOf("plain")).toEqual({ subject: null, text: "plain" });
    });
});

describe("buildProblems", () => {
    const { problems, lineProblems } = buildProblems(offsiteLog, [telegram], targets);

    it("tells every problem once, the errors first", () => {
        expect(problems.map((problem) => problem.title)).toEqual(["Google Drive is full", "Telegram blocked the bot", "Circular foreign keys in orders"]);
    });

    it("folds the tries of a destination into its error, with a button to the destination", () => {
        const drive = problems[0];
        expect(drive).toMatchObject({ tone: "error", step: "Uploading", subject: "Google Drive", raw: "403 The user's Drive storage quota has been exceeded." });
        expect(drive.tries).toEqual(["2026-09-27T04:05:31.000Z", "2026-09-27T04:05:41.000Z", "2026-09-27T04:05:53.000Z"]);
        expect(drive.actions).toEqual([{ kind: "destination", id: "drive", label: "Open destination" }, { kind: "job", label: "Open job" }]);
        expect([...lineProblems.values()].filter((id) => id === drive.id)).toHaveLength(3);
    });

    it("tells a channel that did not take the message, and marks a known warning as harmless help", () => {
        expect(problems[1]).toMatchObject({ tone: "error", subject: "Telegram Manu", actions: [{ kind: "channel", id: "tg", label: "Open channel" }] });
        expect(problems[2]).toMatchObject({ tone: "warning", step: "Dumping Databases" });
        expect(problems[2].help).toContain("Nothing is missing");
    });

    it("leaves out the summary lines that repeat what the problems say", () => {
        expect(problems.some((problem) => problem.raw.startsWith("Upload summary"))).toBe(false);
    });

    it("counts an error written twice as one error and no second try", () => {
        const twice = [
            { timestamp: "a", level: "error" as const, type: "general" as const, message: "connection to server failed: timeout expired", stage: "Dumping Databases" },
            { timestamp: "b", level: "error" as const, type: "general" as const, message: "connection to server failed: timeout expired", stage: "Dumping Databases" },
        ];
        const { problems: once } = buildProblems(twice, [], targets);
        expect(once).toHaveLength(1);
        expect(once[0]).toMatchObject({ title: "Could not reach Shop cluster", tries: [], actions: [{ kind: "source", id: "src-1", label: "Open source" }] });
    });
});

describe("warnings of one step about many things", () => {
    const warning = (message: string) => ({ timestamp: "2026-09-27T00:00:03.000Z", level: "warning" as const, type: "general" as const, message, stage: "Dumping Databases" });

    it("are one problem with a count for each kind of thing they say, not tries", () => {
        const { problems, lineProblems } = buildProblems([
            warning("A BACPAC export is not transactionally consistent while the database is being written to."),
            warning("Element [dbo].[h1] is a history table for the [dbo].[t1] updatable ledger table. Migrating data in history tables is not supported."),
            warning("Element [dbo].[t1].[ledger_start_transaction_id] is a column with system-generated values (a GENERATED ALWAYS column) in a ledger table."),
            warning("Element [dbo].[t1].[ledger_end_transaction_id] is a column with system-generated values (a GENERATED ALWAYS column) in a ledger table."),
        ], [], targets);

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ tone: "warning", title: "4 warnings while dumping databases", tries: [], help: null });
        expect(problems[0].kinds!.map((kind) => [kind.title, kind.count])).toEqual([
            ["The export is not consistent while the database is written to", 1],
            ["History tables of ledger tables are left out", 1],
            ["Generated always columns of ledger tables are left out", 2],
        ]);
        expect(lineProblems.size).toBe(4);
    });

    it("keep the title of their one kind when they all say the same", () => {
        const { problems } = buildProblems([
            warning("Element [dbo].[t1].[a] is a column with system-generated values (a GENERATED ALWAYS column) in a ledger table."),
            warning("Element [dbo].[t2].[b] is a column with system-generated values (a GENERATED ALWAYS column) in a ledger table."),
        ], [], targets);
        expect(problems[0]).toMatchObject({ title: "Generated always columns of ledger tables are left out", kinds: [expect.objectContaining({ count: 2 })] });
    });
});

describe("describeProblem", () => {
    it("names the step for a message no entry knows", () => {
        expect(describeProblem("something odd", "error", { subject: null, step: "Processing", jobName: null, subjectKind: null })).toEqual({ title: "Failed while processing", help: null, actions: [] });
        expect(describeProblem("odd", "warning", { subject: "NAS", step: "Uploading", jobName: null, subjectKind: null }).title).toBe("A warning from NAS");
    });
});

describe("MySQL and MariaDB lines", () => {
    const source = { subject: "Shop cluster", step: "Dumping Databases", jobName: "Shop offsite", subjectKind: "source" as const, subjectId: "src-1" };

    it("tell which part of a database the dump left out and what to grant, with the source to open", () => {
        const events = describeProblem("Events of shop left out: the login may not read them. Grant it EVENT on the database, or turn off Events in the source.", "warning", source);
        const routines = describeProblem("Stored procedures and functions of shop left out: the login may not read function f_add. Grant it SHOW_ROUTINE ...", "warning", source);

        expect(events).toMatchObject({ title: "The events of shop are not in the backup", actions: [{ kind: "source", id: "src-1", label: "Open source" }] });
        expect(events.help).toContain("Grant it EVENT");
        expect(routines.title).toBe("Routines of shop are not in the backup");
        expect(routines.help).toContain("SHOW_ROUTINE");
    });

    it("explain a restore that binary logging or another definer stops", () => {
        const restore = { ...source, step: "Restoring" };

        expect(describeProblem("MySQL: ERROR 1419 (HY000) at line 60: You do not have the SUPER privilege and binary logging is enabled (you *might* want to use the less safe log_bin_trust_function_creators variable)", "error", restore).help)
            .toContain("log_bin_trust_function_creators");
        for (const line of [
            "MySQL: ERROR 1227 (42000) at line 60: Access denied; you need (at least one of) the SUPER privilege(s) for this operation",
            "MySQL: ERROR 1227 (42000) at line 56: Access denied; you need (at least one of) the SUPER or SET_ANY_DEFINER privilege(s) for this operation",
            "MySQL: ERROR 1227 (42000) at line 60: Access denied; you need (at least one of) the SET USER privilege(s) for this operation",
        ]) {
            expect(describeProblem(line, "error", restore).title).toBe("The backup holds objects of another user");
        }
    });
});

describe("markSteps", () => {
    it("marks the lines of each problem and counts a failed notification on its step", () => {
        const { problems, lineProblems } = buildProblems(offsiteLog, [telegram], targets);
        const steps = markSteps(buildSteps(offsiteLog, { type: "Backup", status: "Partial", currentStage: null, now: 0, usual: new Map() }), lineProblems, problems);
        const uploading = steps.find((step) => step.name === "Uploading")!;
        expect(uploading.lines.filter((line) => line.problem === problems[0].id)).toHaveLength(3);
        expect(steps.find((step) => step.name === "Sending Notifications")).toMatchObject({ state: "failed", errors: 1 });
    });
});
