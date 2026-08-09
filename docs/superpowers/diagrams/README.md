# Diagrams

Mermaid sources for the design specs in [`../specs/`](../specs/). Each `.mmd` file is the **single source of truth** for its diagram — the specs link here rather than embedding a copy, so there is nothing to keep in sync.

**Naming:** `<spec-prefix>-<section>-<slug>.mmd`. The section number matches the heading in the owning spec.

## Spec v2 change spec (§13 Workflows & Scenarios)

Owner: [`2026-07-28-kickr-spec-v2-changes.md`](../specs/2026-07-28-kickr-spec-v2-changes.md)

| § | Diagram | Type |
|---|---|---|
| 13.1 | [user signup & first login](./spec-v2-13-1-user-signup-login.mmd) | sequence |
| 13.2 | [group creation → invitation → approval](./spec-v2-13-2-group-join-approval.mmd) | flowchart |
| 13.3 | [event lifecycle](./spec-v2-13-3-event-lifecycle.mmd) | state |
| 13.4 | [team shuffle & fixture generation](./spec-v2-13-4-team-shuffle-fixtures.mmd) | sequence |
| 13.5 | [match results, MVP & ratings](./spec-v2-13-5-match-results-mvp-ratings.mmd) | flowchart |
| 13.6 | [team challenge](./spec-v2-13-6-team-challenge.mmd) | sequence |
| 13.7 | [location attach](./spec-v2-13-7-location-attach.mmd) | flowchart |
| 13.8 | [file upload (ImageKit)](./spec-v2-13-8-file-upload-imagekit.mmd) | sequence |

## Events feature spec (§5 Scenario design)

Owner: [`2026-08-03-events-feature-spec.md`](../specs/2026-08-03-events-feature-spec.md)

| § | Diagram | Type |
|---|---|---|
| 5.1 | [full event lifecycle](./events-5-1-event-lifecycle-states.mmd) | state |
| 5.2 | [organizer happy path](./events-5-2-organizer-happy-path.mmd) | sequence |
| 5.3 | [join / unjoin gating](./events-5-3-join-unjoin-gating.mmd) | flowchart |
| 5.4 | [team submission → validation → fixtures](./events-5-4-team-submission-fixtures.mmd) | sequence |
| 5.5 | [score entry & standings](./events-5-5-score-entry-standings.mmd) | flowchart |
| 5.6 | [geo discovery](./events-5-6-geo-discovery.mmd) | flowchart |
| 5.7 | [illegal transition](./events-5-7-illegal-transition.mmd) | sequence |
| 5.8 | [after-match — MVP, cover & photos](./events-5-8-after-match-result-uploads.mmd) | sequence |
| 5.9 | [likes & event templates](./events-5-9-likes-and-templates.mmd) | flowchart |

All nine reflect the implementation as built (steps 1–4, 2026-08-09), not just the intended design.

## Conventions

- **Prose wins.** Where a diagram and its spec's prose disagree, the prose is authoritative. Diagrams are a reading aid.
- **Edit the `.mmd`, not the spec.** The spec holds only a link.
- **Keep the header comment.** Each file opens with `%%` lines naming its title and owning spec section; they survive rendering.
- **Renumbering a spec section?** Rename the file and update the link in the spec plus the table above.

## Rendering

GitHub renders `.mmd` files natively when opened. Locally, VS Code's Mermaid extensions preview them, or:

```bash
npx @mermaid-js/mermaid-cli -i <file>.mmd -o out.svg
```

## Validating

These diagrams are parsed with mermaid's own parser rather than eyeballed — a syntax error renders as an error block instead of failing loudly. To check every file:

```bash
npx @mermaid-js/mermaid-cli -i <file>.mmd -o /dev/null   # per file; non-zero exit on a parse error
```
