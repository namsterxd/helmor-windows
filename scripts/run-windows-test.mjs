#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(scriptDir, "test-windows.ps1");
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const forwardedArgs = process.argv.slice(2);

const command = [
	"$ErrorActionPreference = 'Stop'",
	"$scriptPath = $env:HELMOR_WINDOWS_TEST_SCRIPT",
	"$script = Get-Content -Raw -LiteralPath $scriptPath",
	"$scriptArgs = ConvertFrom-Json -InputObject $env:HELMOR_WINDOWS_TEST_ARGS",
	"& ([scriptblock]::Create($script)) @scriptArgs",
].join("; ");

const result = spawnSync(
	powershell,
	["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
	{
		cwd: resolve(scriptDir, ".."),
		stdio: "inherit",
		env: {
			...process.env,
			HELMOR_WINDOWS_TEST_SCRIPT: scriptPath,
			HELMOR_WINDOWS_TEST_SCRIPT_DIR: scriptDir,
			HELMOR_WINDOWS_TEST_ARGS: JSON.stringify(forwardedArgs),
		},
	},
);

if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 1);
