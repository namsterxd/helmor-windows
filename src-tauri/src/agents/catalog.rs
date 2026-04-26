use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelOption {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub cli_model: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effort_levels: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub supports_fast_mode: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentModelSectionStatus {
    Ready,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelSection {
    pub id: String,
    pub label: String,
    pub status: AgentModelSectionStatus,
    pub options: Vec<AgentModelOption>,
}

pub fn static_model_sections() -> Vec<AgentModelSection> {
    vec![
        AgentModelSection {
            id: "claude".to_string(),
            label: "Claude Code".to_string(),
            status: AgentModelSectionStatus::Ready,
            options: vec![
                claude_model(
                    "default",
                    "Opus 4.7 1M",
                    &["low", "medium", "high", "xhigh", "max"],
                    false,
                ),
                claude_model(
                    "claude-opus-4-6[1m]",
                    "Opus 4.6 1M",
                    &["low", "medium", "high", "max"],
                    true,
                ),
                claude_model("sonnet", "Sonnet", &["low", "medium", "high", "max"], false),
                claude_model("haiku", "Haiku", &[], false),
            ],
        },
        AgentModelSection {
            id: "codex".to_string(),
            label: "Codex".to_string(),
            status: AgentModelSectionStatus::Ready,
            options: vec![
                codex_model("gpt-5.5", "GPT-5.5"),
                codex_model("gpt-5.4", "GPT-5.4"),
                codex_model("gpt-5.4-mini", "GPT-5.4-Mini"),
                codex_model("gpt-5.3-codex", "GPT-5.3-Codex"),
                codex_model("gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark"),
                codex_model("gpt-5.2", "GPT-5.2"),
            ],
        },
    ]
}

fn claude_model(
    id: &str,
    label: &str,
    effort_levels: &[&str],
    supports_fast_mode: bool,
) -> AgentModelOption {
    AgentModelOption {
        id: id.to_string(),
        provider: "claude".to_string(),
        label: label.to_string(),
        cli_model: id.to_string(),
        effort_levels: effort_levels
            .iter()
            .map(|level| level.to_string())
            .collect(),
        supports_fast_mode,
    }
}

fn codex_model(id: &str, label: &str) -> AgentModelOption {
    AgentModelOption {
        id: id.to_string(),
        provider: "codex".to_string(),
        label: label.to_string(),
        cli_model: id.to_string(),
        effort_levels: ["low", "medium", "high", "xhigh"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        supports_fast_mode: true,
    }
}

/// Resolved model info needed by the streaming path.
#[derive(Debug, Clone)]
pub struct ResolvedModel {
    pub id: String,
    pub provider: String,
    pub cli_model: String,
}

/// Resolve a model ID to provider + cli_model. Provider is inferred from the
/// ID: `gpt-*` → codex, everything else → claude. The ID is passed through
/// as cli_model directly — the sidecar/SDK handles the actual mapping.
pub fn resolve_model(model_id: &str) -> ResolvedModel {
    let provider = if model_id.starts_with("gpt-") {
        "codex"
    } else {
        "claude"
    };
    ResolvedModel {
        id: model_id.to_string(),
        provider: provider.to_string(),
        cli_model: model_id.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_model_sections_returns_hardcoded_catalog() {
        let sections = static_model_sections();

        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].id, "claude");
        assert_eq!(sections[0].status, AgentModelSectionStatus::Ready);
        assert_eq!(
            sections[0]
                .options
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["default", "claude-opus-4-6[1m]", "sonnet", "haiku"]
        );
        assert!(sections[0]
            .options
            .iter()
            .any(|model| model.id == "claude-opus-4-6[1m]" && model.supports_fast_mode));

        assert_eq!(sections[1].id, "codex");
        assert_eq!(sections[1].status, AgentModelSectionStatus::Ready);
        assert_eq!(
            sections[1]
                .options
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "gpt-5.5",
                "gpt-5.4",
                "gpt-5.4-mini",
                "gpt-5.3-codex",
                "gpt-5.3-codex-spark",
                "gpt-5.2",
            ]
        );
        assert!(sections[1]
            .options
            .iter()
            .all(|model| model.supports_fast_mode));
    }

    #[test]
    fn resolve_claude_model() {
        let m = resolve_model("default");
        assert_eq!(m.provider, "claude");
        assert_eq!(m.cli_model, "default");
        assert_eq!(m.id, "default");
    }

    #[test]
    fn resolve_opus_model() {
        let m = resolve_model("opus");
        assert_eq!(m.provider, "claude");
        assert_eq!(m.cli_model, "opus");
    }

    #[test]
    fn resolve_sonnet_model() {
        let m = resolve_model("sonnet");
        assert_eq!(m.provider, "claude");
    }

    #[test]
    fn resolve_gpt_model_routes_to_codex() {
        let m = resolve_model("gpt-4o");
        assert_eq!(m.provider, "codex");
        assert_eq!(m.cli_model, "gpt-4o");
    }

    #[test]
    fn resolve_gpt_5_4_routes_to_codex() {
        let m = resolve_model("gpt-5.4");
        assert_eq!(m.provider, "codex");
    }

    #[test]
    fn resolve_unknown_model_defaults_to_claude() {
        let m = resolve_model("some-future-model");
        assert_eq!(m.provider, "claude");
        assert_eq!(m.cli_model, "some-future-model");
    }
}
