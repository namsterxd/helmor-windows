use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_REFRESH_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_USER_AGENT: &str = concat!("Helmor/", env!("CARGO_PKG_VERSION"));
const REFRESH_AFTER_SECONDS: i64 = 8 * 24 * 60 * 60;

/// Pull the raw `wham/usage` response body straight from ChatGPT.
///
/// Mirrors `rate_limits::claude::fetch_claude_rate_limits`: the body is
/// stored verbatim in `settings.app.codex_rate_limits` and parsed on the
/// frontend, so any future schema additions (new windows, plan types,
/// etc.) only need a parser tweak — no DB migration.
pub fn fetch_codex_rate_limits() -> Result<String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("Failed to build Codex usage client")?;

    let auth_path = auth_file_path();
    let mut credentials = load_credentials(&auth_path)
        .with_context(|| format!("Failed to read {}", auth_path.display()))?;
    if credentials.needs_refresh(now_seconds()) {
        match refresh_credentials(&client, &credentials) {
            Ok(refreshed) => {
                if let Err(err) = persist_refreshed_credentials(&auth_path, &refreshed) {
                    tracing::warn!("Codex auth.json write-back failed: {err}");
                }
                credentials = refreshed;
            }
            Err(err) => {
                tracing::warn!("Codex token refresh failed, retrying with existing token: {err}");
            }
        }
    }

    let mut request = client
        .get(CODEX_USAGE_URL)
        .bearer_auth(&credentials.access_token)
        .header("Accept", "application/json")
        .header("User-Agent", CODEX_USER_AGENT);
    if let Some(account_id) = credentials.account_id.as_deref() {
        if !account_id.is_empty() {
            request = request.header("ChatGPT-Account-Id", account_id);
        }
    }

    let response = request.send().context("Codex usage request failed")?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        return Err(anyhow!(
            "Codex usage request failed with HTTP {status}: {body}"
        ));
    }
    response.text().context("Failed to read Codex usage body")
}

#[derive(Debug, Clone)]
struct CodexCredentials {
    access_token: String,
    refresh_token: String,
    id_token: Option<String>,
    account_id: Option<String>,
    last_refresh: Option<i64>,
}

impl CodexCredentials {
    fn needs_refresh(&self, now_seconds: i64) -> bool {
        if self.refresh_token.trim().is_empty() {
            return false;
        }
        match self.last_refresh {
            Some(last) => now_seconds.saturating_sub(last) > REFRESH_AFTER_SECONDS,
            None => true,
        }
    }
}

fn auth_file_path() -> PathBuf {
    if let Ok(custom) = std::env::var("CODEX_HOME") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("auth.json");
        }
    }
    home_dir().join(".codex").join("auth.json")
}

fn home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    PathBuf::from("/")
}

fn load_credentials(path: &Path) -> Result<CodexCredentials> {
    let raw = std::fs::read(path).with_context(|| {
        format!(
            "Codex auth.json not found at {}. Run `codex` to log in.",
            path.display()
        )
    })?;
    parse_credentials(&raw)
}

fn parse_credentials(data: &[u8]) -> Result<CodexCredentials> {
    let root: Value = serde_json::from_slice(data).context("Codex auth.json is not valid JSON")?;

    // Plain API-key style file: `{ "OPENAI_API_KEY": "sk-..." }`.
    if let Some(api_key) = root
        .get("OPENAI_API_KEY")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(CodexCredentials {
            access_token: api_key.to_string(),
            refresh_token: String::new(),
            id_token: None,
            account_id: None,
            last_refresh: None,
        });
    }

    let tokens = root
        .get("tokens")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("Codex auth.json contains no tokens"))?;

    let access_token = pick_string(tokens, &["access_token", "accessToken"])
        .ok_or_else(|| anyhow!("Codex auth.json missing access token"))?;
    let refresh_token = pick_string(tokens, &["refresh_token", "refreshToken"]).unwrap_or_default();
    let id_token = pick_string(tokens, &["id_token", "idToken"]);
    let account_id = pick_string(tokens, &["account_id", "accountId"]);
    let last_refresh = root
        .get("last_refresh")
        .and_then(Value::as_str)
        .and_then(parse_iso_to_unix);

    Ok(CodexCredentials {
        access_token,
        refresh_token,
        id_token,
        account_id,
        last_refresh,
    })
}

