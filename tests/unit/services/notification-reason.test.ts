import { describe, it, expect } from "vitest";
import { eventReason, jobReason, userReason } from "@/services/notifications/notification-reason";
import { getEventDefinition } from "@/lib/notifications/events";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";

describe("why a mail comes", () => {
    it("names the event and where it is switched", () => {
        const definition = getEventDefinition(NOTIFICATION_EVENTS.RESTORE_FAILURE);

        expect(eventReason(definition, undefined, false)).toBe('You get this because "A restore failed" is on under Settings, Notifications.');
    });

    it("says how often an event with reminders comes back", () => {
        const offline = getEventDefinition(NOTIFICATION_EVENTS.CONNECTION_OFFLINE);
        const update = getEventDefinition(NOTIFICATION_EVENTS.UPDATE_AVAILABLE);

        expect(eventReason(offline, 24, false)).toContain("a reminder follows every day.");
        expect(eventReason(update, 168, false)).toContain("a reminder follows every 7 days.");
        expect(eventReason(offline, 6, false)).toContain("a reminder follows every 6 hours.");
        expect(eventReason(offline, 0, false)).not.toContain("reminder");
    });

    it("calls a test a test", () => {
        const definition = getEventDefinition(NOTIFICATION_EVENTS.CONFIG_BACKUP);

        expect(eventReason(definition, undefined, true)).toBe('This is a test of "The configuration was backed up" from Settings, Notifications.');
    });

    it("tells the person a sign-in is about why they get it", () => {
        expect(userReason(NOTIFICATION_EVENTS.USER_LOGIN, "Production")).toBe("You get this as a user of DBackup · Production, since an admin turned on mails about sign-ins.");
        expect(userReason(NOTIFICATION_EVENTS.USER_CREATED, null)).toBe("You get this as a user of DBackup, since an admin turned on mails about new accounts.");
    });

    it("says when a job tells a channel", () => {
        expect(jobReason("Ops mail", "shop", new Set(["SUCCESS", "PARTIAL", "FAILED"]))).toBe("You get this through Ops mail, which shop tells after every run. Change it in the job under Notifications.");
        expect(jobReason("Ops mail", "shop", new Set(["PARTIAL", "FAILED"]))).toContain("which shop tells when a run fails or is partial.");
        expect(jobReason("Ops mail", "shop", new Set(["SUCCESS"]))).toContain("which shop tells when a run succeeds.");
    });
});
