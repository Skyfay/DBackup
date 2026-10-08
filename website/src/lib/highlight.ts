import { codeToTokens, type BundledLanguage } from "shiki";

/** A piece of a highlighted line with its color in the light and the dark theme. */
export interface CodeToken {
  text: string;
  light: string;
  dark: string;
}

export type CodeLines = CodeToken[][];

const THEMES = { light: "github-light-default", dark: "github-dark-default" } as const;

/**
 * Highlights a snippet during the static export, so no highlighter ships to
 * the browser. The colors become the `--shiki-light` and `--shiki-dark`
 * variables the `.code-highlight` rules in globals.css pick from.
 */
export async function highlight(code: string, lang: BundledLanguage): Promise<CodeLines> {
  const { tokens } = await codeToTokens(code, { lang, themes: THEMES, defaultColor: false });
  return tokens.map((line) =>
    line.map((token) => ({
      text: token.content,
      light: token.htmlStyle?.["--shiki-light"] ?? "",
      dark: token.htmlStyle?.["--shiki-dark"] ?? "",
    }))
  );
}
