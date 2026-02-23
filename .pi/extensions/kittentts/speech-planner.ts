export type CodeSpeechPolicy = "summarize" | "short" | "verbatim";
export type PauseProfile = "fast" | "balanced" | "expressive";

export type SpeakStyle = "normal" | "heading" | "label" | "list_item" | "code_summary";
export type PauseReason = "sentence" | "paragraph" | "label" | "heading" | "list" | "code_transition";

export type SpeechPlanItem =
	| {
			type: "speak";
			text: string;
			style: SpeakStyle;
	  }
	| {
			type: "pause";
			ms: number;
			reason: PauseReason;
	  };

export interface SpeechPlannerConfig {
	codeSpeechPolicy: CodeSpeechPolicy;
	pauseProfile: PauseProfile;
	maxSpeakChars: number;
	maxSentencesPerUtterance: number;
	shortCodeMaxLines: number;
	shortCodeMaxChars: number;
	shortCommandMaxChars: number;
}

type Segment =
	| { type: "blank" }
	| { type: "heading"; text: string }
	| { type: "label"; text: string }
	| { type: "bullet"; text: string }
	| { type: "command"; text: string }
	| { type: "paragraph"; text: string }
	| { type: "code"; language: string | undefined; text: string; lines: string[] };

type PauseDurations = Record<PauseReason, number>;

const PAUSE_BY_PROFILE: Record<PauseProfile, PauseDurations> = {
	fast: {
		sentence: 120,
		paragraph: 260,
		label: 220,
		heading: 280,
		list: 180,
		code_transition: 240,
	},
	balanced: {
		sentence: 200,
		paragraph: 520,
		label: 360,
		heading: 460,
		list: 260,
		code_transition: 360,
	},
	expressive: {
		sentence: 280,
		paragraph: 680,
		label: 460,
		heading: 620,
		list: 340,
		code_transition: 520,
	},
};

