import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentLoginProvider, LoginShell } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AgentLoginStatus } from "../types";

export function AgentStatusAction({
	provider,
	status,
	selectedShell,
	targetReady,
	waiting = false,
	onPrimeLogin,
	onStartLogin,
}: {
	provider: AgentLoginProvider;
	status: AgentLoginStatus;
	selectedShell: LoginShell;
	targetReady: boolean;
	waiting?: boolean;
	onPrimeLogin?: (provider: AgentLoginProvider) => void;
	onStartLogin?: (provider: AgentLoginProvider, shell: LoginShell) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					size="sm"
					variant={status === "ready" ? "outline" : "default"}
					className={cn(
						"group h-7 shrink-0 px-2 text-xs",
						waiting &&
							"bg-muted-foreground/70 text-background hover:bg-primary hover:text-primary-foreground",
					)}
					title={waiting ? "Restart setup" : undefined}
					onMouseEnter={() => {
						onPrimeLogin?.(provider);
					}}
					onFocus={() => {
						onPrimeLogin?.(provider);
					}}
					>
					{targetReady ? (
						`Using ${shellLabel(selectedShell)}`
					) : waiting ? (
						<>
							<span className="group-hover:hidden">Waiting...</span>
							<span className="hidden group-hover:inline">Restart</span>
						</>
					) : (
						`Set up ${shellLabel(selectedShell)}`
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" sideOffset={4} className="min-w-32">
				<DropdownMenuItem onClick={() => onStartLogin?.(provider, "powershell")}>
					{provider === "codex" ? "Windows Codex app" : "Windows Claude CLI"}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onStartLogin?.(provider, "wsl")}>
					{provider === "codex" ? "WSL Codex CLI" : "WSL CLI"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function shellLabel(shell: LoginShell) {
	return shell === "wsl" ? "WSL" : "Windows";
}
