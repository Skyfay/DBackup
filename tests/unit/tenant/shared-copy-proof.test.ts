/**
 * A customer reads a backup of a shared server only with a proof that DBackup made it: a run of the
 * server's tenant that wrote the path, or the seal of a key of that tenant. A `.meta.json` at the
 * destination proves nothing and gives no time a run or the seal does not confirm. A copy moved to a
 * new storage keeps its proof, by the digest of its index or by its seal.
 */
import { describe, expect, it } from "vitest";
import { copyProofProblem, proofOf } from "@/services/tenant/shared-copy-proof";
import type { RecordedRun } from "@/services/tenant/recorded-backups";

const run = (destinations: string[], indexSha256: string | null, startedAt = "2026-11-02T01:00:00.000Z", endedAt: string | null = "2026-11-02T01:30:00.000Z"): RecordedRun =>
    ({ destinations: new Set(destinations), indexSha256, startedAt, endedAt });
const runs = (list: RecordedRun[]) => new Map([["Nightly/crm.tar", list]]);
const listed = (extra: Record<string, unknown> = {}) => ({ path: "/Nightly/crm.tar", createdAt: "2026-11-02T01:20:00.000Z", dumpsStartedAt: "2026-11-02T01:05:00.000Z", ...extra });

describe("the proof a listed copy carries", () => {
    it("is the run that wrote it there, with the start of the run and the stamp of the sidecar inside it", () => {
        const proven = proofOf("nas", listed(), runs([run(["nas"], "digest-a")]));
        expect(proven).toEqual({ proof: { kind: "recorded", digests: ["digest-a"] }, createdAt: "2026-11-02T01:20:00.000Z", dumpsStartedAt: "2026-11-02T01:00:00.000Z" });
    });

    it("takes the end of the run for a stamp of the sidecar outside the run, so a changed sidecar moves no backup in time", () => {
        const proven = proofOf("nas", listed({ createdAt: "2026-12-24T10:00:00.000Z" }), runs([run(["nas"], "digest-a")]));
        expect(proven?.createdAt).toBe("2026-11-02T01:30:00.000Z");
    });

    it("is the run that wrote the path elsewhere for a copy moved to a new storage, by the digest of its index", () => {
        const proven = proofOf("new-nas", listed(), runs([run(["nas"], "digest-a")]));
        expect(proven?.proof).toEqual({ kind: "recorded", digests: ["digest-a"] });
    });

    it("is none for a moved copy whose run recorded no digest, nor for a plain file no run wrote", () => {
        expect(proofOf("new-nas", listed(), runs([run(["nas"], null)]))).toBeNull();
        expect(proofOf("nas", listed(), new Map())).toBeNull();
    });

    it("is the seal for an encrypted backup no run knows, with the times of its sidecar until the read checks the seal", () => {
        const proven = proofOf("new-nas", listed({ isEncrypted: true }), new Map());
        expect(proven).toEqual({ proof: { kind: "sealed" }, createdAt: "2026-11-02T01:20:00.000Z", dumpsStartedAt: "2026-11-02T01:05:00.000Z" });
    });
});

const opened = (extra: Record<string, unknown> = {}) => ({
    manifest: { encryption: { profileId: "msp-key" } },
    masterKey: Buffer.alloc(32, 1),
    indexSha256: "digest-a",
    index: { header: { createdAt: "2026-11-02T01:10:00.000Z" } },
    ...extra,
});
const always = () => true;

describe("an opened copy against its proof", () => {
    it("passes a recorded copy whose index is the one its run recorded, and refuses another index", () => {
        expect(copyProofProblem({ kind: "recorded", digests: ["digest-a"] }, opened(), always)).toBeNull();
        expect(copyProofProblem({ kind: "recorded", digests: ["digest-a"] }, opened({ indexSha256: "digest-b" }), always)).toMatch(/not the one its run recorded/);
    });

    it("passes a copy of a run that recorded no digest on its own destination", () => {
        expect(copyProofProblem({ kind: "recorded", digests: [] }, opened({ indexSha256: "anything" }), always)).toBeNull();
    });

    it("refuses a sealed copy that is plain or opened with no key of the server's tenant", () => {
        expect(copyProofProblem({ kind: "sealed" }, opened({ manifest: {} }), always)).toMatch(/not encrypted/);
        expect(copyProofProblem({ kind: "sealed" }, opened({ masterKey: undefined }), always)).toMatch(/not encrypted/);
    });

    it("judges a sealed copy by the time sealed in its index, not by its sidecar", () => {
        const asked: string[] = [];
        const heldAt = (at: string) => { asked.push(at); return at.startsWith("2026-11-02"); };
        expect(copyProofProblem({ kind: "sealed" }, opened(), heldAt)).toBeNull();
        expect(asked).toEqual(["2026-11-02T01:10:00.000Z"]);
        expect(copyProofProblem({ kind: "sealed" }, opened({ index: { header: { createdAt: "2025-01-01T00:00:00.000Z" } } }), heldAt)).toMatch(/not one of the customer's/);
    });
});
