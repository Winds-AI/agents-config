/**
 * Verbalized Sampling Extension
 *
 * Based on Stanford's "Verbalized Sampling" research: instead of letting the
 * agent collapse to one answer, ask it to generate N diverse solution approaches
 * with probability/confidence estimates — then let the user pick the best one.
 *
 * Usage:
 *   /approaches 4 db schema      → propose 4 approaches for "db schema"
 *   /approaches db schema        → propose 3 approaches (default N)
 *   /approaches 2 auth strategy  → propose 2 approaches for "auth strategy"
 *
 * The command sends a one-shot message to the agent. No persistent mode,
 * no context injection between turns. Tools are always registered (stable
 * system prompt prefix = prompt cache never busted).
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	Key,
	Markdown,
	type MarkdownTheme,
	Text,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ─── Configuration ────────────────────────────────────────────────────────────

const MIN_APPROACHES = 2;
const MAX_APPROACHES = 5;
const DEFAULT_N = 3;
const CONF_BAR_WIDTH = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApproachDef {
	title: string;
	confidence: number;
	summary: string;
	pros: string[];
	cons: string[];
	details?: string;
}

interface ApproachResult {
	problem: string;
	approaches: ApproachDef[];
	selectedIndex: number | null;
	cancelled: boolean;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const ApproachSchema = Type.Object({
	title: Type.String({
		description: "Short, memorable approach name (3–6 words)",
	}),
	confidence: Type.Number({
		description:
			"Probability 0–100: how likely is this approach to produce the best outcome given all constraints? Be honest — not all approaches are equal.",
		minimum: 0,
		maximum: 100,
	}),
	summary: Type.String({
		description: "2–3 sentence description of what this approach does and why it might be chosen",
	}),
	pros: Type.Array(Type.String(), {
		description: "Concrete advantages of this approach (2–4 items)",
		minItems: 1,
		maxItems: 4,
	}),
	cons: Type.Array(Type.String(), {
		description: "Honest tradeoffs, risks, or limitations (1–3 items)",
		minItems: 0,
		maxItems: 3,
	}),
	details: Type.Optional(
		Type.String({
			description:
				"Optional: detailed markdown — implementation notes, code sketches, or architectural diagrams",
		}),
	),
});

const PresentApproachesParams = Type.Object({
	problem: Type.String({ description: "The topic or problem being explored" }),
	approaches: Type.Array(ApproachSchema, {
		description: `${MIN_APPROACHES}–${MAX_APPROACHES} genuinely diverse approaches with probability estimates. Explore the full space — not just variations of one idea.`,
		minItems: MIN_APPROACHES,
		maxItems: MAX_APPROACHES,
	}),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function confidenceBar(confidence: number): string {
	const filled = Math.round((confidence / 100) * CONF_BAR_WIDTH);
	return "█".repeat(filled) + "░".repeat(CONF_BAR_WIDTH - filled);
}

function confidenceColor(confidence: number): string {
	if (confidence >= 65) return "success";
	if (confidence >= 35) return "warning";
	return "muted";
}

function buildMarkdownTheme(theme: {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}): MarkdownTheme {
	return {
		heading: (t) => theme.fg("mdHeading", t),
		link: (t) => theme.fg("mdLink", t),
		linkUrl: (t) => theme.fg("mdLinkUrl", t),
		code: (t) => theme.fg("mdCode", t),
		codeBlock: (t) => theme.fg("mdCodeBlock", t),
		codeBlockBorder: (t) => theme.fg("mdCodeBlockBorder", t),
		quote: (t) => theme.fg("mdQuote", t),
		quoteBorder: (t) => theme.fg("mdQuoteBorder", t),
		hr: (t) => theme.fg("mdHr", t),
		listBullet: (t) => theme.fg("mdListBullet", t),
		bold: (t) => theme.bold(t),
		italic: (t) => t,
		strikethrough: (t) => t,
		underline: (t) => t,
	};
}

function renderSideBySide(
	leftLines: string[],
	rightLines: string[],
	leftWidth: number,
	rightWidth: number,
	dividerFn: (s: string) => string,
): string[] {
	const maxLen = Math.max(leftLines.length, rightLines.length);
	const result: string[] = [];
	for (let i = 0; i < maxLen; i++) {
		const left = leftLines[i] ?? "";
		const right = rightLines[i] ?? "";
		const leftPad = Math.max(0, leftWidth - visibleWidth(left));
		const rightPad = Math.max(0, rightWidth - visibleWidth(right));
		result.push(left + " ".repeat(leftPad) + dividerFn(" │ ") + right + " ".repeat(rightPad));
	}
	return result;
}

function buildDetailMarkdown(approach: ApproachDef): string {
	const lines: string[] = [];
	lines.push(`## ${approach.title}`);
	lines.push("");
	lines.push(approach.summary);
	lines.push("");
	if (approach.pros.length > 0) {
		lines.push("**Advantages**");
		for (const p of approach.pros) lines.push(`- ${p}`);
		lines.push("");
	}
	if (approach.cons.length > 0) {
		lines.push("**Tradeoffs**");
		for (const c of approach.cons) lines.push(`- ${c}`);
		lines.push("");
	}
	if (approach.details) {
		lines.push("---");
		lines.push("");
		lines.push(approach.details);
	}
	return lines.join("\n");
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function verbalizedSampling(pi: ExtensionAPI): void {
	// ── /approaches command ──────────────────────────────────────────────────
	// Parses: /approaches [n] <topic>
	//   n     — optional number (default 3, range 2–5)
	//   topic — everything else

	pi.registerCommand("approaches", {
		description: "Propose N approaches for a topic using verbalized sampling. Usage: /approaches [n] <topic>",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();

			if (!trimmed) {
				ctx.ui.notify(
					`Usage: /approaches [n] <topic>\nExample: /approaches 4 db schema`,
					"info",
				);
				return;
			}

			const parts = trimmed.split(/\s+/);
			const firstNum = parseInt(parts[0]!, 10);
			let n: number;
			let topic: string;

			if (!isNaN(firstNum)) {
				n = Math.min(Math.max(firstNum, MIN_APPROACHES), MAX_APPROACHES);
				topic = parts.slice(1).join(" ");
			} else {
				n = DEFAULT_N;
				topic = trimmed;
			}

			if (!topic) {
				ctx.ui.notify(
					`Usage: /approaches [n] <topic>\nExample: /approaches 4 db schema`,
					"info",
				);
				return;
			}

			pi.sendMessage(
				{
					customType: "verbalized-sampling-request",
					display: true,
					content: `Using verbalized sampling, propose exactly ${n} diverse approaches for: ${topic}.

For each approach provide:
- title: short memorable name (3–6 words)
- confidence: 0–100% — honest estimate of how likely this is the optimal approach
- summary: 2–3 sentences describing the approach and why it might be chosen
- pros: 2–4 concrete advantages
- cons: 1–3 honest tradeoffs or risks
- details: (optional) markdown with implementation notes or code sketches

Be genuinely diverse — explore the full space of valid approaches, not variations of one idea.
Confidence reflects relative likelihood of success; they don't need to sum to 100%.

Then call present_approaches with your ${n} approaches.`,
				},
				{ triggerTurn: true },
			);
		},
	});

	// ── present_approaches tool ──────────────────────────────────────────────

	pi.registerTool({
		name: "present_approaches",
		label: "Present Approaches",
		description: `Show the user a selection UI with ${MIN_APPROACHES}–${MAX_APPROACHES} solution approaches generated via verbalized sampling. Each approach has a confidence/probability estimate, pros, cons, and optional markdown details. The user picks one.`,
		parameters: PresentApproachesParams,

		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				const first = params.approaches[0];
				return {
					content: [
						{
							type: "text",
							text: `No UI — proceeding with: "${first?.title ?? "approach 1"}". Implement it now.`,
						},
					],
					details: {
						problem: params.problem,
						approaches: params.approaches,
						selectedIndex: 0,
						cancelled: false,
					} as ApproachResult,
				};
			}

			const approaches = params.approaches;

			const result = await ctx.ui.custom<ApproachResult>((tui, theme, _kb, done) => {
				let cursor = 0;
				let cachedLines: string[] | undefined;
				let cachedWidth: number | undefined;
				const mdCache = new Map<string, string[]>();
				const mdTheme = buildMarkdownTheme(theme);

				function refresh(): void {
					cachedLines = undefined;
					cachedWidth = undefined;
					tui.requestRender();
				}

				function handleInput(data: string): void {
					if (matchesKey(data, Key.up)) {
						cursor = Math.max(0, cursor - 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						cursor = Math.min(approaches.length - 1, cursor + 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.enter)) {
						done({ problem: params.problem, approaches, selectedIndex: cursor, cancelled: false });
						return;
					}
					if (matchesKey(data, Key.escape)) {
						done({ problem: params.problem, approaches, selectedIndex: null, cancelled: true });
						return;
					}
					const num = parseInt(data, 10);
					if (!isNaN(num) && num >= 1 && num <= approaches.length) {
						cursor = num - 1;
						done({ problem: params.problem, approaches, selectedIndex: cursor, cancelled: false });
					}
				}

				function buildLeftLines(leftWidth: number): string[] {
					const lines: string[] = [];
					const add = (s: string) => lines.push(truncateToWidth(s, leftWidth));

					for (let i = 0; i < approaches.length; i++) {
						const a = approaches[i];
						const isActive = i === cursor;
						const prefix = isActive ? theme.fg("accent", "> ") : "  ";
						const color = confidenceColor(a.confidence);
						const numStyled = isActive ? theme.fg("accent", `${i + 1}.`) : theme.fg("muted", `${i + 1}.`);
						const titleStyled = isActive
							? theme.fg("accent", theme.bold(a.title))
							: theme.fg("text", a.title);
						const bar = theme.fg(color, confidenceBar(a.confidence));
						const pct = theme.fg(color, `${a.confidence}%`.padStart(4));

						add(`${prefix}${numStyled} ${titleStyled}`);
						add(`     ${bar} ${pct}`);
						if (i < approaches.length - 1) lines.push("");
					}
					return lines;
				}

				function buildRightLines(rightWidth: number): string[] {
					const a = approaches[cursor];
					if (!a) return [];

					const cacheKey = `${cursor}:${rightWidth}`;
					const cached = mdCache.get(cacheKey);
					if (cached) return cached;

					const color = confidenceColor(a.confidence);
					const header: string[] = [
						theme.fg(color, ` ${confidenceBar(a.confidence)} ${a.confidence}% confidence`),
						"",
					];

					const md = new Markdown(buildDetailMarkdown(a), 1, 0, mdTheme);
					const rendered = [...header, ...md.render(rightWidth)];
					mdCache.set(cacheKey, rendered);
					return rendered;
				}

				function render(width: number): string[] {
					if (cachedLines && cachedWidth === width) return cachedLines;

					const lines: string[] = [];
					const add = (s: string) => lines.push(truncateToWidth(s, width));

					add(theme.fg("accent", "─".repeat(width)));
					add(theme.fg("accent", theme.bold("  ⚡ Choose an Approach")));
					add(theme.fg("muted", `  ${truncateToWidth(params.problem, width - 4)}`));
					lines.push("");

					const MIN_LEFT = 30;
					const leftWidth = Math.max(MIN_LEFT, Math.floor(width * 0.38));
					const rightWidth = Math.max(10, width - leftWidth - 3);

					const combined = renderSideBySide(
						buildLeftLines(leftWidth),
						buildRightLines(rightWidth),
						leftWidth,
						rightWidth,
						(s) => theme.fg("border", s),
					);
					for (const l of combined) add(l);

					lines.push("");
					add(theme.fg("dim", `  ↑↓ navigate • 1–${approaches.length} quick pick • Enter select • Esc cancel`));
					add(theme.fg("accent", "─".repeat(width)));

					cachedLines = lines;
					cachedWidth = width;
					return lines;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
						cachedWidth = undefined;
						mdCache.clear();
					},
					handleInput,
				};
			});

			if (result.cancelled || result.selectedIndex === null) {
				return {
					content: [{ type: "text", text: "User cancelled. Proceed with your best judgment." }],
					details: result,
				};
			}

			const chosen = params.approaches[result.selectedIndex];
			const parts = [
				`User selected: "${chosen.title}" (${chosen.confidence}% confidence)`,
				"",
				`Summary: ${chosen.summary}`,
			];
			if (chosen.details) parts.push("", "Implementation notes:", chosen.details);
			parts.push("", "Now proceed with this approach.");

			return {
				content: [{ type: "text", text: parts.join("\n") }],
				details: result,
			};
		},

		renderCall(args, theme) {
			const approaches = (args.approaches as ApproachDef[]) ?? [];
			const problem = (args.problem as string) ?? "";
			let text = theme.fg("toolTitle", theme.bold("present_approaches "));
			text += theme.fg("muted", `${approaches.length} `);
			text += theme.fg("dim", `"${truncateToWidth(problem, 50)}"`);
			for (const a of approaches) {
				const color = confidenceColor(a.confidence);
				text += `\n  ${theme.fg(color, confidenceBar(a.confidence))} ${theme.fg(color, `${a.confidence}%`)} ${theme.fg("dim", a.title)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _opts, theme) {
			const details = result.details as ApproachResult | undefined;
			if (!details || details.cancelled || details.selectedIndex === null) {
				return new Text(theme.fg("warning", "⚠ Cancelled"), 0, 0);
			}
			const chosen = details.approaches[details.selectedIndex];
			if (!chosen) return new Text(theme.fg("warning", "⚠ No selection"), 0, 0);
			const color = confidenceColor(chosen.confidence);
			let text = theme.fg("success", "✓ ") + theme.fg("accent", chosen.title);
			text += `  ${theme.fg(color, confidenceBar(chosen.confidence))} ${theme.fg(color, `${chosen.confidence}%`)}`;
			return new Text(text, 0, 0);
		},
	});
}
