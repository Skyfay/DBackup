import { describe, expect, it } from "vitest";
import { KEY_PLACEHOLDER, curlStatus, curlTrigger, type TriggerTarget } from "@/components/dashboard/jobs/api-trigger-examples";
import { PIPELINE_EXAMPLES } from "@/components/dashboard/jobs/api-trigger-pipelines";
import { SCRIPT_EXAMPLES } from "@/components/dashboard/jobs/api-trigger-scripts";

const target: TriggerTarget = { baseUrl: "https://backup.example.com", jobId: "job-42", apiKey: "dbackup_made_in_setup" };
const code = (id: string) => [...SCRIPT_EXAMPLES, ...PIPELINE_EXAMPLES].find((example) => example.id === id)!.files.map((file) => file.code(target)).join("\n");

describe("examples of the API trigger", () => {
    it.each(["bash", "python", "typescript", "go"])("%s ends a Partial run with 2 and a Failed or Cancelled one with 1, instead of waiting for ever", (id) => {
        const script = code(id);
        for (const status of ["Success", "Partial", "Failed", "Cancelled"]) expect(script).toContain(`"${status}"`);
        expect(script).toMatch(/exit\(2\)|exit 2|Exit\(2\)/);
    });

    it("stops Bash at a status it does not know, so a new one never loops", () => {
        expect(code("bash")).toContain('echo "Unknown status: ${STATUS}"');
    });

    it.each(["curl", "bash", "python", "typescript", "go", "ansible"])("%s sends the key it is given to the address and the job", (id) => {
        const example = code(id);
        expect(example).toContain(target.apiKey);
        expect(example).toContain(target.baseUrl);
        expect(example).toContain(target.jobId);
        expect(example).not.toContain(KEY_PLACEHOLDER);
    });

    it.each(["github", "gitlab", "azure"])("%s reads the address and the key from its secrets, so neither lands in the file", (id) => {
        const pipeline = code(id);
        expect(pipeline).toContain(`JOB_ID: "${target.jobId}"`);
        expect(pipeline).toContain("DBACKUP_API_KEY");
        expect(pipeline).not.toContain(target.apiKey);
        expect(pipeline).not.toContain(target.baseUrl);
    });

    it("lets Ansible wait for every status that ends a run and fail the play unless the backup succeeded", () => {
        const playbook = code("ansible");
        expect(playbook).toContain("until: poll.json.data.status in ['Success', 'Partial', 'Failed', 'Cancelled']");
        expect(playbook).toContain("when: poll.json.data.status != 'Success'");
    });

    it("starts a run with cURL and asks for its status, with its log on request", () => {
        expect(curlTrigger(target)).toBe(`curl -X POST "https://backup.example.com/api/jobs/job-42/run" \\\n  -H "Authorization: Bearer dbackup_made_in_setup"`);
        expect(curlStatus(target, "?includeLogs=true")).toContain('"https://backup.example.com/api/executions/EXECUTION_ID?includeLogs=true"');
    });
});
