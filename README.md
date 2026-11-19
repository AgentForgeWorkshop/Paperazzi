<div align="center">

# 🔎 Paperazzi

### A multi-agent AI research assistant

**A hackathon project for learning and experimenting with Agentic AI through scientific literature review.**

![Python](https://img.shields.io/badge/Python-3.11%2B-blue) ![LangChain](https://img.shields.io/badge/Agents-LangChain-purple) ![Status](https://img.shields.io/badge/Status-Hackathon%20Prototype-orange) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>


Paperazzi searches research databases, inspects available paper text, synthesizes findings, and evaluates how well review statements are supported by their citations. Its purpose is to explore **agentic AI workflows** with transparent tool use, structured handoffs, and inspectable evidence.

> **Hackathon learning project:** Built to practice agent design, tool calling, multi-agent coordination, feedback loops, and evidence tracing. This is an experimental prototype, not a validated scientific review service.

## How it works

```mermaid
flowchart LR
  Q[Research question] --> S[Searcher agent]
  S --> R[Reader agent]
  P[Document parser] --> R
  R --> RR[ReviewReasoner code]
  RR --> G[Generator agent]
  G --> J[Judge agent]
  J -->|Revision feedback, detailed mode| G
  R -->|Targeted evidence gap, at most once| S
  J --> O[Evidence-linked review and trace]
```

- **Searcher:** Searches and inspects literature records, refining queries when needed.
- **Reader:** Inspects available passages, extracts claims, records exclusions, and can request a targeted follow-up search.
- **ReviewReasoner:** Deterministic code organizes Reader-assigned claim relationships; it does **not** independently establish scientific truth.
- **Generator:** Produces a review grounded in prepared claims and citations.
- **Judge:** Uses two LLM rubrics to assess statement support and snippet relevance, returning feedback for a bounded revision.

The **document parser** and **coordinator** are ordinary code, not additional LLM agents.

## Features

- Literature retrieval from **PubMed, arXiv, Europe PMC, and Semantic Scholar**.
- Available full-text XML/PDF parsing with explicit abstract-only fallback.
- Source-linked claims, passages, locations, and inspectable agent traces.
- Evidence-gap follow-up search (up to one additional search phase).
- Citation-support and snippet-relevance assessments with visible ratings.
- Brief and detailed review modes; detailed mode supports one feedback revision.
- Local saved briefs and Markdown export.
- Explicit incomplete, unsupported, and unresolved-evidence states.

## Quick start

**Requirements:** Node.js 22+, Python 3.11+, and an OpenRouter API key for agent runs.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r agents/requirements.txt
npm run dev:agent
```

Enter the OpenRouter key at the launcher's hidden terminal prompt (or set `OPENROUTER_API_KEY` in the environment). Open:

**http://127.0.0.1:4173/?mode=multiagent**

Select **Multi-agent review · four specialists**. The multi-agent workflow runs **locally** and is not part of the hosted Worker deployment.

For the baseline interface without a model key:

```bash
npm run dev
```

This mode can return clearly labeled source excerpts instead of a model-generated synthesis.

## Explore the results

The interface includes an **Evidence & trace** view with cited passages, statement-level support and relevance assessments, and recorded agent actions. A `complete` status means the configured citation rubrics passed; it does **not** establish scientific validity.

<!-- Add a real screenshot or GIF here after capturing a successful local run. -->

## Run tests

```bash
npm test
npm run test:agents
```

The tests use fixtures and scripted model behavior. They do not establish live-model scientific accuracy. The Python test command requires the virtual environment created above.

## Documentation

- [Architecture and agent workflow](docs/architecture.md)
- [Installation and configuration](docs/getting-started.md)
- [Citation evaluation](docs/evaluation.md)
- [API reference](docs/api.md)
- [Learning milestones and next steps](docs/development.md)

## About this project

Paperazzi was built for **hackathon learning and experimentation with Agentic AI**. The project focuses on understanding how specialized agents use tools, exchange structured evidence, recover from incomplete searches, and improve drafts through feedback. Citation ratings are LLM-based and should not be interpreted as independent scientific verification.

## License

Paperazzi is released under the [MIT License](LICENSE).

