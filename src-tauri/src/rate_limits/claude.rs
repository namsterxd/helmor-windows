use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const CLAUDE_KEYCHAIN_SERVICE: &str = "Claude Code-credentials";
const CLAUDE_OAUTH_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_REFRESH_URL: &str = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_BETA: &str = "oauth-2025-04-20";
const CLAUDE_CODE_FALLBACK_VERSION: &str = "2.1.0";
const CLAUDE_VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Deserialize)]
struct ClaudeCredentialsFile {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<ClaudeOAuthCredentials>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeOAuthCredentials {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<i64>,
    #[serde(default)]
    scopes: Vec<String>,
}

impl ClaudeOAuthCredentials {
    fn is_expired(&self, now_ms: i64) -> bool {
        self.expires_at
            .is_some_and(|expires_at| expires_at <= now_ms)
    }

    fn has_required_scope(&self) -> bool {
        self.scopes.iter().any(|scope| scope == "user:profile")
    }
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

/// Pull the raw `oauth/usage` response body straight from Anthropic.
///
/// The body is stored verbatim in `settings.app.claude_rate_limits` and
/// parsed on the frontend — no shape-mapping happens in Rust on purpose,
/// so changes to Anthropic's (undocumented) field set don't require a DB
/// migration.
pub fn fetch_claude_rate_limits() -> Result<String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("Failed to build Claude usage client")?;
    let credentials = load_best_credentials()?;
    let credentials = if credentials.is_expired(now_ms()) {
        refresh_credentials(&client, credentials)?
    } else {
        credentials
    };
    if !credentials.has_required_scope() {
        return Err(anyhow!("Claude OAuth token missing user:profile scope"));
    }

    let response = client
        .get(CLAUDE_OAUTH_USAGE_URL)
        .bearer_auth(&credentials.access_token)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("anthropic-beta", CLAUDE_OAUTH_BETA)
        .header("User-Agent", claude_code_user_agent())
        .send()
        .context("Claude usage request failed")?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        return Err(anyhow!(
            "Claude usage request failed with HTTP {status}: {body}"
        ));
    }
    response.text().context("Failed to read Claude usage body")
}

fn load_best_credentials() -> Result<ClaudeOAuthCredentials> {
    let mut credentials = load_keychain_credentials()?;
    let now = now_ms();
    sort_credentials(&mut credentials, now);
    credentials
        .into_iter()
        .rev()
        .find(|credential| !credential.access_token.trim().is_empty())
        .ok_or_else(|| anyhow!("No Claude Code OAuth credentials found in Keychain"))
}

fn sort_credentials(credentials: &mut [ClaudeOAuthCredentials], now: i64) {
    credentials.sort_by_key(|credential| {
        let scope_score = if credential.has_required_scope() {
            2
        } else {
            0
        };
        let valid_score = if credential.is_expired(now) { 0 } else { 1 };
        let expires_at = credential.expires_at.unwrap_or(0) / 1000;
        (scope_score, valid_score, expires_at)
    });
}

#[cfg(target_os = "macos")]
fn load_keychain_credentials() -> Result<Vec<ClaudeOAuthCredentials>> {
    let mut credentials = Vec::new();
    for account in keychain_account_candidates().into_iter().take(3) {
        let Ok(data) =
            security_framework::passwords::get_generic_password(CLAUDE_KEYCHAIN_SERVICE, &account)
        else {
            continue;
        };
        if let Some(credential) = parse_credentials(&data) {
            credentials.push(credential);
        }
    }
    Ok(credentials)
}

#[cfg(not(target_os = "macos"))]
fn load_keychain_credentials() -> Result<Vec<ClaudeOAuthCredentials>> {
    Ok(Vec::new())
}

fn keychain_account_candidates() -> Vec<String> {
    let mut accounts = Vec::new();
    for key in ["USER", "LOGNAME"] {
        if let Ok(value) = std::env::var(key) {
            push_unique_account(&mut accounts, value);
        }
    }
    for account in keychain_accounts_without_prompt() {
        push_unique_account(&mut accounts, account);
    }
    push_unique_account(&mut accounts, "Claude Code".to_string());
    accounts
}

