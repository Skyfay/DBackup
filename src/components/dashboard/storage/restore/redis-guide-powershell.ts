import { commented, guideParts, type GuideCode, type GuideStep, type RedisGuideInput } from "./redis-guide-common";

/** A value in single quotes, which PowerShell takes as it is. */
function literal(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/** A value as one word of a command, quoted only when PowerShell would read it otherwise. */
function word(value: string): string {
    return /^[A-Za-z0-9_.:\\/-]+$/.test(value) ? value : literal(value);
}

/** Asks for the password without showing it and hands it to the CLI as REDISCLI_AUTH. */
function askPassword(engine: string): string {
    return `$env:REDISCLI_AUTH = [Net.NetworkCredential]::new('', (Read-Host 'Password of ${engine}' -AsSecureString)).Password`;
}

/** The pieces the script and the steps share for a Windows service. */
function windows(input: RedisGuideInput) {
    const p = guideParts(input);
    const inData = (file: string) => (p.dataDir ? word(`${p.dataDir}\\${file}`) : `${p.missingDir}\\${file}`);
    return { p, cli: `${p.lower}-cli`, name: p.target ? word(p.target) : p.missingTarget, inData };
}

/**
 * The whole restore as one PowerShell script for Windows PowerShell 5.1 and PowerShell 7. It
 * leaves $ErrorActionPreference alone, since Windows PowerShell turns the stderr of redis-cli
 * into an error under Stop, and stops on the cmdlets that change something instead. Its
 * functions have a verb and a noun, since PowerShell ships short names like cli as aliases,
 * which win over a function of the same name.
 */
export function powershellScript(input: RedisGuideInput): GuideCode {
    const { p, cli } = windows(input);
    const engine = input.engine;
    const body = [
        `$Service = ${p.variable(p.target, p.missingTarget, literal)}`,
        `$Data = ${p.variable(p.dataDir, p.missingDir, literal)}`,
        `# Put the full path here when ${cli} is not on the PATH, like C:\\Program Files\\${engine}\\${cli}.exe.`,
        `$Cli = '${cli}'`,
        ...(input.password ? [askPassword(engine)] : []),
        "function Invoke-Cli { & $Cli @args 2>$null }",
        "function Get-Setting($Name) { Invoke-Cli CONFIG GET $Name | Select-Object -Last 1 }",
        "function Test-Up { (Invoke-Cli PING) -eq 'PONG' }",
        "try {",
        `    if (-not (Test-Up)) { throw '${engine} does not answer. Check that it runs${input.password ? " and the password" : ""}.' }`,
        `    if ((Get-Setting appendonly) -ne 'no') { throw '${engine} writes an append only file and would not read the dump. See If ${engine} writes an append only file in DBackup.' }`,
        `    if ((Get-Setting dir) -ne $Data) { throw "${engine} keeps its data in $(Get-Setting dir), not in $Data." }`,
        `    if ((Get-Setting dbfilename) -ne 'dump.rdb') { throw "${engine} reads $(Get-Setting dbfilename), not dump.rdb." }`,
        "",
        "    $ProgressPreference = 'SilentlyContinue'",
        "    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
        "    $Dump = Join-Path $PWD 'dump.rdb'",
        `    Invoke-WebRequest -UseBasicParsing -Uri ${literal(p.url)} -OutFile $Dump -ErrorAction Stop`,
        "    Stop-Service -Name $Service -ErrorAction Stop",
        "    $Old = Join-Path $Data 'dump.rdb'",
        `    if (Test-Path $Old) { Copy-Item $Old "$Old.before-restore" -Force -ErrorAction Stop } else { Write-Host '${engine} had no dump yet.' }`,
        "    Copy-Item $Dump $Old -Force -ErrorAction Stop",
        "    Start-Service -Name $Service -ErrorAction Stop",
        "",
        "    foreach ($i in 1..120) { if (Test-Up) { break }; Start-Sleep -Seconds 1 }",
        `    if (-not (Test-Up)) { throw '${engine} did not answer within two minutes of its start. Look at its log.' }`,
        "    Invoke-Cli INFO keyspace",
        "} finally {",
        "    Remove-Item Env:REDISCLI_AUTH -ErrorAction SilentlyContinue",
        "}",
    ];
    // One script block, so a pasted script is read in full before its prompt waits for the
    // password, and a failed check ends the block without closing the window.
    const lines = [
        `# Restores ${input.backup} into the Windows service ${p.target || p.missingTarget}.`,
        `# Run it in PowerShell as an administrator on the ${engine} host, saved as a file or pasted. It keeps the old dump beside the new one as dump.rdb.before-restore.`,
        "& {",
        ...body.map((line) => (line ? `    ${line}` : "")),
        "}",
    ];
    return { code: lines.join("\n"), marks: p.marks };
}

/** The same restore one step at a time in PowerShell, every value filled in. */
export function powershellSteps(input: RedisGuideInput): GuideStep[] {
    const { p, cli, name, inData } = windows(input);
    const engine = input.engine;
    const steps: GuideStep[] = [
        {
            title: "Download the dump",
            text: "Saves it as dump.rdb in the folder you are in. The link works once.",
            blocks: [p.code(`$ProgressPreference = 'SilentlyContinue'\nInvoke-WebRequest -UseBasicParsing -Uri ${literal(p.url)} -OutFile dump.rdb`)],
        },
    ];
    if (input.password) {
        steps.push({ title: "Enter the password", text: `${cli} reads it from REDISCLI_AUTH, so it is in no command and no history.`, blocks: [p.code(askPassword(engine))] });
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
        { title: `Stop ${engine}`, text: "It saves once more while it stops.", blocks: [p.code(`Stop-Service ${name}`)] },
        {
            title: "Put the dump in place",
            text: "The old dump stays beside the new one as dump.rdb.before-restore.",
            blocks: [p.code(`Copy-Item ${inData("dump.rdb")} ${inData("dump.rdb.before-restore")}\nCopy-Item dump.rdb ${inData("dump.rdb")} -Force`)],
        },
        { title: `Start ${engine}`, text: "It loads the dump while it starts, which takes a moment for a big one.", blocks: [p.code(`Start-Service ${name}`)] },
        { title: "Check the keys", text: `Lists the keys of every database ${engine} loaded.`, blocks: [p.code(`${cli} INFO keyspace`)] },
    );
    return steps;
}

/** A copy of the append only file, whichever form it has, and the command that writes a new one. */
export function powershellAof(input: RedisGuideInput): { keep: GuideCode; turnOn: GuideCode[] } {
    const { p, cli, inData } = windows(input);
    const keep = `New-Item -ItemType Directory ${inData("aof.before-restore")} -Force | Out-Null\nCopy-Item ${inData("appendonly*")} ${inData("aof.before-restore")} -Recurse`;
    return {
        keep: p.code(keep),
        turnOn: [...(input.password ? [p.code(askPassword(input.engine))] : []), p.code(`${cli} CONFIG SET appendonly yes`)],
    };
}
