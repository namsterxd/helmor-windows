import { Circle } from "lucide-react";

/**
 * Pure-UI "Working" footer shown at the bottom of an in-flight assistant
 * turn — pulsing dot + label.
 */
export function WorkingIndicatorUI({ label = "Working" }: { label?: string }) {
	return (
		<div className="flex items-center gap-1.5 px-5 py-3 text-[12px] tabular-nums text-muted-foreground">
			<Circle className="size-3 animate-pulse fill-current" />
			{label}
		</div>
	);
}
