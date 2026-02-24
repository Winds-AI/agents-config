import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	buildSpeechPlan,
	type CodeSpeechPolicy,
	type PauseProfile,
	type SpeechPlanItem,
	type SpeechPlannerConfig,
} from "./speech-planner.js";

// ============================================================================
// Configuration (edit these values as needed)
// ============================================================================

/** Footer status key used by this extension */
const STATUS_KEY = "tts";

/** Python executable to run worker/dependency checks (set to venv python if needed) */
const PYTHON_BIN = ".pi/extensions/kittentts/.venv/bin/python";

/** KittenTTS model repo to load in the worker */
const MODEL_REPO_ID = "KittenML/kitten-tts-micro-0.8";

/** Preferred audio players (first available one is used) */
const PLAYER_PRIORITY = ["pw-play", "paplay", "aplay"];

/** Hugging Face cache home for model downloads */
const HF_HOME = ".pi/extensions/kittentts/.hf-home";

/** Default voice alias (resolved by model voice_aliases) */
const DEFAULT_VOICE = "Jasper";

/** Voice aliases expected in 0.8 models (for command hints/validation) */
const KNOWN_VOICES = ["Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo"];

/** Speech speed passed to KittenTTS */
const DEFAULT_SPEED = 1.0;

/** Worker startup readiness timeout */
const WORKER_READY_TIMEOUT_MS = 10000;

/** Initial adaptive chunk length */
const INITIAL_CHUNK_CHARS = 160;
const CHUNK_MIN = 90;
const CHUNK_MAX = 260;
const CHUNK_STEP = 20;

/** Adaptive heuristic thresholds */
const RATIO_HIGH = 0.7;
const RATIO_LOW = 0.35;

/** Semantic speech planner toggle and behavior */
const SPEECH_PLANNER_ENABLED = true;
const LEGACY_CHUNKING_FALLBACK = true;
const CODE_SPEECH_POLICY: CodeSpeechPolicy = "summarize";
const PAUSE_PROFILE: PauseProfile = "balanced";
const SHORT_CODE_MAX_LINES = 6;
const SHORT_CODE_MAX_CHARS = 320;
const SHORT_COMMAND_MAX_CHARS = 110;
const MAX_SENTENCES_PER_UTTERANCE = 2;

type WorkerEvent =
	| { type: "ready"; player?: string; model?: string }
	| { type: "ack"; id: string }
	| { type: "synth_done"; id: string; synth_ms?: number }
	| { type: "play_done"; id: string; synth_ms?: number; play_ms?: number }
	| { type: "pause_done"; id: string; pause_ms?: number }
	| { type: "error"; id?: string; stage?: string; message?: string }
	| { type: "fatal"; message?: string }
	| { type: "cleared"; generation?: number };

const extensionDir = dirname(fileURLToPath(import.meta.url));
const workerPath = join(extensionDir, "kittentts_worker.py");

