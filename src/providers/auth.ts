import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getEnvApiKey } from "@earendil-works/pi-ai/compat";

export type ResolvedAuth =
    | { ok: true; apiKey?: string; headers?: Record<string, string>; baseUrl?: string; }
    | { ok: false; error: string; };

function getEnvAuth(model: Model<Api>): Extract<ResolvedAuth, { ok: true }> | undefined {
    const apiKey = getEnvApiKey(model.provider);
    return apiKey ? { ok: true, apiKey } : undefined;
}

/**
 * Get API key and headers for a model.
 */
export async function getAuth(ctx: ExtensionContext, model: Model<Api>): Promise<ResolvedAuth> {
    const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!resolved.ok) return resolved;

    // pi-coding-agent 0.80.1+ returns { ok: true } from getApiKeyAndHeaders()
    // when auth only comes from provider env vars such as ANTHROPIC_API_KEY.
    // The main agent still works because pi-ai's streamSimple() performs its own
    // getEnvApiKey() fallback, but this extension calls fetch() directly, so it
    // must mirror that fallback while preserving explicit model/auth headers.
    const envAuth = !resolved.apiKey && !hasAuthHeader(resolved.headers) ? getEnvAuth(model) : undefined;
    return envAuth ? { ...resolved, apiKey: envAuth.apiKey } : resolved;
}

function hasAuthHeader(headers?: Record<string, string>): boolean {
    if (!headers) return false;
    return Object.entries(headers).some(([name, value]) => {
        if (!value) return false;
        const normalized = name.toLowerCase();
        return normalized === "authorization" || normalized === "x-api-key" || normalized === "x-goog-api-key";
    });
}