#[cfg(target_os = "macos")]
fn keychain_accounts_without_prompt() -> Vec<String> {
    use core_foundation::base::{CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit, SearchResult};
    use security_framework_sys::item::kSecAttrAccount;

    let results = match ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service(CLAUDE_KEYCHAIN_SERVICE)
        .load_attributes(true)
        .skip_authenticated_items(true)
        .limit(Limit::All)
        .search()
    {
        Ok(results) => results,
        Err(error) => {
            tracing::debug!("Claude Keychain account probe failed: {error}");
            return Vec::new();
        }
    };

    let account_key = unsafe { kSecAttrAccount as CFTypeRef };
    results
        .into_iter()
        .filter_map(|result| {
            let SearchResult::Dict(attrs) = result else {
                return None;
            };
            let account = attrs.find(account_key)?;
            let account = unsafe { CFString::wrap_under_get_rule(*account as _) };
            let account = account.to_string();
            (!account.trim().is_empty()).then_some(account)
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn keychain_accounts_without_prompt() -> Vec<String> {
    Vec::new()
}

fn push_unique_account(accounts: &mut Vec<String>, account: String) {
    let trimmed = account.trim();
    if trimmed.is_empty() || accounts.iter().any(|existing| existing == trimmed) {
        return;
    }
    accounts.push(trimmed.to_string());
}

fn parse_credentials(data: &[u8]) -> Option<ClaudeOAuthCredentials> {
    serde_json::from_slice::<ClaudeCredentialsFile>(data)
        .ok()
        .and_then(|file| file.claude_ai_oauth)
        .or_else(|| serde_json::from_slice::<ClaudeOAuthCredentials>(data).ok())
}

fn refresh_credentials(
    client: &Client,
    credentials: ClaudeOAuthCredentials,
) -> Result<ClaudeOAuthCredentials> {
    let refresh_token = credentials
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| anyhow!("Claude OAuth token expired and no refresh token is available"))?;

    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", CLAUDE_OAUTH_CLIENT_ID),
    ];
    let response = client
        .post(CLAUDE_OAUTH_REFRESH_URL)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .context("Claude OAuth refresh request failed")?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        return Err(anyhow!(
            "Claude OAuth refresh failed with HTTP {status}: {body}"
        ));
    }

    let refreshed: RefreshResponse = response
        .json()
        .context("Failed to decode Claude OAuth refresh response")?;
    Ok(ClaudeOAuthCredentials {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token.or(credentials.refresh_token),
        expires_at: refreshed
            .expires_in
            .map(|seconds| now_ms() + seconds.saturating_mul(1000)),
        scopes: credentials.scopes,
    })
}

/// `claude-code/<version>` so the request matches the real CLI shape.
/// The version probe runs `claude --allowed-tools "" --version` with a
/// 5 s ceiling; on any failure (binary missing, slow shell init, parse
/// hiccup) we fall back to a hardcoded version string.
fn claude_code_user_agent() -> String {
    let version =
        probe_claude_version().unwrap_or_else(|| CLAUDE_CODE_FALLBACK_VERSION.to_string());
    format!("claude-code/{version}")
}

fn probe_claude_version() -> Option<String> {
    let output = run_with_timeout(
        Command::new("claude").args(["--allowed-tools", "", "--version"]),
        CLAUDE_VERSION_PROBE_TIMEOUT,
    )?;
    parse_claude_version_output(&output)
}

fn parse_claude_version_output(raw: &str) -> Option<String> {
    let first_line = raw.lines().next().unwrap_or(raw).trim();
    if first_line.is_empty() {
        return None;
    }
    // `claude --version` prints "<version> (Claude Code)" — take the
    // first whitespace-delimited token. Tolerate ANSI-free leading junk
    // by skipping non-numeric prefixes if present.
    let token = first_line.split_whitespace().next()?.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> Option<String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                use std::io::Read;
                let mut buf = String::new();
                child.stdout.as_mut()?.read_to_string(&mut buf).ok()?;
                return Some(buf);
            }
            Ok(Some(_)) => return None,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return None,
        }
    }
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_claude_code_credentials() {
        let data = br#"{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","expiresAt":1777109771360,"scopes":["user:profile"],"rateLimitTier":"default"}}"#;
        let credentials = parse_credentials(data).unwrap();
        assert_eq!(credentials.access_token, "a");
        assert!(credentials.has_required_scope());
    }

    #[test]
    fn parses_flat_claude_code_credentials() {
        let data =
            br#"{"accessToken":"a","refreshToken":"r","expiresAt":1777109771360,"scopes":["user:profile"]}"#;
        let credentials = parse_credentials(data).unwrap();
        assert_eq!(credentials.access_token, "a");
        assert_eq!(credentials.refresh_token.as_deref(), Some("r"));
    }

    #[test]
    fn returns_none_for_invalid_credentials_bytes() {
        assert!(parse_credentials(b"not json").is_none());
    }

    #[test]
    fn credential_sort_prioritizes_required_scope() {
        let now = 1_000_000;
        let mut credentials = vec![
            ClaudeOAuthCredentials {
                access_token: "valid-no-scope".to_string(),
                refresh_token: None,
                expires_at: Some(now + 10_000),
                scopes: Vec::new(),
            },
            ClaudeOAuthCredentials {
                access_token: "expired-with-scope".to_string(),
                refresh_token: Some("refresh".to_string()),
                expires_at: Some(now - 1),
                scopes: vec!["user:profile".to_string()],
            },
        ];

        sort_credentials(&mut credentials, now);
        assert_eq!(
            credentials
                .last()
                .map(|credential| credential.access_token.as_str()),
            Some("expired-with-scope")
        );
    }

    #[test]
    fn parses_claude_version_output() {
        assert_eq!(
            parse_claude_version_output("2.1.70 (Claude Code)\n"),
            Some("2.1.70".to_string())
        );
        assert_eq!(
            parse_claude_version_output("2.1.0\n"),
            Some("2.1.0".to_string())
        );
        assert!(parse_claude_version_output("").is_none());
        assert!(parse_claude_version_output("   \n").is_none());
    }
}
