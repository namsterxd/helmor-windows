pub struct BuiltinClaudeProvider {
    pub key: &'static str,
    pub name: &'static str,
    pub base_url: &'static str,
    pub models: &'static [BuiltinClaudeModel],
}

pub struct BuiltinClaudeModel {
    pub id: &'static str,
    pub label: &'static str,
}

pub const MINIMAX_MODELS: &[BuiltinClaudeModel] = &[BuiltinClaudeModel {
    id: "MiniMax-M2.7",
    label: "MiniMax M2.7",
}];

pub const BUILTIN_CLAUDE_PROVIDERS: &[BuiltinClaudeProvider] = &[
    BuiltinClaudeProvider {
        key: "minimax",
        name: "MiniMax",
        base_url: "https://api.minimax.io/anthropic",
        models: MINIMAX_MODELS,
    },
    BuiltinClaudeProvider {
        key: "minimax-cn",
        name: "MiniMax CN",
        base_url: "https://api.minimaxi.com/anthropic",
        models: MINIMAX_MODELS,
    },
    BuiltinClaudeProvider {
        key: "moonshot",
        name: "Moonshot / Kimi",
        base_url: "https://api.moonshot.ai/anthropic",
        models: &[BuiltinClaudeModel {
            id: "kimi-k2.5",
            label: "Kimi K2.5",
        }],
    },
    BuiltinClaudeProvider {
        key: "moonshot-cn",
        name: "Moonshot / Kimi CN",
        base_url: "https://api.moonshot.cn/anthropic",
        models: &[BuiltinClaudeModel {
            id: "kimi-k2.5",
            label: "Kimi K2.5",
        }],
    },
    BuiltinClaudeProvider {
        key: "zai",
        name: "Z.AI / GLM",
        base_url: "https://api.z.ai/api/anthropic",
        models: &[BuiltinClaudeModel {
            id: "glm-4.7",
            label: "GLM 4.7",
        }],
    },
    BuiltinClaudeProvider {
        key: "zai-cn",
        name: "Z.AI / GLM CN",
        base_url: "https://open.bigmodel.cn/api/anthropic",
        models: &[BuiltinClaudeModel {
            id: "glm-5.1",
            label: "GLM 5.1",
        }],
    },
    BuiltinClaudeProvider {
        key: "qwen",
        name: "Qwen / DashScope",
        base_url: "https://dashscope.aliyuncs.com/apps/anthropic",
        models: &[BuiltinClaudeModel {
            id: "qwen3.6-plus",
            label: "Qwen 3.6 Plus",
        }],
    },
    BuiltinClaudeProvider {
        key: "qwen-intl",
        name: "Qwen / DashScope Intl",
        base_url: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
        models: &[BuiltinClaudeModel {
            id: "qwen3.5-plus",
            label: "Qwen 3.5 Plus",
        }],
    },
    BuiltinClaudeProvider {
        key: "xiaomi",
        name: "Xiaomi MiMo",
        base_url: "https://api.xiaomimimo.com/anthropic",
        models: &[BuiltinClaudeModel {
            id: "mimo-v2-flash",
            label: "MiMo V2 Flash",
        }],
    },
];
