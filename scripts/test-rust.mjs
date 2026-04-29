import { spawnSync } from "node:child_process";

const manifestArgs = ["--manifest-path", "src-tauri/Cargo.toml"];
const integrationTargets = [
	"agent_stream_event_wire",
	"pipeline_fixtures",
	"pipeline_scenarios",
	"pipeline_streams",
	"schema_migrations",
	"stable_part_ids",
	"stream_bridge_elicitation",
	"stream_bridge_events",
	"streaming_send_params",
];

function runCargo(args, env = {}) {
	console.log(`$ cargo ${args.join(" ")}`);
	const result = spawnSync("cargo", args, {
		stdio: "inherit",
		env: { ...process.env, ...env },
	});
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function integrationArgs() {
	return [
		"test",
		...manifestArgs,
		...integrationTargets.flatMap((target) => ["--test", target]),
	];
}

const mode = process.argv[2] ?? "all";
const isWindows = process.platform === "win32";

if (mode === "--lib") {
	runCargo(["test", ...manifestArgs, "--lib"], isWindows ? { HELMOR_WINDOWS_TEST_MANIFEST: "1" } : {});
} else if (mode === "--integration") {
	runCargo(isWindows ? integrationArgs() : ["test", ...manifestArgs, "--tests"]);
} else if (mode === "all") {
	if (isWindows) {
		runCargo(["test", ...manifestArgs, "--lib"], { HELMOR_WINDOWS_TEST_MANIFEST: "1" });
		runCargo(integrationArgs());
	} else {
		runCargo(["test", ...manifestArgs]);
	}
} else {
	console.error(`Unknown mode: ${mode}`);
	process.exit(1);
}
