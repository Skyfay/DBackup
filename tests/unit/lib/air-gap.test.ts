import { describe, expect, it } from "vitest";
import { isAirGapped, isNotConnected } from "@/lib/core/air-gap";

const usb = { type: "storage", storageRole: "DESTINATION", metadata: JSON.stringify({ airGapped: true }) };

describe("an air-gapped destination", () => {
    it("is a destination whose metadata says so, read from its JSON or already read", () => {
        expect(isAirGapped(usb)).toBe(true);
        expect(isAirGapped({ ...usb, metadata: { airGapped: true } })).toBe(true);
        expect(isAirGapped({ ...usb, metadata: JSON.stringify({ healthNotificationsDisabled: true }) })).toBe(false);
        expect(isAirGapped({ ...usb, metadata: null })).toBe(false);
    });

    it("is never a directory source or a database, even when the switch stayed from an earlier role", () => {
        expect(isAirGapped({ ...usb, storageRole: "SOURCE" })).toBe(false);
        expect(isAirGapped({ ...usb, type: "database" })).toBe(false);
    });

    it("reads broken metadata as not air-gapped", () => {
        expect(isAirGapped({ ...usb, metadata: "{not json" })).toBe(false);
    });

    it("is not connected whenever its last check did not pass, which is no problem", () => {
        expect(isNotConnected({ ...usb, lastStatus: "OFFLINE" })).toBe(true);
        expect(isNotConnected({ ...usb, lastStatus: "DEGRADED" })).toBe(true);
        expect(isNotConnected({ ...usb, lastStatus: "ONLINE" })).toBe(false);
        expect(isNotConnected({ ...usb, metadata: null, lastStatus: "OFFLINE" })).toBe(false);
    });
});
