import { describe, it, expect, afterEach, vi } from "vitest";
import type * as React from "react";
import { isPlainClick, toggleOnClick } from "@/components/ui/row-click";

function row() {
    const element = document.createElement("div");
    element.innerHTML = `<span class="text">postgres-prod</span><button type="button">Actions</button><div role="checkbox"></div>`;
    document.body.appendChild(element);
    return element;
}

const click = (currentTarget: HTMLElement, target: Element) =>
    ({ currentTarget, target, stopPropagation: vi.fn() }) as unknown as React.MouseEvent<HTMLElement>;

describe("isPlainClick", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("opens the row for a click on its text", () => {
        const element = row();
        expect(isPlainClick(click(element, element.querySelector(".text")!))).toBe(true);
    });

    it("leaves a click on a control inside the row to that control", () => {
        const element = row();
        expect(isPlainClick(click(element, element.querySelector("button")!))).toBe(false);
        expect(isPlainClick(click(element, element.querySelector("[role=checkbox]")!))).toBe(false);
    });

    it("ignores a click inside a popover that renders outside the row", () => {
        const element = row();
        const popover = document.createElement("div");
        document.body.appendChild(popover);

        expect(isPlainClick(click(element, popover))).toBe(false);
    });

    it("does not open the row when the click ends a text selection", () => {
        const element = row();
        vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "postgres" } as Selection);

        expect(isPlainClick(click(element, element.querySelector(".text")!))).toBe(false);
    });
});

describe("toggleOnClick", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    function cell() {
        const element = document.createElement("td");
        element.innerHTML = `<button role="checkbox"><svg></svg></button>`;
        document.body.appendChild(element);
        return element;
    }

    it("ticks the box for a click beside it and keeps the click from the row", () => {
        const element = cell();
        const toggle = vi.fn();
        const event = click(element, element);

        toggleOnClick(toggle)(event);

        expect(toggle).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalled();
    });

    it("leaves a click on the checkbox to the checkbox", () => {
        const element = cell();
        const toggle = vi.fn();
        const event = click(element, element.querySelector("svg")!);

        toggleOnClick(toggle)(event);

        expect(toggle).not.toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
    });
});
