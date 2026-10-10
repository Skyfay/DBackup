import { Fragment, type CSSProperties } from "react";
import type { CodeLines as Lines } from "@/lib/highlight";

/** The lines of a snippet from `highlight()`, inside the `<pre>` of a CodeBlock. */
export function CodeLines({ lines }: { lines: Lines }) {
  return (
    <code>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {line.map((token, j) => (
            <span key={j} style={{ "--shiki-light": token.light, "--shiki-dark": token.dark } as CSSProperties}>
              {token.text}
            </span>
          ))}
          {i < lines.length - 1 && "\n"}
        </Fragment>
      ))}
    </code>
  );
}
