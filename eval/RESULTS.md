# Retrieval evaluation

Generated 2026-10-13 by `npm run eval`. 50 queries (47 with at least one relevant passage), 1487 judgments (1487 model-draft).

The model-draft labels have not been reviewed by a human. These scores are exploratory results, not an independent relevance benchmark.

## nDCG@10 by query type

| System | keyword | paraphrase | negation | known-item | All (95% CI) | Δ vs minilm (95% CI) |
|---|---:|---:|---:|---:|---:|---:|
| minilm (v0.1 baseline) | 0.809 | 0.514 | 0.380 | 0.601 | 0.588 (0.52–0.67) | – |
| bm25 | 0.742 | 0.471 | 0.489 | 0.494 | 0.558 (0.48–0.64) | -0.030 (-0.13 to 0.05) |
| hybrid-minilm (shipped) | 0.842 | 0.571 | 0.468 | 0.682 | 0.659 (0.59–0.74) | +0.071 (0.01 to 0.12) |

## Other measures (answerable queries)

| System | MRR@10 (first grade-2) | P@5 | Recall@20 (pooled) | Judged@10 | Known item: target in top 1 / 10 / 20 | Negation: wrong-stance share of top 10 |
|---|---:|---:|---:|---:|---:|---:|
| minilm (v0.1 baseline) | 0.660 | 0.660 | 0.529 | 1.00 | 3 / 4 / 5 of 6 | 0.455 |
| bm25 | 0.576 | 0.651 | 0.502 | 1.00 | 2 / 4 / 4 of 6 | 0.231 |
| hybrid-minilm (shipped) | 0.665 | 0.728 | 0.608 | 1.00 | 3 / 3 / 4 of 6 | 0.334 |

## Can the score tell when there is no answer?

3 queries have no relevant passage at all (`irr-afl`, `irr-dogs`, `irr-sourdough`). AUC = probability that an answerable query's top-1 score beats an unanswerable one's (1.0 = a threshold separates them perfectly; 0.5 = no signal). Only meaningful for cosine-scored systems.

| System | AUC (no answer) | AUC (8 out-of-scope queries) | Mean top-1 (answerable) | Mean top-1 (no answer) | Highest top-1 with no answer | Lowest top-1 with an answer |
|---|---:|---:|---:|---:|---:|---:|
| minilm (v0.1 baseline) | 0.993 | 0.914 | 0.582 | 0.238 | 0.280 | 0.279 |
| bm25 | – | – | – | – | – | – |
| hybrid-minilm (shipped) | 0.993 | 0.914 | 0.582 | 0.238 | 0.280 | 0.279 |

The site shows a "weak matches only" notice when the best cosine is below 0.3. On this set that flags 3 of 3 no-answer queries and 2 of 47 answerable ones (`para-ev`, `irr-visa`). The threshold was chosen on this same set, so expect it to be slightly optimistic. Hybrid systems report the best embedding cosine in the collection here (what the site checks), not the fused score.

## Per query (nDCG@10)

