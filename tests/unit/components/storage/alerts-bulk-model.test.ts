import { describe, expect, it } from "vitest";
import { afterOf, alertOf, changedDestinations, changesOf, firesRightAway, nowText, startValue, summaryText, type AlertSettings } from "@/components/dashboard/storage/explorer/alerts-bulk-model";
import { destination } from "./explorer-fixtures";

const GB = 1024 ** 3;
const nas = destination("nas", "NAS Backups", {
    size: 31 * GB,
    alerts: {
        usageSpike: { enabled: true, percent: 20, active: false },
        storageLimit: { enabled: true, bytes: 40 * GB, active: false },
        missingBackup: { enabled: true, hours: 26, active: false },
    },
});
const r2 = destination("r2", "Cloudflare R2", { size: 1 * GB });
const hetzner = destination("hetzner", "Hetzner Box", {
    size: 18 * GB,
    alerts: { ...r2.alerts, missingBackup: { enabled: true, hours: 24, active: false } },
});
const all = [nas, r2, hetzner];
const keep = { choice: "keep", value: 0 } as const;
const settings = (overrides: Partial<AlertSettings>): AlertSettings => ({ usageSpike: keep, storageLimit: keep, missingBackup: keep, ...overrides });

describe("the alerts of several destinations", () => {
    it("says in one line how the destinations have an alert now", () => {
        expect(nowText("usageSpike", all)).toBe("On at NAS Backups with 20 %, off at 2");
        expect(nowText("missingBackup", all)).toBe("On at 2 of 3 after 24 to 26 hours, off at 1");
        expect(nowText("storageLimit", [r2, hetzner])).toBe("Off at all 2");
    });

    it("starts On at the value most of the destinations with the alert on have", () => {
        expect(startValue("missingBackup", [nas, hetzner, destination("x", "X", { alerts: { ...r2.alerts, missingBackup: { enabled: true, hours: 24, active: false } } })])).toBe(24);
        expect(startValue("storageLimit", [r2, hetzner])).toBe(10 * GB);
    });

    it("changes only the destinations an alert differs at, and names a limit that fires as soon as it is saved", () => {
        const set = settings({ missingBackup: { choice: "on", value: 24 }, storageLimit: { choice: "on", value: 25 * GB } });

        expect(changedDestinations(all, set).map((entry) => entry.id)).toEqual(["nas", "r2", "hetzner"]);
        expect(changedDestinations(all, settings({ missingBackup: { choice: "on", value: 24 } })).map((entry) => entry.id)).toEqual(["nas", "r2"]);
        expect(firesRightAway(nas, "storageLimit", alertOf(nas, "storageLimit"), afterOf(alertOf(nas, "storageLimit"), set.storageLimit))).toBe(true);
        expect(summaryText(all, set)).toBe("2 alerts change at all 3. The storage limit fires right away at NAS Backups");
        expect(summaryText(all, settings({ missingBackup: { choice: "on", value: 24 } }))).toBe("Missing backup changes at 2 of 3");
        expect(summaryText(all, settings({}))).toBe("Nothing changes yet");
    });

    it("sends only the alerts that were set, off without its value", () => {
        expect(changesOf(settings({ usageSpike: { choice: "off", value: 20 }, missingBackup: { choice: "on", value: 24 } }))).toEqual({
            usageSpike: { enabled: false },
            missingBackup: { enabled: true, hours: 24 },
        });
    });
});
