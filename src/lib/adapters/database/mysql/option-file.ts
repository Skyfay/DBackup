/**
 * What a value needs to go into the option file the MySQL and MariaDB tools read their password
 * from, see `withAuthArgs` in `args.ts`. The quotes of that file end with its line whatever they
 * say, so a CR or an LF in a password would start a line of its own that every one of these tools
 * reads as an option, like `plugin-dir` or `init-command`, and a NUL ends the value early. A plain
 * module, the form schema, the credential profiles and the adapter read it.
 */

/** What someone reads whose password cannot go into the option file of the client tools. */
export const PASSWORD_LINE_BREAK = "The password cannot hold a line break or a NUL character, which the MySQL and MariaDB tools would read as further options. Set a password without one.";

/** The characters a value of the option file cannot hold. */
const OPTION_FILE_UNSAFE = /[\r\n\0]/;

/** Whether a value fits into the option file. Anything but text fits, it never reaches the file. */
export function fitsOptionFile(value: unknown): boolean {
    return typeof value !== "string" || !OPTION_FILE_UNSAFE.test(value);
}
