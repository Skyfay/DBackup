"use client";

import { useState } from "react";
import { Check, Copy, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type CodeLanguage = "bash" | "python" | "typescript" | "go" | "yaml" | "json";

type TokenKind = "comment" | "string" | "variable" | "number" | "keyword";

/** Each kind of token in both themes. Comments stay quiet, everything else gets a soft color. */
const TOKEN_CLASSES: Record<TokenKind, string> = {
    comment: "italic text-muted-foreground",
    string: "text-amber-700 dark:text-amber-300",
    variable: "text-sky-700 dark:text-sky-300",
    number: "text-orange-700 dark:text-orange-300",
    keyword: "text-violet-700 dark:text-violet-300",
};

const KEYWORDS: Record<CodeLanguage, string[]> = {
    bash: ["if", "then", "else", "elif", "fi", "case", "esac", "do", "done", "while", "for", "in", "echo", "exit", "set", "sleep", "local", "export", "curl", "jq"],
    python: ["import", "from", "def", "class", "if", "elif", "else", "return", "raise", "try", "except", "with", "as", "for", "while", "in", "not", "and", "or", "True", "False", "None", "print"],
    typescript: ["import", "from", "export", "const", "let", "function", "async", "await", "if", "else", "return", "throw", "new", "while", "for", "of", "true", "false", "null"],
    go: ["package", "import", "func", "var", "const", "if", "else", "return", "for", "range", "defer", "struct", "type", "switch", "case", "default", "nil", "any"],
    yaml: ["true", "false", "null"],
    json: ["true", "false", "null"],
};

const COMMENTS: Record<CodeLanguage, string | null> = { bash: "#", python: "#", yaml: "#", typescript: "//", go: "//", json: null };

const patterns = new Map<CodeLanguage, RegExp>();

function patternOf(language: CodeLanguage): RegExp {
    let pattern = patterns.get(language);
    if (!pattern) {
        const comment = COMMENTS[language];
        const backticks = language === "typescript" || language === "go" ? "|`(?:[^`\\\\]|\\\\.)*`" : "";
        pattern = new RegExp(
            [
                // A comment starts a line or follows a space, so the // of a URL in a string never counts.
                comment ? `(?<comment>(?:^|(?<=\\s))${comment}.*$)` : null,
                `(?<string>"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'${backticks})`,
                "(?<variable>\\$\\{\\{[^}]*\\}\\}|\\$\\{[^}]*\\}|\\$\\([A-Z_]+\\)|\\$[A-Za-z_]\\w*|\\{\\{[^}]*\\}\\})",
                "(?<number>\\b\\d+(?:\\.\\d+)?\\b)",
                `(?<keyword>\\b(?:${KEYWORDS[language].join("|")})\\b)`,
            ]
                .filter(Boolean)
                .join("|"),
            "g",
        );
        patterns.set(language, pattern);
    }
    return pattern;
}

/** The pieces of one line, each with its kind, or none for plain text. */
export function tokenize(line: string, language: CodeLanguage): { text: string; kind?: TokenKind }[] {
    const pattern = patternOf(language);
    const tokens: { text: string; kind?: TokenKind }[] = [];
    let at = 0;
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > at) tokens.push({ text: line.slice(at, index) });
        const kind = (Object.keys(match.groups ?? {}) as TokenKind[]).find((name) => match.groups?.[name] !== undefined);
        tokens.push({ text: match[0], kind });
        at = index + match[0].length;
    }
    if (at < line.length) tokens.push({ text: line.slice(at) });
    return tokens;
}

/** A value the reader has to notice in the code, like the key: amber to swap, green once it is filled in. */
export interface CodeMark {
    text: string;
    tone: "warning" | "success";
}

/** Text with every appearance of the mark tinted, for code and for a value shown beside it. */
export function MarkedText({ text, mark }: { text: string; mark?: CodeMark }) {
    if (!mark || !mark.text || !text.includes(mark.text)) return <>{text}</>;
    const parts = text.split(mark.text);
    return (
        <>
            {parts.map((part, index) => (
                <span key={index}>
                    {part}
                    {index < parts.length - 1 && (
                        <span
                            className={cn(
                                "rounded-sm px-0.5",
                                mark.tone === "warning" ? "bg-warning/15 text-warning underline decoration-dotted underline-offset-4" : "bg-success/12 text-success",
                            )}
                        >
                            {mark.text}
                        </span>
                    )}
                </span>
            ))}
        </>
    );
}

interface CodeBlockProps {
    /** The file it is saved as, or what it is, above the code. */
    name: string;
    code: string;
    language: CodeLanguage;
    /** Shown before the name, like the logo of the language. Defaults to a file. */
    icon?: React.ReactNode;
    mark?: CodeMark;
    className?: string;
}

/**
 * Code to copy, with its file name and Copy on top. It follows the theme like the rest of the
 * page and scrolls sideways where a line is longer than the block.
 */
export function CodeBlock({ name, code, language, icon, mark, className }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={cn("min-w-0 overflow-hidden rounded-lg border", className)}>
            <div className="flex h-9 items-center gap-2 border-b bg-card pr-1 pl-3">
                <span className="text-muted-foreground [&_svg]:size-3.5" aria-hidden="true">
                    {icon ?? <FileText />}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{name}</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={copy} aria-label={copied ? `${name} copied` : `Copy ${name}`}>
                    {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>
            <ScrollArea className="bg-muted/40 dark:bg-black/20" type="auto">
                <pre className="px-4 py-3 font-mono text-xs leading-5">
                    <code>
                        {code.split("\n").map((line, index) => (
                            <div key={index} className="min-h-5">
                                {tokenize(line, language).map((token, part) =>
                                    token.kind ? (
                                        <span key={part} className={TOKEN_CLASSES[token.kind]}>
                                            <MarkedText text={token.text} mark={mark} />
                                        </span>
                                    ) : (
                                        <MarkedText key={part} text={token.text} mark={mark} />
                                    ),
                                )}
                            </div>
                        ))}
                    </code>
                </pre>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
}
