import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function commandApprovalGate(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!ctx.hasUI) {
			return { block: true, reason: "Blocked: interactive approval is required for tool calls" };
		}

		const inputJson = JSON.stringify(event.input, null, 2);
		const choice = await ctx.ui.select(
			`Tool approval required:\n\n${event.toolName}\n\n${inputJson}`,
			["yes", "no", "type something"],
		);
		if (choice === "yes") return undefined;

		if (choice === "type something") {
			const userText = (await ctx.ui.input("Type your follow-up", "question, suggestion, or instruction"))?.trim();
			if (!userText) {
				return { block: true, reason: "Blocked by user: no follow-up text provided" };
			}

			const toolSummary = `${event.toolName} ${inputJson}`.replace(/\s+/g, " ").trim();
			const contextMessage = `User rejected tool call (${toolSummary}) and said: ${userText}`;
			await pi.sendUserMessage(contextMessage, { deliverAs: "steer" });

			return { block: true, reason: "Blocked original tool call; sent user follow-up as steering message" };
		}

		return { block: true, reason: "Blocked by user" };
	});
}
