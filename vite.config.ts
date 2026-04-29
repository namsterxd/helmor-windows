import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createLogger } from "vite";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;
const WATCH_IGNORED = [
	"**/src-tauri/**",
	"**/.local/**",
	"**/.local-docs/**",
	"**/.vscode/**",
	"**/dist/**",
	"**/*.log",
];
const logger = createLogger();
const defaultWarn = logger.warn;
const defaultWarnOnce = logger.warnOnce;
const isWindows = process.platform === "win32";

logger.warn = (message, options) => {
	if (message.includes("[PLUGIN_TIMINGS]")) return;
	defaultWarn(message, options);
};

logger.warnOnce = (message, options) => {
	if (message.includes("[PLUGIN_TIMINGS]")) return;
	defaultWarnOnce(message, options);
};

// https://vite.dev/config/
export default defineConfig(async () => ({
	customLogger: logger,
	plugins: [
		react(),
		babel({
			plugins: [["babel-plugin-react-compiler", {}]],
		}),
		tailwindcss(),
	],
	resolve: {
		dedupe: ["react", "react-dom"],
		alias: {
			"@": path.resolve(__dirname, "./src"),
			react: path.resolve(__dirname, "./node_modules/react"),
			"react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
			"react/jsx-runtime": path.resolve(
				__dirname,
				"./node_modules/react/jsx-runtime.js",
			),
			"react/jsx-dev-runtime": path.resolve(
				__dirname,
				"./node_modules/react/jsx-dev-runtime.js",
			),
		},
	},
	optimizeDeps: {
		include: [
			"react",
			"react-dom",
			"react/jsx-runtime",
			"react/jsx-dev-runtime",
			"@tanstack/react-query",
			// Pre-bundle lucide-react so Vite does not have to crawl the
			// per-icon ESM modules on every cold dev start. Production builds
			// already tree-shake to only the icons we actually use.
			"lucide-react",
		],
		// Lexical's package graph produces many transient dev-only chunks.
		// When Vite re-optimizes mid-session after a lockfile check, those
		// generated chunk names can drift and leave stale references behind.
		// Excluding Lexical avoids the broken half-optimized cache state.
		exclude: ["lexical", "@lexical/react"],
	},
	build: {
		// Monaco workers and the code-highlighting grammars are intentionally
		// heavy editor assets. Keep the production build warning budget aligned
		// with that expected desktop-app payload.
		chunkSizeWarningLimit: 7_000,
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. ignore app-internal local data/docs, Rust backend, editor metadata, logs, and build artifacts
			ignored: WATCH_IGNORED,
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: "./src/test/setup.ts",
		css: true,
		// GitHub Actions macos-latest runs ~50x slower than local for the
		// same spec (transform + import easily consume tens of seconds
		// before the first test runs). waitFor-heavy tests in the nav +
		// app-shortcuts suites hit microtask ordering edges under that
		// load. Retry twice in CI so a single scheduling hiccup does not
		// fail the whole run; local dev stays strict.
		retry: process.env.CI ? 2 : 0,
		// The native Windows smoke harness captures stdout/stderr through
		// PowerShell so its heaviest React integration specs run slower than
		// an interactive Vitest invocation. Keep local Unix runs strict while
		// giving Windows enough room to exercise the same behavior.
		testTimeout: isWindows ? 30_000 : 5_000,
		hookTimeout: isWindows ? 30_000 : 10_000,
		maxWorkers: isWindows ? "50%" : undefined,
		// Sidecar tests are written for `bun:test`, not vitest. Exclude them
		// so `bun run test:frontend` doesn't trip on `import ... from "bun:test"`.
		// Same for the Rust + fixtures trees which contain no TS tests.
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"sidecar/**",
			"src-tauri/**",
			"fixtures/**",
			"e2e/**",
		],
	},
}));
