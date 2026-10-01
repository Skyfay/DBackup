import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagInput } from "@/components/ui/tag-input";

const isEmail = (value: string) => /^[^@\s]+@[^@\s]+$/.test(value);

function Recipients() {
    const [value, setValue] = useState<string[]>([]);
    return (
        <>
            <TagInput id="to" value={value} onChange={setValue} validate={isEmail} placeholder="Recipients" />
            <button type="button">Test</button>
            <output>{value.join(",")}</output>
        </>
    );
}

describe("the recipients of an email channel", () => {
    it("lets Tab move on to the next field, and keeps what was typed as a tag", async () => {
        const user = userEvent.setup();
        render(<Recipients />);

        await user.type(screen.getByPlaceholderText("Recipients"), "ops@example.ch");
        await user.tab();

        expect(screen.getByRole("button", { name: "Test" })).toHaveFocus();
        expect(screen.getByRole("status")).toHaveTextContent("ops@example.ch");
    });

    it("lets Tab move on from an empty field too", async () => {
        const user = userEvent.setup();
        render(<Recipients />);

        await user.click(screen.getByPlaceholderText("Recipients"));
        await user.tab();

        expect(screen.getByRole("button", { name: "Test" })).toHaveFocus();
    });

    it("still adds a tag with Enter and stays in the field for the next one", async () => {
        const user = userEvent.setup();
        render(<Recipients />);

        const field = screen.getByPlaceholderText("Recipients");
        await user.type(field, "ops@example.ch{Enter}");

        expect(field).toHaveFocus();
        expect(screen.getByRole("status")).toHaveTextContent("ops@example.ch");
    });
});