const HEADING_RE = /^#{1,6}\s+(.+)$/;
const LABEL_RE = /^[A-Za-z][A-Za-z0-9 _/()\-]{0,64}:$/;
const BULLET_RE = /^\s*(?:[-*]|\d+\.)\s+(.+)$/;
const SINGLE_INLINE_CODE_RE = /^`([^`]+)`$/;
const KNOWN_COMMAND_PREFIX_RE =
	/^(?:bash|zsh|sh|python|python3|node|npm|pnpm|yarn|uv|pip|git|docker|kubectl|cargo|go|make)\b/;
const SHELL_LANG_RE = /^(?:bash|zsh|sh|shell|console)$/i;

function normalizeInput(raw: string): string {
	return raw
		.replace(/\r\n/g, "\n")
		.replace(/\t/g, " ")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function stripMarkdownInline(text: string): string {
	return text
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/_([^_]+)_/g, "$1");
}

function speechNormalize(text: string): string {
	return stripMarkdownInline(text)
		.replace(/\b([A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+)\b/g, (token) => {
			if (token.includes(".") || token.includes("/") || token.startsWith("--")) return token;
			return token.replace(/[-_]+/g, " ");
		})
		.replace(/\s+/g, " ")
		.trim();
}

function splitLongByWords(text: string, maxChars: number): string[] {
	if (text.length <= maxChars) return [text];
	const out: string[] = [];
	let current = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (word.length > maxChars) {
			if (current.length > 0) {
				out.push(current);
				current = "";
			}
			for (let i = 0; i < word.length; i += maxChars) {
				out.push(word.slice(i, i + maxChars));
			}
			continue;
		}
		if (!current) {
			current = word;
			continue;
		}
		if (current.length + 1 + word.length <= maxChars) {
			current += ` ${word}`;
		} else {
			out.push(current);
			current = word;
		}
	}
	if (current.length > 0) out.push(current);
	return out;
}

function splitParagraph(text: string, maxChars: number, maxSentencesPerUtterance: number): string[] {
	const normalized = speechNormalize(text);
	if (!normalized) return [];

	const sentenceUnits = normalized
		.match(/[^.!?]+[.!?]?/g)
		?.map((s) => s.trim())
		.filter(Boolean) ?? [normalized];

	const utterances: string[] = [];
	let current = "";
	let currentSentences = 0;

	const flush = () => {
		if (current.trim()) utterances.push(current.trim());
		current = "";
		currentSentences = 0;
	};

	for (const sentence of sentenceUnits) {
		const pieces = splitLongByWords(sentence, maxChars);
		for (const piece of pieces) {
			if (!current) {
				current = piece;
				currentSentences = 1;
				continue;
			}
			const next = `${current} ${piece}`;
			if (next.length <= maxChars && currentSentences < maxSentencesPerUtterance) {
				current = next;
				currentSentences += 1;
			} else {
				flush();
				current = piece;
				currentSentences = 1;
			}
		}
	}
	flush();
	return utterances;
}

function isCommandLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed) return false;
	if (SINGLE_INLINE_CODE_RE.test(trimmed)) return true;
	if (/^[>$#]\s+\S+/.test(trimmed)) return true;
	if (/^\.\//.test(trimmed)) return true;
	if (KNOWN_COMMAND_PREFIX_RE.test(trimmed) && trimmed.split(/\s+/).length > 1) return true;
	return false;
}

function normalizeCommandText(raw: string): string {
	let text = raw.trim();
	const inlineMatch = text.match(SINGLE_INLINE_CODE_RE);
	if (inlineMatch) text = inlineMatch[1];
	text = text.replace(/^[>$#]\s+/, "");
	return speechNormalize(text);
}

function parseTextLines(lines: string[]): Segment[] {
	const segments: Segment[] = [];
	let paragraphLines: string[] = [];

	const flushParagraph = () => {
		if (paragraphLines.length === 0) return;
		const paragraph = paragraphLines.map((line) => line.trim()).join(" ");
		const normalized = speechNormalize(paragraph);
		if (normalized) segments.push({ type: "paragraph", text: normalized });
		paragraphLines = [];
	};

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			flushParagraph();
			segments.push({ type: "blank" });
			continue;
		}

		const headingMatch = line.match(HEADING_RE);
		if (headingMatch) {
			flushParagraph();
			segments.push({ type: "heading", text: speechNormalize(headingMatch[1]) });
			continue;
		}

		const bulletMatch = line.match(BULLET_RE);
		if (bulletMatch) {
			flushParagraph();
			segments.push({ type: "bullet", text: speechNormalize(bulletMatch[1]) });
			continue;
		}

		if (LABEL_RE.test(line)) {
			flushParagraph();
			segments.push({ type: "label", text: speechNormalize(line.replace(/:$/, "")) });
			continue;
		}

		if (isCommandLine(line)) {
			flushParagraph();
			segments.push({ type: "command", text: normalizeCommandText(line) });
			continue;
		}

		paragraphLines.push(line);
	}

	flushParagraph();
	return segments;
}

function parseSegments(input: string): Segment[] {
	const segments: Segment[] = [];
	const textLines: string[] = [];

	let inCode = false;
	let codeLang: string | undefined;
	let codeLines: string[] = [];

	const flushTextLines = () => {
		if (textLines.length === 0) return;
		segments.push(...parseTextLines(textLines));
		textLines.length = 0;
	};

	for (const rawLine of input.split("\n")) {
		const trimmed = rawLine.trim();
		if (trimmed.startsWith("```")) {
			if (!inCode) {
				flushTextLines();
				inCode = true;
				const lang = trimmed.slice(3).trim();
				codeLang = lang || undefined;
				codeLines = [];
			} else {
				segments.push({
					type: "code",
					language: codeLang,
					text: codeLines.join("\n"),
					lines: [...codeLines],
				});
				inCode = false;
				codeLang = undefined;
				codeLines = [];
			}
			continue;
		}

		if (inCode) {
			codeLines.push(rawLine);
			continue;
		}

		textLines.push(rawLine);
	}

	flushTextLines();

	if (inCode) {
		segments.push({
			type: "code",
			language: codeLang,
			text: codeLines.join("\n"),
			lines: [...codeLines],
		});
	}

	return segments;
}

function summarizeCodeSegment(segment: Extract<Segment, { type: "code" }>): string[] {
	const language = segment.language ? segment.language.trim() : "";
	const lineCount = segment.lines.filter((line) => line.trim().length > 0).length;
	const langLabel = language
		? SHELL_LANG_RE.test(language)
			? "Bash"
			: `${language.toUpperCase()}`
		: "Code";
	if (lineCount > 0) {
		return [`${langLabel} snippet shown with ${lineCount} lines.`];
	}
	return [`${langLabel} snippet shown.`];
}

function trimPlan(items: SpeechPlanItem[]): SpeechPlanItem[] {
	const filtered = items.filter((item) => {
		if (item.type === "speak") return item.text.trim().length > 0;
		return item.ms > 0;
	});
	while (filtered.length > 0 && filtered[0].type === "pause") {
		filtered.shift();
	}
	while (filtered.length > 0 && filtered[filtered.length - 1].type === "pause") {
		filtered.pop();
	}

	const merged: SpeechPlanItem[] = [];
	for (const item of filtered) {
		const prev = merged.at(-1);
		if (prev?.type === "pause" && item.type === "pause") {
			prev.ms = Math.max(prev.ms, item.ms);
			continue;
		}
		merged.push(item);
	}
	return merged;
}

