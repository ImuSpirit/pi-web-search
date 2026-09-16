import type { ExtensionContext, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { callApiStream, getConfig } from "./api.ts";
import { formatWebSearchResult } from "./format.ts";
import { getWebSearchModel, missingWebSearchConfigResult, errorResult } from "./utils.ts";

export const WebSearchSchema = Type.Object({
    query: Type.String({ minLength: 1, description: "The search query or question to answer" }),
    allowed_domains: Type.Optional(Type.Array(Type.String(), {
        description: "Only include these domains (DeepSeek/Anthropic only). Cannot combine with blocked_domains.",
    })),
    blocked_domains: Type.Optional(Type.Array(Type.String(), {
        description: "Exclude these domains (DeepSeek/Anthropic only). Cannot combine with allowed_domains.",
    })),
    urls: Type.Optional(Type.Array(Type.String(), { 
        description: "Additional URLs to analyze along with search (up to 20)",
        maxItems: 20
    })),
});
export type WebSearchInput = Static<typeof WebSearchSchema>;

export async function webSearch(
    id: string, 
    params: WebSearchInput, 
    signal: AbortSignal,
    onUpdate: AgentToolUpdateCallback | undefined, 
    ctx: ExtensionContext,
    thinkingLevel?: ModelThinkingLevel
) {
    const model = await getWebSearchModel(ctx);
    if (!model) return missingWebSearchConfigResult(ctx);

    const hasUrls = params.urls && params.urls.length > 0;
    const urlCount = hasUrls ? params.urls!.length : 0;
    
    onUpdate?.({ 
        content: [{ 
            type: "text", 
            text: hasUrls 
                ? `Searching and analyzing ${urlCount} URL(s)...` 
                : `Searching for "${params.query}"...`
        }], 
        details: {} 
    });

    try {
        const config = getConfig(model);
        if (!params.query.trim()) throw new Error("query is required");
        const hasFilters = params.allowed_domains?.length || params.blocked_domains?.length;
        if (params.allowed_domains?.length && params.blocked_domains?.length) {
            throw new Error("allowed_domains and blocked_domains cannot be combined");
        }
        if (hasFilters && config.kind !== "deepseek" && config.kind !== "anthropic") {
            throw new Error("Domain filters are supported only by DeepSeek and Anthropic");
        }
        
        // Build prompt: include URLs if provided
        const prompt = hasUrls
            ? `${params.query}\n\nAlso analyze these URLs:\n${params.urls!.join("\n")}`
            : params.query;

        // Enable provider-native search tools. Google needs explicit Gemini tool names;
        // OpenAI/Anthropic are handled inside callApiStream based on the current model.
        const tools = config.kind === "google"
            ? (hasUrls
                ? [{ [config.searchTool!]: {} }, { [config.urlContextTool!]: {} }]
                : [{ [config.searchTool!]: {} }])
            : undefined;

        const result = await callApiStream(ctx, model, {
            ...(hasFilters ? { searchDomainFilters: {
                allowed_domains: params.allowed_domains,
                blocked_domains: params.blocked_domains,
            } } : {}),
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            ...(tools ? { tools } : {})
        }, onUpdate, signal, thinkingLevel);

        return formatWebSearchResult(result, { modelId: model.id });
    } catch (e: any) {
        return errorResult(e);
    }
}
