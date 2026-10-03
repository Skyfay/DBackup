// The two install snippets as highlighted tokens. The text that gets copied
// is the tokens joined, so what is shown and what is copied never differ.

export type TokenKind =
  | "key"
  | "punct"
  | "value"
  | "tag"
  | "keyword"
  | "string"
  | "env"
  | "comment"
  | "url"
  | "command"
  | "subshell"
  | "flag"
  | "secret"
  | "space";

export type Token = [text: string, kind: TokenKind];
export type CodeLine = Token[];

/** Colors of the dark editor window, which stays dark in light mode too. */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  key: "text-[#93c5fd]",
  punct: "text-[#71717a]",
  value: "text-[#e4e4e7]",
  tag: "text-[#a78bfa]",
  keyword: "text-[#fbbf24]",
  string: "text-[#34d399]",
  env: "text-[#c4b5fd]",
  comment: "text-[#71717a] italic",
  url: "text-[#22d3ee]",
  command: "text-[#60a5fa] font-semibold",
  subshell: "text-[#fbbf24]",
  flag: "text-[#a78bfa]",
  secret: "text-[#34d399] [text-shadow:0_0_12px_rgb(52_211_153/0.6)]",
  space: "",
};

export const COMPOSE_LINES: CodeLine[] = [
  [["services", "key"], [":", "punct"]],
  [["  ", "space"], ["dbackup", "key"], [":", "punct"]],
  [["    ", "space"], ["image", "key"], [": ", "punct"], ["skyfay/dbackup", "value"], [":latest", "tag"]],
  [["    ", "space"], ["restart", "key"], [": ", "punct"], ["always", "keyword"]],
  [["    ", "space"], ["ports", "key"], [":", "punct"]],
  [["      ", "space"], ["- ", "punct"], ['"3000:3000"', "string"]],
  [["    ", "space"], ["environment", "key"], [":", "punct"]],
  [["      ", "space"], ["- ", "punct"], ["ENCRYPTION_KEY", "env"], ["=", "punct"], ["  ", "space"], ["# openssl rand -hex 32", "comment"]],
  [["      ", "space"], ["- ", "punct"], ["BETTER_AUTH_URL", "env"], ["=", "punct"], ["https://localhost:3000", "url"]],
  [["      ", "space"], ["- ", "punct"], ["BETTER_AUTH_SECRET", "env"], ["=", "punct"], ["  ", "space"], ["# openssl rand -base64 32", "comment"]],
  [["    ", "space"], ["volumes", "key"], [":", "punct"]],
  [["      ", "space"], ["- ", "punct"], ["./data", "value"], [":/data", "tag"]],
  [["      ", "space"], ["- ", "punct"], ["./backups", "value"], [":/backups", "tag"]],
];

/** The lines of the compose file that hold a secret to fill in, counted from 0. */
export const COMPOSE_SECRET_LINES = [7, 9];

export const RUN_LINES: CodeLine[] = [
  [["docker", "command"], [" run", "key"], [" -d", "flag"], [" --name", "flag"], [" dbackup", "value"], [" --restart", "flag"], [" always", "keyword"], [" \\", "punct"]],
  [["  -p", "flag"], [" 3000:3000", "string"], [" \\", "punct"]],
  [["  -e", "flag"], [" ENCRYPTION_KEY", "env"], ["=", "punct"], ["$(openssl rand -hex 32)", "subshell"], [" \\", "punct"]],
  [["  -e", "flag"], [" BETTER_AUTH_URL", "env"], ["=", "punct"], ["https://localhost:3000", "url"], [" \\", "punct"]],
  [["  -e", "flag"], [" BETTER_AUTH_SECRET", "env"], ["=", "punct"], ["$(openssl rand -base64 32)", "subshell"], [" \\", "punct"]],
  [["  -v", "flag"], [" ./data", "value"], [":/data", "tag"], [" \\", "punct"]],
  [["  -v", "flag"], [" ./backups", "value"], [":/backups", "tag"], [" \\", "punct"]],
  [["  skyfay/dbackup", "value"], [":latest", "tag"]],
];

/** Both secrets, made in the browser in the shape openssl prints them. */
export interface Keys {
  hex: string;
  base64: string;
}

export function generateKeys(): Keys {
  const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
  const hex = Array.from(bytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
  const base64 = btoa(String.fromCharCode(...bytes(32)));
  return { hex, base64 };
}

/** The compose file, with the generated keys in place of the two comments. */
export function composeLines(keys: Keys | null): CodeLine[] {
  if (!keys) return COMPOSE_LINES;
  return COMPOSE_LINES.map((line, i) => {
    if (!COMPOSE_SECRET_LINES.includes(i)) return line;
    const value = i === COMPOSE_SECRET_LINES[0] ? keys.hex : keys.base64;
    return [...line.slice(0, 4), [value, "secret"]];
  });
}

/** The docker run command, with the generated keys in place of the two openssl calls. */
export function runLines(keys: Keys | null): CodeLine[] {
  if (!keys) return RUN_LINES;
  return RUN_LINES.map((line) =>
    line.map(([text, kind]): Token => {
      if (kind !== "subshell") return [text, kind];
      return [text.includes("-hex") ? keys.hex : keys.base64, "secret"];
    })
  );
}

/** A long key cut in the middle for the editor. The copied text keeps it whole. */
export function shortenSecret(value: string): string {
  return value.length > 24 ? `${value.slice(0, 14)}…${value.slice(-6)}` : value;
}

export function codeText(lines: CodeLine[]): string {
  return lines.map((line) => line.map(([text]) => text).join("")).join("\n");
}
