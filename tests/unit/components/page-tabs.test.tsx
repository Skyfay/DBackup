import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyRound, User } from "lucide-react";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs } from "@/components/ui/tabs";

function renderTabs() {
    return render(
        <Tabs value="users">
            <PageTabs
                tabs={[
                    { value: "users", label: "Users", icon: User },
                    { value: "apikeys", label: "API keys", icon: KeyRound, attention: { tone: "warning", note: "CI deploy runs out within two weeks" } },
                ]}
                value="users"
                onValueChange={() => undefined}
                label="Users and groups list"
            />
        </Tabs>
    );
}

describe("the tabs of a page", () => {
    it("show an icon and the name of each list, without a count", () => {
        renderTabs();

        const users = screen.getByRole("tab", { name: "Users" });
        expect(users.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
        expect(users).not.toHaveTextContent(/\d/);
    });

    it("mark a list that needs a look with a dot that says why", async () => {
        renderTabs();

        const keys = screen.getByRole("tab", { name: "API keys, needs a look: CI deploy runs out within two weeks" });
        expect(keys.querySelector(".bg-warning")).not.toBeNull();

        await userEvent.setup().hover(keys);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("CI deploy runs out within two weeks");
    });
});
