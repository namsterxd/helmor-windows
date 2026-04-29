//! Paths to bundled `gh` / `glab` inside Tauri resource directories.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const GH_PATH_ENV: &str = "HELMOR_GH_BIN_PATH";
pub const GLAB_PATH_ENV: &str = "HELMOR_GLAB_BIN_PATH";

#[derive(Debug, Default, Clone)]
pub struct BundledForgeCliPaths {
    pub gh: Option<PathBuf>,
    pub glab: Option<PathBuf>,
}

static BUNDLED_PATHS: OnceLock<BundledForgeCliPaths> = OnceLock::new();

/// Call once from the Tauri setup hook; later calls are a no-op in release
/// and a debug assertion failure in dev (catches accidental re-init).
pub fn init() {
    let result = BUNDLED_PATHS.set(resolve_from_running_exe());
    debug_assert!(result.is_ok(), "forge::bundled::init called more than once");
    let paths = BUNDLED_PATHS.get();
    tracing::info!(
        gh = ?paths.and_then(|p| p.gh.as_deref()),
        glab = ?paths.and_then(|p| p.glab.as_deref()),
        "Resolved bundled forge CLI paths"
    );
}

/// Env var override > startup-resolved path > `None` (caller falls back to PATH).
pub fn bundled_path_for(program: &str) -> Option<PathBuf> {
    if let Some(env_key) = env_key_for(program) {
        if let Ok(raw) = std::env::var(env_key) {
            let path = PathBuf::from(raw);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    let cached = BUNDLED_PATHS.get()?;
    match program {
        "gh" => cached.gh.clone(),
        "glab" => cached.glab.clone(),
        _ => None,
    }
}

fn env_key_for(program: &str) -> Option<&'static str> {
    match program {
        "gh" => Some(GH_PATH_ENV),
        "glab" => Some(GLAB_PATH_ENV),
        _ => None,
    }
}

fn resolve_from_running_exe() -> BundledForgeCliPaths {
    let paths = std::env::current_exe()
        .ok()
        .and_then(|exe| resolve_for_exe(&exe))
        .unwrap_or_default();

    #[cfg(debug_assertions)]
    {
        paths.with_fallback(resolve_for_dev_workspace(&dev_workspace_root()))
    }

    #[cfg(not(debug_assertions))]
    {
        paths
    }
}

fn resolve_for_exe(exe: &Path) -> Option<BundledForgeCliPaths> {
    let exe_dir = exe.parent()?;
    for root in resource_root_candidates(exe_dir) {
        let paths = resolve_for_resource_root(&root);
        if paths.gh.is_some() || paths.glab.is_some() {
            return Some(paths);
        }
    }

    Some(BundledForgeCliPaths::default())
}

fn resource_root_candidates(exe_dir: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(contents_dir) = exe_dir.parent() {
        roots.push(contents_dir.join("Resources"));
    }
    roots.push(exe_dir.to_path_buf());
    roots.push(exe_dir.join("resources"));
    roots.push(exe_dir.join("Resources"));
    roots
}

fn resolve_for_resource_root(root: &Path) -> BundledForgeCliPaths {
    for vendor in [root.join("vendor"), root.to_path_buf()] {
        let paths = resolve_for_vendor_root(&vendor);
        if paths.gh.is_some() || paths.glab.is_some() {
            return paths;
        }
    }
    BundledForgeCliPaths::default()
}

fn resolve_for_vendor_root(vendor: &Path) -> BundledForgeCliPaths {
    let gh_name = bundled_binary_name("gh");
    let glab_name = bundled_binary_name("glab");

    let gh = vendor.join("gh").join(gh_name);
    let glab = vendor.join("glab").join(glab_name);

    BundledForgeCliPaths {
        gh: gh.is_file().then_some(gh),
        glab: glab.is_file().then_some(glab),
    }
}

fn bundled_binary_name(program: &str) -> String {
    if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.to_string()
    }
}

#[cfg(debug_assertions)]
impl BundledForgeCliPaths {
    fn with_fallback(self, fallback: BundledForgeCliPaths) -> BundledForgeCliPaths {
        BundledForgeCliPaths {
            gh: self.gh.or(fallback.gh),
            glab: self.glab.or(fallback.glab),
        }
    }
}

#[cfg(debug_assertions)]
fn dev_workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

