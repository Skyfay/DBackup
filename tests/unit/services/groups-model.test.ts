import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/system/data-retention-service", () => ({ getDataRetentionValues: vi.fn() }));

const { buildGroupsModel } = await import("@/services/user/groups-model");
const { groupEntryText } = await import("@/services/user/group-details");
type Build = Parameters<typeof buildGroupsModel>[0];

const at = (iso: string) => new Date(iso);
const member = (id: string, name: string) => ({ id, name, email: `${id}@example.ch`, image: null });

const GROUPS: Build["groups"] = [
    { id: "g-view", name: "Viewers", permissions: JSON.stringify(["jobs:read"]), fullAccess: false, createdAt: at("2026-03-12T09:00:00Z"), users: [member("jana", "Jana Keller")] },
    // The full access group stores no list, it holds every permission anyway.
    { id: "g-full", name: "Admin", permissions: "[]", fullAccess: true, createdAt: at("2026-01-01T09:00:00Z"), users: [member("manu", "Manu")] },
    {
        id: "g-ops",
        name: "Operators",
        permissions: JSON.stringify(["storage:read", "storage:delete"]),
        fullAccess: false,
        createdAt: at("2026-03-12T09:00:00Z"),
        users: [member("tom", "Tom Weber"), member("lena", "Lena Graf")],
    },
    { id: "g-empty", name: "Backup admins", permissions: JSON.stringify(["credentials:read", "credentials:reveal"]), fullAccess: false, createdAt: at("2026-09-29T09:00:00Z"), users: [] },
];

const PEOPLE: Build["people"] = [
    { id: "manu", name: "Manu", email: "manu@example.ch", groupId: "g-full", platformAdmin: true },
    { id: "lena", name: "Lena Graf", email: "lena@example.ch", groupId: "g-ops", platformAdmin: false },
    { id: "sara", name: "Sara Nguyen", email: "sara@example.ch", groupId: null, platformAdmin: false },
];

function build(overrides: Partial<Build> = {}) {
    return buildGroupsModel({
        groups: GROUPS,
        people: PEOPLE,
        audit: [
            { resourceId: "g-ops", action: "UPDATE", createdAt: at("2026-09-28T10:00:00Z"), user: { name: "Manu" } },
            { resourceId: "g-ops", action: "UPDATE", createdAt: at("2026-09-01T10:00:00Z"), user: { name: "Ada" } },
            { resourceId: "g-ops", action: "CREATE", createdAt: at("2026-03-12T09:00:00Z"), user: { name: "Manu" } },
        ],
        viewerId: "manu",
        viewerPlatformAdmin: true,
        withPeople: true,
        ...overrides,
    });
}

describe("the groups of the Groups tab", () => {
    it("lists the full access group first, then by name, with the members in order", () => {
        const model = build();

        expect(model.groups.map((group) => group.name)).toEqual(["Admin", "Backup admins", "Operators", "Viewers"]);
        expect(model.groups.map((group) => group.superAdmin)).toEqual([true, false, false, false]);
        expect(model.groups.find((group) => group.id === "g-ops")?.members.map((entry) => entry.name)).toEqual(["Lena Graf", "Tom Weber"]);
        expect(model.groups[0].members[0].isYou).toBe(true);
    });

    it("takes who made a group and who changed it last from the audit log", () => {
        const operators = build().groups.find((group) => group.id === "g-ops");

        expect(operators?.made).toEqual({ at: "2026-03-12T09:00:00.000Z", by: "Manu" });
        expect(operators?.changed).toEqual({ at: "2026-09-28T10:00:00.000Z", by: "Manu" });
    });

    it("names who changed a group by the name kept on the entry once that user is deleted", () => {
        const operators = build({
            audit: [{ resourceId: "g-ops", action: "UPDATE", createdAt: at("2026-09-28T10:00:00Z"), user: null, actorName: "Ada" }],
        }).groups.find((group) => group.id === "g-ops");

        expect(operators?.changed).toEqual({ at: "2026-09-28T10:00:00.000Z", by: "Ada" });
    });

    it("counts who may delete backups or reveal secrets, and the empty groups", () => {
        const { stats } = build();

        expect(stats.canDelete).toEqual(["Admin", "Operators"]);
        expect(stats.canReveal).toEqual(["Admin", "Backup admins"]);
        expect(stats.empty).toEqual(["Backup admins"]);
        expect(stats.inGroup).toBe(2);
        expect(stats.withoutGroup).toEqual(["Sara Nguyen"]);
    });

    it("marks the platform admins among the people by their account, not by their group", () => {
        const people = build({ people: [...PEOPLE, { id: "root", name: "Root", email: "root@example.ch", groupId: null, platformAdmin: true }] }).people;

        expect(people?.filter((person) => person.superAdmin).map((person) => person.id)).toEqual(["manu", "root"]);
    });

    it("names nobody outside the groups for a viewer who may not see the users", () => {
        const model = build({ withPeople: false });

        expect(model.people).toBeNull();
        expect(model.stats.withoutGroup).toEqual([]);
        expect(model.stats.people - model.stats.inGroup).toBe(1);
    });
});

describe("the history of a group in words", () => {
    it("says a group was made, from a template when it was", () => {
        expect(groupEntryText("CREATE", JSON.stringify({ name: "Ops", template: "operator" }))).toBe("made the group from the template Operator");
        expect(groupEntryText("CREATE", null)).toBe("made the group");
    });

    it("names the areas whose level changed and a new name", () => {
        const details = { name: "Ops", renamedFrom: "Operators", added: ["storage:download"], removed: [], areas: [{ area: "backups", from: "see", to: "use" }, { area: "jobs", from: "see", to: "use" }] };

        expect(groupEntryText("UPDATE", JSON.stringify(details))).toBe("renamed it from Operators and changed Backups See to Use and Jobs See to Use");
    });

    it("says less about an entry from before the changes were kept", () => {
        expect(groupEntryText("UPDATE", JSON.stringify({ name: "Ops", permissions: ["jobs:read"] }))).toBe("changed the permissions");
        expect(groupEntryText("UPDATE", JSON.stringify({ name: "Ops", added: [], removed: [], areas: [] }))).toBe("saved it without a change");
    });
});
