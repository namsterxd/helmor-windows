import { ClaudeIcon, OpenAIIcon } from "@/components/icons";
import type { AgentLoginStatusResult } from "@/lib/api";
import type { AgentLoginItem } from "./types";

export function buildAgentLoginItems(
	status?: AgentLoginStatusResult | null,
): AgentLoginItem[] {
	const claudeReady = Boolean(status?.claude || status?.claudeWsl);
	const codexReady = Boolean(status?.codex || status?.codexWsl);
	const claudeDetail = agentReadyDetail(status?.claude, status?.claudeWsl);
	const codexDetail = agentReadyDetail(status?.codex, status?.codexWsl);
	return [
		{
			icon: ClaudeIcon,
			provider: "claude",
			label: "Claude Code",
			description: claudeReady
				? agentReadyDescription(!status?.claude && status?.claudeWsl)
				: "Sign in to Claude Code to use Anthropic models in Helmor.",
			status: claudeReady ? "ready" : "needsSetup",
			readyDetail: claudeDetail,
			windowsReady: Boolean(status?.claude),
			wslReady: Boolean(status?.claudeWsl),
		},
		{
			icon: OpenAIIcon,
			provider: "codex",
			label: "Codex",
			description: codexReady
				? agentReadyDescription(!status?.codex && status?.codexWsl)
				: "Sign in to Codex to use OpenAI models in Helmor.",
			status: codexReady ? "ready" : "needsSetup",
			readyDetail: codexDetail,
			windowsReady: Boolean(status?.codex),
			wslReady: Boolean(status?.codexWsl),
		},
	];
}

function agentReadyDetail(
	nativeReady?: boolean,
	wslReady?: boolean,
): string | undefined {
	if (nativeReady && wslReady) return "Windows + WSL";
	if (wslReady) return "WSL";
	if (nativeReady) return "Windows";
	return undefined;
}

function agentReadyDescription(wslReady?: boolean): string {
	return wslReady
		? "Signed in through WSL and ready to run in local workspaces."
		: "Signed in and ready to run in local workspaces.";
}
