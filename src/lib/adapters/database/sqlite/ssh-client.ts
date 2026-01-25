import { Client, ConnectConfig } from "ssh2";
import { LogLevel, LogType } from "@/lib/core/logs";

export class SshClient {
    private client: Client;

    constructor() {
        this.client = new Client();
    }

    public connect(config: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const sshConfig: ConnectConfig = {
                host: config.host,
                port: config.port,
                username: config.username,
                readyTimeout: 20000,
            };

            if (config.authType === 'privateKey') {
                sshConfig.privateKey = config.privateKey;
                if (config.passphrase) {
                    sshConfig.passphrase = config.passphrase;
                }
            } else if (config.authType === 'agent') {
                 sshConfig.agent = process.env.SSH_AUTH_SOCK;
            } else {
                // Default to password
                 sshConfig.password = config.password;
            }

            this.client
                .on("ready", () => {
                    resolve();
                })
                .on("error", (err) => {
                    reject(err);
                })
                .connect(sshConfig);
        });
    }

    public exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
        return new Promise((resolve, reject) => {
            this.client.exec(command, (err, stream) => {
                if (err) return reject(err);

                let stdout = "";
                let stderr = "";

                stream
                    .on("close", (code: number, signal: any) => {
                        resolve({ stdout, stderr, code });
                    })
                    .on("data", (data: any) => {
                        stdout += data.toString();
                    })
                    .stderr.on("data", (data: any) => {
                        stderr += data.toString();
                    });
            });
        });
    }

    // Returns the raw stream for piping
    public execStream(command: string, callback: (err: Error | undefined, stream: any) => void): void {
        this.client.exec(command, callback);
    }

    public end() {
        this.client.end();
    }
}
