export type ShortcutId =
	| "workspace.previous"
	| "workspace.next"
	| "workspace.new"
	| "workspace.addRepository"
	| "workspace.copyPath"
	| "workspace.openInEditor"
	| "session.previous"
	| "session.next"
	| "session.new"
	| "session.close"
	| "session.reopenClosed"
	| "script.run"
	| "settings.open"
	| "theme.toggle"
	| "sidebar.left.toggle"
	| "sidebar.right.toggle"
	| "zen.toggle"
	| "zoom.in"
	| "zoom.out"
	| "zoom.reset"
	| "action.createPr"
	| "action.commitAndPush"
	| "action.pullLatest"
	| "action.mergePr"
	| "action.fixErrors"
	| "action.openPullRequest"
	| "composer.focus"
	| "composer.togglePlanMode"
	| "composer.openModelPicker";

export type ShortcutGroup =
	| "Navigation"
	| "Session"
	| "Workspace"
	| "Actions"
	| "System"
	| "Composer";

export type ShortcutScope = "global" | "conversation";

export type ShortcutDefinition = {
	id: ShortcutId;
	title: string;
	description?: string;
	group: ShortcutGroup;
	defaultHotkey: string | null;
	scope: ShortcutScope;
	editable: boolean;
};

export type ShortcutMap = Partial<Record<string, string | null>>;
