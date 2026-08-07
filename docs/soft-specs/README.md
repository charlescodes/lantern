# Lantern Soft Specifications

> **Collection status:** mutable design material.
>
> **Authority:** none. A soft specification records intent, candidate stories, and architectural hypotheses. It does not describe shipped behavior unless it explicitly links to a current contract that does.

This directory is Lantern's design notebook between an informal conversation and an implementation contract. It gives valuable ideas a durable home without turning every idea into a promise, milestone, or framework project.

## How this collection fits

The documentation categories have different jobs:

| Category | Question it answers | Change policy |
| --- | --- | --- |
| [Current contracts](../README.md#current-contracts) | What behavior and authority boundaries exist now? | Change with the behavior or compatibility boundary. |
| [Architecture guide](../architecture-guide.md) | How is the current code composed, and where is it under pressure? | Keep aligned with the live tree. |
| Soft specifications | What experience are we aiming toward, and what might we try? | Revise freely as experiments teach us more. |
| [Milestone history](../README.md#release-and-milestone-history) | What did a release promise at that point in time? | Keep frozen except for factual corrections. |

When documents disagree, the live code and tests plus current contracts describe reality. A soft specification may explain the desired direction, but it never silently overrides them.

## Vocabulary

Soft specifications use these labels deliberately:

- **Intent** — a durable preference or desired player experience.
- **Candidate story** — a concrete scenario worth testing, not scheduled work.
- **Working hypothesis** — an architectural shape expected to support a story, but still requiring proof.
- **Constraint** — a boundary the candidate design should preserve unless a later decision explicitly changes it.
- **Open question** — a decision intentionally left unresolved.

Each document also has one lifecycle status:

| Status | Meaning |
| --- | --- |
| `Seed` | Captured but not yet organized or challenged. |
| `Working draft` | Coherent enough to guide discussion; details remain changeable. |
| `Candidate` | Narrow enough to turn into a decision-complete implementation plan. |
| `Promoted` | The relevant decisions moved into a plan, contract, decision record, tests, or milestone. |
| `Retired` | Kept for context but no longer expresses the intended direction. |

## Promotion path

```text
conversation / brain dump
          |
          v
     soft specification
          | choose one bounded story
          v
implementation plan and, when useful, a decision record
          |
          v
    code + tests + human acceptance
          |
          +--> current contract for continuing behavior
          +--> milestone document for frozen release history
```

Promotion is selective. An implementation plan should name the exact story it promotes and leave unrelated ideas here. Implementing one bookshelf interaction does not approve a universal item system, a general ECS, or every imagined elemental reaction.

## Guidance for contributors and agents

Before using a soft specification to change the engine:

1. Read the [platform contract](../platform.md) and the relevant current code and tests.
2. Treat quantities and ordering here as targets or hypotheses unless marked as current facts.
3. Select one bounded vertical slice and state which architecture seam it is meant to test.
4. Preserve fixed-tick authority, deterministic ordering, bounded work, stable identity, replay compatibility, and renderer independence unless the approved task explicitly changes one of those contracts.
5. Record what the experiment proved. Promote only the proven decisions and revise or retire the rest.

## Catalog

| Document | Status | Purpose |
| --- | --- | --- |
| [Emergent co-op simulation north star](./emergent-coop-simulation.md) | Working draft | Captures the desired experience, narrative probes, world layers, AI composition, data residency, co-op shape, portability, and architectural pressure. |
| [Candidate feature roadmap](./candidate-roadmap.md) | Working draft | Orders small vertical slices that can test the north star without committing versions, dates, or a broad rewrite. |
| [Long-term improvement ledger](./long-term-improvements.md) | Working draft | Records credible future architecture boundaries, their promotion triggers, migration constraints, and acceptance evidence without scheduling them as features. |

## Template for another soft specification

```markdown
# Title

| Field | Value |
| --- | --- |
| Status | Seed / Working draft / Candidate / Promoted / Retired |
| Authority | Non-authoritative |
| Last reviewed | YYYY-MM-DD |
| Related current contracts | Links |

## Intent

## Candidate stories

## Working hypotheses

## Constraints

## Open questions

## Promotion trigger
```