export default function kittenTts(pi: ExtensionAPI) {
	let enabled = true;
	let available = false;
	let currentVoice = DEFAULT_VOICE;
	let chunkChars = INITIAL_CHUNK_CHARS;
	let worker: ChildProcessWithoutNullStreams | null = null;
	let workerBuffer = "";
	let nextChunkId = 1;
	let generation = 0;
	let pending = new Map<string, true>();
	let readyTimer: ReturnType<typeof setTimeout> | null = null;
	let lastCtx: ExtensionContext | null = null;

	const rememberContext = (ctx: ExtensionContext) => {
		lastCtx = ctx;
	};

	const notify = (message: string, type: "info" | "warning" | "error" = "info") => {
		if (lastCtx?.hasUI) {
			lastCtx.ui.notify(message, type);
		}
	};

	const setStatus = (text: string | undefined) => {
		if (lastCtx?.hasUI) {
			lastCtx.ui.setStatus(STATUS_KEY, text);
		}
	};

	const updateStatus = () => {
		if (!enabled || !available || !worker) {
			setStatus(undefined);
			return;
		}

		const queued = pending.size;
		if (queued <= 0) {
			setStatus("TTS: idle");
			return;
		}
		if (queued === 1) {
			setStatus("TTS: speaking...");
			return;
		}
		setStatus(`TTS: speaking... (${queued} queued)`);
	};

	const clearReadyTimer = () => {
		if (readyTimer !== null) {
			clearTimeout(readyTimer);
			readyTimer = null;
		}
	};

	const sendToWorker = (payload: Record<string, unknown>): boolean => {
		if (!worker || worker.killed || worker.stdin.destroyed) {
			return false;
		}
		try {
			worker.stdin.write(`${JSON.stringify(payload)}\n`);
			return true;
		} catch {
			return false;
		}
	};

	const clearWorkerQueue = () => {
		generation += 1;
		pending.clear();
		sendToWorker({ op: "clear" });
		updateStatus();
	};

	const stopWorker = () => {
		clearReadyTimer();
		if (!worker) {
			return;
		}
		try {
			sendToWorker({ op: "shutdown" });
			worker.stdin.end();
		} catch {
			// ignore shutdown pipe errors
		}
		try {
			worker.kill("SIGTERM");
		} catch {
			// ignore kill errors
		}
		worker = null;
		workerBuffer = "";
		pending.clear();
		available = false;
		updateStatus();
	};

	const adjustChunkSize = (synthMs?: number, playMs?: number) => {
		if (typeof synthMs !== "number" || typeof playMs !== "number" || playMs <= 0) {
			return;
		}
		const ratio = synthMs / playMs;
		if (ratio > RATIO_HIGH) {
			chunkChars = Math.min(CHUNK_MAX, chunkChars + CHUNK_STEP);
			return;
		}
		if (ratio < RATIO_LOW) {
			chunkChars = Math.max(CHUNK_MIN, chunkChars - CHUNK_STEP);
		}
	};

	const handleWorkerEvent = (event: WorkerEvent) => {
		if (event.type === "ready") {
			clearReadyTimer();
			available = true;
			updateStatus();
			notify(`TTS ready (${event.player || "audio player"}, model: ${event.model || MODEL_REPO_ID})`, "info");
			return;
		}

		if (event.type === "play_done") {
			pending.delete(event.id);
			adjustChunkSize(event.synth_ms, event.play_ms);
			updateStatus();
			return;
		}

		if (event.type === "pause_done") {
			pending.delete(event.id);
			updateStatus();
			return;
		}

		if (event.type === "error") {
			if (event.id) {
				pending.delete(event.id);
			}
			updateStatus();
			const stage = event.stage ? `${event.stage}: ` : "";
			notify(`TTS error: ${stage}${event.message || "unknown error"}`, "warning");
			return;
		}

		if (event.type === "fatal") {
			available = false;
			pending.clear();
			updateStatus();
			notify(`TTS unavailable: ${event.message || "worker failed to start"}`, "error");
			return;
		}

		if (event.type === "cleared") {
			updateStatus();
		}
	};

	const handleWorkerStdoutData = (data: Buffer | string) => {
		workerBuffer += data.toString();
		const lines = workerBuffer.split(/\r?\n/);
		workerBuffer = lines.pop() ?? "";
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;
			try {
				const event = JSON.parse(line) as WorkerEvent;
				handleWorkerEvent(event);
			} catch {
				// Ignore known worker protocol noise if it appears.
				if (line.startsWith("Audio saved to ")) {
					continue;
				}
				notify(`TTS worker emitted non-JSON output: ${line.slice(0, 120)}`, "warning");
			}
		}
	};

	const startWorker = () => {
		stopWorker();
		available = false;
		workerBuffer = "";
		pending.clear();
		updateStatus();

		try {
			worker = spawn(
				PYTHON_BIN,
				[workerPath, "--model", MODEL_REPO_ID, "--players", PLAYER_PRIORITY.join(",")],
				{
					stdio: ["pipe", "pipe", "pipe"],
					shell: false,
					env: {
						...process.env,
						HF_HOME: HF_HOME,
					},
				},
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			worker = null;
			available = false;
			updateStatus();
			notify(`Failed to start TTS worker: ${message}`, "error");
			return;
		}

		worker.stdout.on("data", handleWorkerStdoutData);
		worker.stderr.on("data", (data: Buffer | string) => {
			const message = data.toString().trim();
			if (!message) return;
			notify(`TTS worker stderr: ${message.slice(0, 160)}`, "warning");
		});
		worker.on("error", (err) => {
			available = false;
			pending.clear();
			updateStatus();
			notify(`TTS worker process error: ${err.message}`, "error");
		});
		worker.on("exit", (code, signal) => {
			clearReadyTimer();
			worker = null;
			available = false;
			pending.clear();
			updateStatus();
			if (enabled) {
				notify(`TTS worker exited (${code ?? "null"}${signal ? `, ${signal}` : ""})`, "warning");
			}
		});

		readyTimer = setTimeout(() => {
			if (!available) {
				notify("TTS worker did not become ready in time", "warning");
			}
		}, WORKER_READY_TIMEOUT_MS);
	};

	const isTextBlock = (block: unknown): block is TextContent => {
		if (!block || typeof block !== "object") return false;
		const candidate = block as { type?: unknown; text?: unknown };
		return candidate.type === "text" && typeof candidate.text === "string";
	};

	const extractAssistantText = (message: AssistantMessage): string => {
		return message.content
			.filter(isTextBlock)
			.map((block) => block.text.trim())
			.filter((line) => line.length > 0)
			.join("\n");
	};

	const splitLongLine = (line: string, maxChars: number): string[] => {
		if (line.length <= maxChars) {
			return [line];
		}

		const parts: string[] = [];
		let current = "";
		for (const word of line.split(/\s+/).filter(Boolean)) {
			if (word.length > maxChars) {
				if (current.length > 0) {
					parts.push(current);
					current = "";
				}
				for (let i = 0; i < word.length; i += maxChars) {
					parts.push(word.slice(i, i + maxChars));
				}
				continue;
			}

			if (current.length === 0) {
				current = word;
				continue;
			}

			if (current.length + 1 + word.length <= maxChars) {
				current += ` ${word}`;
			} else {
				parts.push(current);
				current = word;
			}
		}

		if (current.length > 0) {
			parts.push(current);
		}

		return parts;
	};

	const chunkText = (text: string, maxChars: number): string[] => {
		const lines = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		const chunks: string[] = [];
		let currentLines: string[] = [];
		let currentLen = 0;

		const pushCurrent = () => {
			if (currentLines.length === 0) return;
			chunks.push(currentLines.join("\n"));
			currentLines = [];
			currentLen = 0;
		};

		for (const rawLine of lines) {
			for (const piece of splitLongLine(rawLine, maxChars)) {
				const extra = currentLines.length > 0 ? 1 : 0;
				const nextLen = currentLen + extra + piece.length;
				const hitLineLimit = currentLines.length >= 3;
				const hitSizeLimit = currentLines.length >= 2 && nextLen > maxChars;
				if ((hitLineLimit || hitSizeLimit) && currentLines.length > 0) {
					pushCurrent();
				}

				currentLines.push(piece);
				currentLen += (currentLines.length > 1 ? 1 : 0) + piece.length;

				if (currentLines.length >= 3) {
					pushCurrent();
				}
			}
		}

		pushCurrent();
		return chunks;
	};

	const nextItemId = () => `chunk-${nextChunkId++}`;

	const plannerConfig = (): SpeechPlannerConfig => ({
		codeSpeechPolicy: CODE_SPEECH_POLICY,
		pauseProfile: PAUSE_PROFILE,
		maxSpeakChars: chunkChars,
		maxSentencesPerUtterance: MAX_SENTENCES_PER_UTTERANCE,
		shortCodeMaxLines: SHORT_CODE_MAX_LINES,
		shortCodeMaxChars: SHORT_CODE_MAX_CHARS,
		shortCommandMaxChars: SHORT_COMMAND_MAX_CHARS,
	});

	const enqueueChunk = (chunk: string) => {
		if (!enabled || !available || !worker) {
			return;
		}
		const chunkId = nextItemId();
		pending.set(chunkId, true);
		const ok = sendToWorker({
			op: "speak",
			id: chunkId,
			text: chunk,
			voice: currentVoice,
			speed: DEFAULT_SPEED,
			generation: generation,
		});
		if (!ok) {
			pending.delete(chunkId);
			notify("Failed to enqueue TTS chunk", "warning");
		}
		updateStatus();
	};

	const enqueuePause = (pauseMs: number) => {
		if (!enabled || !available || !worker) {
			return;
		}
		const clampedPauseMs = Math.max(0, Math.round(pauseMs));
		if (clampedPauseMs <= 0) {
			return;
		}
		const chunkId = nextItemId();
		pending.set(chunkId, true);
		const ok = sendToWorker({
			op: "pause",
			id: chunkId,
			pause_ms: clampedPauseMs,
			generation: generation,
		});
		if (!ok) {
			pending.delete(chunkId);
			notify("Failed to enqueue TTS pause", "warning");
		}
		updateStatus();
	};

	const enqueuePlan = (plan: SpeechPlanItem[]) => {
		for (const item of plan) {
			if (item.type === "speak") {
				enqueueChunk(item.text);
				continue;
			}
			enqueuePause(item.ms);
		}
	};

	const checkDependencies = async (): Promise<boolean> => {
		const result = await pi.exec(PYTHON_BIN, [
			"-c",
			"import espeakng_loader, numpy, onnxruntime, soundfile, huggingface_hub, phonemizer",
		]);
		if (result.code !== 0) {
			available = false;
			updateStatus();
			notify(
				`KittenTTS CPU dependencies missing for ${PYTHON_BIN}. Install .pi/extensions/kittentts/requirements-cpu.txt`,
				"warning",
			);
			return false;
		}
		return true;
	};

	const ensureWorkerStarted = async (): Promise<boolean> => {
		if (worker && !worker.killed) return true;
		const ok = await checkDependencies();
		if (!ok) return false;
		startWorker();
		return true;
	};

	pi.on("session_start", async (_event, ctx) => {
		rememberContext(ctx);
		const ok = await checkDependencies();
		if (!ok) return;
		startWorker();
	});

	pi.on("message_end", async (event, ctx) => {
		rememberContext(ctx);
		if (!enabled) return;
		if (!event.message || event.message.role !== "assistant") return;

		if (!(await ensureWorkerStarted())) return;

		const text = extractAssistantText(event.message as AssistantMessage);
		if (!text) return;

		if (SPEECH_PLANNER_ENABLED) {
			try {
				const plan = buildSpeechPlan(text, plannerConfig());
				if (plan.length > 0) {
					enqueuePlan(plan);
					return;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notify(`TTS planner failed: ${message}`, "warning");
				if (!LEGACY_CHUNKING_FALLBACK) {
					return;
				}
			}
		}

		for (const chunk of chunkText(text, chunkChars)) {
			enqueueChunk(chunk);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		rememberContext(ctx);
		enabled = false;
		available = false;
		stopWorker();
		setStatus(undefined);
	});

	pi.registerCommand("tts", {
		description: "Toggle TTS or set voice: /tts, /tts on|off, /tts voice <name>",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			rememberContext(ctx);
			const parts = args
				.trim()
				.split(/\s+/)
				.map((p) => p.trim())
				.filter((p) => p.length > 0);

			if (parts.length === 0) {
				enabled = !enabled;
				if (!enabled) {
					clearWorkerQueue();
					notify("TTS disabled", "info");
				} else {
					await ensureWorkerStarted();
					notify("TTS enabled", "info");
				}
				updateStatus();
				return;
			}

			if (parts[0] === "on") {
				enabled = true;
				await ensureWorkerStarted();
				updateStatus();
				notify("TTS enabled", "info");
				return;
			}

			if (parts[0] === "off") {
				enabled = false;
				clearWorkerQueue();
				updateStatus();
				notify("TTS disabled", "info");
				return;
			}

			if (parts[0] === "voice") {
				const voice = parts.slice(1).join(" ").trim();
				if (!voice) {
					notify(`Usage: /tts voice <name> (e.g. ${KNOWN_VOICES.join(", ")})`, "warning");
					return;
				}
				currentVoice = voice;
				if (!KNOWN_VOICES.includes(voice)) {
					notify(`Voice set to ${voice} (custom/unverified)`, "info");
				} else {
					notify(`Voice set to ${voice}`, "info");
				}
				return;
			}

			notify("Usage: /tts, /tts on, /tts off, /tts voice <name>", "warning");
		},
	});
}
