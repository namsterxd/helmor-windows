import { describe, expect, test } from "bun:test";
import { buildWslResolvedCliCommand } from "./wsl.js";

describe("buildWslResolvedCliCommand", () => {
	test("prefers WSL-local fallback paths before PATH lookup", () => {
		const homeExpr = "$" + "{HOME}";
		const command = buildWslResolvedCliCommand(
			"codex",
			["$HOME/.npm-global/bin/codex", "$HOME/.bun/bin/codex"],
			["app-server", "--help"],
		);

		expect(command).toContain(
			`if [ -x "${homeExpr}/.npm-global/bin/codex" ]; then cli="${homeExpr}/.npm-global/bin/codex";`,
		);
		expect(command).toContain(
			`elif [ -x "${homeExpr}/.bun/bin/codex" ]; then cli="${homeExpr}/.bun/bin/codex";`,
		);
		expect(command).toContain(
			'elif cli=$(command -v codex 2>/dev/null) && [ -n "\\$cli" ]; then',
		);
	});

	test("rejects Windows interop shims for WSL targets", () => {
		const command = buildWslResolvedCliCommand("codex", [], ["app-server"]);

		expect(command).toContain('case "\\$cli" in /mnt/[A-Za-z]/*)');
		expect(command).toContain(
			"codex resolved to a Windows interop path; install it inside WSL instead.",
		);
		expect(command).toContain("exec \"\\$cli\" 'app-server'");
	});
});
