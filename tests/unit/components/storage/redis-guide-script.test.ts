import { describe, expect, it } from "vitest";
import { hostPlace, redisAofCommands, redisScript, redisSteps, runHint, scriptFileName, type RedisGuideInput } from "@/components/dashboard/storage/restore/redis-guide-script";

const URL = "https://dbackup.test/api/storage/public-download?token=abc";
const input = (overrides: Partial<RedisGuideInput> = {}): RedisGuideInput => ({
    engine: "Redis",
    host: "docker",
    target: "cache-redis",
    dataDir: "/data",
    password: true,
    url: URL,
    backup: "Cache nightly of 24 Sep 2026, 02:00",
    ...overrides,
});
const WINDOWS = { host: "windows", target: "Redis", dataDir: "C:\\Program Files\\Redis" } as const;
const codeOf = (steps: ReturnType<typeof redisSteps>) => steps.flatMap((step) => step.blocks.map((block) => block.code)).join("\n");

describe("the restore script for Linux and Docker", () => {
    it("writes the script for a container with the values it was given, marked as filled in", () => {
        const { code, marks } = redisScript(input());

        expect(code).toContain('CONTAINER="cache-redis"');
        expect(code).toContain('DATA="/data"');
        expect(code).toContain(`curl -fo dump.rdb "${URL}"`);
        expect(code).toContain('docker stop -t 60 "$CONTAINER"');
        expect(marks).toEqual(expect.arrayContaining([
            { text: URL, tone: "success" },
            { text: '"cache-redis"', tone: "success" },
            { text: '"/data"', tone: "success" },
        ]));
    });

    it("checks everything that would make Redis start without the dump before it downloads or stops anything", () => {
        const lines = redisScript(input()).code.split("\n");
        const at = (text: string) => lines.findIndex((line) => line.includes(text));

        const checks = [at("setting appendonly"), at("setting dir"), at("setting dbfilename")];
        expect(checks.every((index) => index > 0)).toBe(true);
        expect(Math.max(...checks)).toBeLessThan(at("curl -fo"));
        expect(at("curl -fo")).toBeLessThan(at("docker stop"));
    });

    it("runs in a subshell of a function, so a pasted script is read in full and a failed check keeps the shell open", () => {
        const lines = redisScript(input()).code.split("\n");

        expect(lines).toContain("restore() (");
        expect(lines.slice(-2)).toEqual([")", "restore"]);
    });

    it("asks for the password in a way bash and zsh both take, and never puts it into a command", () => {
        const withPassword = redisScript(input()).code;
        expect(withPassword).toContain('printf "Password of Redis: " && read -rs REDISCLI_AUTH && echo && export REDISCLI_AUTH');
        expect(withPassword).toContain('docker exec -e REDISCLI_AUTH "$CONTAINER" redis-cli');
        expect(withPassword).not.toContain(" -a ");

        const without = redisScript(input({ password: false })).code;
        expect(without).not.toContain("REDISCLI_AUTH");
        expect(without).toContain('docker exec "$CONTAINER" redis-cli');
    });

    it("marks a link that is missing or ran out amber", () => {
        const missing = redisScript(input({ url: null }));
        expect(missing.code).toContain('curl -fo dump.rdb "<make the link in DBackup first>"');
        expect(missing.marks).toContainEqual({ text: "<make the link in DBackup first>", tone: "warning" });

        expect(redisScript(input({ urlExpired: true })).marks).toContainEqual({ text: URL, tone: "warning" });
    });

    it("stops a Linux service with systemctl and hands the dump to the user Redis runs as", () => {
        const { code } = redisScript(input({ host: "service", target: "redis-server", dataDir: "/var/lib/redis/" }));

        expect(code).toContain('DATA="/var/lib/redis"');
        expect(code).toContain('sudo systemctl stop "$SERVICE"');
        expect(code).toContain('sudo install -o redis -g redis -m 640 dump.rdb "$DATA/dump.rdb"');
        expect(code).toContain('cli() { redis-cli "$@"; }');
    });

    it("reaches a compose service through docker compose", () => {
        const { code } = redisScript(input({ host: "compose", target: "redis" }));

        expect(code).toContain('cli() { docker compose exec -T -e REDISCLI_AUTH "$SERVICE" redis-cli "$@"; }');
        expect(code).toContain('docker compose cp dump.rdb "$SERVICE:$DATA/dump.rdb"');
        expect(code).toContain('docker compose start "$SERVICE"');
    });

    it("uses valkey-cli and the valkey user for Valkey", () => {
        const { code } = redisScript(input({ engine: "Valkey", host: "service", target: "valkey-server", dataDir: "/var/lib/valkey" }));

        expect(code).toContain("valkey-cli");
        expect(code).not.toContain("redis-cli");
        expect(code).toContain("sudo install -o valkey -g valkey");
        expect(hostPlace("service", "Valkey")).toBe("on the Valkey host");
    });

    it("marks a field left empty amber instead of writing an empty value", () => {
        const { code, marks } = redisScript(input({ target: " " }));

        expect(code).toContain('CONTAINER="<container>"');
        expect(marks).toContainEqual({ text: "<container>", tone: "warning" });
    });

    it("names the script after the job, as a PowerShell file on Windows", () => {
        expect(scriptFileName("Cache nightly", "docker")).toBe("restore-cache-nightly.sh");
        expect(scriptFileName("Cache nightly", "windows")).toBe("restore-cache-nightly.ps1");
        expect(scriptFileName("", "service")).toBe("restore-redis.sh");
    });
});

