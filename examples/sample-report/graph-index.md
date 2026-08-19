# Environment graph — index — Contoso AG / Production

> **Generated file.** Edits are lost on the next run.
> Generated 2026-08-19 12:07. Rebuild with:
>
> ```
> node scripts/sample-report.mjs
> ```

Entry point for agents. Answers "what is here" on its own and says where everything else lives.

**Scope:** 8 SharePoint sites · 26 SharePoint lists · 2 Dataverse tables · 42 cloud flows · 8 canvas apps

## Solutions

- **Contract Management** — flows 5 · apps 1 · lists/tables 7
- **Customer Portal** — flows 5 · apps 1 · lists/tables 4
- **Field Service** — flows 6 · apps 2 · lists/tables 8
- **HR Onboarding** — flows 6 · apps 1 · lists/tables 7
- **Purchase Requests** — flows 14 · apps 2 · lists/tables 6
- **Quality Audits** — flows 6 · apps 1 · lists/tables 4

## Findings

- ⚠ 1 self-triggers with no condition — they fire indefinitely (§3)
- 13 self-triggers in total (§3)
- 4 lists/tables in more than one solution — these break on export/import (§7)
- ⚠ 1 references unresolved — they point at nothing (header of graph.md)
- 14 lists/tables with no trigger — a write sets nothing off there (§6)

## Where to find what

- **What happens if I write to X?** — `graph.md`, find the heading `### <technology> <site>/<X>` and read only that section (≈70 tokens).
- **Which flow hangs off X?** — `graph.md` §1, find the row with X.
- **What does flow Y do?** — `graph-flows.md`, find the heading `## Y` (≈90 tokens).
- **Everything else** — QUERY `graph.json`, never read it (≈66k tokens). It holds cascade depth 3, `refiredBy` per trigger edge, and the raw conditions.

⚠ **Never read `graph.md` or `graph-flows.md` whole** — ≈9800 and ≈3870 tokens. Both are searchable by heading; a targeted question costs a fraction of that.

