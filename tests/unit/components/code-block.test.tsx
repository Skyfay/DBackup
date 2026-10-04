import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodeBlock, tokenize } from "@/components/ui/code-block";

describe("code to copy", () => {
    afterEach(() => vi.restoreAllMocks());

    it("keeps the // of a URL inside its string, and still finds the comment after it", () => {
        const tokens = tokenize('curl "https://backup.example.com/api" # starts a run', "bash");
        expect(tokens.find((token) => token.kind === "string")?.text).toBe('"https://backup.example.com/api"');
        expect(tokens.find((token) => token.kind === "comment")?.text).toBe("# starts a run");
    });

    it("marks the key to swap in amber and a new key in green", () => {
        const { rerender } = render(<CodeBlock name="curl" language="bash" code='-H "Authorization: Bearer dbackup_YOUR_API_KEY"' mark={{ text: "dbackup_YOUR_API_KEY", tone: "warning" }} />);
        expect(screen.getByText("dbackup_YOUR_API_KEY")).toHaveClass("text-warning");

        rerender(<CodeBlock name="curl" language="bash" code='-H "Authorization: Bearer dbackup_new"' mark={{ text: "dbackup_new", tone: "success" }} />);
        expect(screen.getByText("dbackup_new")).toHaveClass("text-success");
    });

    it("copies the whole code and says so", async () => {
        const user = userEvent.setup();
        const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
        render(<CodeBlock name="backup.sh" language="bash" code={"#!/bin/bash\necho done"} />);

        await user.click(screen.getByRole("button", { name: "Copy backup.sh" }));

        expect(writeText).toHaveBeenCalledWith("#!/bin/bash\necho done");
        expect(await screen.findByRole("button", { name: "backup.sh copied" })).toHaveTextContent("Copied");
    });
});