function pushSpeakItems(items: SpeechPlanItem[], texts: string[], style: SpeakStyle): void {
	for (const text of texts) {
		const normalized = speechNormalize(text);
		if (!normalized) continue;
		items.push({ type: "speak", text: normalized, style });
	}
}

function codeAsSpeech(
	segment: Extract<Segment, { type: "code" }>,
	config: SpeechPlannerConfig,
): { speakTexts: string[]; style: SpeakStyle } {
	if (config.codeSpeechPolicy === "summarize") {
		return { speakTexts: summarizeCodeSegment(segment), style: "code_summary" };
	}

	const normalizedLines = segment.lines.map((line) => speechNormalize(line)).filter(Boolean);
	const fullText = normalizedLines.join(". ");
	const lineCount = normalizedLines.length;
	const charCount = fullText.length;

	if (config.codeSpeechPolicy === "short") {
		if (lineCount <= config.shortCodeMaxLines && charCount <= config.shortCodeMaxChars) {
			return { speakTexts: splitParagraph(fullText, config.maxSpeakChars, config.maxSentencesPerUtterance), style: "normal" };
		}
		return { speakTexts: summarizeCodeSegment(segment), style: "code_summary" };
	}

	return { speakTexts: splitParagraph(fullText, config.maxSpeakChars, config.maxSentencesPerUtterance), style: "normal" };
}

export function buildSpeechPlan(rawText: string, config: SpeechPlannerConfig): SpeechPlanItem[] {
	const text = normalizeInput(rawText);
	if (!text) return [];

	const segments = parseSegments(text);
	if (segments.length === 0) return [];

	const pauses = PAUSE_BY_PROFILE[config.pauseProfile];
	const items: SpeechPlanItem[] = [];

	for (const segment of segments) {
		switch (segment.type) {
			case "blank":
				items.push({ type: "pause", ms: pauses.paragraph, reason: "paragraph" });
				break;
			case "heading": {
				const heading = speechNormalize(segment.text);
				if (heading) {
					items.push({ type: "speak", text: heading, style: "heading" });
					items.push({ type: "pause", ms: pauses.heading, reason: "heading" });
				}
				break;
			}
			case "label": {
				const label = speechNormalize(segment.text);
				if (label) {
					items.push({ type: "speak", text: `${label}.`, style: "label" });
					items.push({ type: "pause", ms: pauses.label, reason: "label" });
				}
				break;
			}
			case "bullet": {
				const lines = splitParagraph(segment.text, config.maxSpeakChars, config.maxSentencesPerUtterance);
				pushSpeakItems(items, lines, "list_item");
				items.push({ type: "pause", ms: pauses.list, reason: "list" });
				break;
			}
			case "command": {
				const command = speechNormalize(segment.text);
				if (!command) break;
				if (config.codeSpeechPolicy === "summarize") {
					const summarized =
						command.length > config.shortCommandMaxChars
							? "Command suggested."
							: `Command suggested: ${command}.`;
					items.push({ type: "speak", text: summarized, style: "code_summary" });
					items.push({ type: "pause", ms: pauses.sentence, reason: "sentence" });
					break;
				}
				if (config.codeSpeechPolicy === "short" && command.length > config.shortCommandMaxChars) {
					items.push({ type: "speak", text: "Command suggested.", style: "code_summary" });
					items.push({ type: "pause", ms: pauses.sentence, reason: "sentence" });
					break;
				}
				const pieces = splitParagraph(command, config.maxSpeakChars, config.maxSentencesPerUtterance);
				pushSpeakItems(items, pieces, "normal");
				items.push({ type: "pause", ms: pauses.sentence, reason: "sentence" });
				break;
			}
			case "paragraph": {
				const utterances = splitParagraph(segment.text, config.maxSpeakChars, config.maxSentencesPerUtterance);
				for (let i = 0; i < utterances.length; i += 1) {
					items.push({ type: "speak", text: utterances[i], style: "normal" });
					if (i < utterances.length - 1) {
						items.push({ type: "pause", ms: pauses.sentence, reason: "sentence" });
					}
				}
				if (utterances.length > 0) {
					items.push({ type: "pause", ms: pauses.paragraph, reason: "paragraph" });
				}
				break;
			}
			case "code": {
				const output = codeAsSpeech(segment, config);
				pushSpeakItems(items, output.speakTexts, output.style);
				items.push({ type: "pause", ms: pauses.code_transition, reason: "code_transition" });
				break;
			}
		}
	}

	return trimPlan(items);
}
