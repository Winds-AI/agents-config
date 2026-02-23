/**
 * Ask User Question Tool — rich clarifying-question UI for the AI agent.
 *
 * Features:
 *   • Configurable question count with tab-bar navigation
 *   • Single-select and multi-select modes
 *   • Recommended option badges with reasons
 *   • Markdown preview (side-by-side) with recommendedReason fallback
 *   • Free-text "Type something" fallback with inline editor
 *   • Number key shortcuts (1–N), including the auto-added custom-input option
 *   • Optional auto-submit timeout with recommended-option selection
 *   • Configurable via constants at top of file
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, Markdown, type MarkdownTheme, matchesKey, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ============================================================================
// Configuration
// ============================================================================

/** Maximum number of questions per invocation. Set to 0 to disable the tool. */
const MAX_QUESTIONS: number = 10;

/** Maximum number of options the agent can provide per question. */
const MAX_OPTIONS: number = 4;

/**
 * Auto-submit timeout in seconds.
 *   null  — no timer; user must answer manually (default)
 *   0     — skip all questions immediately without showing UI
 *   N > 0 — show countdown; on expiry select each question's recommended option,
 *            or skip questions that have no recommended option
 */
const DEFAULT_TIMEOUT_SECONDS: number | null = 10; // combined timeout for all questions

/**
 * Prompt copy templates (quick-edit zone).
 * Keep these prompts explicit about:
 *   1) {MAX_QUESTIONS} limits
 *   2) {MAX_OPTIONS} limits
 *   3) "Type something." being auto-added by the UI (agent must NOT add Other/Type something options)
 */
const PROMPT_COPY = {
	toolDescription:
		"Ask the user one or more clarifying questions with rich options. You can ask 1-{MAX_QUESTIONS} questions in one call, and each question must provide 1-{MAX_OPTIONS} options. Supports recommended badges, markdown previews for visual comparison, multi-select, and free-text input. Use when you need user input or preferences to proceed.",
	optionsDescription:
		"Available options (1-{MAX_OPTIONS}). Do not include an 'Other' or 'Type something' option because the UI automatically appends 'Type something.' as an extra final option.",
	questionsDescription: "Questions to ask the user (1-{MAX_QUESTIONS})",
};

function withPromptVars(template: string): string {
	return template
		.replaceAll("{MAX_QUESTIONS}", String(MAX_QUESTIONS))
		.replaceAll("{MAX_OPTIONS}", String(MAX_OPTIONS));
}

// ============================================================================
// Types
// ============================================================================

interface OptionDef {
	label: string;
	description?: string;
	recommended?: boolean;
	recommendedReason?: string;
	preview?: string;
}

interface QuestionDef {
	id: string;
	label?: string;
	question: string;
	options: OptionDef[];
	multiSelect?: boolean;
}

type DisplayOption = OptionDef & { isOther?: boolean };

interface Answer {
	id: string;
	selections: { label: string; index: number; wasCustom: boolean }[];
}

interface AskResult {
	questions: QuestionDef[];
	answers: Answer[];
	cancelled: boolean;
	timedOut: boolean;
}

// ============================================================================
// Schema
// ============================================================================

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Description shown below label" })),
	recommended: Type.Optional(Type.Boolean({ description: "Mark as the recommended option" })),
	recommendedReason: Type.Optional(Type.String({ description: "Why this option is recommended" })),
	preview: Type.Optional(Type.String({ description: "Markdown content shown in side-by-side preview" })),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question" }),
	label: Type.Optional(Type.String({ description: "Short tab-bar label (defaults to Q1, Q2…)" })),
	question: Type.String({ description: "Full question text to display" }),
	options: Type.Array(OptionSchema, {
		description: withPromptVars(PROMPT_COPY.optionsDescription),
		minItems: 1,
		maxItems: MAX_OPTIONS,
	}),
	multiSelect: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options (default: false)" })),
});

const AskUserQuestionParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		description: withPromptVars(PROMPT_COPY.questionsDescription),
		minItems: 1,
		maxItems: MAX_QUESTIONS,
	}),
});

// ============================================================================
// Helpers
// ============================================================================

function buildMarkdownTheme(theme: { fg: (color: string, text: string) => string; bold: (text: string) => string }): MarkdownTheme {
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

/** Render left and right panels side-by-side, separated by a │ divider. */
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

// ============================================================================
// Extension
// ============================================================================

export default function askUserQuestion(pi: ExtensionAPI) {
	if (MAX_QUESTIONS === 0) return;

	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description: withPromptVars(PROMPT_COPY.toolDescription),
		parameters: AskUserQuestionParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
					details: { questions: params.questions, answers: [], cancelled: true } as AskResult,
				};
			}

			if (params.questions.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No questions provided" }],
					details: { questions: [], answers: [], cancelled: true } as AskResult,
				};
			}

			// Normalize
			const questions: QuestionDef[] = params.questions.map((q, i) => ({
				...q,
				label: q.label || `Q${i + 1}`,
				multiSelect: q.multiSelect === true,
			}));

			// Timeout === 0: skip all questions immediately without showing UI
			if (DEFAULT_TIMEOUT_SECONDS === 0) {
				const autoAnswers: Answer[] = questions.map((q) => ({
					id: q.id,
					selections: [{ label: "user chose to skip this question", index: -1, wasCustom: false }],
				}));
				const autoResult: AskResult = { questions, answers: autoAnswers, cancelled: false, timedOut: true };
				const answerLines = autoAnswers.map((a) => {
					const q = questions.find((x) => x.id === a.id)!;
					const sels = a.selections.map((s) => {
						if (s.wasCustom) return `user wrote: ${s.label}`;
						if (s.index === -1) return s.label;
						return `${s.index}. ${s.label}`;
					}).join(", ");
					return `${q.label}: ${sels}`;
				});
				return {
					content: [{ type: "text", text: "[Timed out — all questions skipped immediately (timeout=0).]\n\n" + answerLines.join("\n") }],
					details: autoResult,
				};
			}

			const isMulti = questions.length > 1;
			const totalTabs = questions.length + (isMulti ? 1 : 0); // +1 for Submit tab

			// Pre-compute per-question derived data (never changes during the session)
			const questionDisplayOptions: DisplayOption[][] = questions.map((q) => [
				...q.options,
				{ label: "Type something.", isOther: true },
			]);
			const questionHasPreview: boolean[] = questions.map((q) => q.options.some((o) => o.preview));

			const result = await ctx.ui.custom<AskResult>((tui, theme, _kb, done) => {
				// ── state ──────────────────────────────────────────────
				let currentTab = 0;
				const optionCursors: number[] = questions.map((q) => {
					const recIdx = q.options.findIndex((o) => o.recommended);
					return recIdx >= 0 ? recIdx : 0;
				});
				const selectedSets: Set<number>[] = questions.map(() => new Set<number>());
				const answers = new Map<string, Answer>();
				let inputMode = false;
				let inputQuestionId: string | null = null;
				let cachedLines: string[] | undefined;
				let cachedWidth: number | undefined;
				const markdownCache = new Map<string, string[]>();

				// ── timeout state ──────────────────────────────────────
				let timeoutRemaining: number | null = DEFAULT_TIMEOUT_SECONDS;
				let timerInterval: ReturnType<typeof setInterval> | null = null;

				const editorTheme: EditorTheme = {
					borderColor: (s) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (t) => theme.fg("accent", t),
						selectedText: (t) => theme.fg("accent", t),
						description: (t) => theme.fg("muted", t),
						scrollInfo: (t) => theme.fg("dim", t),
						noMatch: (t) => theme.fg("warning", t),
					},
				};
				const editor = new Editor(tui, editorTheme);

				const mdTheme = buildMarkdownTheme(theme);

				// ── helpers ────────────────────────────────────────────
				function refresh() {
					cachedLines = undefined;
					cachedWidth = undefined;
					tui.requestRender();
				}

				function submit(cancelled: boolean, timedOut = false) {
					if (timerInterval !== null) {
						clearInterval(timerInterval);
						timerInterval = null;
					}
					markdownCache.clear();
					done({ questions, answers: Array.from(answers.values()), cancelled, timedOut });
				}

				function currentQuestion(): QuestionDef | undefined {
					if (isMulti && currentTab === questions.length) return undefined;
					return questions[currentTab];
				}

				function allAnswered(): boolean {
					return questions.every((q) => answers.has(q.id));
				}

				function advanceAfterAnswer() {
					if (!isMulti) {
						submit(false);
						return;
					}
					if (currentTab < questions.length - 1) {
						currentTab++;
					} else {
						currentTab = questions.length; // Submit tab
					}
					refresh();
				}

				function saveAnswer(q: QuestionDef, selections: Answer["selections"]) {
					answers.set(q.id, { id: q.id, selections });
				}

				// ── timer ──────────────────────────────────────────────
				if (timeoutRemaining !== null && timeoutRemaining > 0) {
					timerInterval = setInterval(() => {
						timeoutRemaining!--;
						if (timeoutRemaining! <= 0) {
							clearInterval(timerInterval!);
							timerInterval = null;
							for (const q of questions) {
								if (!answers.has(q.id)) {
									const recIdx = q.options.findIndex((o) => o.recommended);
									if (recIdx >= 0) {
										answers.set(q.id, { id: q.id, selections: [{ label: q.options[recIdx].label, index: recIdx + 1, wasCustom: false }] });
									} else {
										answers.set(q.id, { id: q.id, selections: [{ label: "user chose to skip this question", index: -1, wasCustom: false }] });
									}
								}
							}
							submit(false, true);
						} else {
							refresh();
						}
					}, 1000);
				}

				// ── editor submit ──────────────────────────────────────
				editor.onSubmit = (value) => {
					if (!inputQuestionId) return;
					const qIndex = questions.findIndex((x) => x.id === inputQuestionId);
					if (qIndex < 0) return;
					const q = questions[qIndex];
					const trimmed = value.trim() || "(no response)";

					if (q.multiSelect) {
						const set = selectedSets[qIndex];
						const sels: Answer["selections"] = [];
						for (const idx of Array.from(set).sort((a, b) => a - b)) {
							const o = q.options[idx];
							if (o) sels.push({ label: o.label, index: idx + 1, wasCustom: false });
						}
						sels.push({ label: trimmed, index: -1, wasCustom: true });
						saveAnswer(q, sels);
					} else {
						saveAnswer(q, [{ label: trimmed, index: -1, wasCustom: true }]);
					}

					inputMode = false;
					inputQuestionId = null;
					editor.setText("");
					advanceAfterAnswer();
				};

				// ── input ──────────────────────────────────────────────
				function handleInput(data: string) {
					// Editor mode
					if (inputMode) {
						if (matchesKey(data, Key.escape)) {
							inputMode = false;
							inputQuestionId = null;
							editor.setText("");
							refresh();
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					const q = currentQuestion();

					// Tab navigation (multi-question)
					if (isMulti) {
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							currentTab = (currentTab + 1) % totalTabs;
							refresh();
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTab = (currentTab - 1 + totalTabs) % totalTabs;
							refresh();
							return;
						}
					}

					// Submit tab
					if (isMulti && currentTab === questions.length) {
						if (matchesKey(data, Key.enter)) {
							// Fill unanswered questions with skip
							for (const uq of questions) {
								if (!answers.has(uq.id)) {
									answers.set(uq.id, { id: uq.id, selections: [{ label: "user chose to skip this question", index: -1, wasCustom: false }] });
								}
							}
							submit(false);
						} else if (matchesKey(data, Key.escape)) {
							submit(true);
						}
						return;
					}

					if (!q) return;
					const opts = questionDisplayOptions[currentTab];
					const cursor = optionCursors[currentTab];

					// Option navigation
					if (matchesKey(data, Key.up)) {
						optionCursors[currentTab] = Math.max(0, cursor - 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						optionCursors[currentTab] = Math.min(opts.length - 1, cursor + 1);
						refresh();
						return;
					}

					// Number key shortcuts (1–N, including the auto-added "Type something." option)
					const num = parseInt(data, 10);
					if (!isNaN(num) && num >= 1 && num <= opts.length) {
						const idx = num - 1;
						optionCursors[currentTab] = idx;
						const opt = opts[idx];
						if (opt?.isOther) {
							inputMode = true;
							inputQuestionId = q.id;
							editor.setText("");
							refresh();
							return;
						}
						if (q.multiSelect) {
							const set = selectedSets[currentTab];
							if (set.has(idx)) {
								set.delete(idx);
							} else {
								set.add(idx);
							}
							refresh();
						} else {
							saveAnswer(q, [{ label: q.options[idx].label, index: num, wasCustom: false }]);
							advanceAfterAnswer();
						}
						return;
					}

					// Space toggles in multi-select
					if (q.multiSelect && data === " ") {
						const opt = opts[cursor];
						if (!opt.isOther) {
							const set = selectedSets[currentTab];
							if (set.has(cursor)) {
								set.delete(cursor);
							} else {
								set.add(cursor);
							}
							refresh();
						}
						return;
					}

					// Enter
					if (matchesKey(data, Key.enter)) {
						const opt = opts[cursor];
						if (opt.isOther) {
							inputMode = true;
							inputQuestionId = q.id;
							editor.setText("");
							refresh();
							return;
						}
						if (q.multiSelect) {
							// Confirm multi-select: gather all toggled
							const set = selectedSets[currentTab];
							// If nothing toggled yet, treat current cursor as selection
							if (set.size === 0) set.add(cursor);
							const sels: Answer["selections"] = [];
							for (const idx of Array.from(set).sort((a, b) => a - b)) {
								const o = q.options[idx];
								if (o) sels.push({ label: o.label, index: idx + 1, wasCustom: false });
							}
							saveAnswer(q, sels);
							advanceAfterAnswer();
						} else {
							saveAnswer(q, [{ label: opt.label, index: cursor + 1, wasCustom: false }]);
							advanceAfterAnswer();
						}
						return;
					}

					// Escape
					if (matchesKey(data, Key.escape)) {
						submit(true);
					}
				}

				// ── render ─────────────────────────────────────────────
				function render(width: number): string[] {
					if (cachedLines && cachedWidth === width) return cachedLines;

					const lines: string[] = [];
					const add = (s: string) => lines.push(truncateToWidth(s, width));

					add(theme.fg("accent", "─".repeat(width)));

					// Timer bar (prominent warning at top when active)
					if (timeoutRemaining !== null && timeoutRemaining > 0) {
						add(theme.fg("warning", ` ⏱ Auto-submitting in ${timeoutRemaining}s — recommended defaults selected on expiry`));
					}

					// Tab bar
					if (isMulti) {
						const tabs: string[] = ["← "];
						for (let i = 0; i < questions.length; i++) {
							const isActive = i === currentTab;
							const isAnswered = answers.has(questions[i].id);
							const lbl = questions[i].label!;
							const box = isAnswered ? "■" : "□";
							const color = isAnswered ? "success" : "muted";
							const text = ` ${box} ${lbl} `;
							const styled = isActive ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg(color, text);
							tabs.push(`${styled} `);
						}
						const canSubmit = allAnswered();
						const isSubmitTab = currentTab === questions.length;
						const submitText = " ✓ Submit ";
						const submitStyled = isSubmitTab
							? theme.bg("selectedBg", theme.fg("text", submitText))
							: theme.fg(canSubmit ? "success" : "dim", submitText);
						tabs.push(`${submitStyled} →`);
						add(` ${tabs.join("")}`);
						lines.push("");
					}

					const q = currentQuestion();

					// Submit tab (multi-question)
					if (isMulti && currentTab === questions.length) {
						const ready = allAnswered();
						add(theme.fg("accent", theme.bold(" Ready to submit")));
						lines.push("");
						for (const question of questions) {
							const answer = answers.get(question.id);
							if (answer) {
								const labels = answer.selections.map((s) => s.wasCustom ? `(wrote) ${s.label}` : s.label).join(", ");
								add(` ${theme.fg("success", "✓")} ${theme.fg("muted", `${question.label}: `)}${theme.fg("text", labels)}`);
							} else {
								add(` ${theme.fg("warning", "○")} ${theme.fg("warning", `${question.label}: `)}${theme.fg("dim", "(will be skipped)")}`);
							}
						}
						lines.push("");
						if (ready) {
							add(theme.fg("success", " Press Enter to submit"));
						} else {
							add(theme.fg("warning", " Press Enter to submit (unanswered questions will be skipped)"));
						}
						lines.push("");
						add(theme.fg("dim", " Tab/←→ navigate • Enter submit • Esc cancel"));
						add(theme.fg("accent", "─".repeat(width)));
						cachedLines = lines;
						cachedWidth = width;
						return lines;
					}

					if (!q) {
						cachedLines = lines;
						cachedWidth = width;
						return lines;
					}

					// Question text
					add(theme.fg("text", ` ${q.question}`));
					lines.push("");

					const opts = questionDisplayOptions[currentTab];
					const cursor = optionCursors[currentTab];
					const set = selectedSets[currentTab];
					const hasPreview = questionHasPreview[currentTab];

					function renderOptionLines(opt: DisplayOption, i: number): string[] {
						const isSel = i === cursor;
						const isOther = opt.isOther === true;
						const prefix = isSel ? theme.fg("accent", "> ") : "  ";
						const color = isSel ? "accent" : "text";

						let mainLine = prefix;
						if (q!.multiSelect && !isOther) {
							const check = set.has(i) ? "[x]" : "[ ]";
							mainLine += theme.fg(color, `${check} ${i + 1}. ${opt.label}`);
						} else if (isOther && inputMode) {
							mainLine += theme.fg("accent", `${i + 1}. ${opt.label} ✎`);
						} else {
							mainLine += theme.fg(color, `${i + 1}. ${opt.label}`);
						}

						if (opt.recommended) {
							mainLine += " " + theme.fg("warning", "★ Recommended");
						}

						const result = [mainLine];
						if (opt.description) {
							result.push(`     ${theme.fg("muted", opt.description)}`);
						}
						if (opt.recommended && opt.recommendedReason) {
							result.push(`     ${theme.fg("dim", opt.recommendedReason)}`);
						}
						return result;
					}

					if (hasPreview && !inputMode) {
						// Side-by-side layout
						const MIN_LEFT = 25;
						const leftWidth = Math.max(MIN_LEFT, Math.floor(width * 0.4));
						const dividerWidth = 3; // " │ "
						const rightWidth = Math.max(10, width - leftWidth - dividerWidth);

						// Build left panel (options list)
						const leftLines: string[] = [];
						for (let i = 0; i < opts.length; i++) {
							for (const line of renderOptionLines(opts[i], i)) {
								leftLines.push(truncateToWidth(line, leftWidth));
							}
						}

						// Build right panel: markdown preview, recommendedReason fallback, or placeholder
						const focusedOpt = opts[cursor];
						const previewText = focusedOpt?.preview ?? "";
						const cacheKey = `${currentTab}:${cursor}:${rightWidth}`;
						let rightLines = markdownCache.get(cacheKey);
						if (!rightLines) {
							if (previewText) {
								const md = new Markdown(previewText, 1, 0, mdTheme);
								rightLines = md.render(rightWidth);
							} else if (focusedOpt?.recommendedReason) {
								rightLines = [theme.fg("dim", ` ${focusedOpt.recommendedReason}`)];
							} else {
								rightLines = [theme.fg("dim", " (no preview)")];
							}
							markdownCache.set(cacheKey, rightLines);
						}

						const combined = renderSideBySide(leftLines, rightLines, leftWidth, rightWidth, (s) => theme.fg("border", s));
						for (const l of combined) {
							add(l);
						}
					} else {
						// Standard layout (no preview)
						for (let i = 0; i < opts.length; i++) {
							for (const line of renderOptionLines(opts[i], i)) {
								add(line);
							}
						}
					}

					// Editor area
					if (inputMode) {
						lines.push("");
						add(theme.fg("muted", " Your answer:"));
						for (const line of editor.render(width - 2)) {
							add(` ${line}`);
						}
					}

					// Hint bar
					lines.push("");
					if (inputMode) {
						add(theme.fg("dim", " Enter to submit • Esc to go back"));
					} else {
						const tabHint = isMulti ? " • Tab/←→ tabs" : "";
						const shortcutRange = `1–${opts.length}`;
						const customHint = ` (${opts.length} = Type something.)`;
						const navHint = q.multiSelect
							? ` ↑↓ navigate • Space toggle • ${shortcutRange} quick pick${customHint} • Enter confirm`
							: ` ↑↓ navigate • ${shortcutRange} quick pick${customHint} • Enter confirm`;
						add(theme.fg("dim", navHint + tabHint + " • Esc cancel"));
					}
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
						markdownCache.clear();
					},
					handleInput,
				};
			});

			// ── process result ──────────────────────────────────────
			if (result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled" }],
					details: result,
				};
			}

			const answerLines = result.answers.map((a) => {
				const qLabel = questions.find((q) => q.id === a.id)?.label || a.id;
				const sels = a.selections
					.map((s) => {
						if (s.wasCustom) return `user wrote: ${s.label}`;
						if (s.index === -1) return s.label;
						return `${s.index}. ${s.label}`;
					})
					.join(", ");
				return `${qLabel}: ${sels}`;
			});

			const text = result.timedOut
				? `[Timed out — no response within ${DEFAULT_TIMEOUT_SECONDS}s. Recommended defaults were accepted automatically; questions without a recommended option were skipped.]\n\n${answerLines.join("\n")}`
				: answerLines.join("\n");
			return {
				content: [{ type: "text", text }],
				details: result,
			};
		},

		// ── renderCall ──────────────────────────────────────────────
		renderCall(args, theme) {
			const qs = (args.questions as QuestionDef[]) || [];
			const count = qs.length;
			const labels = qs.map((q) => q.label || q.id).join(", ");
			let text = theme.fg("toolTitle", theme.bold("ask_user_question "));
			text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
			if (labels) {
				text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
			}
			for (const q of qs) {
				const optLabels = q.options.map((o) => o.label);
				const numbered = [...optLabels, "Type something."].map((o, i) => `${i + 1}. ${o}`);
				text += `\n  ${theme.fg("dim", `${q.label || q.id}: ${numbered.join(", ")}`)}`;
			}
			return new Text(text, 0, 0);
		},

		// ── renderResult ────────────────────────────────────────────
		renderResult(result, _options, theme) {
			const details = result.details as AskResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("warning", "⚠ Cancelled"), 0, 0);
			}
			const prefix = details.timedOut ? theme.fg("warning", "⏱ Timed out — defaults accepted\n") : "";
			const lines = details.answers.map((a) => {
				const qLabel = details.questions.find((q) => q.id === a.id)?.label || a.id;
				const sels = a.selections.map((s) => {
					if (s.index === -1 && !s.wasCustom) {
						return theme.fg("dim", "(skipped)");
					}
					if (s.wasCustom) {
						return `${theme.fg("muted", "(wrote) ")}${theme.fg("accent", s.label)}`;
					}
					return theme.fg("accent", `${s.index}. ${s.label}`);
				}).join(", ");
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", qLabel)}: ${sels}`;
			});
			return new Text(prefix + lines.join("\n"), 0, 0);
		},
	});
}
