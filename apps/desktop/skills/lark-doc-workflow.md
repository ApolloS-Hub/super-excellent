---
name: lark-doc-workflow
description: Use when the user needs to create, read, edit, or find Lark/Feishu docs. Drives the lark_doc tool and enforces search-before-create to avoid doc duplication.
phase: business
category: business
tags: [lark, feishu, doc, document, wiki, 飞书, 文档]
triggers: [文档, doc, 文件, 写文档, 飞书文档, create doc, read doc, 查文档]
workers: [writer, product, customer_support]
command: /lark-doc
---

# Lark Doc Workflow

## Overview
Docs get duplicated because people don't search first. This skill enforces a search-before-create flow and produces well-structured docs rather than prose dumps.

## When to Use
- User asks to create a meeting note, PRD, spec, or knowledge-base article
- User wants to read/summarize an existing doc
- User needs to find docs on a topic

## Process

### 1. Identify action
- `create` — new doc
- `read` — fetch existing doc content
- `search` — find docs by keyword

### 2. For CREATE — search first
Before creating, always:
1. Run `search` with 2-3 keywords from the user's intent
2. If matches exist, show top 3 results and ask: "Update an existing doc, or create new?"
3. Only create new if user explicitly picks "new"

### 3. Structure the content
Not a wall of text. Use:
- H1 title (document topic)
- H2 sections for logical parts (Overview, Decisions, Action Items, ...)
- Tables for any 2-column-or-more data
- Bullet lists for sequential steps or short items
- Tag owners with @ where applicable

### 4. Meeting note template
If user wants meeting notes:
```
# {Meeting topic} — YYYY-MM-DD

## Attendees
- {Name 1}
- {Name 2}

## Agenda
1. ...

## Discussion
### Topic A
{Key points, not verbatim transcript}

## Decisions
- {What was decided, by whom}

## Action Items
| Who | What | By when |
|-----|------|---------|

## Next Steps
```

### 5. PRD / Spec template
```
# {Feature name}

## Problem
{One paragraph}

## Non-Goals
- ...

## User Stories
- As a {role}, I want to {action} so that {outcome}.

## Requirements
- {Numbered, testable requirements}

## Open Questions
- ...
```

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "User said create, so I create" | Search-first prevents team-wide duplication |
| "Just dump the transcript as notes" | Unstructured notes are unused notes |
| "PRD templates are bureaucratic" | Templates prevent missing fields |

## Red Flags
- Creating a doc without searching for duplicates
- Walls of unstructured text (no H2/H3 sections)
- No "Action Items" in a meeting note
- PRD with no "Non-Goals" or "Open Questions" section
- Copy-paste of full chat transcript as "notes"

## Verification
- [ ] For create: searched for existing first
- [ ] Doc has clear H1 title and H2 sections
- [ ] Meeting notes: Attendees, Decisions, Action Items all present
- [ ] PRD: Problem, Non-Goals, Requirements, Open Questions all present
- [ ] Returned doc_token or URL to user