describe("the restore script for Windows", () => {
    it("writes a PowerShell script for the Windows service, with its values as literals", () => {
        const { code, marks } = redisScript(input(WINDOWS));

        expect(code).toContain("$Service = 'Redis'");
        expect(code).toContain("$Data = 'C:\\Program Files\\Redis'");
        expect(code).toContain(`Invoke-WebRequest -UseBasicParsing -Uri '${URL}' -OutFile $Dump -ErrorAction Stop`);
        expect(code).toContain("Stop-Service -Name $Service -ErrorAction Stop");
        expect(code).toContain("Start-Service -Name $Service -ErrorAction Stop");
        expect(marks).toEqual(expect.arrayContaining([
            { text: "'Redis'", tone: "success" },
            { text: "'C:\\Program Files\\Redis'", tone: "success" },
        ]));
    });

    it("checks before it downloads, in one block that keeps the window open, and forgets the password afterwards", () => {
        const lines = redisScript(input(WINDOWS)).code.split("\n");
        const at = (text: string) => lines.findIndex((line) => line.includes(text));

        expect(lines).toContain("& {");
        expect(at("Get-Setting appendonly")).toBeLessThan(at("Invoke-WebRequest"));
        expect(at("Invoke-WebRequest")).toBeLessThan(at("Stop-Service"));
        expect(at("Remove-Item Env:REDISCLI_AUTH")).toBeGreaterThan(at("} finally {"));
        expect(lines.some((line) => /\bexit\b/.test(line))).toBe(false);
    });

    it("names its functions so that no alias of PowerShell hides them", () => {
        const { code } = redisScript(input(WINDOWS));

        // cli is the alias of Clear-Item and wins over a function named Cli.
        expect(code).not.toMatch(/function (Cli|Setting|Up)\b/);
        expect(code).toContain("function Invoke-Cli { & $Cli @args 2>$null }");
    });

    it("drops a backslash at the end of the data folder but keeps a drive alone", () => {
        expect(redisScript(input({ ...WINDOWS, dataDir: "C:\\Program Files\\Redis\\" })).code).toContain("$Data = 'C:\\Program Files\\Redis'");
        expect(redisScript(input({ ...WINDOWS, dataDir: "D:\\" })).code).toContain("$Data = 'D:\\'");
    });

    it("tells how to run a saved script past the execution policy", () => {
        expect(runHint(input(WINDOWS), "restore-cache-nightly.ps1")).toContain("powershell -ExecutionPolicy Bypass -File restore-cache-nightly.ps1");
        expect(runHint(input(), "restore-cache-nightly.sh")).toContain("bash restore-cache-nightly.sh");
    });
});

