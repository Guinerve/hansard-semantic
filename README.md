# hansard-semantic

> Search Parliament by meaning, entirely in the browser, with no server.

**Status:** v0.1 core built (search quality measured; the browser UI has not been run in a browser yet) · Portfolio project #9 · see `../README.md`

## The idea

A static GitHub Pages site with precomputed embeddings for a slice of Hansard (e.g. one year of energy-policy speeches). Queries are embedded in the browser with transformers.js, so nothing leaves the user's device.

## Stack

Python precompute (OpenAustralia API, sentence embeddings); TypeScript, Vite, transformers.js front end.

Dev server binds to `0.0.0.0` on port **5193** so it's reachable over Tailscale (`vite --host 0.0.0.0 --port 5193 --strictPort`). Deploy to GitHub Pages.

## Build plan (v1)

- [x] Fetch and chunk speeches: **House of Reps, 2025-07-01 to 2026-09-17, 85 sitting days, energy-related only → 3,430 passages.** Uses OpenAustralia's public scraped XML (`data.openaustralia.org.au`), so **no API key is needed**.
- [x] Precompute embeddings with the same model used in the browser (`Xenova/all-MiniLM-L6-v2`, q8) → 1.3 MB int8 index + 4.3 MB text (1.2 MB gzipped). Done in **Node with transformers.js**, not Python, so the tokenizer and model are identical to the browser's. with the same model used in the browser; ship a compact index
- [ ] (partly done) In-browser query embedding and cosine search (Web Worker): written and builds; not yet run in a browser.
- [x] Results with speaker, date, party, electorate and a link to the source, plus a party filter

## Run it

```bash
npm install
npm run index    # rebuild the index (cached raw XML in data/)
npm run dev      # http://0.0.0.0:5193
npm test         # 3 tests; downloads the model on first run
```

## How I know it's right

3 tests (`src/search.test.ts`):

- Index integrity: one unit-norm vector per passage.
- Embedding parity: re-embedding stored passages reproduces the stored vectors (cosine > 0.99).
- **Hit rate: 12 / 12 hand-written queries return a matching passage in the top 5** (`data/eval-results.txt`).

**How much that proves:** a "hit" means one of the top 5 passages contains a required keyword (e.g. the query "building nuclear power stations" must return a passage mentioning *nuclear*). The corpus is already energy-filtered, so this is a lenient check and 12/12 is not impressive. A harder set (queries with no shared keywords, paraphrases, expected specific speeches) is the next step.

Review fixes: the search is gated on both the model and the index; load, worker and fetch failures stay visible instead of "loading…"; the index builder refuses to overwrite with an empty result; the test writes `data/` itself so CI works on a fresh checkout.

**Not verified:** the browser/Node parity. Both use transformers.js with the same q8 model, but onnxruntime-web (browser) and onnxruntime-node were not compared.

## Limits

The production bundle includes the onnxruntime WASM (~27 MB, ~6.8 MB gzipped), and the first visit downloads the ~25 MB model from Hugging Face. Energy-related speeches were selected by keyword (≥3 hits in a passage, or an energy heading), so the slice has gaps.

One corpus slice; model size and index size trade off against load time.

## Next (tomorrow)

- Run it in a browser: model download, worker, results, timing.
- Harder evaluation set; try a bigger model (bge-small) if hit quality is poor.
- Decide on index size vs. coverage (widen the date range).

## Stretch

Hybrid keyword + semantic ranking; topic timeline view.

## Definition of done

- [ ] Hero GIF or screenshot at the top of this README
- [x] Live demo link or one-command run (`npm install && npm run dev`)
- [ ] "How I know it's right" section filled in with real results
- [ ] Tests passing in CI, badge added
- [ ] "Limits" section written
- [ ] Licence chosen, repo description and topics set
- [ ] Pinned on GitHub profile and added to guinerve.github.io
- [ ] Added to `career-radar/data/cv/portfolio.json`
