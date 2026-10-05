import "server-only";

import { insert } from "../db";
import { newId } from "../ids";
import { logger } from "../logger";
import type { AICompletionRequest, AICompletionResult, AIProviderName } from "./types";

/**
 * AI provider abstraction (§67).
 *
 * `local` is a first-class provider, not a stub: it runs the deterministic
 * reasoning engines in `./local` which derive every statement from real audit
 * findings. Configuring an LLM key switches the *language* layer only — facts
 * still come from the audit record, and `guardrails.ts` rejects any generated
 * claim that cannot be traced back to evidence (§52).
 */

export interface ProviderConfig {
  provider: AIProviderName;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  maxTokens: number;
  temperature: number;
  configured: boolean;
  label: string;
  note?: string;
}

const DEFAULT_MODELS: Record<AIProviderName, string> = {
  local: "leadforge-reasoning-v1",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  "azure-openai": "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
};

export function providerConfig(): ProviderConfig {
  const provider = (process.env.AI_PROVIDER ?? "local").toLowerCase() as AIProviderName;
  const apiKey = process.env.AI_API_KEY?.trim() || undefined;
  const model = process.env.AI_MODEL?.trim() || DEFAULT_MODELS[provider] || DEFAULT_MODELS.local;

  // Azure/OpenRouter need a base URL to be usable at all.
  const baseUrl = process.env.AI_BASE_URL?.trim() || undefined;
  const needsBaseUrl = provider === "azure-openai" || provider === "openrouter";
  const configured = provider === "local" ? true : Boolean(apiKey) && (!needsBaseUrl || Boolean(baseUrl));

  const notes: Partial<Record<AIProviderName, string>> = {
    "azure-openai": "Requires AI_BASE_URL pointing at your Azure deployment endpoint.",
    openrouter: "Requires AI_BASE_URL (https://openrouter.ai/api/v1) and AI_API_KEY.",
    anthropic: "Requires AI_API_KEY. Messages API is called server-side only.",
    openai: "Requires AI_API_KEY. Requests never leave the server.",
  };

  return {
    provider,
    model,
    baseUrl,
    apiKey,
    maxTokens: Number(process.env.AI_MAX_TOKENS ?? 2048),
    temperature: Number(process.env.AI_TEMPERATURE ?? 0.4),
    configured,
    label:
      provider === "local"
        ? "LeadForge local reasoning engine"
        : `${provider} · ${model}`,
    note: provider === "local"
      ? "Deterministic on-device engine. Every statement is derived from measured audit data — no external calls, no key required."
      : notes[provider],
  };
}

export function isLlmConfigured(): boolean {
  const config = providerConfig();
  return config.provider !== "local" && config.configured;
}

/* ── System preamble shared by every LLM call ────────────────────────────── */

export const SYSTEM_GUARDRAILS = `You are the reasoning engine inside LeadForge, a sales platform used by professional web development agencies.

NON-NEGOTIABLE RULES:
1. Never invent a fact. If a value is not present in the supplied data, say it is not available.
2. Never invent contact details, names, phone numbers, email addresses or review counts.
3. Only reference audit findings that are explicitly listed in the supplied evidence. Never claim a check found something it did not.
4. Clearly separate MEASURED facts (from the audit) from RECOMMENDATIONS (your judgement).
5. Never use deceptive, manufactured-urgency or unverifiable superlative sales language. No "guaranteed #1 rankings", no fake scarcity.
6. Never claim to be a human. You are an AI assistant for the agency; be transparent if asked.
7. Respect opt-outs and do not produce harassment or repeated-contact copy.
8. Pricing you produce is an internal estimate, never a guaranteed quote, and must say so.
9. Be specific and concrete. Generic filler is a failure.
10. British English. No emoji unless the field explicitly asks for it.`;

/* ── Low-level completion ────────────────────────────────────────────────── */

