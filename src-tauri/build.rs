use std::env;
use std::path::{Path, PathBuf};

const GITHUB_CLIENT_ID_KEY: &str = "HELMOR_GITHUB_CLIENT_ID";
const UPDATER_ENDPOINTS_KEY: &str = "HELMOR_UPDATER_ENDPOINTS";
const UPDATER_PUBKEY_KEY: &str = "HELMOR_UPDATER_PUBKEY";

fn main() {
    // Windows only: re-embed the Common-Controls v6 manifest for every link
    // invocation (bins AND [[test]] targets). tauri-winres/embed-resource
    // uses `rustc-link-arg-bins` which skips test binaries, so nextest's
    // test-list step in target\debug\deps\ aborts with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) under the v5 comctl32 stub.
    // See windows-app-manifest.xml for the upstream issue links. Fully
    // no-op on macOS and Linux because of #[cfg(windows)].
    #[cfg(windows)]
    {
        let manifest_dir =
            std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set");
        let manifest_path = std::path::Path::new(&manifest_dir).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest_path.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
            manifest_path.display()
        );
    }

    tauri_build::build();

    println!("cargo:rerun-if-changed=build.rs");

    for env_path in candidate_env_paths() {
        // Only watch files that exist. Watching a missing file makes Cargo
        // treat the fingerprint as permanently stale, which forces a full
        // recompile of the crate on every single `cargo build` invocation.
        if env_path.exists() {
            println!("cargo:rerun-if-changed={}", env_path.display());
        }
        load_env_var(&env_path, GITHUB_CLIENT_ID_KEY);
        load_env_var(&env_path, UPDATER_ENDPOINTS_KEY);
        load_env_var(&env_path, UPDATER_PUBKEY_KEY);
    }
}

fn candidate_env_paths() -> Vec<PathBuf> {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set"));
    let mut paths = vec![manifest_dir.join(".env.local")];

    if let Some(repo_root) = manifest_dir.parent() {
        paths.push(repo_root.join(".env.local"));
        // Lowest-priority fallback: committed `.env.example` provides defaults
        // for public values (e.g. GitHub Device Flow client ID) so a fresh
        // `cargo build` works without any manual `cp .env.example .env.local`.
        paths.push(repo_root.join(".env.example"));
    }

    paths
}

fn load_env_var(path: &Path, key: &str) {
    if env::var_os(key).is_some() || !path.exists() {
        return;
    }

    let Ok(iter) = dotenvy::from_path_iter(path) else {
        return;
    };

    for item in iter.flatten() {
        if item.0 == key {
            println!("cargo:rustc-env={}={}", item.0, item.1);
            break;
        }
    }
}
