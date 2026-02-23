import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function fmt(bytes: number): string {
	return `${Math.round(bytes / 1024 / 1024)}MB`;
}

export default function memoryMonitor(pi: ExtensionAPI) {
	let interval: ReturnType<typeof setInterval> | null = null;

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		const update = () => {
			const { heapUsed, heapTotal, rss } = process.memoryUsage();
			ctx.ui.setStatus("mem", `heap ${fmt(heapUsed)}/${fmt(heapTotal)} · rss ${fmt(rss)}`);
		};

		update();
		interval = setInterval(update, 2000);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (interval !== null) {
			clearInterval(interval);
			interval = null;
		}
		if (ctx.hasUI) ctx.ui.setStatus("mem", undefined);
	});
}