export async function complete(request: AICompletionRequest): Promise<AICompletionResult> {
  const config = providerConfig();
  const started = Date.now();

  if (!isLlmConfigured()) {
    return {
      text: "",
      provider: "local",
      model: DEFAULT_MODELS.local,
      latencyMs: 0,
      promptTokens: 0,
      outputTokens: 0,
      costEstimate: 0,
      guardrailFlags: [],
      degraded: true,
      error: "No LLM provider configured — the deterministic local engine was used instead.",
    };
  }

  try {
    const result = await callProvider(config, request);
    const latencyMs = Date.now() - started;
    logInteraction({
      ...request,
      provider: config.provider,
      model: config.model,
      response: result.text,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
      latencyMs,
      costEstimate: estimateCost(config, result.promptTokens, result.outputTokens),
      status: "ok",
    });
    return {
      text: result.text,
      provider: config.provider,
      model: config.model,
      latencyMs,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
      costEstimate: estimateCost(config, result.promptTokens, result.outputTokens),
      guardrailFlags: [],
      degraded: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("ai", "LLM completion failed; falling back to the local engine", {
      feature: request.feature,
      provider: config.provider,
      error: message,
    });
    logInteraction({
      ...request,
      provider: config.provider,
      model: config.model,
      response: null,
      promptTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      costEstimate: 0,
      status: "error",
      error: message,
    });
    return {
      text: "",
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - started,
      promptTokens: 0,
      outputTokens: 0,
      costEstimate: 0,
      guardrailFlags: [],
      degraded: true,
      error: message,
    };
  }
}

async function callProvider(
  config: ProviderConfig,
  request: AICompletionRequest,
): Promise<{ text: string; promptTokens: number; outputTokens: number }> {
  const maxTokens = request.maxTokens ?? config.maxTokens;
  const temperature = request.temperature ?? config.temperature;

  if (config.provider === "anthropic") {
    const response = await fetch(`${config.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        temperature,
        system: `${SYSTEM_GUARDRAILS}\n\n${request.system}`,
        messages: [{ role: "user", content: request.user }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const payload = (await response.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: payload.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "",
      promptTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    };
  }

  // OpenAI-compatible (OpenAI, Azure, OpenRouter, and most self-hosted gateways)
  const isAzure = config.provider === "azure-openai";
  const endpoint = isAzure
    ? `${config.baseUrl!.replace(/\/$/, "")}/openai/deployments/${config.model}/chat/completions?api-version=2024-06-01`
    : `${config.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: isAzure
      ? { "content-type": "application/json", "api-key": config.apiKey! }
      : { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: isAzure ? undefined : config.model,
      temperature,
      max_tokens: maxTokens,
      response_format: request.json ? { type: "json_object" } : undefined,
      messages: [
        { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${request.system}` },
        { role: "user", content: request.user },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) throw new Error(`${config.provider} API ${response.status}: ${(await response.text()).slice(0, 300)}`);

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: payload.choices?.[0]?.message?.content ?? "",
    promptTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
  };
}

function estimateCost(config: ProviderConfig, promptTokens: number, outputTokens: number): number {
  // Indicative public list prices per 1M tokens. Used only for the diagnostics
  // dashboard — never billed to a customer.
  const pricing: Record<string, { in: number; out: number }> = {
    "gpt-4o-mini": { in: 0.15, out: 0.6 },
    "gpt-4o": { in: 2.5, out: 10 },
    "claude-3-5-sonnet-latest": { in: 3, out: 15 },
    "claude-3-5-haiku-latest": { in: 0.8, out: 4 },
  };
  const key = Object.keys(pricing).find((k) => config.model.includes(k));
  const rate = key ? pricing[key] : { in: 1, out: 3 };
  return (promptTokens / 1_000_000) * rate.in + (outputTokens / 1_000_000) * rate.out;
}

function logInteraction(input: AICompletionRequest & {
  provider: string;
  model: string;
  response: string | null;
  promptTokens: number;
  outputTokens: number;
  latencyMs: number;
  costEstimate: number;
  status: string;
  error?: string;
}): void {
  try {
    insert("ai_interactions", {
      id: newId("ai"),
      org_id: input.orgId ?? null,
      user_id: input.userId ?? null,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      entity_type: input.entity?.type ?? null,
      entity_id: input.entity?.id ?? null,
      // Prompts can contain prospect data — store them truncated, never verbatim in full.
      prompt: input.user.slice(0, 4000),
      response: input.response ? input.response.slice(0, 8000) : null,
      prompt_tokens: input.promptTokens,
      output_tokens: input.outputTokens,
      latency_ms: input.latencyMs,
      cost_estimate: input.costEstimate,
      status: input.status,
      error: input.error ?? null,
      guardrail_flags_json: [],
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn("ai", "Failed to persist AI interaction log", { error: String(error) });
  }
}

/** Extract a JSON object from a model response that may be wrapped in prose. */
export function parseJsonResponse<T>(text: string): T | null {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
