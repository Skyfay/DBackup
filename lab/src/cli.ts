/**
 * The dev lab behind one menu, like `pnpm toolbox`.
 *
 *   pnpm lab                     shows the menu
 *   pnpm lab <command> [args]    runs a command, the same as pnpm lab:<command> [args]
 *
 * The commands are in commands.ts, the guide is docs/developer-guide/reference/dev-lab.md.
 */

import { ask, bold, closePrompt, fail, messageOf } from "../../scripts/toolbox/cli.mjs";
import { COMMANDS, menuLines } from "./commands";

const write = (line: string) => process.stdout.write(`${line}\n`);

// The adapters of the app warn about details of Node only a developer of DBackup can change.
process.noDeprecation = true;

/** Shows the menu and runs the command picked. */
async function menu(): Promise<void> {
    write(bold("DBackup dev lab"));
    for (const line of menuLines(COMMANDS)) write(line);
    write("");
    const choice = await ask(`Select [1-${COMMANDS.length}, Enter to quit]: `);
    if (choice === "") return;
    const command = COMMANDS[Number(choice) - 1];
    if (!command || !/^\d+$/.test(choice)) {
        fail(`No command ${choice}.`);
        return;
    }
    write("");
    await command.run([], true);
}

async function main(): Promise<void> {
    const [name, ...args] = process.argv.slice(2);
    try {
        if (name === undefined) {
            await menu();
            return;
        }
        const command = COMMANDS.find((candidate) => candidate.name === name);
        if (!command) {
            fail(`No command ${name}. The commands: ${COMMANDS.map((candidate) => candidate.name).join(", ")}`);
            return;
        }
        await command.run(args, false);
    } catch (error) {
        fail(messageOf(error));
    } finally {
        closePrompt();
    }
}

// The seed creates jobs, which starts the scheduler of the app in this process, so it ends here.
main().then(() => process.exit(process.exitCode ?? 0));
