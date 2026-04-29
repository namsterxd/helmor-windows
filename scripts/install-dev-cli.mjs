#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const exe = isWindows ? ".exe" : "";
const dataDir =
	process.env.HELMOR_DATA_DIR ??
	(isWindows ? join(homedir(), "helmor-dev") : null);
const installDir = isWindows ? join(dataDir, "bin") : "/usr/local/bin";
const cliSource = join(
	root,
	"src-tauri",
	"target",
	"debug",
	`helmor-cli${exe}`,
);
const cliTarget = join(installDir, `helmor-dev${exe}`);
const sidecarSource = join(root, "sidecar", "dist", `helmor-sidecar${exe}`);
const sidecarTarget = join(installDir, `helmor-sidecar${exe}`);

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		shell: isWindows,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

run("cargo", ["build", "--bin", "helmor-cli"], join(root, "src-tauri"));

if (!existsSync(sidecarSource)) {
	run(
		"bun",
		["run", isWindows ? "build:windows" : "build"],
		join(root, "sidecar"),
	);
}

mkdirSync(dirname(cliTarget), { recursive: true });
copyFileSync(cliSource, cliTarget);
copyFileSync(sidecarSource, sidecarTarget);

console.log(`Installed helmor-dev + helmor-sidecar to ${installDir}`);
