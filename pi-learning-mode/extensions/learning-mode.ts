import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(extensionDir);
const booksDir = join(packageDir, "books");

const LEARNING_TOOLS = ["read", "bash", "grep", "find", "ls", "learn_book_search"];
const FALLBACK_TOOLS = ["read", "bash", "edit", "write"];
const STATE_ENTRY_TYPE = "learning-mode-state";

type LearningLevel = "fresh-start" | "some-exposure" | "brushing-up";

interface LearningState {
	enabled: boolean;
	topic: string | null;
	level: LearningLevel | null;
	related: string | null;
	conceptCount: number;
	toneStyle: string | null;
	lastUpdated: string;
}

interface BookHit {
	book: string;
	line: number;
	text: string;
}

function nowIso(): string {
	return new Date().toISOString();
}

function defaultState(): LearningState {
	return {
		enabled: false,
		topic: null,
		level: null,
		related: null,
		conceptCount: 0,
		toneStyle: null,
		lastUpdated: nowIso(),
	};
}

function isLearningLevel(value: string): value is LearningLevel {
	return value === "fresh-start" || value === "some-exposure" || value === "brushing-up";
}

function getAssistantText(message: AgentMessage): string {
	if (message.role !== "assistant" || !Array.isArray(message.content)) {
		return "";
	}

	return message.content
		.filter((content): content is { type: "text"; text: string } => content.type === "text")
		.map((content) => content.text)
		.join("\n")
		.trim();
}

function unique(items: string[]): string[] {
	return Array.from(new Set(items));
}

function listMarkdownFiles(baseDir: string): string[] {
	if (!existsSync(baseDir)) {
		return [];
	}

	const result: string[] = [];
	const queue: string[] = [baseDir];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) continue;

		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const fullPath = join(current, entry.name);
			if (entry.isDirectory()) {
				queue.push(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;
			if (entry.name.endsWith(".md")) {
				result.push(fullPath);
			}
		}
	}

	return result.sort();
}

function searchBooks(query: string, onlyBook: string | undefined, maxHits: number): BookHit[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return [];

	const files = listMarkdownFiles(booksDir).filter((filePath) => {
		if (!onlyBook) return true;
		const base = filePath.toLowerCase();
		return base.includes(onlyBook.toLowerCase());
	});

	const hits: BookHit[] = [];
	for (const filePath of files) {
		if (hits.length >= maxHits) break;

		let content = "";
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const lines = content.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			if (hits.length >= maxHits) break;
			const line = lines[i];
			if (!line.toLowerCase().includes(normalizedQuery)) continue;
			hits.push({
				book: filePath,
				line: i + 1,
				text: line.trim().slice(0, 240),
			});
		}
	}

	return hits;
}

function buildTeachingPrompt(state: LearningState): string {
	const levelGuidance =
		state.level === "fresh-start"
			? "Learner is a beginner. Include context, explain why each piece matters, and avoid jargon dumps."
			: state.level === "some-exposure"
				? "Learner has some exposure. Keep foundations concise, then focus on differences, pitfalls, and practice."
				: state.level === "brushing-up"
					? "Learner is brushing up. Be concise, emphasize updates, tradeoffs, and high-value reminders."
					: "Learner level is unknown. Quickly calibrate in one sentence before deep explanation.";

	return [
		"You are in Learning Mode.",
		"Primary objective: teach the user effectively, not execute tasks by default.",
		"",
		"Required teaching rubric:",
		"1. One concept per response.",
		"2. Use this sequence when relevant: Hook -> Before -> Pain -> Solution -> Jargon map -> Difference -> (optional) real-life example -> Thinking prompt -> 2-3 next choices.",
		"3. Start with the smallest working snippet, then explain labeled parts.",
		"4. First-use jargon format: plain phrase (official term).",
		"5. If a prerequisite is missing, offer a choice and do not force:",
		"   - bridge_session_only: quick bridge now, then return.",
		"   - separate_path_first: do prerequisite path first.",
		"6. Verify understanding before advancing. If unclear, ask a short follow-up.",
		"7. Keep tone interactive and concise. No long lecture blocks.",
		"8. If user asks for direct implementation/execution, comply but keep a teaching frame and explain decisions.",
		"",
		`Learner topic: ${state.topic ?? "not set"}`,
		`Learner level: ${state.level ?? "not set"}`,
		`Related known context: ${state.related ?? "not set"}`,
		`Concepts covered this session: ${state.conceptCount}`,
		levelGuidance,
	].join("\n");
}

