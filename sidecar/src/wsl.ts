import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export function isWslTarget(target: string | undefined): boolean {
	return process.platform === "win32" && target === "wsl";
}

export function windowsPathToWsl(path: string | undefined): string | undefined {
	if (!path || process.platform !== "win32") return path;
	const normalized = path.replaceAll("\\", "/");
	const match = /^([a-zA-Z]):\/?(.*)$/.exec(normalized);
	if (!match) return path;
	const [, drive, rest = ""] = match;
	if (!drive) return path;
	return `/mnt/${drive.toLowerCase()}/${rest}`;
}

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function wslShellCommand(command: string): {
	binaryPath: string;
	args: string[];
} {
	return {
		binaryPath: "wsl.exe",
		args: ["--", "sh", "-lc", command],
	};
}

export function spawnWslShell(command: string): ChildProcessWithoutNullStreams {
	return spawn("wsl.exe", ["--", "sh", "-lc", command], {
		stdio: ["pipe", "pipe", "pipe"],
	});
}

export function buildWslCliCommand(
	binary: string,
	args: readonly string[],
	cwd?: string,
	env?: Readonly<Record<string, string | undefined>>,
): string {
	const envParts = Object.entries(env ?? {})
		.filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && value !== undefined)
		.map(([key, value]) => `${key}=${shellQuote(value ?? "")}`);
	const cd = cwd ? `cd ${shellQuote(windowsPathToWsl(cwd) ?? cwd)} && ` : "";
	const envPrefix = envParts.length > 0 ? `env ${envParts.join(" ")} ` : "";
	return `${cd}exec ${envPrefix}${binary} ${args.map(shellQuote).join(" ")}`;
}

export function buildWslResolvedCliCommand(
	binary: string,
	fallbackPaths: readonly string[],
	args: readonly string[],
	cwd?: string,
	env?: Readonly<Record<string, string | undefined>>,
): string {
	const envParts = Object.entries(env ?? {})
		.filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && value !== undefined)
		.map(([key, value]) => `${key}=${shellQuote(value ?? "")}`);
	const cd = cwd ? `cd ${shellQuote(windowsPathToWsl(cwd) ?? cwd)} && ` : "";
	const envPrefix = envParts.length > 0 ? `env ${envParts.join(" ")} ` : "";
	const fallbacks = fallbackPaths
		.map((path, index) => {
			const expr = path.startsWith("$HOME/")
				? `"${"${HOME}"}/${path.slice("$HOME/".length)}"`
				: shellQuote(path);
			return `${index === 0 ? "if" : "elif"} [ -x ${expr} ]; then cli=${expr}; `;
		})
		.join("");
	const lookupPrefix = fallbackPaths.length > 0 ? "elif" : "if";
	const resolvedLookup = `${lookupPrefix} cli=$(command -v ${binary} 2>/dev/null) && [ -n "\\$cli" ]; then case "\\$cli" in /mnt/[A-Za-z]/*) printf '%s\\n' ${shellQuote(`${binary} resolved to a Windows interop path; install it inside WSL instead.`)}; exit 127;; esac; `;
	const missing = `else printf '%s\\n' ${shellQuote(`${binary} is not on PATH in this WSL shell.`)}; exit 127; fi; `;
	return `${cd}${fallbacks}${resolvedLookup}${missing}exec ${envPrefix}"\\$cli" ${args.map(shellQuote).join(" ")}`;
}