| Query | Type | minilm | bm25 | hybrid-minilm |
|---|---|---:|---:|---:|
| `kw-nuclear` building nuclear power stations in Australia | keyword | 0.88 | 0.48 | 0.61 |
| `kw-rooftop` how rooftop solar is helping households cut power bills | keyword | 0.70 | 0.66 | 0.68 |
| `kw-coal-close` closing coal-fired power stations and reliability of supply | keyword | 0.95 | 0.40 | 0.82 |
| `kw-transmission` the cost of transmission lines and community opposition | keyword | 0.78 | 0.80 | 0.90 |
| `kw-batteries` home batteries subsidy | keyword | 0.93 | 0.80 | 0.95 |
| `kw-gas-reserve` gas reservation and the east coast gas shortfall | keyword | 0.95 | 0.94 | 0.94 |
| `kw-netzero` reaching net zero emissions by 2050 | keyword | 0.95 | 0.89 | 0.94 |
| `kw-offshore` offshore wind farms and local jobs | keyword | 0.67 | 0.80 | 0.73 |
| `kw-2035` Australia's 2035 emissions reduction target | keyword | 0.62 | 0.85 | 0.84 |
| `kw-hydrogen` hydrogen industry investment | keyword | 0.89 | 0.80 | 1.00 |
| `kw-smallbiz` electricity prices rising for small business | keyword | 0.63 | 0.67 | 0.76 |
| `kw-rez` renewable energy zones and the grid | keyword | 0.75 | 0.83 | 0.91 |
| `para-nuclear` should the country go down the atomic path to keep the lights on | paraphrase | 0.36 | 0.00 | 0.04 |
| `para-rooftop` panels on suburban roofs lowering what families pay each quarter | paraphrase | 0.81 | 0.48 | 0.63 |
| `para-batteries` government help for households to store their own daytime power for the evening | paraphrase | 0.53 | 0.89 | 0.91 |
| `para-transmission` farmers angry about giant pylons and wires being pushed across their land | paraphrase | 0.88 | 0.77 | 0.82 |
| `para-coal` ageing generators that burn black rock reaching the end of their life | paraphrase | 0.34 | 0.32 | 0.49 |
| `para-gastax` making exporters of our seabed fuel pay a fair share to the public | paraphrase | 0.68 | 1.00 | 1.00 |
| `para-repeal` scrapping the legal commitment to eliminate carbon pollution by mid-century | paraphrase | 0.06 | 0.13 | 0.11 |
| `para-bills` families who can't afford to heat or cool their homes | paraphrase | 0.34 | 0.57 | 0.54 |
| `para-datacentres` AI server warehouses gobbling up enormous amounts of power | paraphrase | 0.80 | 0.55 | 0.80 |
| `para-ev` people switching to cars you plug in instead of filling up at the bowser | paraphrase | 0.26 | 0.17 | 0.36 |
| `para-fuel` if the sea lanes are blocked will we run out of diesel for trucks and tractors | paraphrase | 0.47 | 0.45 | 0.57 |
| `para-adapt` getting towns ready for worse floods, fires and heatwaves | paraphrase | 0.56 | 0.26 | 0.53 |
| `para-offsets` making sure the offsets polluters buy represent real abatement | paraphrase | 0.78 | 0.64 | 0.82 |
| `para-aer` splitting the energy watchdog off from the competition regulator | paraphrase | 0.70 | 1.00 | 1.00 |
| `para-reserve` a government stockpile of rare earths and lithium | paraphrase | 0.47 | 0.31 | 0.41 |
| `para-2035` how deep the nation's pollution cuts should be in ten years' time | paraphrase | 0.19 | 0.00 | 0.11 |
| `neg-nuclear-against` reasons Australia should not build nuclear reactors | negation | 0.29 | 0.68 | 0.55 |
| `neg-nuclear-for` the case for lifting the ban on nuclear energy | negation | 0.41 | 0.32 | 0.61 |
| `neg-renew-dearer` renewables have not made electricity cheaper | negation | 0.27 | 0.00 | 0.00 |
| `neg-renew-cheaper` renewables are the cheapest form of new power | negation | 0.65 | 0.66 | 0.73 |
| `neg-netzero-oppose` members who do not support net zero | negation | 0.74 | 0.76 | 0.84 |
| `neg-no-new-fossil` no new coal or gas projects should be approved | negation | 0.38 | 0.73 | 0.57 |
| `neg-more-gas` Australia needs to open up more gas supply, not less | negation | 0.30 | 0.41 | 0.45 |
| `neg-battery-critic` criticism that the home battery rebate is not working | negation | 0.00 | 0.35 | 0.00 |
| `ki-battery-electorates` minister listing electorates where more than a tenth of homes installed subsidised batteries | known-item | 0.68 | 0.31 | 0.57 |
| `ki-smelter-solar` a smelter buying power from solar farms the local MP had campaigned against | known-item | 0.73 | 0.73 | 0.82 |
| `ki-diesel-credit` ending the rebate that lets miners pay less for fuel in their haul trucks | known-item | 0.68 | 0.17 | 0.72 |
| `ki-hormuz` the Strait of Hormuz closing and millions of barrels of oil a day missing from world markets | known-item | 0.70 | 0.80 | 0.84 |
| `ki-sea-level` a quarter of a million homes at risk from rising seas by the end of the century | known-item | 0.83 | 0.44 | 0.72 |
| `ki-fuel-cfd` underwriting fuel importers against losses if the oil price collapses | known-item | 0.00 | 0.51 | 0.42 |
| `irr-gp` bulk billing rates for GP visits | irrelevant | 0.69 | 0.87 | 0.68 |
| `irr-afl` who won the AFL grand final | irrelevant (no answer) | – | – | – |
| `irr-dogs` penalties for owners of dangerous dogs | irrelevant (no answer) | – | – | – |
| `irr-childcare` childcare subsidy for working parents | irrelevant | 1.00 | 0.00 | 0.57 |
| `irr-sourdough` how to bake sourdough bread at home | irrelevant (no answer) | – | – | – |
| `irr-visa` cancelling visas of non-citizens convicted of crimes | irrelevant | 0.29 | 0.50 | 1.00 |
| `irr-uni` cutting student debt for university graduates | irrelevant | 0.55 | 0.69 | 0.73 |
| `irr-socialmedia` banning children under 16 from social media | irrelevant | 0.53 | 0.83 | 0.91 |

## How to read this

- Grades: 2 = answers the query, 1 = on topic but partial, 0 = not relevant. For negation queries a passage arguing the opposite side is graded 0 and flagged `opposite`.
- Judgments were pooled (TREC style): the union of every system's top 10 per query was judged; anything never retrieved by any system is unjudged and counts as not relevant. Judged@10 shows how complete the labels are for each system's top 10. Recall@20 is relative to the pooled relevant set, so it overstates true recall.
- MRR counts only grade-2 passages, so it measures "how far down is the first passage that actually answers the question".
- The CIs are bootstrap intervals over queries (10,000 resamples); with 47 answerable queries they are wide. Treat differences whose interval crosses 0 as unproven.