#[cfg(debug_assertions)]
fn resolve_for_dev_workspace(workspace_root: &Path) -> BundledForgeCliPaths {
    let vendor = workspace_root.join("sidecar/dist/vendor");
    resolve_for_vendor_root(&vendor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_finds_binaries_under_resources_vendor() {
        let root = tempfile::tempdir().unwrap();
        let exe = root.path().join("Helmor.app/Contents/MacOS/Helmor");
        let vendor = root.path().join("Helmor.app/Contents/Resources/vendor");
        std::fs::create_dir_all(vendor.join("gh")).unwrap();
        std::fs::create_dir_all(vendor.join("glab")).unwrap();
        let gh = vendor.join("gh").join(bundled_binary_name("gh"));
        let glab = vendor.join("glab").join(bundled_binary_name("glab"));
        std::fs::write(&gh, "").unwrap();
        std::fs::write(&glab, "").unwrap();

        let paths = resolve_for_exe(&exe).unwrap();

        assert_eq!(paths.gh.unwrap(), gh);
        assert_eq!(paths.glab.unwrap(), glab);
    }

    #[test]
    fn resolve_finds_binaries_next_to_exe_on_windows_layout() {
        let root = tempfile::tempdir().unwrap();
        let exe_dir = root.path().join("Helmor");
        let exe = exe_dir.join("Helmor.exe");
        let vendor = exe_dir.join("vendor");
        std::fs::create_dir_all(vendor.join("gh")).unwrap();
        std::fs::create_dir_all(vendor.join("glab")).unwrap();
        let gh = vendor.join("gh").join(bundled_binary_name("gh"));
        let glab = vendor.join("glab").join(bundled_binary_name("glab"));
        std::fs::write(&gh, "").unwrap();
        std::fs::write(&glab, "").unwrap();

        let paths = resolve_for_exe(&exe).unwrap();

        assert_eq!(paths.gh.unwrap(), gh);
        assert_eq!(paths.glab.unwrap(), glab);
    }

    #[test]
    fn resolve_finds_binaries_under_resources_next_to_exe() {
        let root = tempfile::tempdir().unwrap();
        let exe_dir = root.path().join("Helmor");
        let exe = exe_dir.join("Helmor.exe");
        let vendor = exe_dir.join("resources/vendor");
        std::fs::create_dir_all(vendor.join("gh")).unwrap();
        std::fs::create_dir_all(vendor.join("glab")).unwrap();
        let gh = vendor.join("gh").join(bundled_binary_name("gh"));
        let glab = vendor.join("glab").join(bundled_binary_name("glab"));
        std::fs::write(&gh, "").unwrap();
        std::fs::write(&glab, "").unwrap();

        let paths = resolve_for_exe(&exe).unwrap();

        assert_eq!(paths.gh.unwrap(), gh);
        assert_eq!(paths.glab.unwrap(), glab);
    }

    #[test]
    fn resolve_returns_none_when_binaries_missing() {
        let root = tempfile::tempdir().unwrap();
        let exe = root.path().join("Helmor.app/Contents/MacOS/Helmor");
        let paths = resolve_for_exe(&exe).unwrap();
        assert!(paths.gh.is_none());
        assert!(paths.glab.is_none());
    }

    #[cfg(debug_assertions)]
    #[test]
    fn resolve_finds_debug_vendor_under_workspace_root() {
        let root = tempfile::tempdir().unwrap();
        let vendor = root.path().join("sidecar/dist/vendor");
        std::fs::create_dir_all(vendor.join("gh")).unwrap();
        std::fs::create_dir_all(vendor.join("glab")).unwrap();
        let gh = vendor.join("gh").join(bundled_binary_name("gh"));
        let glab = vendor.join("glab").join(bundled_binary_name("glab"));
        std::fs::write(&gh, "").unwrap();
        std::fs::write(&glab, "").unwrap();

        let paths = resolve_for_dev_workspace(root.path());

        assert_eq!(paths.gh.unwrap(), gh);
        assert_eq!(paths.glab.unwrap(), glab);
    }

    #[cfg(debug_assertions)]
    #[test]
    fn app_bundle_paths_win_over_debug_vendor() {
        let root = tempfile::tempdir().unwrap();
        let exe = root.path().join("Helmor.app/Contents/MacOS/Helmor");
        let app_vendor = root.path().join("Helmor.app/Contents/Resources/vendor");
        let dev_vendor = root.path().join("sidecar/dist/vendor");
        std::fs::create_dir_all(app_vendor.join("gh")).unwrap();
        std::fs::create_dir_all(app_vendor.join("glab")).unwrap();
        std::fs::create_dir_all(dev_vendor.join("gh")).unwrap();
        std::fs::create_dir_all(dev_vendor.join("glab")).unwrap();
        let app_gh = app_vendor.join("gh").join(bundled_binary_name("gh"));
        let app_glab = app_vendor.join("glab").join(bundled_binary_name("glab"));
        let dev_gh = dev_vendor.join("gh").join(bundled_binary_name("gh"));
        let dev_glab = dev_vendor.join("glab").join(bundled_binary_name("glab"));
        std::fs::write(&app_gh, "").unwrap();
        std::fs::write(&app_glab, "").unwrap();
        std::fs::write(dev_gh, "").unwrap();
        std::fs::write(dev_glab, "").unwrap();

        let paths = resolve_for_exe(&exe)
            .unwrap()
            .with_fallback(resolve_for_dev_workspace(root.path()));

        assert_eq!(paths.gh.unwrap(), app_gh);
        assert_eq!(paths.glab.unwrap(), app_glab);
    }
}
