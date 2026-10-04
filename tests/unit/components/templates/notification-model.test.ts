import { describe, expect, it } from "vitest";
import { listenersOf, parseOutcomes, repeatsOf, runsPhrase, summaryOf, type NotificationTemplateItem } from "@/components/templates/notification-model";

const ADMINS = { id: "admins", name: "Admins", adapterId: "email" };
const OPS = { id: "ops", name: "#ops-alerts", adapterId: "slack" };
const SMS = { id: "sms", name: "On-call phone", adapterId: "twilio-sms" };

function template(id: string, name: string, channels: [typeof ADMINS, string][]): NotificationTemplateItem {
    return {
        id,
        name,
        description: null,
        isDefault: false,
        isSystem: false,
        channels: channels.map(([config, events], index) => ({ id: `${id}-${index}`, configId: config.id, events, config })),
    };
}

const MAIL = template("mail", "Mail Success", [[ADMINS, "SUCCESS"]]);
const ALERTS = template("ops", "Ops alerts", [[OPS, "PARTIAL|FAILED"], [SMS, "FAILED"]]);
const TEAM = template("team", "Team chat", [[OPS, "FAILED"]]);

describe("who hears about a run of a job", () => {
    it("lists every channel of every template with the messages each run sends it", () => {
        const listeners = listenersOf([MAIL, ALERTS], [], []);

        expect(listeners.map((listener) => [listener.name, listener.via, listener.messages])).toEqual([
            ["Admins", ["Mail Success"], { SUCCESS: 1, PARTIAL: 0, FAILED: 0 }],
            ["#ops-alerts", ["Ops alerts"], { SUCCESS: 0, PARTIAL: 1, FAILED: 1 }],
            ["On-call phone", ["Ops alerts"], { SUCCESS: 0, PARTIAL: 0, FAILED: 1 }],
        ]);
    });

    it("counts a channel in two templates twice, since the runner sends it both", () => {
        const [ops] = listenersOf([ALERTS, TEAM], [], []);

        expect(ops.via).toEqual(["Ops alerts", "Team chat"]);
        expect(ops.messages).toEqual({ SUCCESS: 0, PARTIAL: 1, FAILED: 2 });
        expect(repeatsOf([ops])).toEqual([{ configId: "ops", text: "#ops-alerts is in Ops alerts and Team chat, so it gets two messages after a failed run." }]);
    });

    it("tells the channels the job names directly only while it has no template", () => {
        expect(listenersOf([], [ADMINS], ["PARTIAL", "FAILED"])).toEqual([
            { configId: "admins", name: "Admins", adapterId: "email", via: [], messages: { SUCCESS: 0, PARTIAL: 1, FAILED: 1 } },
        ]);
        expect(listenersOf([MAIL], [OPS], ["FAILED"]).map((listener) => listener.name)).toEqual(["Admins"]);
    });

    it("sums a run up by the failed one, and warns when nobody hears about that", () => {
        expect(summaryOf(listenersOf([MAIL, ALERTS], [], []))).toEqual({ text: "After a failed run 2 channels hear about it, after a successful one 1.", silentFailure: false });
        expect(summaryOf(listenersOf([TEAM], [], []))).toEqual({ text: "After a failed run 1 channel hears about it, after a successful one nobody.", silentFailure: false });
        expect(summaryOf(listenersOf([MAIL], [], []))).toEqual({ text: "Nobody hears about a failed run.", silentFailure: true });
    });
});

describe("runs of a notification", () => {
    it("reads the runs of a channel in their usual order and leaves out what it does not know", () => {
        expect(parseOutcomes("FAILED|SUCCESS|ALWAYS")).toEqual(["SUCCESS", "FAILED"]);
    });

    it("puts runs into words", () => {
        expect(runsPhrase(["SUCCESS", "PARTIAL", "FAILED"])).toBe("every run");
        expect(runsPhrase(["PARTIAL", "FAILED"])).toBe("partial and failed runs");
        expect(runsPhrase(["SUCCESS"])).toBe("a successful run");
    });
});
