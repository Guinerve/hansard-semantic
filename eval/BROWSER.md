# Browser benchmark

Measured 2026-10-13 by `npm run bench` on Google Chrome 155.0.8059.40 (headless), darwin 27.0.0, Apple M4 Max (14 cores), serving the production build from `vite preview`. The model comes from Hugging Face over this machine's real internet connection, so cold-load times depend on it.

| | Cold (empty cache) | Warm (reload, same profile) |
|---|---|---|
| Index ready (passages + vectors loaded, BM25 built) | 0.2 s | 0.1 s |
| Model ready (search usable) | 8.5 s | 0.3 s |
| Transferred | 127.0.0.1:5294 2.1 MB, huggingface.co 0.2 MB, us.aws.cdn.hf.co 23.0 MB, cdn.jsdelivr.net 5.6 MB | ≈0 (all cached) |
| Model ready on Chrome's "Fast 4G" preset (cold) | 33.0 s | – |

Per query, over all 50 labelled queries typed into the search box (after one warm-up query):

| | p50 | p95 | max |
|---|---:|---:|---:|
| Embed query (Web Worker, q8 MiniLM) | 15.6 ms | 22.7 ms | 23.5 ms |
| Rank (cosine over 3,430 vectors + BM25 + fusion) | 1.6 ms | 2.1 ms | 2.8 ms |
| Total | 17.3 ms | 24.3 ms | |

Memory after the queries: main-thread JS heap 20.6 MB, worker JS heap 7.3 MB (the ONNX model weights live in WASM memory, which this does not count).

**Browser = Node:** the browser's top 8 overlaps the Node evaluation's top 8 by 95.0% on average; 6 of 50 queries return the identical ordered list. nDCG@8 over the 47 answerable queries: 0.643 from the browser's own result lists, 0.650 from Node. The order differs because the browser (onnxruntime-web WASM) and Node (onnxruntime-node) compute slightly different q8 query embeddings: across 400 displayed results the cosine differs from Node's by 0.0066 on average (p95 0.017, max 0.028, including ±0.005 display rounding), which reorders near-ties before the rank fusion.

No console or page errors.
