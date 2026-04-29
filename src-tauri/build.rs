use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const GITHUB_CLIENT_ID_KEY: &str = "HELMOR_GITHUB_CLIENT_ID";
const UPDATER_ENDPOINTS_KEY: &str = "HELMOR_UPDATER_ENDPOINTS";
const UPDATER_PUBKEY_KEY: &str = "HELMOR_UPDATER_PUBKEY";

fn main() {
    ensure_external_bin_placeholders();
    emit_windows_test_manifest_dependency();

    println!("cargo:rerun-if-changed=build.rs");
    for key in [
        GITHUB_CLIENT_ID_KEY,
        UPDATER_ENDPOINTS_KEY,
        UPDATER_PUBKEY_KEY,
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }

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

    tauri_build::build();
}

fn emit_windows_test_manifest_dependency() {
    println!("cargo:rerun-if-env-changed=HELMOR_WINDOWS_TEST_MANIFEST");
    if env::var_os("HELMOR_WINDOWS_TEST_MANIFEST").is_none() {
        return;
    }

    let Ok(target) = env::var("TARGET") else {
        return;
    };
    if !target.contains("windows-msvc") {
        return;
    }

    // Rust test harnesses do not inherit Tauri's Windows application manifest.
    // Without comctl32 v6, the loader picks the legacy common-controls DLL,
    // which lacks TaskDialogIndirect and aborts before unit tests can start.
    let Ok(out_dir) = env::var("OUT_DIR") else {
        return;
    };
    let manifest_path = PathBuf::from(out_dir).join("windows-test-common-controls.manifest");
    let manifest = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>
"#;

    if let Err(error) = fs::write(&manifest_path, manifest) {
        println!(
            "cargo:warning=failed to write Windows test manifest {}: {error}",
            manifest_path.display()
        );
        return;
    }

    println!("cargo:rustc-link-arg=/MANIFEST:EMBED,ID=1");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest_path.display());
}

fn ensure_external_bin_placeholders() {
    let Ok(target) = env::var("TARGET") else {
        return;
    };
    let exe_suffix = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };

    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set"));
    ensure_executable_placeholder(
        manifest_dir
            .join("target")
            .join("bundled")
            .join(format!("helmor-cli-{target}{exe_suffix}")),
    );

    if let Some(repo_root) = manifest_dir.parent() {
        let vendor_dir = repo_root.join("sidecar").join("dist").join("vendor");
        let _ = fs::create_dir_all(&vendor_dir);
        let _ = fs::write(vendor_dir.join(".gitkeep"), "");

        ensure_executable_placeholder(
            repo_root
                .join("sidecar")
                .join("dist")
                .join(format!("helmor-sidecar-{target}{exe_suffix}")),
        );
    }
}

fn ensure_executable_placeholder(path: PathBuf) {
    if path.exists() {
        return;
    }

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let bytes: &[u8] = if path.extension().and_then(|ext| ext.to_str()) == Some("exe") {
        b""
    } else {
        b"#!/bin/sh\nexit 0\n"
    };
    let _ = fs::write(&path, bytes);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
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
