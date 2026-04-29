export function isMac(): boolean {
	if (typeof navigator === "undefined") {
		return false;
	}
	const platform = navigator.platform.toLowerCase();
	const userAgent = navigator.userAgent.toLowerCase();
	return platform.includes("mac") || userAgent.includes("mac os");
}

export function isWindows(): boolean {
	if (typeof navigator === "undefined") {
		return false;
	}
	const platform = navigator.platform.toLowerCase();
	const userAgent = navigator.userAgent.toLowerCase();
	return platform.includes("win") || userAgent.includes("windows");
}
