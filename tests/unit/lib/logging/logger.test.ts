import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Helpers ───────────────────────────────────────────────────

async function getLogger() {
  vi.resetModules();
  const mod = await import("@/lib/logging/logger");
  return mod.logger;
}

// ── Log level filtering ───────────────────────────────────────

describe("logger level filtering", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs info and above when LOG_LEVEL=info", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("NODE_ENV", "development");
    const log = await getLogger();

    log.debug("debug msg");
    log.info("info msg");

    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("debug msg"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("info msg"));
  });

  it("logs all levels when LOG_LEVEL=debug", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    vi.stubEnv("NODE_ENV", "development");
    const log = await getLogger();

    log.debug("debug msg");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("debug msg"));
  });

  it("suppresses debug/info when LOG_LEVEL=warn", async () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    vi.stubEnv("NODE_ENV", "development");
    const log = await getLogger();

    log.debug("debug msg");
    log.info("info msg");
    log.warn("warn msg");

    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("warn msg"));
  });

  it("suppresses all below error when LOG_LEVEL=error", async () => {
    vi.stubEnv("LOG_LEVEL", "error");
    vi.stubEnv("NODE_ENV", "development");
    const log = await getLogger();

    log.info("info msg");
    log.warn("warn msg");
    log.error("error msg");

    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("error msg"));
  });

  it("falls back to info in production when LOG_LEVEL is not set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "");
    const log = await getLogger();

    log.debug("debug msg");
    log.info("info msg");

    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("debug msg"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("info msg"));
  });

  it("falls back to debug in development when LOG_LEVEL is not set", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "");
    const log = await getLogger();

    log.debug("debug msg");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("debug msg"));
  });

  it("ignores invalid LOG_LEVEL and uses env default", async () => {
    vi.stubEnv("LOG_LEVEL", "verbose");
    vi.stubEnv("NODE_ENV", "development");
    const log = await getLogger();

    log.debug("debug msg");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("debug msg"));
  });
});

// ── Production JSON format ────────────────────────────────────

describe("production JSON output format", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("outputs valid JSON in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();

    log.info("prod message", { jobId: "123" });

    expect(console.log).toHaveBeenCalledTimes(1);
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("prod message");
    expect(parsed.context).toEqual({ jobId: "123" });
  });

  it("includes error details in production JSON output", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();

    const err = new Error("something broke");
    log.error("error happened", {}, err);

    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.error.message).toBe("something broke");
    expect(parsed.error.name).toBe("Error");
  });
});

// ── Development human-readable format ────────────────────────

describe("development human-readable output format", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("includes message in development output", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();

    log.info("hello world");

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toContain("hello world");
  });

  it("includes context JSON in development output", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();

    log.info("msg", { key: "value" });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toContain("key");
    expect(output).toContain("value");
  });

  it("uses console.warn for warn level", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();

    log.warn("a warning");

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("a warning"));
  });

  it("includes error name and message in dev output for warn level", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();

    const err = new Error("warn error msg");
    log.warn("warning with error", {}, err);

    const output = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toContain("warn error msg");
    expect(output).toContain("Error");
  });

  it("includes stack trace in dev output for error level", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();

    const err = new Error("some error");
    log.error("error with stack", {}, err);

    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toContain("some error");
  });
});

// ── child logger ──────────────────────────────────────────────

describe("child logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("merges parent and child context into every log entry", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();
    const child = log.child({ service: "MyService" });

    child.info("child message", { requestId: "r1" });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.context).toMatchObject({ service: "MyService", requestId: "r1" });
  });

  it("does not include context key when no context is passed and no default context", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();

    log.info("bare message");

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.context).toBeUndefined();
  });
});

// ── error code in error details ───────────────────────────────

describe("DBackupError code in log entry", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("includes error code in production JSON output for DBackupError", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
    const log = await getLogger();
    const { DBackupError } = await import("@/lib/logging/errors");

    const err = new DBackupError("db error", "BACKUP_ERROR");
    log.error("failed", {}, err);

    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.error.code).toBe("BACKUP_ERROR");
  });
});

// ── Secrets in a line ─────────────────────────────────────────

describe("secrets in a log line", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const lastLine = (method: "log" | "error" = "log") => {
    const calls = (console[method] as ReturnType<typeof vi.fn>).mock.calls;
    return JSON.parse(calls[calls.length - 1][0] as string);
  };

  it("redacts the values of keys that hold a secret, also nested and in a child logger", async () => {
    const log = (await getLogger()).child({ service: "Test", apiKey: "dbk_live_123" });

    log.info("Connecting", {
      host: "db.internal",
      password: "hunter2",
      dbPassword: "hunter3",
      Authorization: "Bearer abc.def",
      config: { secretAccessKey: "AKIA-SECRET", masterKeyHex: "ab".repeat(32), port: 5432 },
      headers: [{ "x-auth-token": "tok-1" }],
    });

    const { context } = lastLine();
    expect(context).toEqual({
      service: "Test",
      apiKey: "[REDACTED]",
      host: "db.internal",
      password: "[REDACTED]",
      dbPassword: "[REDACTED]",
      Authorization: "[REDACTED]",
      config: { secretAccessKey: "[REDACTED]", masterKeyHex: "[REDACTED]", port: 5432 },
      headers: [{ "x-auth-token": "[REDACTED]" }],
    });
  });

  it("keeps the ids, names and flags of a secret, which say nothing of it", async () => {
    const log = await getLogger();

    log.info("Key used", { apiKeyId: "key-1", tokenExpiresAt: "2026-11-07", credentialIds: ["c-1"], hasPassword: true, keyCount: 2 });

    expect(lastLine().context).toEqual({ apiKeyId: "key-1", tokenExpiresAt: "2026-11-07", credentialIds: ["c-1"], hasPassword: true, keyCount: 2 });
  });

  it("redacts the password of a connection string in any value, the message and the error", async () => {
    const log = await getLogger();

    log.error(
      "Could not reach mysql://root:p@ss@db:3306/shop",
      { target: "mongodb+srv://backup:s3cret@cluster0.example.net/admin", mssql: "Server=db;User Id=sa;Password=Str0ng!;" },
      new Error("connect ECONNREFUSED https://user:tok@registry.example.com/v2")
    );

    const line = JSON.stringify(lastLine("error"));
    for (const secret of ["p@ss", "s3cret", "Str0ng!", "tok@"]) expect(line).not.toContain(secret);
    expect(line).toContain("mysql://root:[REDACTED]@db:3306/shop");
    expect(line).toContain("mongodb+srv://backup:[REDACTED]@cluster0.example.net/admin");
    expect(line).toContain("Password=[REDACTED]");
  });
});
