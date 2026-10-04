import { commented, guideParts, type GuideCode, type GuideStep, type RedisGuideInput } from "./redis-guide-common";

/** A value as one word of a command, quoted only when the shell would read it otherwise. */
function word(value: string): string {
    return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A value in double quotes for a variable of the script. */
function quoted(value: string): string {
    return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** Asks for the password without showing it. printf carries the prompt, so bash and zsh both take it. */
function askPassword(engine: string): string {
    return `printf "Password of ${engine}: " && read -rs REDISCLI_AUTH && echo && export REDISCLI_AUTH`;
}

/** The pieces the script and the steps share, for a container, a compose service or a Linux service. */
function shell(input: RedisGuideInput) {
    const p = guideParts(input);
    const auth = input.password ? " -e REDISCLI_AUTH" : "";
    const cliOf = (who: string) =>
        input.host === "docker" ? `docker exec${auth} ${who} ${p.lower}-cli`
            : input.host === "compose" ? `docker compose exec -T${auth} ${who} ${p.lower}-cli`
                : `${p.lower}-cli`;
    const name = p.target ? word(p.target) : p.missingTarget;
    return { p, cliOf, name, dir: p.dataDir ? word(p.dataDir) : p.missingDir, docker: input.host === "compose" ? "docker compose" : "docker" };
}

/** The whole restore as one Bash script, which stops before it changes anything Redis would not read. */
export function bashScript(input: RedisGuideInput): GuideCode {
    const { p, cliOf, docker } = shell(input);
    const engine = input.engine;
    const variable = input.host === "docker" ? "CONTAINER" : "SERVICE";
    const into = { docker: "the Docker container", compose: "the compose service", service: "the service", windows: "" }[input.host];
    const where = {
        docker: "on the Docker host",
        compose: "in the folder of the compose file",
        service: `on the ${engine} host with sudo rights`,
        windows: "",
    }[input.host];
    const swap = input.host === "service"
        ? [
            `sudo systemctl stop "$SERVICE"`,
            `sudo cp -p "$DATA/dump.rdb" "$DATA/dump.rdb.before-restore" || echo "${engine} had no dump yet."`,
            `sudo install -o ${p.lower} -g ${p.lower} -m 640 dump.rdb "$DATA/dump.rdb"`,
            `sudo systemctl start "$SERVICE"`,
        ]
        : [
            `${docker} stop -t 60 "$${variable}"`,
            `${docker} cp "$${variable}:$DATA/dump.rdb" dump.rdb.before-restore || echo "${engine} had no dump yet."`,
            `${docker} cp dump.rdb "$${variable}:$DATA/dump.rdb"`,
            `${docker} start "$${variable}"`,
        ];

    const body = [
        "set -euo pipefail",
        "",
        `${variable}=${p.variable(p.target, p.missingTarget, quoted)}`,
        `DATA=${p.variable(p.dataDir, p.missingDir, quoted)}`,
        ...(input.password ? [askPassword(engine)] : []),
        ...(input.host === "service" ? [`# Add -p or -s to ${p.lower}-cli when ${engine} does not listen on 127.0.0.1:6379.`] : []),
        `cli() { ${cliOf(`"$${variable}"`)} "$@"; }`,
        `setting() { cli CONFIG GET "$1" | tail -n 1; }`,
        `up() { [ "$(cli PING 2>/dev/null)" = "PONG" ]; }`,
        `fail() { echo "$1" >&2; exit 1; }`,
        "",
        `up || fail "${engine} does not answer. Check that it runs${input.password ? " and the password" : ""}."`,
        `[ "$(setting appendonly)" = "no" ] || fail "${engine} writes an append only file and would not read the dump. See If ${engine} writes an append only file in DBackup."`,
        `[ "$(setting dir)" = "$DATA" ] || fail "${engine} keeps its data in $(setting dir), not in $DATA."`,
        `[ "$(setting dbfilename)" = "dump.rdb" ] || fail "${engine} reads $(setting dbfilename), not dump.rdb."`,
        "",
        `curl -fo dump.rdb "${p.url}"`,
        ...swap,
        "",
        "for _ in $(seq 1 120); do up && break; sleep 1; done",
        `up || fail "${engine} did not answer within two minutes of its start. Look at its log."`,
        "cli INFO keyspace",
    ];
    // The body runs in a subshell of a function, so a pasted script is read in full before its
    // prompt waits for the password, and a failed check never closes the shell it was pasted into.
    const lines = [
        "#!/usr/bin/env bash",
        `# Restores ${input.backup} into ${into} ${p.target || p.missingTarget}.`,
        `# Run it ${where}, saved as a file or pasted. It keeps the old dump ${input.host === "service" ? "beside the new one" : "in this folder"} as dump.rdb.before-restore.`,
        "restore() (",
        ...body.map((line) => (line ? `    ${line}` : "")),
        ")",
        "restore",
    ];
    return { code: lines.join("\n"), marks: p.marks };
}

/** The same restore one step at a time, every value filled in. */
export function bashSteps(input: RedisGuideInput): GuideStep[] {
    const { p, cliOf, name, dir, docker } = shell(input);
    const engine = input.engine;
    const cli = cliOf(name);
    const inContainer = input.host !== "service";
    const steps: GuideStep[] = [
        { title: "Download the dump", text: "Saves it as dump.rdb in the folder you are in. The link works once.", blocks: [p.code(`curl -fo dump.rdb "${p.url}"`)] },
    ];
    if (input.password) {
        steps.push({ title: "Enter the password", text: "The commands below read it from REDISCLI_AUTH, so it is in no command and no shell history.", blocks: [p.code(askPassword(engine))] });
    }
    steps.push(
        {
            title: `Check that ${engine} reads the dump`,
            text: `It has to answer no, ${p.dataDir || "its data folder"} and dump.rdb. Otherwise it starts without the dump.`,
            blocks: [p.code(commented([
                [`${cli} CONFIG GET appendonly`, "no"],
                [`${cli} CONFIG GET dir`, p.dataDir || p.missingDir],
                [`${cli} CONFIG GET dbfilename`, "dump.rdb"],
            ]))],
        },
        {
            title: `Stop ${engine}`,
            text: inContainer ? "It saves once more while it stops, and stays off even with a restart policy." : "It saves once more while it stops.",
            blocks: [p.code(inContainer ? `${docker} stop -t 60 ${name}` : `sudo systemctl stop ${name}`)],
        },
        {
            title: "Put the dump in place",
            text: inContainer ? "The old dump stays in the folder you are in as dump.rdb.before-restore." : "The old dump stays beside the new one as dump.rdb.before-restore.",
            blocks: [p.code(inContainer
                ? `${docker} cp ${name}:${dir}/dump.rdb dump.rdb.before-restore\n${docker} cp dump.rdb ${name}:${dir}/dump.rdb`
                : `sudo cp -p ${dir}/dump.rdb ${dir}/dump.rdb.before-restore\nsudo install -o ${p.lower} -g ${p.lower} -m 640 dump.rdb ${dir}/dump.rdb`)],
        },
        {
            title: `Start ${engine}`,
            text: "It loads the dump while it starts, which takes a moment for a big one.",
            blocks: [p.code(inContainer ? `${docker} start ${name}` : `sudo systemctl start ${name}`)],
        },
        { title: "Check the keys", text: `Lists the keys of every database ${engine} loaded.`, blocks: [p.code(`${cli} INFO keyspace`)] },
    );
    return steps;
}

/** A copy of the append only file, and the command that writes a new one from the restored data. */
export function bashAof(input: RedisGuideInput): { keep: GuideCode; turnOn: GuideCode[] } {
    const { p, cliOf, name, dir, docker } = shell(input);
    const keep = input.host === "service"
        ? `sudo cp -rp ${dir}/appendonlydir ${dir}/appendonlydir.before-restore`
        : `${docker} cp ${name}:${dir}/appendonlydir appendonlydir.before-restore`;
    return {
        keep: p.code(keep),
        turnOn: [...(input.password ? [p.code(askPassword(input.engine))] : []), p.code(`${cliOf(name)} CONFIG SET appendonly yes`)],
    };
}
