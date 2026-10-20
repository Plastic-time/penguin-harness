---
name: rfc-contribution
description: Design and submit RFCs (Request for Comments) for architecture and feature proposals
version: 1.0.0
---

# RFC Contribution Skill

This skill guides you through writing, reviewing, and integrating design RFCs (Request for Comments)
into PenguinHarness. RFCs document architectural decisions, major features, and design choices before
implementation begins.

## When to use this skill

Use this skill when:

- You are designing a major feature or architectural change
- A proposal affects core concepts (plugin model, message protocol, session lifecycle, etc.)
- You need to propose significant changes to existing design decisions
- You want input from the team before committing to an implementation direction

Do not use this skill for:

- Bug fixes or minor refactors
- Performance optimizations that don't change behavior
- Documentation updates that don't affect API or architecture

## RFC states

RFCs follow these states:

- **landed** — merged into `rfcs/` on the default branch; this is the approved design
- **draft** — early stage; not yet ready for full review or implementation
- **open** — under review in a PR; design discussion is active

Once landed, an RFC should remain stable. Modifications are rare and require a version bump.

## Writing an RFC

### 1. Choose an RFC number

Look at [`rfcs/README.md`](../../rfcs/README.md) to find the next available PRFC number. If drafts
already use the number you want (e.g., two competing proposals both drafted as PRFC-0005), that is
fine — multiple drafts can share a number until one lands.

### 2. Use the template

Copy [`rfcs/TEMPLATE.md`](../../rfcs/TEMPLATE.md) to `rfcs/PRFC-NNNN-your-slug.md`. The template
includes:

- Metadata (Feature Name, Start Date, links to design and implementation PRs)
- Required sections: Summary, Motivation, Guide-level Explanation, Reference-level Explanation,
  Drawbacks, Rationale and Alternatives, Unresolved Questions, Future Possibilities
- A `## Changes` section for tracking revisions

Fill in each section honestly. Spend time on "Drawbacks" and "Rationale and Alternatives" — these
show you have thought through the design space.

### 3. Add the provenance marker

After the title and metadata, add a **provenance marker** block (see the template). This records:

