/**
 * What Docker takes as the name of a volume, and nothing else.
 *
 * A mount whose source starts with `/` is a folder of the host to Docker, not a volume, so a name
 * that slips past this would mount any folder of the Docker host into the helper, as root. The list
 * filter `volume` matches the destination of a mount and the folder of a bind as well, so the name is
 * checked before it reaches that too. Docker's own rule for the names it creates, which leaves out
 * `/`, `\`, `:` and a leading dot.
 */

const VOLUME_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;

/** Whether Docker would read a text as the name of a volume. */
export function isVolumeName(name: unknown): name is string {
    return typeof name === "string" && VOLUME_NAME.test(name);
}

/** Why a text is no volume name, as a sentence, or null when it is one. */
export function volumeNameProblem(name: string): string | null {
    return isVolumeName(name)
        ? null
        : `'${name}' is no Docker volume name. A volume name starts with a letter or a digit and holds only letters, digits, '_', '.' and '-'.`;
}

/**
 * Why the path of a directory source of Docker Volumes is no single volume, or null when it is one.
 * A backup reads whole volumes, so the path is the name of one, as the volume picker writes it.
 */
export function volumeSourceProblem(path: string): string | null {
    if (path === "" || path === "/") return "A Docker Volumes source names one volume. Pick a volume for it.";
    return volumeNameProblem(path);
}

/**
 * Refuses a text that is no volume name, before it reaches Docker.
 *
 * @throws Error naming the text.
 */
export function assertVolumeName(name: string): void {
    const problem = volumeNameProblem(name);
    if (problem) throw new Error(problem);
}
