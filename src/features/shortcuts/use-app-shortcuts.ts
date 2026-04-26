import { useEffect, useMemo, useRef } from "react";
import { normalizeShortcutEvent } from "./format";
import { isShortcutRecordingActive } from "./recording-state";
import { getShortcut, getShortcutConflicts } from "./registry";
import type { ShortcutId, ShortcutMap } from "./types";

export type ShortcutHandler = {
	id: ShortcutId;
	callback: () => void;
	enabled?: boolean;
};

type UseAppShortcutsArgs = {
	overrides: ShortcutMap;
	handlers: ShortcutHandler[];
};

export function useAppShortcuts({ overrides, handlers }: UseAppShortcutsArgs) {
	const registrations = useMemo(() => {
		const { disabledHotkeys } = getShortcutConflicts(overrides);
		return handlers
			.map(({ id, callback, enabled = true }) => ({
				callback,
				enabled,
				hotkey: getShortcut(overrides, id),
				id,
			}))
			.filter(
				(registration) =>
					registration.hotkey && !disabledHotkeys.has(registration.hotkey),
			);
	}, [handlers, overrides]);
	const registrationsRef = useRef(registrations);
	registrationsRef.current = registrations;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isShortcutRecordingActive()) return;

			const hotkey = normalizeShortcutEvent(event);
			const match = registrationsRef.current.find(
				(registration) =>
					registration.enabled && registration.hotkey === hotkey,
			);
			if (!match) return;
			event.preventDefault();
			event.stopPropagation();
			match.callback();
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, []);
}
