---
name: stakeholder-alignment
description: Use when the user needs buy-in from other teams/leaders before moving forward. Covers pre-read docs, RACI, async alignment, and escalation paths.
phase: plan
category: business
tags: [alignment, stakeholder, buy-in, 对齐, 协同, RACI]
triggers: [alignment, 对齐, stakeholder, buy-in, 支持, push back, 推进, escalate, 升级, get approval]
workers: [project_manager, product, ops_director]
command: /align
---

# Stakeholder Alignment

## Overview
Nothing cross-functional ships without alignment. The most common project failure isn't technical — it's two teams with subtly different assumptions, both shipping the wrong thing. This skill front-loads the work of making assumptions visible so execution can go fast.

## When to Use
- Starting a project that needs 3+ teams
- A peer or leader pushed back on your proposal
- You need sign-off from someone senior you rarely talk to
- A project is stuck because people disagree on goals / scope
- You're about to escalate something

## Process

### 1. Map the stakeholders — RACI
For any non-trivial initiative, name explicitly:
- **Responsible**: does the work (often multiple people)
- **Accountable**: one person owns the outcome (exactly one)
- **Consulted**: input sought before decisions (small list)
- **Informed**: kept in the loop after decisions (broader)

If two people claim Accountable, you have a conflict that will blow up later. Resolve it first.

### 2. Write a pre-read, not a pitch
Before any alignment meeting, send a 1-2 page doc:
- **Problem**: what we're solving and why now
- **Proposal**: the direction we're going
- **Key decisions**: 2-3 explicit choice points
- **Asks**: exactly what you need from each stakeholder
- **Non-goals**: what this won't address (crucial!)

The pre-read does 80% of the alignment. The meeting confirms.

### 3. Find the blockers ahead of time — 1:1s
Before the group meeting, have 15-min 1:1s with key stakeholders. Three questions:
- "What's your biggest concern with this?"
- "What would make this fail in your view?"
- "What do you need to be a yes?"

Surface objections privately so the group meeting can focus on resolution, not litigation.

### 4. Reframe pushback as data
When someone pushes back, they're giving you information:
- "We can't do it this quarter" → a constraint
- "This breaks our architecture" → a design requirement
- "I don't think users want this" → a hypothesis to test

Don't defend. Ask: "What would have to be true for you to support this?"

### 5. Escalate with care — up, not around
If you're blocked after honest effort, escalate. But:
- **Tell the blocker first**: "I'm going to raise this with Alice on Friday because we're stuck." No surprise escalations.
- **Escalate the decision, not the person**: frame as "we need help breaking this tie", not "X won't cooperate"
- **Bring options, not just the problem**: senior people don't want to debate; they want to pick

### 6. After alignment — write it down
Email or doc to all stakeholders:
- **What we decided**
- **Who's Accountable for each piece**
- **When we'll check in**
- **What could change our minds** (kill-criteria)

Without this, "alignment" fades within 2 weeks.

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "They should just trust me / my team" | Trust is earned by making thinking visible, not by asking for it |
| "Pre-reads take too long to write" | One hour of writing saves ten hours of re-litigation |
| "We'll figure it out as we go" | You'll figure out you disagree when shipping, which is too late |
| "Escalating makes me look weak" | Not escalating when stuck makes you look worse later |
| "Everyone said yes, so we're aligned" | People nod to end meetings. Verify with written acknowledgment |

## Red Flags
- No single Accountable person named
- Key stakeholder found out from the all-hands / public launch
- Same objections re-litigated every 2 weeks
- Pre-read is a slide deck instead of a doc (hides nuance)
- Silent skeptics in meetings — they'll become loud saboteurs later
- "Alignment" without anyone writing down the decision

## Verification
- [ ] RACI named explicitly (exactly one Accountable)
- [ ] Pre-read sent 48h before any alignment meeting
- [ ] 1:1s done with top 3 stakeholders to surface objections
- [ ] Non-goals explicitly listed
- [ ] Post-meeting decision memo distributed to all attendees
- [ ] Check-in cadence set (weekly/bi-weekly)
