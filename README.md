# Paperazzi

A local literature-review application with four LangChain agents, source-linked claims, ReviewReasoner, and two LLM citation-evaluation rubrics.

## Quick start

Requires **Node.js 22+** and **Python 3.11+**.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r agents/requirements.txt
npm run dev:agent
```

Enter your OpenRouter key at the launcher's hidden prompt. The launcher keeps it in process memory. You can alternatively supply `OPENROUTER_API_KEY` through your environment. Keep keys out of GitHub.

Open http://127.0.0.1:4173/?mode=multiagent. Brief mode runs one scoring pass; Detailed mode allows one revision. The Evidence & trace tab shows relation/action decisions, source passages, statement-support ratings, and individual snippet-relevance ratings.

```text
Searcher agent → Reader agent → ReviewReasoner → Generator agent → Judge agent
                    │
              Document parser
```

The coordinator is ordinary code. Parser and ReviewReasoner are ordinary functions. The separate Python-program-generation and executable-verification layer is **not connected**. The current Judge uses the two LLM rubrics and does not establish scientific validity.

For the baseline webpage without the agent launcher, run `npm run dev`. Without a server-side model key it returns labeled source excerpts.

## Baseline integrated-review behavior

- Searches arXiv (research preprints), PubMed (default, NCBI), Europe PMC, or Semantic Scholar. arXiv Atom and PubMed XML abstracts are normalized into the same source-linked response.
- Reads available abstracts together, groups equivalent claims, preserves study conditions and disagreements, and writes one connected review with joint citations. Exact evidence quotations must match their source abstracts.
- Provides source abstracts, a transparent processing log, local saved briefs, copy, and Markdown export.
- Returns clear empty, timeout, and provider-rate-limit states.
- Runs a Reader model, a deterministic relation reasoner, and a Generator model when configured. It does not parse PDFs or independently verify scientific support. Post-generation checks validate citation mappings and retained conflicts, not semantic entailment.

## Components and integration

`backend/research.mjs` implements retrieval and the labeled fallback. `backend/synthesis.mjs` implements the Reader → reasoner → Generator pipeline and source validation. `backend/worker.mjs` serves the API and frontend. `public/` holds the interface. `scripts/build.mjs` creates the self-contained Cloudflare Worker. `scripts/dev.mjs` runs it locally.

The supplied `backend/review_reasoner.py` is preserved unchanged. Hosted execution uses `backend/review_reasoner.mjs`, a JavaScript translation tested against the original Python for merged, conflicting, empty, filtered, and structured-feature cases. The Reader selects fixed passage IDs; evidence quotations are resolved directly from the source text. Reader evidence records become reasoner documents; each record retains its paper ID, quotation, conditions, and source number. A score of 1 means the quotation was found verbatim, not 100% scientific confidence. Reader-assigned semantic relations guide the reasoner; relation/action outputs guide the Generator. The Python file is executed by parity tests, not directly by the JavaScript host.

The baseline Reader and Generator are fixed structured LLM calls. The local multi-agent mode described below is a separate implementation with four actual `create_agent` loops. The independent verification service remains unconnected.

Keep the response contract below when replacing the baseline so the webpage continues to work. Store API keys server-side only. Do not put them into browser JavaScript.

## API

`POST /api/research`

```json
{"query":"large language models","source":"arxiv","years":"all","limit":8,"length":"brief"}
```

Source is `arxiv`, `pubmed` (default), `europepmc`, or `semantic`. arXiv date filtering uses submission dates. PubMed uses publication dates. Requests are serialized per provider, paced, and successful metadata responses are cached for ten minutes within each worker instance. Upstream rate limits still apply. Years is `all` or `5`. Limit is 4, 8, or 12. Length is `brief` or `detailed`.

Response:

```json
{
  "query":"...",
  "createdAt":"ISO timestamp",
  "mode":"extractive",
  "database":"Europe PMC",
  "scope":"Biomedical and life-sciences literature",
  "total":100,
  "papers":[{"id":"MED:...","number":1,"title":"...","authors":"...","year":2026,"journal":"...","doi":null,"url":"https://...","abstract":"...","source":"Europe PMC"}],
  "insights":[{"text":"Exact excerpt","paperId":"MED:...","sourceNumber":1}],
  "checks":{"sources":1,"withAbstract":1,"citedInsights":1,"verification":"not_connected"},
  "limitations":["..."],
  "steps":[{"name":"Searcher","detail":"..."}]
}
```

`GET /api/health` reports current operating mode. Search queries are sent to the selected provider. Saved briefs and query history are stored in browser localStorage, not on a server.

## Build and test

```sh
node --test tests/*.test.mjs
node scripts/build.mjs
```

The output is `dist/server/index.js`. `.openai/hosting.json` preserves the existing private Sites identity.

## Workshop model configuration

The hosted Site reads `OPENROUTER_API_KEY` only from its server-side secret store. `OPENROUTER_MODEL` defaults to `openai/gpt-4.1-mini`. The key is never included in browser JavaScript, reports, exports, logs, or source control. Local development can receive the same environment variables from the process environment.

The endpoint is fixed to `https://openrouter.ai/api/v1/chat/completions`, with redirects disabled. Requests use strict JSON schemas. The baseline integrated review makes at most two synthesis calls, without automatic paid retries. Multi-agent mode has separate budgets described below. Changing study conditions prevents deterministic duplicate merging; semantic equivalence across different wording is assigned by the Reader.

Synthesized responses have `mode: "synthesized"`, `review.paragraphs[].sentences[]` with `text`, `claimIds`, and `sourceNumbers`, plus `claims` and a full `reasoning` input/output trace. Legacy `insights` remain for compatibility. Missing model configuration is explicitly reported as `synthesis.status: "not_configured"`.

Both the research question and retrieved abstracts are sent to the configured model provider for synthesis. Baseline synthesis sends available abstracts. Multi-agent mode also sends bounded passages extracted from publicly available full text; raw PDF files are not sent to the model.

## User-provided evaluation rubrics

`backend/evaluation.mjs` transcribes the two supplied prompt images. Statement support uses `Fully supported`, `Partially supported`, or `No support` against the concatenation of a statement's cited passages. Relevance uses `Relevant` or `Irrelevant` separately for each cited passage. Both judges receive only the question, statement, and relevant snippet text, never the reasoner's relation label or external evidence.

The original near-identical-wording requirement for Fully supported is preserved. The original partial-support wording and its two-key-point example are preserved as supplied. Only the incorrect closing `</statement>` after the snippet is corrected to `</snippet>`. Independent cases are batched in JSON for efficiency, and each result retains `Rating: [[...]] Analysis: ...`.

`POST /api/evaluate` accepts `{ "report": { "query", "papers", "claims", "review" } }`. Evidence quotations and citation mappings are revalidated before judging. Results include statement-level relations and support ratings, per-passage relevance, exact passages, analyses, rubric text, and separate aggregate counts. Partial support is never counted as full support. Successful repeated evaluations are cached for 30 minutes in the local server's memory.

Use the Evidence tab and select Evaluate summary. Evaluation uses the workshop OpenRouter key and the same model by default; `OPENROUTER_JUDGE_MODEL` optionally selects another judge model. These are LLM rubric judgments, separate from the proposed executable evidence-verification layer. Reports and Markdown exports preserve the evaluations.


## Paperazzi learning milestone 1: Searcher agent (local only)

Choose **Searcher agent · learning milestone 1** in Run mode. The baseline integrated review remains available. The new Searcher uses the real LangChain `create_agent` loop with three Python tools: `search_literature`, `inspect_sources`, and `finish_search`. The model chooses query refinement, inspection, and completion. The selected database and date range remain user-controlled.

Set up Python 3.11+ in a project-local environment:

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r agents/requirements.txt
```

Run `npm run dev:agent` to enter the workshop key at a hidden terminal prompt. It stays in process memory. If `OPENROUTER_API_KEY` is already in the process environment, the prompt is skipped. `npm run dev` continues to support the baseline without a model key. `OPENROUTER_SEARCHER_MODEL` optionally overrides `OPENROUTER_MODEL` for this agent. No key belongs in source code, browser storage, or trace exports. No paid retries are automatic.

The Node server launches `agents/searcher.py` as a subprocess for each run. Its retrieval tool calls a token-protected loopback endpoint which reuses our existing rate-limited database functions. This is a direct tool connection, not MCP. Searcher mode is not part of the hosted Worker deployment.

Hard limits: 5 model calls, 8 tool calls, 3 searches, 900 output tokens per model call, and a 3-minute process deadline. The observed-token ceiling is checked before the next model call, so it is not an exact spending cap. Finished selections must reference sources actually retrieved and inspected. Plain model text cannot masquerade as a completed search. Empty or incomplete searches are explicit. These checks do not prove scientific relevance.

The interface exposes instructions, tool schemas, model-input previews, tool requests/results, usage metadata, and the stop reason. Export downloads a JSON trace. Previews are truncated and are not hidden model reasoning.

```sh
.venv/bin/python -m unittest discover -s tests -p test_searcher.py -v
```

These tests exercise the real LangChain runtime with scripted model decisions and synthetic literature fixtures; they make no network requests or model calls. They verify refinement after empty search, source inspection, rejection of invented IDs, and enforced limits. A live OpenRouter smoke test is separate.

Milestone 1 remains available as a standalone Searcher demonstration. See the four-agent mode below for the connected implementation.

## Four-agent literature review (local only)

Choose **Multi-agent review · four specialists** in Run mode. The pilot starts with up to four papers. One Reader-requested follow-up Searcher run can add up to two new papers (six total). Existing baseline/Searcher modes remain available.

```text
Searcher agent → Reader agent → ReviewReasoner code → Generator agent → Judge agent
                    ↑                                   ↑                 │
              Document parser                           └── feedback ─────┘
```

- **Searcher:** existing model/tool loop for query refinement and source selection.
- **Reader:** separate LangChain loop. Opens selected papers, chooses sections and passage windows, records exclusions, and returns claim groups citing only passages actually inspected. It can call `request_followup_search` after inspecting current papers when evidence essential to the question is missing. The tool records the missing information, why it matters, an exact targeted query, and inspected passage IDs. Its semantic relation labels and gap assessments are provisional.
- **Parser:** `agents/documents.py`, ordinary code. Retrieves PMC full-text XML through NCBI (Europe PMC fallback), or supported arXiv PDFs. XML retains section/element locations; PDF text retains page numbers. It does not perform OCR or reconstruct all table layouts. At most 60,000 characters/90 passages per paper and 35 PDF pages are extracted. Every source is explicitly `full_text_xml`, `full_text_pdf`, or `abstract_only`.
- **ReviewReasoner:** remains separate deterministic code in `backend/review_reasoner.mjs`; receives extracted evidence and upstream semantic labels and produces relation/action records. Labels are not support verdicts.
- **Generator:** separate LangChain loop with `inspect_claims`, `submit_draft`, and `finish_writing`. It handles prepared evidence only, not retrieval/parsing. Invalid citations and omitted conflicting groups are rejected; the model can revise its submission.
- **Judge:** separate LangChain loop with `inspect_evidence`, `run_rubrics`, and `finish_judging`. It must inspect all statements and obtain both original rubric evaluations. Support and relevance use separate fixed LLM prompt calls; the agent can inspect failures and communicate revision priorities, but cannot override ratings or skip coverage.
- **Coordinator:** bounded ordinary Node orchestration in `scripts/multiagent.mjs`, not a fifth LLM agent. Passes validated records between specialists. On a Reader `needs_search` handoff, invokes Searcher once more with the selected database/date filters and already-reviewed IDs excluded, deduplicates IDs/DOIs, adds at most two new sources, then resumes Reader. Existing source numbers, parsed documents, read passage IDs, and exclusions are retained. No further Reader search is permitted. Separately allows at most one Generator revision and second Judge run, and labels unresolved rubric failures `needs_revision`.

All four roles use OpenRouter. Optional role overrides are `OPENROUTER_SEARCHER_MODEL`, `OPENROUTER_READER_MODEL`, `OPENROUTER_GENERATOR_MODEL`, and `OPENROUTER_JUDGE_MODEL`; otherwise `OPENROUTER_MODEL` is used. Install/update `agents/requirements.txt` in `.venv` and launch with `npm run dev:agent` as above. MCP is not used.

Reader is bounded to 12 model calls, Generator and Judge to 7 each, with at most 22 tool calls per specialist invocation and a four-minute process deadline. Specialist model output is capped (Reader 3,200; others 2,600 tokens per call). An observed token ceiling is checked before the next model call. Rubric evaluation makes additional bounded model calls. These are execution limits, not an exact spending cap. Cancellation terminates the active Python worker; an already-submitted remote model request may still complete.

The website exposes per-agent model/tool events, handoffs, source scope, claim relations, and the evaluation report. A `complete` run means both supplied citation rubrics passed, not that scientific truth or clinical reliability has been established. The original strict near-identical wording rubric may flag otherwise reasonable paraphrases; unresolved failures remain visibly marked drafts. Independent executable verification from the teammate is not connected and no verification pass is fabricated.

`POST /api/multiagent` accepts the same query/source/years/length fields with `limit: 4`. It returns `status`, `runs`, `handoffs`, and, when available, a compatible `report`. Internal evaluation and literature endpoints require the server-only random bridge token. `GET /api/multiagent-progress` returns only the current stage/attempt, never credentials or paper text.

```sh
npm run test:agents
npm test
```

Python tests run the actual LangChain loops with scripted models and fixture evidence. Node tests cover handoff validation, full-text source mappings, bounded revision, incomplete-stage handling, and rejection of skipped evaluation cases. These tests make no paid API calls. Live model/provider checks are separate and do not establish scientific reliability.

## Reader evidence-gap handoff

The main workflow remains **Searcher → document parser → Reader**. The added feedback path is **Reader → Searcher → parser/Reader**. Parser is ordinary code called by Reader, not a separate agent.

The Reader must inspect or explicitly exclude every current source before requesting a follow-up. A request must cite already-read passages and explain an essential missing piece of evidence. There is no automatic search just because a paper count is low. One additional Searcher run may itself refine its query within the Searcher's existing three-search limit. It cannot reselect excluded provider IDs; the coordinator additionally deduplicates DOI matches.

The resumed Reader sees the search outcome, any newly selected papers, prior read evidence, and the pending gap. It must assess every requested gap explicitly as `resolved`, `partially_resolved`, or `unresolved`. A resolved gap requires a newly inspected evidence passage; finding a paper alone does not resolve it. Resolutions are Reader LLM judgments and do not constitute independent scientific verification. Empty/failed searches are retained, and other unpursued gaps can be recorded as unresolved.

The report's `reading` record includes `followup`, `evidenceGaps`, and per-paper passage coverage. Stable source/passage IDs preserve citations through the handoff. `complete_with_gaps` means the two citation rubrics passed but the Reader still reports unresolved/partial evidence gaps. These concern the selected and inspected sources, not proof that a finding is absent from all literature. `no_reported_gaps` is not a guarantee of completeness. Reading and parsing remain bounded; the interface reports inspected/parsed passage counts rather than claiming every full paper was read.

Each Reader invocation retains its existing model/tool/time limits; the optional resumed invocation adds another bounded phase. Maximum Reader-triggered follow-ups: 1; maximum additional papers: 2. The website distinguishes paused/resumed Reader runs from Generator revision attempts and shows the requested query, outcome, supporting passages, and gap assessments.

Reader navigation safeguards: opening a paper returns one query-ranked preview with its exact passage ID; previews count as inspected because their text is delivered to the model. Section indexes include passage counts. Passage offsets are section-local and must follow `nextStart`; invalid offsets return explicit valid ranges. Repeated windows omit previously delivered text unless `reread: true` is requested. PDF page labels match exact page numbers. Tool results include remaining-call and observed-token notices so the Reader can finish or hand off before its hard limits. Coverage counts track delivered passage IDs, not a guarantee that every passage was read or correctly interpreted.

The Reader harness requires tool actions rather than accepting a prose answer as completed extraction. The LLM still chooses which reading/search/finish action to take. Reader source/passage IDs and locations are retained in ReviewReasoner metadata; its score denotes exact-source matching, not scientific confidence.


## Statement trace and brief-mode latency

The summary has a Trace control for each statement and an Evidence & trace tab. A trace joins written claim IDs to the actual ReviewReasoner decision, writing action, source quotes, stable passage IDs, source locations and recorded agent events. Relation records remain separate from support/relevance ratings. Older reports without recorded events do not acquire a fabricated trace.

Brief mode uses at most four sentences and one Writer/Judge scoring pass. Detailed mode keeps up to eight sentences and one automatic feedback revision. Both preserve all validation and expose unresolved ratings as needs_revision. Reader returns at most four passages / 6,000 characters per window. Brief reading enters finishing mode at 20,000 observed cumulative tokens or after four model browsing calls; detailed enters at 35,000 or seven. A conservative input estimate can trigger finishing sooner. The unchanged hard guard is 75,000 cumulative observed input/output tokens, now reported as local_token_budget. Finishing mode restricts the next available model actions to valid completion, an essential search handoff, or opening/excluding sources that still need inspection. It does not invent unsupported findings or imply exhaustive reading.

Judge evidence is sent to its agent once per unique passage with statement-to-evidence IDs. Rubric evaluations still receive each exact statement and relevant snippet. The agent sees compact rating records, while the complete snippets and judgments remain in the report.
