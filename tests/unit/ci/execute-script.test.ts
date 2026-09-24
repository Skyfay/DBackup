import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const SCRIPT = path.resolve(__dirname, "../../../ci/execute.sh");
const hasJq = spawnSync("jq", ["--version"]).status === 0;

/**
 * Stands in for curl: starting the job answers with a run, and every question about the run
 * answers with the next status of FAKE_STATUSES, the last one again once they run out.
 */
const FAKE_CURL = `#!/bin/bash
out=""
method="GET"
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ "$method" = "POST" ]; then
  echo '{"success":true,"executionId":"exec-1"}' > "$out"
else
  count=$(cat "$FAKE_STATE" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "$FAKE_STATE"
  status=$(echo "$FAKE_STATUSES" | awk -v n="$count" '{ print (n <= NF ? $n : $NF) }')
  echo "{\\"success\\":true,\\"data\\":{\\"status\\":\\"$status\\",\\"error\\":\\"disk full\\"}}" > "$out"
fi
printf 200
`;

describe.skipIf(!hasJq)("the script of the skyfay/dbackup:ci image", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbackup-ci-"));
        fs.writeFileSync(path.join(dir, "curl"), FAKE_CURL, { mode: 0o755 });
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    function run(statuses: string, env: Record<string, string> = {}) {
        const result = spawnSync("bash", [SCRIPT], {
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: `${dir}:${process.env.PATH}`,
                DBACKUP_URL: "https://backup.example.com",
                JOB_ID: "job-42",
                DBACKUP_API_KEY: "dbackup_test",
                DBACKUP_POLL_INTERVAL: "0",
                FAKE_STATUSES: statuses,
                FAKE_STATE: path.join(dir, "state"),
                ...env,
            },
        });
        return { code: result.status, out: result.stdout, err: result.stderr };
    }

    it("waits through Pending and Running and ends with 0 after Success", () => {
        const { code, out } = run("Pending Running Success");
        expect(code).toBe(0);
        expect(out).toContain("Attempt 3: Status=Success");
    });

    it("ends a Partial run with 2 at once, instead of waiting until it times out", () => {
        const { code, out } = run("Running Partial");
        expect(code).toBe(2);
        expect(out).toContain("Backup completed, but part of it failed.");
    });

    it("ends a Failed run with 1 and its error, and a Cancelled one with 1", () => {
        expect(run("Failed")).toMatchObject({ code: 1, out: expect.stringContaining("Backup failed: disk full") });
        expect(run("Cancelled")).toMatchObject({ code: 1, out: expect.stringContaining("Backup cancelled") });
    });

    it("gives up once DBACKUP_TIMEOUT has passed and says the run goes on", () => {
        const { code, out } = run("Running", { DBACKUP_TIMEOUT: "0" });
        expect(code).toBe(1);
        expect(out).toContain("Backup still Running after 0 seconds, giving up. The run goes on in DBackup.");
    });

    it("refuses a timeout that is no number of seconds before it starts the job", () => {
        const { code, err } = run("Success", { DBACKUP_TIMEOUT: "one hour" });
        expect(code).toBe(1);
        expect(err).toContain("DBACKUP_TIMEOUT must be a whole number of seconds");
        expect(err).not.toContain("Request: POST");
    });
});
