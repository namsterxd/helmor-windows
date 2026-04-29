import { describe, expect, it } from "vitest";
import { isMac } from "@/lib/platform";
import {
	normalizeShortcutEvent,
	shortcutToInlineLabel,
	shortcutToKeys,
} from "./format";

describe("shortcut formatting", () => {
	it("normalizes Option plus letter from the physical key code", () => {
		const event = new KeyboardEvent("keydown", {
			altKey: true,
			code: "KeyL",
			key: "¬",
		});

		expect(normalizeShortcutEvent(event)).toBe("Alt+L");
	});

	it("keeps legacy macOS Option glyphs readable", () => {
		const altLabel = isMac() ? "option" : "alt";
		expect(shortcutToKeys("Alt+˙")).toEqual([altLabel, "H"]);
		expect(shortcutToKeys("Alt+¬")).toEqual([altLabel, "L"]);
	});

	it("formats compact tooltip labels", () => {
		expect(shortcutToInlineLabel("Mod+,")).toBe(isMac() ? "⌘," : "Ctrl,");
		expect(shortcutToInlineLabel("Mod+Alt+ArrowRight")).toBe(
			isMac() ? "⌘⌥→" : "CtrlAlt→",
		);
	});
});
