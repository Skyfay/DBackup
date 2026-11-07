import { describe, expect, it } from "vitest";
import { schemaFor } from "@/components/dashboard/users/user-dialog-schema";

const base = { name: "Lena Graf", email: "lena@example.com", password: "Correct-Horse-9", kind: "tenant" as const, tenantId: "", groupId: "", platform: "" };

const problems = (values: typeof base | (Omit<typeof base, "kind"> & { kind: "platform" })) => {
    const result = schemaFor(true, null, true).safeParse(values);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("New user under Platform", () => {
    it("asks an account of a tenant for its tenant and its group there", () => {
        expect(problems(base)).toEqual(["tenantId", "groupId"]);
        expect(problems({ ...base, tenantId: "acme", groupId: "none" })).toEqual(["groupId"]);
        expect(problems({ ...base, tenantId: "acme", groupId: "g-client" })).toEqual([]);
    });

    it("asks an account of the platform for its platform group alone", () => {
        expect(problems({ ...base, kind: "platform" })).toEqual(["platform"]);
        expect(problems({ ...base, kind: "platform", platform: "platform-admin" })).toEqual([]);
    });
});
