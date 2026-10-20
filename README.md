# Vector database calculator

Describe an agent or RAG workload and get a recommendation for a flat file, keyword search, pgvector, or a dedicated vector database. Built for Actian VectorAI DB. Live at https://actian-devs.github.io/vector-db-calculator/

## Run it

```bash
npm install
npm run dev          # local dev server
npm run verify       # typecheck, unit tests, build
npm run test:e2e     # browser tests against the built export
```

Node 22 or newer.

## What it does

Eleven inputs in five groups (workload size, performance target, query shape, operations, deployment) produce one of four verdicts. The verdict updates on every change.

| Tier | Verdict | When |
|---|---|---|
| 0 | You don't need a vector database yet | A flat in-memory scan meets the latency target, with no filtering, one workspace and low concurrency |
| 1 | You need keyword search, not vectors | Queries match exact terms |
| 2 | pgvector will carry you for now | The index fits in the memory budget |
| 3 | You need a dedicated vector database | The index exceeds the memory budget, or several operational demands combine on a workload past half the pgvector ceiling |

Two ceilings are computed from the inputs. The flat-scan ceiling is the smaller of what the latency target allows (`latency x throughput / (2 x dimensions)`) and what fits in memory. The pgvector ceiling is `memory / (dimensions x 4 bytes x HNSW overhead)`, which at the default 32 GB is about 3.5M items at 1536 dimensions and 14M at 384.

Hybrid search, multi-tenancy, constant churn, always-on filtering, air-gapped and edge deployment appear under "Things to design for", each with a note on how Postgres handles it. Hybrid search, multi-tenancy, constant churn and always-on filtering (once past the heavy-filtering assumption) count toward tier 3 only in combination, on a workload past half the pgvector ceiling, and the bar is higher when you already run Postgres. Air-gapped and edge deployment never count.

## Features

- **Editable assumptions.** Memory budget, HNSW overhead, headroom and throughput range sit in a panel. Changes recalculate the verdict and travel with the shared link.
- **Export.** Copy the result as Markdown for an ADR or ticket, or download it as JSON. The record includes the assumptions used and the considerations weighed.

## Memory cost estimate

A card under the cost table prices the memory the workload needs, today and in 12 months. A "Cost as you scale" chart shows the same estimate from 1K to 100M items. It covers hardware memory only.

- **Formula.** Memory in decimal GB equals `items x dims x 4 bytes x hnswMemoryOverhead (1.5) x headroom (1.3)`. Cost equals memory times the price per GB-month, shown as low, mid and high. Both multipliers are editable estimates.
- **Units.** All GB on the page are decimal (10^9 bytes). Cloud prices are per GiB, so `lib/prices.ts` converts each one to per decimal GB-month. The seeded range is $5.57 to $5.62.
- **Prices.** `data/memory-prices.json` holds dated, sourced on-demand list prices for US regions, listed below.

| Provider | Instance | Region | Hourly | Source |
|---|---|---|---|---|
| AWS | r7i.xlarge, 4 vCPU, 32 GiB | us-east-1 | $0.2646 | AWS EC2 bulk price list |
| GCP | n2-highmem-4, 4 vCPU, 32 GiB | us-central1 | $0.262028 | gcloud-compute.com machine-types CSV (hour column) |

Prices refresh weekly. A GitHub Action reads the AWS and GCP price lists and opens a pull request for review.
