/**
 * Embedding core (no port) — shared by sw-openai's callEmbedding and the
 * agent's find_related_pages tool. Lives in its own module so tools.ts and
 * sw-openai.ts don't import each other (no cycle).
 *
 * Embedding config is independent of the chat provider; missing fields throw
 * with sentinel messages the port wrapper maps to errorKeys.
 */

export async function fetchEmbeddingVector(text: string, signal?: AbortSignal): Promise<number[]> {
  const { embeddingApiKey, embeddingApiBase, embeddingModel } = (await chrome.storage.sync.get([
    'embeddingApiKey', 'embeddingApiBase', 'embeddingModel',
  ])) as { embeddingApiKey?: string; embeddingApiBase?: string; embeddingModel?: string };

  if (!embeddingApiKey || !embeddingApiBase || !embeddingModel) {
    throw new Error('embedding-not-configured');
  }

  const response = await fetch(`${embeddingApiBase}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${embeddingApiKey}` },
    body: JSON.stringify({ model: embeddingModel, input: text }),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error((errorData as Record<string, { message?: string }>).error?.message || `Embedding API request failed (${response.status})`);
  }

  const data = await response.json() as { data?: { embedding: number[] }[] };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) throw new Error('empty-embedding');
  return embedding;
}
