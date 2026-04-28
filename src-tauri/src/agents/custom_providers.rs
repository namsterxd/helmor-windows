use std::collections::HashMap;

use serde::{Deserialize, Serialize};

const SETTINGS_KEY: &str = "app.claude_custom_providers";
const MODEL_ID_PREFIX: &str = "claude-custom|";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCustomProviderSettings {
    #[serde(default)]
    pub minimax_api_key: String,
    #[serde(default)]
    pub minimax_cn_api_key: String,
    #[serde(default)]
    pub builtin_provider_api_keys: HashMap<String, String>,
    #[serde(default)]
    pub custom_provider_name: String,
    #[serde(default)]
    pub custom_base_url: String,
    #[serde(default)]
    pub custom_api_key: String,
    #[serde(default)]
    pub custom_models: String,
}

#[derive(Debug, Clone)]
pub struct ClaudeProviderModel {
    pub id: String,
    pub provider_key: String,
    pub provider_name: String,
    pub label: String,
    pub cli_model: String,
    pub base_url: String,
    pub api_key: String,
}

pub fn load_settings() -> ClaudeCustomProviderSettings {
    crate::settings::load_setting_json::<ClaudeCustomProviderSettings>(SETTINGS_KEY)
        .ok()
        .flatten()
        .unwrap_or_default()
}

pub fn configured_models() -> Vec<ClaudeProviderModel> {
    let settings = load_settings();
    let mut models = Vec::new();

    for provider in super::builtin_claude_providers::BUILTIN_CLAUDE_PROVIDERS {
        append_builtin_models(
            &mut models,
            provider.key,
            builtin_api_key(&settings, provider.key).trim(),
        );
    }

    let provider_name = settings.custom_provider_name.trim();
    let base_url = settings.custom_base_url.trim();
    let api_key = settings.custom_api_key.trim();
    if !provider_name.is_empty() && !base_url.is_empty() && !api_key.is_empty() {
        for model in parse_models(&settings.custom_models) {
            models.push(ClaudeProviderModel {
                id: model_id("custom", &model),
                provider_key: "custom".to_string(),
                provider_name: provider_name.to_string(),
                label: model.clone(),
                cli_model: model,
                base_url: base_url.to_string(),
                api_key: api_key.to_string(),
            });
        }
    }

    models
}

fn builtin_api_key(settings: &ClaudeCustomProviderSettings, provider_key: &str) -> String {
    settings
        .builtin_provider_api_keys
        .get(provider_key)
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| match provider_key {
            "minimax" => settings.minimax_api_key.clone(),
            "minimax-cn" => settings.minimax_cn_api_key.clone(),
            _ => String::new(),
        })
}

fn append_builtin_models(models: &mut Vec<ClaudeProviderModel>, provider_key: &str, api_key: &str) {
    if api_key.is_empty() {
        return;
    }

    let Some(provider) = super::builtin_claude_providers::BUILTIN_CLAUDE_PROVIDERS
        .iter()
        .find(|provider| provider.key == provider_key)
    else {
        return;
    };

    for model in provider.models {
        models.push(ClaudeProviderModel {
            id: model_id(provider.key, model.id),
            provider_key: provider.key.to_string(),
            provider_name: provider.name.to_string(),
            label: model.label.to_string(),
            cli_model: model.id.to_string(),
            base_url: provider.base_url.to_string(),
            api_key: api_key.to_string(),
        });
    }
}

pub fn resolve(model_id: &str) -> Option<ClaudeProviderModel> {
    configured_models()
        .into_iter()
        .find(|model| model.id == model_id)
}

fn model_id(provider_key: &str, model: &str) -> String {
    format!("{MODEL_ID_PREFIX}{provider_key}|{model}")
}

fn parse_models(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    for item in raw.split([',', '\n', ';']) {
        let model = item.trim();
        if model.is_empty() || model.contains('|') || out.iter().any(|m| m == model) {
            continue;
        }
        out.push(model.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_list() {
        assert_eq!(
            parse_models("a, b\nc; a | bad"),
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn deserializes_minimax_region_keys() {
        let settings: ClaudeCustomProviderSettings =
            serde_json::from_str(r#"{"minimaxApiKey":"global-key","minimaxCnApiKey":"cn-key"}"#)
                .unwrap();

        assert_eq!(settings.minimax_api_key, "global-key");
        assert_eq!(settings.minimax_cn_api_key, "cn-key");
    }

    #[test]
    fn builtin_api_key_prefers_generic_map() {
        let settings: ClaudeCustomProviderSettings = serde_json::from_str(
            r#"{"minimaxApiKey":"legacy","builtinProviderApiKeys":{"minimax":"mapped"}}"#,
        )
        .unwrap();

        assert_eq!(builtin_api_key(&settings, "minimax"), "mapped");
    }
}
