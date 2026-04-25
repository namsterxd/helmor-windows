import { ClaudeIcon, OpenAIIcon } from "@/components/icons";
import type { AgentLoginItem } from "./types";

// Future real detection should check provider login state, not installation:
// - Claude Code is ready only when its local account/session can be confirmed.
// - Codex is ready only when its local account/session can be confirmed.
// Missing binaries are a separate setup problem; this step is about auth.
const agentLoginItems: AgentLoginItem[] = [
	{
		icon: ClaudeIcon,
		provider: "claude",
		label: "Claude Code",
		description: "Signed in and ready to run in local workspaces.",
		status: "ready",
	},
	{
		icon: OpenAIIcon,
		provider: "codex",
		label: "Codex",
		description: "Sign in to Codex to use OpenAI models in Helmor.",
		status: "needsSetup",
	},
];

export function checkAgentLoginItems(): AgentLoginItem[] {
	// Placeholder for the real auth check. This must keep checking login state,
	// not binary installation. When the user returns focus to Helmor after
	// terminal login, this function is called again and should reclassify each
	// provider from its authenticated session/account state.
	return agentLoginItems;
}