describe("the manual steps", () => {
    it("fills every value into every command, the link included", () => {
        const steps = redisSteps(input());

        expect(steps.map((step) => step.title)).toEqual([
            "Download the dump", "Enter the password", "Check that Redis reads the dump", "Stop Redis", "Put the dump in place", "Start Redis", "Check the keys",
        ]);
        expect(steps[0].blocks).toEqual([{ code: `curl -fo dump.rdb "${URL}"`, marks: [{ text: URL, tone: "success" }] }]);
        expect(steps[4].blocks[0].code).toBe("docker cp cache-redis:/data/dump.rdb dump.rdb.before-restore\ndocker cp dump.rdb cache-redis:/data/dump.rdb");
        expect(codeOf(steps)).not.toMatch(/\$(CONTAINER|SERVICE|DATA)\b/);
    });

    it("keeps the password prompt in a block of its own, so pasting a block never feeds it the next line", () => {
        const steps = redisSteps(input());
        const prompt = steps.flatMap((step) => step.blocks).filter((block) => block.code.includes("read -rs"));

        expect(prompt).toHaveLength(1);
        expect(prompt[0].code.split("\n")).toHaveLength(1);
        expect(redisSteps(input({ password: false })).map((step) => step.title)).not.toContain("Enter the password");
    });

    it("says what each check has to answer", () => {
        const check = redisSteps(input({ host: "service", target: "redis-server", dataDir: "/var/lib/redis", password: false }))[1].blocks[0].code;

        expect(check).toMatch(/redis-cli CONFIG GET appendonly\s+# no/);
        expect(check).toMatch(/redis-cli CONFIG GET dir\s+# \/var\/lib\/redis/);
    });

    it("quotes a folder the shell would split", () => {
        const put = redisSteps(input({ host: "service", target: "redis-server", dataDir: "/srv/redis data", password: false }))[3].blocks[0].code;

        expect(put).toContain("sudo install -o redis -g redis -m 640 dump.rdb '/srv/redis data'/dump.rdb");
    });

    it("writes the steps for Windows in PowerShell, quoting a path with a space", () => {
        const steps = redisSteps(input(WINDOWS));
        const code = codeOf(steps);

        expect(code).toContain(`Invoke-WebRequest -UseBasicParsing -Uri '${URL}' -OutFile dump.rdb`);
        expect(code).toContain("Stop-Service Redis");
        expect(code).toContain("Copy-Item dump.rdb 'C:\\Program Files\\Redis\\dump.rdb' -Force");
        expect(code).toMatch(/redis-cli CONFIG GET dir\s+# C:\\Program Files\\Redis/);
    });
});

describe("a Redis with an append only file", () => {
    it("keeps a copy of the file and turns it back on for where Redis runs", () => {
        const docker = redisAofCommands(input());
        expect(docker.keep.code).toBe("docker cp cache-redis:/data/appendonlydir appendonlydir.before-restore");
        expect(docker.turnOn.map((block) => block.code)).toEqual([
            'printf "Password of Redis: " && read -rs REDISCLI_AUTH && echo && export REDISCLI_AUTH',
            "docker exec -e REDISCLI_AUTH cache-redis redis-cli CONFIG SET appendonly yes",
        ]);

        const service = redisAofCommands(input({ host: "service", target: "redis-server", dataDir: "/var/lib/redis", password: false }));
        expect(service.keep.code).toBe("sudo cp -rp /var/lib/redis/appendonlydir /var/lib/redis/appendonlydir.before-restore");
        expect(service.turnOn.map((block) => block.code)).toEqual(["redis-cli CONFIG SET appendonly yes"]);
    });

    it("copies either form of the file on Windows", () => {
        const { keep } = redisAofCommands(input({ ...WINDOWS, password: false }));

        expect(keep.code).toContain("Copy-Item 'C:\\Program Files\\Redis\\appendonly*' 'C:\\Program Files\\Redis\\aof.before-restore' -Recurse");
    });
});
