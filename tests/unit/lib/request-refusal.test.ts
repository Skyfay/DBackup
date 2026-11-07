// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PermissionError, ValidationError } from "@/lib/logging/errors";
import { requestRefusal } from "@/lib/server/permission-refusal";

describe("the answer of a route that tries a connection", () => {
    it("is 400 with the sentence for a host the tenant may not reach, the caller's to fix", async () => {
        const answer = requestRefusal(new ValidationError("Acme reaches no address of the local network, db1 is 10.0.0.5."));

        expect(answer?.status).toBe(400);
        expect(await answer?.json()).toEqual({ success: false, error: "Acme reaches no address of the local network, db1 is 10.0.0.5.", message: "Acme reaches no address of the local network, db1 is 10.0.0.5." });
    });

    it("is 403 for a missing permission, and none for a failure of DBackup", () => {
        expect(requestRefusal(new PermissionError("sources:write"))?.status).toBe(403);
        expect(requestRefusal(new Error("connect ECONNREFUSED"))).toBeNull();
    });
});
