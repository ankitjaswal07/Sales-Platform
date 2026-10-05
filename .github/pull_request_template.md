## Summary

<!-- What changed, and why. One or two sentences a reviewer can act on. -->

## Phase

<!-- The platform is built in phases (Phase 1 core → Phase 5 advanced). Which one? -->

- [ ] Phase 1 — core data, scoring, discovery, audit, leads
- [ ] Phase 2 — proposals, outreach, conversations
- [ ] Phase 3 — campaigns, pipeline, projects, analytics
- [ ] Phase 4 — automation, alerts, integrations
- [ ] Phase 5 — polish, security hardening, diagnostics
- [ ] Docs / tooling only

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (self-check suite in `scripts/run-checks.ts`)
- [ ] `npm run build` succeeds
- [ ] Seeded data still works: `npm run db:reset && npm run db:seed`

## Honesty checklist (§ quality bar)

- [ ] No fake buttons — every control works, opens configuration, or states what is needed to activate it
- [ ] Unconfigured integrations show their real connection state, never a pretend-success
- [ ] No fabricated analytics or placeholder numbers presented as real
- [ ] AI output never claims to be human, never guarantees results, and is labelled as an estimate
- [ ] Any UI that could break the preview (host/origin allowlists, absolute localhost URLs) was checked in the preview

## Notes for reviewers

<!-- Screenshots, migration notes, or follow-ups deliberately left out of scope. -->
