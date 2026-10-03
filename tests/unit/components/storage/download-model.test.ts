import { describe, expect, it } from "vitest";
import {
    commandFor,
    commandMark,
    headState,
    outputOf,
    pickNote,
    pickTitle,
    requestOf,
    shown,
    toggleShown,
    type DownloadItem,
} from "@/components/dashboard/storage/download/download-model";

const MB = 1024 ** 2;
const item = (name: string, size: number | null = MB): DownloadItem => ({ id: name, name, detail: "", size });
const DBS = ["shop", "billing", "analytics"].map((name) => item(name));
const FOLDERS = [item("uploads", 5 * MB), item("media", 20 * MB)];
const TOTAL = { databases: 3, folders: 2 };
const bytes = (value: number) => `${Math.round(value / MB)} MB`;

describe("what a pick comes out as", () => {
    it("downloads one database as its dump and anything more as one tar.gz", () => {
        expect(outputOf([DBS[0]], [])).toBe("dump");
        expect(outputOf([DBS[0], DBS[1]], [])).toBe("tar");
        expect(outputOf([], [FOLDERS[0]])).toBe("tar");
        expect(outputOf([], [])).toBeNull();
    });

    it("names every picked database and folder in the request, so a link never means more", () => {
        expect(requestOf([DBS[1]], [FOLDERS[0]])).toEqual({ databases: ["billing"], selections: [{ src: "uploads" }] });
        expect(requestOf([], [FOLDERS[1]])).toEqual({ selections: [{ src: "media" }] });
    });
});

describe("the words of the pick", () => {
    it("spells out a few names, names a whole group and counts many", () => {
        expect(pickTitle([DBS[0], DBS[2]], [FOLDERS[1]], TOTAL)).toBe("shop, analytics and media");
        expect(pickTitle(DBS, [], TOTAL)).toBe("All 3 databases");
        expect(pickTitle([], FOLDERS, TOTAL)).toBe("All 2 folders");
        expect(pickTitle(DBS, FOLDERS, TOTAL)).toBe("Everything in the backup");
        expect(pickTitle([DBS[0], DBS[1]], FOLDERS, { databases: 9, folders: 2 })).toBe("2 databases and 2 folders");
        expect(pickTitle([], [], TOTAL)).toBe("Nothing is picked yet");
    });

    it("says how many, how big and in what form", () => {
        expect(pickNote([DBS[1]], [], bytes)).toBe("1 picked · 1 MB · its dump, decrypted and unpacked");
        expect(pickNote([DBS[1]], [FOLDERS[1]], bytes)).toBe("2 picked · 21 MB · one tar.gz, decrypted and unpacked");
        expect(pickNote([item("legacy", null)], [FOLDERS[0]], bytes)).toBe("2 picked · one tar.gz, decrypted and unpacked");
    });
});

describe("a group with a search", () => {
    const tenants = Array.from({ length: 12 }, (_, index) => item(`tenant_${index + 1}`));

    it("ticks and unticks what the search shows and leaves the rest as it was", () => {
        const visible = shown(tenants, "tenant_1");
        expect(visible.map((entry) => entry.name)).toEqual(["tenant_1", "tenant_10", "tenant_11", "tenant_12"]);

        const picked = toggleShown(visible, new Set(["tenant_5"]), true);
        expect([...picked].sort()).toEqual(["tenant_1", "tenant_10", "tenant_11", "tenant_12", "tenant_5"]);
        expect(headState(visible, picked)).toBe(true);
        expect(headState(tenants, picked)).toBe("indeterminate");
        expect([...toggleShown(visible, picked, false)]).toEqual(["tenant_5"]);
    });
});

describe("the command for another host", () => {
    const url = "https://dbackup.test/api/storage/public-download?token=abc";

    it("keeps the name DBackup sends with curl and wget, and stops curl on a spent link", () => {
        expect(commandFor("curl", url, "x")).toBe(`curl -fOJ "${url}"`);
        expect(commandFor("wget", url, "x")).toBe(`wget --content-disposition "${url}"`);
    });

    it("tells PowerShell the file name, quoted for it", () => {
        expect(commandFor("powershell", url, "Shop's dump.sql")).toBe(`Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile 'Shop''s dump.sql'`);
    });

    it("marks the link amber until it works, and green while it does", () => {
        expect(commandFor("curl", null, "x")).toBe('curl -fOJ "<make the link first>"');
        expect(commandMark(null, false)).toEqual({ text: "<make the link first>", tone: "warning" });
        expect(commandMark(url, true)).toEqual({ text: url, tone: "success" });
        expect(commandMark(url, false)).toEqual({ text: url, tone: "warning" });
    });
});
