# hansard-semantic

Search Australian House of Representatives energy debates by meaning. The search runs in your browser, with no search server.

**[Try the live search](https://guinerve.github.io/demos/hansard-semantic/)**. The first search downloads a 23 MB model.

[![CI](https://github.com/Guinerve/hansard-semantic/actions/workflows/ci.yml/badge.svg)](https://github.com/Guinerve/hansard-semantic/actions/workflows/ci.yml)

![The search page with the query "worry about the cost of new transmission lines" and its first two results](assets/screenshot.png)

Hansard is the official record of what members say in Parliament. Keyword search finds a speech only when you guess its exact words. This app also finds passages that match what you mean. For example, "worry about the cost of new transmission lines" finds a member who talks about "cost blowouts" on the VNI West project.

I built it to test how well a small model in the browser can search real parliamentary text. I measured the result on 50 labelled queries. Your query never leaves your device.

## What it searches

The index holds 3,430 passages from House of Representatives Hansard. They come from 85 sitting days, from 2025-07-01 to 2026-09-17. The builder keeps only speeches about energy. Each result shows the speaker, party, electorate, date, debate heading and a link to the full debate on OpenAustralia. You can filter by party.

## Quick start

You need Node 22.18 or later. The index is in the repository, so you do not have to build it.

```bash
npm ci
npm run dev
```

Then open `http://localhost:5193`. The dev server listens on all interfaces (`0.0.0.0`) on port 5193 and stops if that port is in use. Other devices on your network can use `http://<your-host>:5193`.

To make a static build in `dist/`:

```bash
npm run build
```

## How it works

1. A Node script downloads the public Hansard XML from OpenAustralia. It keeps passages about energy and cuts long speeches into parts of about 170 words.
2. The script embeds each passage with `Xenova/all-MiniLM-L6-v2` (q8) through transformers.js. It stores the vectors as int8 (1.3 MB) and the text as JSON (4.3 MB).
3. In the browser, a Web Worker embeds your query with the same model, tokenizer and mean pooling.
4. The page ranks passages two ways: by cosine similarity to your query, and by BM25 keyword score. It combines the top 100 from each list with reciprocal rank fusion.
5. Each result shows its cosine similarity and a label: `both`, `meaning` or `keywords`. The label tells you which list found the passage. The score is a similarity, not a probability of relevance.
6. If the best cosine in the whole collection is below 0.3, the page warns that it found only weak matches.

## Results

I wrote 50 test queries. They include keyword queries, paraphrases, negations ("why nuclear is not the answer"), known items and questions outside the topic. The labelled set has 1,487 pooled judgments.

**All judgments are unreviewed `model-draft` labels.** No person has checked them yet. Treat these numbers as exploratory, not as independent validation.

| Ranker | nDCG@10 | P@5 | Share of negation results on the wrong side |
|---|---:|---:|---:|
| MiniLM alone | 0.588 | 0.660 | 0.455 |
| BM25 alone | 0.558 | 0.651 | 0.231 |
| Shipped hybrid | 0.659 | 0.728 | 0.334 |

- The hybrid improves nDCG@10 by 0.071 over MiniLM alone (95% bootstrap interval 0.01 to 0.12). It is still worse on some queries.
- For known items, the hybrid puts 3 of 6 targets in the top 10. MiniLM alone puts 4 of 6 there.
- The weak match warning flags all 3 queries that have no answer, and 2 of the 47 that do. I chose its threshold on this same set, so the real rate will probably be a little worse.

The full report is in [`eval/RESULTS.md`](eval/RESULTS.md), with results for each query.

### In the browser

I also ran all 50 queries through the production build in headless Chrome on an Apple M4 Max ([`eval/BROWSER.md`](eval/BROWSER.md)):

- The model was ready 8.3 s after a cold load and 0.3 s after a warm reload. On Chrome's "Fast 4G" setting, a cold load took 32.9 s.
- A query took 16.8 ms at the median: 15.3 ms to embed it and 1.5 ms to rank.
- The top 8 in the browser matched the top 8 from Node by 95.0% on average. The two runtimes compute slightly different q8 embeddings, so close ties can change order.

## Limits

- The ranking does not understand negation or political stance well. Read the passage and its source before you draw a conclusion.
- The corpus is a keyword selection of energy debates, not all of Parliament. Some speeches also cover other topics, and the filter misses some energy passages.
- The first visit downloads about 23 MB of model weights from Hugging Face and the ONNX Runtime WASM (5.6 MB compressed) from jsDelivr. The browser caches both. A deployed copy therefore depends on these two hosts.
- `dist/` also contains a 27 MB copy of the WASM file. The page never requests it.
- The labels need review by a person. Recall counts only the pooled judgments, not every relevant passage in the corpus. The confidence intervals do not include label error.

## Development

```bash
npm test         # 26 tests; downloads the model on the first run
npm run build    # type check and static build
```

The tests check the following:

- The index has one unit vector for each passage. Embedding stored passages again gives a cosine above 0.98.
- Ranking, fusion, the party filter, BM25 and empty or unmatched queries work as expected.
- Every judged passage in the labelled set exists in the index. The shipped hybrid keeps nDCG@10 above 0.62 (it measures 0.659), so a ranking regression fails CI.
- Result HTML escapes all passage fields and links only to `http` or `https` sources.
- XML and numeric entities decode correctly, and only once.

### Run the evaluation again

```bash
npm run eval                   # MiniLM, BM25 and the shipped hybrid
npm run build
npm run bench -- --throttle    # Chrome, with a temporary preview server on port 5294
npm run label                  # labelling page on port 5293
```

`npm run eval` writes `eval/RESULTS.md` and `eval/results.json`. `npm run bench` writes `eval/BROWSER.md` and `eval/browser-bench.json`. Set `CHROME_PATH` if Chrome is not in a standard location. Ports 5293 and 5294 must be free.

The labelling page shows the committed judgments. It records a judgment as `human` only when a person saves it. Its server accepts JSON writes only from its own page and only for known query and passage IDs. Run it on a network you trust, and stop it when you finish.

These commands are slower:

```bash
npm run index    # download, cut and embed the corpus again; raw XML is cached in data/
npm run pool     # add candidates from all systems, including BGE and GTE
npm run eval -- --systems minilm,bge-small,gte-small,bm25,hybrid-minilm,hybrid-bge
```

The BGE and GTE models download their own weights and embed the corpus on the first run. If you change the corpus or the pool, review the labels before you compare scores. The committed report does not compare BGE or GTE.

## Roadmap

- Review the relevance labels by hand with `npm run label`.
- Compare larger embedding models after that review.
- Add more of Parliament, with a new evaluation for the larger corpus.

## Licence

The code is under the [MIT licence](LICENSE). The Hansard text comes from [OpenAustralia](https://www.openaustralia.org.au/).
