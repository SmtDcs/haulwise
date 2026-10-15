/**
 * Minimal OpenAI-compatible chat client with tool calling. Works with OpenAI,
 * xAI, OpenRouter, Groq or any compatible gateway; picked from env.
 */
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export interface LlmConfig { baseUrl: string; apiKey: string; model: string; name: string }

export function detectLlm(env = process.env): LlmConfig | null {
  if (env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL)
    return { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL, name: env.LLM_MODEL };
  if (env.OPENAI_API_KEY) return { baseUrl: 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY, model: env.LLM_MODEL ?? 'gpt-4.1', name: 'openai' };
  if (env.XAI_API_KEY) return { baseUrl: 'https://api.x.ai/v1', apiKey: env.XAI_API_KEY, model: env.LLM_MODEL ?? 'grok-4', name: 'xai' };
  if (env.OPENROUTER_API_KEY) return { baseUrl: 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY, model: env.LLM_MODEL ?? 'openai/gpt-4.1', name: 'openrouter' };
  if (env.GROQ_API_KEY) return { baseUrl: 'https://api.groq.com/openai/v1', apiKey: env.GROQ_API_KEY, model: env.LLM_MODEL ?? 'llama-3.3-70b-versatile', name: 'groq' };
  return null;
}

export async function chat(cfg: LlmConfig, messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatMessage> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      messages,
      tools: tools.map(t => ({ type: 'function', function: t })),
      tool_choice: 'auto',
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  return json.choices[0].message;
}
