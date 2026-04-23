import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AppUpdateStatus } from "@/lib/api";
import { installDownloadedAppUpdate } from "@/lib/api";

type ButtonSize = ComponentProps<typeof Button>["size"];
type ButtonVariant = ComponentProps<typeof Button>["variant"];

type AppUpdateButtonProps = {
	status: AppUpdateStatus | null;
	className?: string;
	size?: ButtonSize;
	variant?: ButtonVariant;
};

export function AppUpdateButton({
	status,
	className,
	size = "xs",
	variant = "ghost",
}: AppUpdateButtonProps) {
	const [installing, setInstalling] = useState(false);

	if (status?.stage !== "downloaded" || !status.update) {
		return null;
	}

	const update = status.update;

	return (
		<Button
			type="button"
			variant={variant}
			size={size}
			aria-label={`Update Helmor to ${update.version}`}
			title={`Update Helmor to ${update.version}`}
			className={className}
			onClick={() => {
				setInstalling(true);
				void installDownloadedAppUpdate()
					.catch((error: unknown) => {
						toast.error("Install failed", {
							description:
								error instanceof Error
									? error.message
									: "Unable to install the downloaded update.",
							action: update.releaseUrl
								? {
										label: "Change log",
										onClick: () => void openUrl(update.releaseUrl),
									}
								: undefined,
						});
					})
					.finally(() => setInstalling(false));
			}}
			disabled={installing}
		>
			{installing ? (
				<Loader2 className="size-3.5 animate-spin" />
			) : (
				<Download className="size-3.5" />
			)}
			<span>Update</span>
		</Button>
	);
}
