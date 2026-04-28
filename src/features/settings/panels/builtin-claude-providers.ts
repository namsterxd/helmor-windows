export type BuiltinClaudeProviderKey =
	| "minimax"
	| "minimax-cn"
	| "moonshot"
	| "moonshot-cn"
	| "zai"
	| "zai-cn"
	| "qwen"
	| "qwen-intl"
	| "xiaomi";

export type BuiltinClaudeProvider = {
	key: BuiltinClaudeProviderKey;
	label: string;
	baseUrl: string;
	apiKeyUrl: string;
	models: readonly string[];
	icon: "minimax" | "moonshot" | "zhipu" | "qwen" | "xiaomi";
};

export const BUILTIN_CLAUDE_PROVIDERS: readonly BuiltinClaudeProvider[] = [
	{
		key: "minimax",
		label: "MiniMax",
		baseUrl: "https://api.minimax.io/anthropic",
		apiKeyUrl:
			"https://platform.minimax.io/user-center/basic-information/interface-key",
		models: ["MiniMax-M2.7"],
		icon: "minimax",
	},
	{
		key: "minimax-cn",
		label: "MiniMax CN",
		baseUrl: "https://api.minimaxi.com/anthropic",
		apiKeyUrl:
			"https://platform.minimaxi.com/user-center/basic-information/interface-key",
		models: ["MiniMax-M2.7"],
		icon: "minimax",
	},
	{
		key: "moonshot",
		label: "Moonshot / Kimi",
		baseUrl: "https://api.moonshot.ai/anthropic",
		apiKeyUrl: "https://platform.kimi.ai/console/api-keys",
		models: ["kimi-k2.5"],
		icon: "moonshot",
	},
	{
		key: "moonshot-cn",
		label: "Moonshot / Kimi CN",
		baseUrl: "https://api.moonshot.cn/anthropic",
		apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
		models: ["kimi-k2.5"],
		icon: "moonshot",
	},
	{
		key: "zai",
		label: "Z.AI / GLM",
		baseUrl: "https://api.z.ai/api/anthropic",
		apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
		models: ["glm-4.7"],
		icon: "zhipu",
	},
	{
		key: "zai-cn",
		label: "Z.AI / GLM CN",
		baseUrl: "https://open.bigmodel.cn/api/anthropic",
		apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
		models: ["glm-5.1"],
		icon: "zhipu",
	},
	{
		key: "qwen",
		label: "Qwen / DashScope",
		baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
		apiKeyUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
		models: ["qwen3.6-plus"],
		icon: "qwen",
	},
	{
		key: "qwen-intl",
		label: "Qwen / DashScope Intl",
		baseUrl: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
		apiKeyUrl: "https://bailian.console.alibabacloud.com/?tab=model#/api-key",
		models: ["qwen3.5-plus"],
		icon: "qwen",
	},
	{
		key: "xiaomi",
		label: "Xiaomi MiMo",
		baseUrl: "https://api.xiaomimimo.com/anthropic",
		apiKeyUrl: "https://platform.xiaomimimo.com/#/console/api-keys",
		models: ["mimo-v2-flash"],
		icon: "xiaomi",
	},
];

export function findBuiltinClaudeProvider(key: BuiltinClaudeProviderKey) {
	return BUILTIN_CLAUDE_PROVIDERS.find((provider) => provider.key === key);
}
