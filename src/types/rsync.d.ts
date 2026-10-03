declare module "rsync" {
    import type { ChildProcess } from "child_process";

    class Rsync {
        constructor();
        shell(shell: string): Rsync;
        flags(...flags: (string | boolean)[]): Rsync;
        set(option: string, value?: any): Rsync;
        unset(option: string): Rsync;
        source(source: string | string[]): Rsync;
        destination(destination: string): Rsync;
        exclude(pattern: string | string[]): Rsync;
        include(pattern: string | string[]): Rsync;
        output(stdout?: (data: Buffer) => void, stderr?: (data: Buffer) => void): Rsync;
        cwd(cwd: string): Rsync;
        env(env: Record<string, string>): Rsync;
        command(): string;
        args(): string[];
        /** Returns the spawned child, which is what makes a running transfer killable. */
        execute(
            callback: (error: Error | null, code: number, cmd: string) => void,
            stdoutHandler?: (data: Buffer) => void,
            stderrHandler?: (data: Buffer) => void
        ): ChildProcess;
        dry(): Rsync;
        compress(): Rsync;
        archive(): Rsync;
        delete(): Rsync;
        progress(): Rsync;
        recursive(): Rsync;

        static build(options: Record<string, any>): Rsync;
    }

    export = Rsync;
}
