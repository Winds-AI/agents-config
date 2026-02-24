import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type WorkflowMode =
	| { target: "off" }
	| { target: "backend" }
	| { target: "frontend"; steps: number[] };

const STATE_ENTRY_TYPE = "workflow-orchestrator-state";
const FRONTEND_VALID_STEPS = new Set([1, 2, 3, 4, 5, 6]);

function readUtf8IfExists(path: string): string {
	if (!existsSync(path)) return "";
	return readFileSync(path, "utf8");
}

function findRepoRootFrom(cwd: string): string | undefined {
	let current = resolve(cwd);
	while (true) {
		if (existsSync(join(current, "my-experimental-development-workflow"))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function getWorkflowRoots(cwd: string): { frontendRoot: string; backendRoot: string } | undefined {
	const repoRoot = findRepoRootFrom(cwd);
	if (!repoRoot) return undefined;
	const base = join(repoRoot, "my-experimental-development-workflow");
	return {
		frontendRoot: join(base, "frontend"),
		backendRoot: join(base, "backend"),
	};
}

function hasFrontendPlanFile(frontendRoot: string): boolean {
	const plansDir = join(frontendRoot, ".agent", "plans");
	if (!existsSync(plansDir)) return false;
	return readdirSync(plansDir).some((name) => name.startsWith("PLAN_") && name.endsWith(".md"));
}

function parseFrontendSteps(args: string): { steps: number[] } | { error: string } {
	const raw = args.trim();
	if (!raw) return { error: "Missing steps. Example: /wf-frontend 1,2,3 or /wf-frontend 3-5" };

	const values = new Set<number>();
	for (const token of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
		if (token.includes("-")) {
			const [a, b] = token.split("-").map((part) => Number(part.trim()));
			if (!Number.isInteger(a) || !Number.isInteger(b) || a > b) {
				return { error: `Invalid range: ${token}` };
			}
			for (let n = a; n <= b; n++) values.add(n);
		} else {
			const n = Number(token);
			if (!Number.isInteger(n)) return { error: `Invalid step: ${token}` };
			values.add(n);
		}
	}

	const steps = [...values].sort((a, b) => a - b);
	if (steps.length === 0) return { error: "No steps parsed." };
	for (const step of steps) {
		if (!FRONTEND_VALID_STEPS.has(step)) {
			return { error: `Invalid step: ${step}. Allowed steps: 1,2,3,4,5,6` };
		}
	}
	return { steps };
}

function restoreMode(raw: unknown): WorkflowMode {
	if (!raw || typeof raw !== "object") return { target: "off" };
	const candidate = raw as { target?: unknown; steps?: unknown };
	if (candidate.target === "backend") return { target: "backend" };
	if (candidate.target === "frontend" && Array.isArray(candidate.steps)) {
		const steps = candidate.steps.filter((x): x is number => Number.isInteger(x) && FRONTEND_VALID_STEPS.has(x));
		if (steps.length > 0) return { target: "frontend", steps: [...new Set(steps)].sort((a, b) => a - b) };
	}
	return { target: "off" };
}

function modeSummary(mode: WorkflowMode): string {
	if (mode.target === "off") return "off";
	if (mode.target === "backend") return "backend";
	return `frontend steps ${mode.steps.join(",")}`;
}

function applyStatus(ctx: ExtensionContext, mode: WorkflowMode): void {
	if (!ctx.hasUI) return;
	if (mode.target === "off") {
		ctx.ui.setStatus("workflow", undefined);
		ctx.ui.setWidget("workflow", undefined);
		return;
	}
	if (mode.target === "backend") {
		ctx.ui.setStatus("workflow", "WF: backend api");
		ctx.ui.setWidget("workflow", ["Workflow: backend API discovery/call mode"]);
		return;
	}
	ctx.ui.setStatus("workflow", `WF: frontend ${mode.steps.join(",")}`);
	ctx.ui.setWidget("workflow", [`Workflow: frontend steps ${mode.steps.join(",")}`]);
}

function persistMode(pi: ExtensionAPI, mode: WorkflowMode): void {
	pi.appendEntry(STATE_ENTRY_TYPE, mode);
}

function setMode(pi: ExtensionAPI, ctx: ExtensionContext, mode: WorkflowMode): void {
	applyStatus(ctx, mode);
	persistMode(pi, mode);
}

function shellUsesTool(command: string, toolName: "api" | "acurl"): boolean {
	const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`(?:^|[;&|]\\s*|\\s)(?:\\./)?(?:[^\\s]*?/)?\\.agent/scripts/${escaped}(?:\\s|$)|(?:^|[;&|]\\s*)${escaped}(?:\\s|$)`);
	return pattern.test(command);
}

function buildFrontendContext(frontendRoot: string, steps: number[]): string {
	const agent = readUtf8IfExists(join(frontendRoot, ".agent", "Agent.md"));
	const stepsDir = join(frontendRoot, ".agent", "steps");
	const stepFiles = existsSync(stepsDir) ? readdirSync(stepsDir) : [];
	const stepTexts = steps
		.map((step) => {
			const matched = stepFiles.find((name) => name.startsWith(`${step}-`) && name.endsWith(".md"));
			if (!matched) return `## Step ${step}\n(Missing step file)`;
			return readUtf8IfExists(join(stepsDir, matched));
		})
		.join("\n\n---\n\n");

	const apiGuide = readUtf8IfExists(join(frontendRoot, ".agent", "docs", "API_SCRIPT_USAGE_GUIDE.md"));
	const planTemplate = readUtf8IfExists(join(frontendRoot, ".agent", "docs", "PLAN_TEMPLATE.md"));
	const planFiles = existsSync(join(frontendRoot, ".agent", "plans"))
		? readdirSync(join(frontendRoot, ".agent", "plans")).filter((x) => x.startsWith("PLAN_") && x.endsWith(".md"))
		: [];

	return [
		"[WORKFLOW MODE: FRONTEND]",
		`Active steps: ${steps.join(",")}`,
		"Use only the selected steps in order and obey all boundaries.",
		planFiles.length > 0 ? `Detected plan files: ${planFiles.join(", ")}` : "Detected plan files: none",
		"",
		agent,
		"",
		stepTexts,
		"",
		"## API Toolkit Guide",
		apiGuide,
		"",
		"## Plan Template",
		planTemplate,
	].join("\n");
}

function buildBackendContext(backendRoot: string): string {
	const agent = readUtf8IfExists(join(backendRoot, ".agent", "Agent.md"));
	const apiGuide = readUtf8IfExists(join(backendRoot, ".agent", "docs", "API_SCRIPT_USAGE_GUIDE.md"));
	return [
		"[WORKFLOW MODE: BACKEND]",
		"Only API discovery and API calls are allowed.",
		"",
		agent,
		"",
		"## API Toolkit Guide",
		apiGuide,
	].join("\n");
}

export default function workflowOrchestrator(pi: ExtensionAPI) {
	const baseDir = dirname(fileURLToPath(import.meta.url));
	let mode: WorkflowMode = { target: "off" };

	pi.on("resources_discover", () => {
		return {
			skillPaths: [
				join(baseDir, "skills", "frontend-dev-workflow", "SKILL.md"),
				join(baseDir, "skills", "backend-api-workflow", "SKILL.md"),
			],
			promptPaths: [
				join(baseDir, "prompts", "wf-frontend.md"),
				join(baseDir, "prompts", "wf-backend.md"),
			],
		};
	});

	pi.on("session_start", (_event, ctx) => {
		const state = [...ctx.sessionManager.getEntries()].reverse().find((entry) => {
			return entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE;
		}) as { data?: unknown } | undefined;
		mode = restoreMode(state?.data);
		applyStatus(ctx, mode);
	});

	pi.registerCommand("wf-frontend", {
		description: "Activate frontend workflow with selected steps (e.g. /wf-frontend 1,2,3)",
		handler: async (args, ctx) => {
			const parsed = parseFrontendSteps(args);
			if ("error" in parsed) {
				ctx.ui.notify(parsed.error, "error");
				return;
			}
			mode = { target: "frontend", steps: parsed.steps };
			setMode(pi, ctx, mode);
			ctx.ui.notify(`Workflow set: ${modeSummary(mode)}`, "info");
		},
	});

	pi.registerCommand("wf-backend", {
		description: "Activate backend API workflow",
		handler: async (_args, ctx) => {
			mode = { target: "backend" };
			setMode(pi, ctx, mode);
			ctx.ui.notify(`Workflow set: ${modeSummary(mode)}`, "info");
		},
	});

	pi.registerCommand("wf-off", {
		description: "Disable workflow orchestration",
		handler: async (_args, ctx) => {
			mode = { target: "off" };
			setMode(pi, ctx, mode);
			ctx.ui.notify("Workflow mode disabled", "info");
		},
	});

	pi.registerCommand("wf-status", {
		description: "Show active workflow mode",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`Workflow: ${modeSummary(mode)}`, "info");
		},
	});

	pi.registerTool({
		name: "workflow_set_mode",
		label: "Workflow Set Mode",
		description: "Set workflow mode to frontend/backend/off. Use this before executing a structured workflow.",
		parameters: Type.Object({
			target: StringEnum(["frontend", "backend", "off"] as const),
			steps: Type.Optional(Type.String({ description: "Frontend steps, e.g. 1,2,3 or 3-5" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.target === "off") {
				mode = { target: "off" };
				setMode(pi, ctx, mode);
				return { content: [{ type: "text", text: "Workflow mode: off" }] };
			}

			if (params.target === "backend") {
				mode = { target: "backend" };
				setMode(pi, ctx, mode);
				return { content: [{ type: "text", text: "Workflow mode: backend" }] };
			}

			const parsed = parseFrontendSteps(params.steps ?? "");
			if ("error" in parsed) {
				return {
					content: [
						{ type: "text", text: `Failed to set frontend workflow: ${parsed.error}` },
					],
					isError: true,
				};
			}

			mode = { target: "frontend", steps: parsed.steps };
			setMode(pi, ctx, mode);
			return { content: [{ type: "text", text: `Workflow mode: frontend steps ${parsed.steps.join(",")}` }] };
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (mode.target === "off") return;
		const roots = getWorkflowRoots(ctx.cwd);
		if (!roots) return;

		if (mode.target === "backend") {
			return {
				message: {
					customType: "workflow-context",
					content: buildBackendContext(roots.backendRoot),
					display: false,
				},
			};
		}

		const content = buildFrontendContext(roots.frontendRoot, mode.steps);
		return {
			message: {
				customType: "workflow-context",
				content,
				display: false,
			},
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (mode.target === "off") return;
		const roots = getWorkflowRoots(ctx.cwd);

		if (mode.target === "backend") {
			if (event.toolName === "edit" || event.toolName === "write") {
				return { block: true, reason: "Backend workflow is API-only; file modification tools are blocked." };
			}
			if (event.toolName === "bash") {
				const command = String((event.input as { command?: unknown }).command ?? "");
				const usesApi = shellUsesTool(command, "api");
				const usesAcurl = shellUsesTool(command, "acurl");
				if (!usesApi && !usesAcurl) {
					return {
						block: true,
						reason: "Backend workflow allows only API toolkit commands (.agent/scripts/api and .agent/scripts/acurl).",
					};
				}
			}
			return;
		}

		const allowCodeChanges = mode.steps.includes(4) || mode.steps.includes(6);
		if ((event.toolName === "edit" || event.toolName === "write") && !allowCodeChanges) {
			return {
				block: true,
				reason: "Frontend workflow: selected steps do not allow code modification. Include step 4 or 6.",
			};
		}

		if (
			(event.toolName === "edit" || event.toolName === "write") &&
			mode.steps.includes(4) &&
			roots &&
			!hasFrontendPlanFile(roots.frontendRoot)
		) {
			return {
				block: true,
				reason: "Step 4 requires a plan file at frontend/.agent/plans/PLAN_<feature>.md before implementation.",
			};
		}

		if (event.toolName === "bash") {
			const command = String((event.input as { command?: unknown }).command ?? "");
			const usesApi = shellUsesTool(command, "api");
			const usesAcurl = shellUsesTool(command, "acurl");
			const canUseApi = mode.steps.includes(1) || mode.steps.includes(6);
			const canUseAcurl = mode.steps.includes(2) || mode.steps.includes(6);

			if (usesApi && !canUseApi) {
				return { block: true, reason: "Current frontend step selection does not include API discovery (step 1 or 6)." };
			}
			if (usesAcurl && !canUseAcurl) {
				return { block: true, reason: "Current frontend step selection does not include API testing (step 2 or 6)." };
			}
		}
	});
}