fn pick_string(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = obj.get(*key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

fn refresh_credentials(
    client: &Client,
    credentials: &CodexCredentials,
) -> Result<CodexCredentials> {
    if credentials.refresh_token.trim().is_empty() {
        return Err(anyhow!("Codex refresh token is empty"));
    }

    let body = serde_json::json!({
        "client_id": CODEX_CLIENT_ID,
        "grant_type": "refresh_token",
        "refresh_token": credentials.refresh_token,
        "scope": "openid profile email",
    });

    let response = client
        .post(CODEX_REFRESH_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", CODEX_USER_AGENT)
        .json(&body)
        .send()
        .context("Codex token refresh request failed")?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        return Err(anyhow!(
            "Codex token refresh failed with HTTP {status}: {body}"
        ));
    }

    let refreshed: RefreshResponse = response
        .json()
        .context("Failed to decode Codex token refresh response")?;
    Ok(CodexCredentials {
        access_token: refreshed
            .access_token
            .filter(|token| !token.trim().is_empty())
            .unwrap_or_else(|| credentials.access_token.clone()),
        refresh_token: refreshed
            .refresh_token
            .filter(|token| !token.trim().is_empty())
            .unwrap_or_else(|| credentials.refresh_token.clone()),
        id_token: refreshed.id_token.or_else(|| credentials.id_token.clone()),
        account_id: credentials.account_id.clone(),
        last_refresh: Some(now_seconds()),
    })
}

/// Best-effort write-back so subsequent fetches (and the user's CLI)
/// see the new tokens. Failure is non-fatal — we already have a valid
/// in-memory credential, the next call will simply refresh again.
fn persist_refreshed_credentials(path: &Path, credentials: &CodexCredentials) -> Result<()> {
    let mut root: Value = match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    let map = root
        .as_object_mut()
        .ok_or_else(|| anyhow!("Codex auth.json root is not an object"))?;

    let mut tokens = map
        .get("tokens")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    tokens.insert(
        "access_token".to_string(),
        Value::String(credentials.access_token.clone()),
    );
    if !credentials.refresh_token.is_empty() {
        tokens.insert(
            "refresh_token".to_string(),
            Value::String(credentials.refresh_token.clone()),
        );
    }
    if let Some(id_token) = credentials.id_token.as_ref() {
        tokens.insert("id_token".to_string(), Value::String(id_token.clone()));
    }
    if let Some(account_id) = credentials.account_id.as_ref() {
        tokens.insert("account_id".to_string(), Value::String(account_id.clone()));
    }
    map.insert("tokens".to_string(), Value::Object(tokens));
    map.insert(
        "last_refresh".to_string(),
        Value::String(format_iso(now_seconds())),
    );

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create Codex auth dir {}", parent.display()))?;
    }
    let serialized = serde_json::to_vec_pretty(&root)?;
    std::fs::write(path, serialized)
        .with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

fn parse_iso_to_unix(raw: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|date| date.timestamp())
}

fn format_iso(unix_seconds: i64) -> String {
    DateTime::<Utc>::from_timestamp(unix_seconds, 0)
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn now_seconds() -> i64 {
    Utc::now().timestamp()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_codex_oauth_credentials() {
        let data = br#"{
            "tokens": {
                "access_token": "access",
                "refresh_token": "refresh",
                "id_token": "id",
                "account_id": "acct"
            },
            "last_refresh": "2026-04-25T06:30:00.000Z"
        }"#;
        let credentials = parse_credentials(data).unwrap();
        assert_eq!(credentials.access_token, "access");
        assert_eq!(credentials.refresh_token, "refresh");
        assert_eq!(credentials.account_id.as_deref(), Some("acct"));
        assert!(credentials.last_refresh.unwrap() > 0);
    }

    #[test]
    fn parses_api_key_only_credentials() {
        let data = br#"{ "OPENAI_API_KEY": "sk-test" }"#;
        let credentials = parse_credentials(data).unwrap();
        assert_eq!(credentials.access_token, "sk-test");
        assert!(credentials.refresh_token.is_empty());
    }

    #[test]
    fn rejects_credentials_without_tokens() {
        let data = br#"{ "tokens": {} }"#;
        assert!(parse_credentials(data).is_err());
    }

    #[test]
    fn needs_refresh_when_last_refresh_missing_or_old() {
        let now = 10_000_000;
        let stale = CodexCredentials {
            access_token: "a".to_string(),
            refresh_token: "r".to_string(),
            id_token: None,
            account_id: None,
            last_refresh: None,
        };
        assert!(stale.needs_refresh(now));

        let recent = CodexCredentials {
            last_refresh: Some(now - 60),
            ..stale.clone()
        };
        assert!(!recent.needs_refresh(now));

        let old = CodexCredentials {
            last_refresh: Some(now - REFRESH_AFTER_SECONDS - 1),
            ..stale
        };
        assert!(old.needs_refresh(now));
    }

    #[test]
    fn no_refresh_without_refresh_token() {
        let api_key_only = CodexCredentials {
            access_token: "sk".to_string(),
            refresh_token: String::new(),
            id_token: None,
            account_id: None,
            last_refresh: None,
        };
        assert!(!api_key_only.needs_refresh(10_000_000));
    }
}
