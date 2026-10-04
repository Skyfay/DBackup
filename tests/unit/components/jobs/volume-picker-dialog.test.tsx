import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VolumePickerDialog } from "@/components/dashboard/jobs/volume-picker-dialog";

const ANONYMOUS = "3d962f26bbf9fc06a0f7aa935cbb084626c2aaf77252a0b553cddcda30581990";
const user = (container: string, mount: string, image: string, running = true) => ({ container, running, image, mount });
const VOLUMES = [
    { name: "immich_pgdata", anonymous: false, stack: "immich", createdAt: null, users: [user("immich_postgres", "/var/lib/postgresql/data", "postgres:14")] },
    { name: "nextcloud_db", anonymous: false, stack: "nextcloud", createdAt: null, users: [user("nextcloud-db-1", "/var/lib/mysql", "mariadb:11.4")] },
    {
        name: "nextcloud_html", anonymous: false, stack: "nextcloud", createdAt: null,
        users: [user("nextcloud-app-1", "/var/www/html", "nextcloud:29"), user("nextcloud-cron-1", "/var/www/html", "nextcloud:29")],
    },
    { name: ANONYMOUS, anonymous: true, stack: null, createdAt: null, users: [user("grafana", "/var/lib/grafana", "grafana/grafana:11.2")] },
    { name: "old_postgres_data", anonymous: false, stack: null, createdAt: "2023-09-26T10:00:00.000Z", users: [] },
];

function serve() {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
        if (url === "/api/adapters/docker-1/volumes") return json({ success: true, data: { volumes: VOLUMES } });
        if (url === "/api/adapters/docker-1/volumes/sizes") return json({ success: true, data: { sizes: { immich_pgdata: 1_800_000_000, nextcloud_html: 1_200_000_000 } } });
        throw new Error(`Unexpected request ${url}`);
    }));
}

const IN_JOB = { path: "immich_pgdata", excludePatterns: [], excludePatternPresetIds: [], stopContainers: true };
const props = { open: true, onOpenChange: vi.fn(), configId: "docker-1", connectionName: "Homelab Docker", initialRows: [IN_JOB], onConfirm: vi.fn() };
const box = (name: RegExp) => screen.getByRole("checkbox", { name });
const plan = () => within(screen.getByRole("complementary", { name: "What the job reads" }));

describe("Volume picker of the job form", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        serve();
    });

    it("lists the volumes by stack with who mounts them, the ones in the job ticked and the ones no container mounts on request", async () => {
        const user = userEvent.setup();
        render(<VolumePickerDialog {...props} />);

        const immich = await screen.findByRole("region", { name: "immich" });
        expect(within(immich).getByText("Compose · 1 volume · 1 container running")).toBeInTheDocument();
        expect(box(/^immich_pgdata/)).toBeChecked();
        expect(within(screen.getByRole("region", { name: "Anonymous" })).getByText("grafana")).toBeInTheDocument();
        expect(plan().getByText("Stops immich_postgres")).toBeInTheDocument();

        expect(screen.queryByRole("region", { name: "Not in use" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Show 1 not in use" }));
        expect(within(screen.getByRole("region", { name: "Not in use" })).getByText("old_postgres_data")).toBeInTheDocument();
    });

    it("shows what the job stops for a new volume, and hands it back with the setting of the switch", async () => {
        const user = userEvent.setup();
        render(<VolumePickerDialog {...props} />);

        await user.click(await screen.findByRole("checkbox", { name: /^nextcloud_html/ }));
        expect(screen.getByText("2 picked, 1 new")).toBeInTheDocument();
        expect(plan().getByText("Stops nextcloud-app-1 and nextcloud-cron-1")).toBeInTheDocument();

        await user.click(screen.getByRole("switch", { name: "Stop containers while reading" }));
        expect(plan().getByText("Read while in use, nothing stops")).toBeInTheDocument();
        // The volume already in the job keeps its own setting.
        expect(plan().getByText("Stops immich_postgres")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Use 2 volumes" }));
        expect(props.onConfirm).toHaveBeenCalledWith([IN_JOB, { path: "nextcloud_html", excludePatterns: [], stopContainers: false }]);
    });

    it("finds volumes by container and path, the ones not in use too", async () => {
        const user = userEvent.setup();
        render(<VolumePickerDialog {...props} />);
        await screen.findByRole("region", { name: "immich" });

        await user.type(screen.getByRole("textbox", { name: "Filter by volume, container, image or path" }), "postgres");

        expect(screen.getByText("2 of 5 match")).toBeInTheDocument();
        expect(box(/^immich_pgdata/)).toBeInTheDocument();
        expect(box(/^old_postgres_data/)).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "nextcloud" })).not.toBeInTheDocument();
    });

    it("keeps a volume of the job the host no longer has on top, to take it out", async () => {
        const user = userEvent.setup();
        const gone = { path: "gone_volume", excludePatterns: [], stopContainers: true };
        render(<VolumePickerDialog {...props} initialRows={[IN_JOB, gone]} />);

        const missing = await screen.findByRole("region", { name: "No longer on this host" });
        await user.click(within(missing).getByRole("checkbox", { name: /^gone_volume/ }));
        await user.click(screen.getByRole("button", { name: "Use this volume" }));

        expect(props.onConfirm).toHaveBeenCalledWith([IN_JOB]);
    });
});
