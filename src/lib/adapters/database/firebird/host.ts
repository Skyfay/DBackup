import { isPortOrDefault, plainHostProblem } from "@/lib/adapters/command-values";

/**
 * The host of a Firebird source as `buildConnectionString` in `connection.ts` puts it in front of
 * `:path`. A plain module, the form schema and the adapter read it.
 */

/** The protocols the Firebird client reads in front of `://`. */
const FIREBIRD_PROTOCOLS = /^(?:inet[46]?|wnet|xnet)$/i;

/**
 * Why a host cannot go in front of `:path` in the connection string, null when it can. The client
 * ends the host at the first `/` or `:`, so a host with one would name another host, port or path
 * than the fields say, and an empty one a file of the machine the tool runs on, see `plainHostProblem`.
 * A port typed into the host as `host/3051` stays, the client reads it as the port. A host named like
 * a protocol of the client would turn a path that starts with `//` into the address of another
 * server, `inet://other/db.fdb`.
 */
export function firebirdHostProblem(value: unknown): string | null {
    const raw = typeof value === "string" ? value.trim() : "";
    const typedPort = /^(.*)\/(\d{1,5})$/.exec(raw);
    const host = typedPort ? typedPort[1] : raw;
    if (typedPort && (!isPortOrDefault(typedPort[2]) || Number(typedPort[2]) === 0)) {
        return "The port after the host must be a whole number from 1 to 65535.";
    }
    const problem = plainHostProblem(host);
    if (problem) return problem;
    if (FIREBIRD_PROTOCOLS.test(host)) return "The host must be a host name or address, not a protocol of the Firebird client.";
    return null;
}
