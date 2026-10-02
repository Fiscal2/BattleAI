export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelEnv = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type Completion = { content: string } | { error: string };

export function modelEnv(source: NodeJS.ProcessEnv): ModelEnv | null {
  const baseUrl = source.MODEL_BASE_URL?.replace(/\/$/, "");
  const apiKey = source.MODEL_API_KEY;
  const model = source.MODEL_NAME;
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

export function completeChat(
  env: ModelEnv,
  messages: ChatMessage[],
  timeoutMs = 60_000,
  fetchImpl: typeof fetch = fetch,
): Promise<Completion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(`${env.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: env.model, messages }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) return { error: `HTTP ${response.status}` };
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") return { error: "missing content" };
      return { content };
    })
    .catch(() => ({ error: "timeout" }))
    .finally(() => clearTimeout(timer));
}
