/// <reference lib="webworker" />
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

let extractor: Awaited<ReturnType<typeof pipeline>> | null = null;

async function load(model: string, dtype: string): Promise<void> {
  extractor = await pipeline("feature-extraction", model, {
    dtype: dtype as "q8",
    progress_callback: (p: { status: string; progress?: number }) => {
      if (p.status === "progress") postMessage({ type: "progress", progress: p.progress ?? 0 });
    },
  });
  postMessage({ type: "ready" });
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: "load"; model: string; dtype: string } | { type: "embed"; id: number; text: string };
  const id = m.type === "embed" ? m.id : undefined;
  try {
    if (m.type === "load") await load(m.model, m.dtype);
    else if (!extractor) throw new Error("the model is not loaded yet");
    else {
      const out = await (extractor as unknown as (t: string, o: object) => Promise<{ data: Float32Array }>)(m.text, { pooling: "mean", normalize: true });
      postMessage({ type: "embedding", id: m.id, vector: out.data });
    }
  } catch (err) {
    postMessage({ type: "error", id, fatal: m.type === "load", message: String(err) });
  }
};