- Where the document came from (e.g., `rfcs/PRFC-NNNN-slug.md` from the design repository)
- Its state (landed on `main`, draft in PR #NNN, etc.)
- The current version (`v1.0.0` for new RFCs)

Example:

```markdown
> **Provenance marker**
> - Source: `rfcs/PRFC-0021-my-design.md` from [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design)
> - State: draft in design PR #42
> - Rev: v1.0.0
```

### 4. Sections to focus on

**Summary** — one paragraph that captures the essence. A reader should understand the core idea
without reading the rest.

**Motivation** — why this matters. What problem does it solve? Who benefits? What use cases does it enable?

**Reference-level Explanation** — the heart of the RFC. Show how the design works:

- How does it interact with existing subsystems?
- What are the APIs or data structures?
- How are edge cases handled?
- Use examples and concrete scenarios.

**Drawbacks** — every design has tradeoffs. Name them. This is not a weakness of your proposal; it
is clarity about what you are choosing. "None" is rarely honest.

**Rationale and Alternatives** — explain why this is the best choice in the space of alternatives.
Show that you have considered other approaches and articulate why you chose this one.

## Submitting an RFC

### To the design repository (open or draft)

If your RFC is still in draft or you want feedback from the design team first:

1. Fork [Prism-Shadow/penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design)
2. Create a branch `rfc/PRFC-NNNN-your-slug`
3. Add your RFC to `rfcs/`
4. Open a PR with title `RFC: PRFC-NNNN your title` and describe the design in the body
5. Incorporate feedback, update the RFC, and commit further changes to the same PR
6. Once the design is stable, the PR can be merged (on the design repo's default branch) or left
   open if it is still in active refinement

### To the main repository (landing already-designed RFCs)

If your RFC is already designed and approved on the design repository and you are migrating it here:

1. Branch from `main` of [Prism-Shadow/penguin-harness](https://github.com/Prism-Shadow/penguin-harness)
2. Add your RFC to `rfcs/`
3. Update the provenance marker to note it is now landed on this repository's main branch
4. Ensure the `## Changes` section is present with at least `v1.0.0` entries
5. Open a PR titled `rfcs: add PRFC-NNNN your title`
6. Wait for review and merge (RFC and implementation PRs merge independently)

## Modifying a landed RFC

Once an RFC is on the main branch, modifications should be rare. When truly needed:

1. Bump the version: `v1.0.0` → `v2.0.0`
2. Add a `## Changes` section (or append to the existing one) with subsections per version:

```markdown
## Changes

### v1.0.0
- Initial design

### v2.0.0
- Updated deployment strategy based on feedback from impl PR #456
- Clarified interaction with plugin system
```

3. Summarize the change under each version:
   - `- Added …` (new sections or concepts)
   - `- Removed …` (deleted content or deprecated ideas)
   - `- Updated …` (refined or changed explanations)

Include the PR number that resolved the issue, so readers can trace the decision.

4. Open a PR with title `rfcs: update PRFC-NNNN (v2.0.0)` and reference the RFC changes in the body

## Implementation and RFC independence

**Key principle**: an RFC and its implementation PR are separate. You can:

- Submit an RFC, have it approved, and implement later
- Implement a feature, then have someone else write the RFC
- Have multiple implementation approaches for the same RFC
- Have an implementation PR that references and completes an RFC without merging both in one go

When implementation begins:

- Reference the RFC number in your implementation PR title or description
- Document which parts of the RFC your PR covers
- If you discover the RFC needs updating during implementation, open a separate PR for the RFC update
  (or note the change in feedback when the RFC is still in review)

## CI checks for RFCs

The repository runs automated checks on pull requests that modify `rfcs/`:

1. **Naming**: files must be `PRFC-NNNN-slug.md` with a 4-digit number and lowercase slug
2. **Numbering**: no unexpected duplicate numbers (PRFC-0005 twice from competing drafts is OK)
3. **Sections**: each RFC must have Summary, Motivation, Reference-level Explanation, and others per the template
4. **Version control**: if you modify an existing RFC, the version number must increase and `## Changes` must be updated

If your PR fails checks, the CI message will tell you what to fix. Common issues:

- **Naming**: fix the filename
- **Missing section**: add the section to the RFC
- **Forgot version bump**: increment the version and add a Changes section
- **Duplicate number**: pick a different number or wait for the other draft to land

## Working with existing RFCs

### Reading an RFC

Start with the Summary and Motivation to understand the scope. Skim the Reference-level Explanation
for technical details. The Drawbacks and Alternatives sections tell you what the author considered
and ruled out.

If an RFC has a `## Changes` section with multiple versions, read the latest version first, then
check previous versions to understand the evolution.

### Finding the source

Each landed RFC has a provenance marker that tells you where it came from. If you need the original
context or design discussion:

1. Check the marker for a link to the design PR
2. Visit the design repository to read the full discussion
3. Look at the implementation PR (linked in the marker or mentioned in the RFC) to see how it was implemented

### Implementing an RFC

1. Read the entire RFC, including Unresolved Questions
2. Note any parts that are deliberately vague (the RFC author expected implementation to decide)
3. If you get stuck, check the original design PR for discussion
4. If the RFC needs updating based on implementation, do that in a separate PR
5. Reference the RFC number in your implementation PR so others can find the design

## Examples

See [`rfcs/`](../../rfcs/) for examples:

- [`rfcs/PRFC-0001-module.md`](../../rfcs/PRFC-0001-module.md) — landed RFC with module design
- [`rfcs/PRFC-0010-ui-modules.md`](../../rfcs/PRFC-0010-ui-modules.md) — draft RFC under discussion
- [`rfcs/README.md`](../../rfcs/README.md) — index of all RFCs and their states

Each one shows the provenance marker, full sections, and how Changes are tracked across versions.

## Tips for writing good RFCs

- **Be specific**: avoid vague language. "Easy to use" needs examples; "five new concepts" names them.
- **Show your work**: explain your reasoning. Why this design over others? What constraints guided the choice?
- **Acknowledge tradeoffs**: no design is perfect. Drawbacks section is not optional.
- **Use examples**: concrete scenarios and code snippets are worth thousands of words of abstract explanation.
- **Get early feedback**: circulate a draft RFC before it is complete. Design is collaborative.
- **Keep it focused**: one RFC, one design. If it spans multiple subsystems, split into separate RFCs.
- **Link related docs**: if your RFC references existing designs or external standards, link them.

## Questions?

If you are unsure about any part of the RFC process, check [`rfcs/README.md`](../../rfcs/README.md)
or ask your team. RFCs are a communication tool — clarity and completeness matter more than length.