export default function learningMode(pi: ExtensionAPI): void {
	let state: LearningState = defaultState();
	let toolsBeforeLearningMode: string[] | null = null;

	function persistState(): void {
		state.lastUpdated = nowIso();
		pi.appendEntry(STATE_ENTRY_TYPE, { ...state });
	}

	function renderStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		if (!state.enabled) {
			ctx.ui.setStatus("learning-mode", undefined);
			ctx.ui.setWidget("learning-mode", undefined);
			return;
		}

		const topic = state.topic ?? "no-topic";
		const level = state.level ?? "unset";
		ctx.ui.setStatus("learning-mode", ctx.ui.theme.fg("accent", `learn:${topic} (${level})`));
		ctx.ui.setWidget("learning-mode", [
			ctx.ui.theme.fg("muted", "Learning Mode Active"),
			`topic: ${topic}`,
			`level: ${level}`,
			`concepts: ${state.conceptCount}`,
		]);
	}

	function applyMode(ctx: ExtensionContext): void {
		if (state.enabled) {
			if (toolsBeforeLearningMode === null) {
				toolsBeforeLearningMode = pi.getActiveTools();
			}
			const nextTools = unique([...LEARNING_TOOLS]);
			pi.setActiveTools(nextTools);
		} else {
			const restored = toolsBeforeLearningMode && toolsBeforeLearningMode.length > 0
				? toolsBeforeLearningMode
				: FALLBACK_TOOLS;
			pi.setActiveTools(restored);
			toolsBeforeLearningMode = null;
		}
		renderStatus(ctx);
	}

	function restoreStateFromSession(ctx: ExtensionContext): void {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as { type: string; customType?: string; data?: Partial<LearningState> };
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE || !entry.data) {
				continue;
			}
			state = {
				...defaultState(),
				...entry.data,
				lastUpdated: typeof entry.data.lastUpdated === "string" ? entry.data.lastUpdated : nowIso(),
			};
			break;
		}
	}

	function parseLearnCommand(rawArgs: string, ctx: ExtensionContext): string {
		const args = rawArgs.trim();
		if (!args) {
			state.enabled = true;
			applyMode(ctx);
			persistState();
			if (!state.topic) {
				pi.sendUserMessage(
					"I want to start learning mode. Ask me these onboarding questions one by one: (1) what I want to learn, (2) my level [fresh-start/some-exposure/brushing-up], (3) what related things I already know. Then start teaching.",
				);
				return "Learning mode enabled. Starting onboarding.";
			}
			return [
				"Learning mode enabled.",
				`topic: ${state.topic}`,
			].join("\n");
		}

		const [action, ...rest] = args.split(/\s+/);
		const payload = rest.join(" ").trim();

		switch (action) {
			case "on":
				state.enabled = true;
				applyMode(ctx);
				persistState();
				return "Learning mode enabled.";
			case "off":
				state.enabled = false;
				applyMode(ctx);
				persistState();
				return "Learning mode disabled.";
			case "status":
				return [
					`enabled: ${state.enabled}`,
					`topic: ${state.topic ?? "unset"}`,
					`level: ${state.level ?? "unset"}`,
					`related: ${state.related ?? "unset"}`,
					`conceptCount: ${state.conceptCount}`,
				].join("\n");
			case "topic":
				if (!payload) return "Missing topic. Example: /learn TypeScript";
				state.topic = payload;
				persistState();
				renderStatus(ctx);
				return `Learning topic set to: ${payload}`;
			case "related":
				if (!payload) return "Missing related context. Example: /learn related JavaScript and Node.js";
				state.related = payload;
				persistState();
				return "Related context updated.";
			case "level":
				if (!payload || !isLearningLevel(payload)) {
					return "Invalid level. Use: fresh-start | some-exposure | brushing-up";
				}
				state.level = payload;
				persistState();
				renderStatus(ctx);
				return `Learning level set to: ${payload}`;
			case "reset":
				state = defaultState();
				applyMode(ctx);
				persistState();
				return "Learning profile reset.";
			case "start":
				if (!payload) return "Missing topic. Example: /learn Python generators";
				state.enabled = true;
				state.topic = payload;
				applyMode(ctx);
				persistState();
				pi.sendUserMessage(`Teach me ${payload}. Start with the foundations and ask one quick understanding check at the end.`);
				return `Started guided learning for: ${payload}`;
			default:
				state.enabled = true;
				state.topic = args;
				applyMode(ctx);
				persistState();
				pi.sendUserMessage(`Teach me ${args}. Start with foundations and keep one concept per response.`);
				return `Learning mode enabled. Topic: ${args}`;
		}
	}

	pi.registerFlag("learn-mode", {
		description: "Start in learning mode (teaching-first behavior)",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("learn", {
		description: "Alias for --learn-mode (start in learning mode)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("learn", {
		description: "Enable learning mode (optionally provide a topic)",
		handler: async (args, ctx) => {
			const message = parseLearnCommand(args, ctx);
			ctx.ui.notify(message, "info");
		},
	});

	pi.registerTool({
		name: "learn_book_search",
		label: "Learning Book Search",
		description:
			"Search built-in learning reference books bundled with learning mode. Use this for teaching structure, learning rubrics, and study flow guidance.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query for learning references" }),
			book: Type.Optional(Type.String({ description: "Optional book filter (partial filename)" })),
			maxHits: Type.Optional(Type.Number({ description: "Maximum number of hits to return (1-20)", minimum: 1, maximum: 20 })),
		}),
		async execute(_toolCallId, params) {
			const maxHits = Math.max(1, Math.min(20, Math.floor(params.maxHits ?? 8)));
			const hits = searchBooks(params.query, params.book, maxHits);
			if (hits.length === 0) {
				return {
					content: [{ type: "text", text: `No learning-book matches found for: ${params.query}` }],
					details: { hits },
				};
			}

			const lines = hits.map((hit, index) => {
				const rel = hit.book.startsWith(packageDir) ? hit.book.slice(packageDir.length + 1) : hit.book;
				return `${index + 1}. ${rel}:${hit.line}\n   ${hit.text}`;
			});

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { hits },
			};
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreStateFromSession(ctx);
		if (pi.getFlag("learn-mode") === true || pi.getFlag("learn") === true) {
			state.enabled = true;
		}
		applyMode(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.enabled) return;

		const teachingBlock = buildTeachingPrompt(state);
		return {
			systemPrompt: `${event.systemPrompt}\n\n# Learning Mode Instructions\n${teachingBlock}`,
			message: {
				customType: "learning-mode-context",
				display: false,
				content: [
					"Learning profile:",
					`topic=${state.topic ?? "unset"}`,
					`level=${state.level ?? "unset"}`,
					`related=${state.related ?? "unset"}`,
					`conceptCount=${state.conceptCount}`,
				].join("\n"),
			},
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!state.enabled) return;

		const lastAssistant = [...event.messages].reverse().find((message) => message.role === "assistant");
		if (!lastAssistant) return;

		const text = getAssistantText(lastAssistant);
		if (!text) return;

		state.conceptCount += 1;
		persistState();
		renderStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("learning-mode", undefined);
		ctx.ui.setWidget("learning-mode", undefined);
	});
}
