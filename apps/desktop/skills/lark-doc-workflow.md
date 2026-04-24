---
name: lark-doc-workflow
description: Use when the user needs to create, read, update, or find Lark docs. Drives the lark_doc tool with search-before-create, block-level editing, and structured content patterns.
phase: business
category: business
tags: [lark, doc, document, wiki, 文档, write, edit, update]
triggers: [文档, doc, 文件, 写文档, create doc, read doc, 查文档, update doc, edit doc, 改文档, 同步文档, sync doc]
workers: [writer, product, customer_support]
command: /lark-doc
---

# Lark Doc Workflow

## Overview
Docs get duplicated because people don't search first, and content rots because people create but never update. This skill enforces search-before-create AND supports updating existing docs with new content.

## When to Use
- Create a meeting note, PRD, spec, or knowledge-base article
- Read or summarize an existing doc
- **Update** an existing doc with new content (overwrite or append)
- Find docs on a topic
- Inspect a doc's block structure before precision editing

## Process

### 1. Identify the action
| User intent | Action | Requires |
|-------------|--------|----------|
| "创建文档" / "new doc" | `create` | title |
| "看看这个文档" | `read` or `read_content` | doc_token |
| "搜索文档" | `search` | query |
| "更新这个文档" | `update` | doc_token + content |
| "在文档后面加一段" | `append` | doc_token + content |
| "看看文档结构" | `list_blocks` | doc_token |
| "删除这个块" | `delete_block` | doc_token + block_id |

### 2. For CREATE — search first
Before creating, always:
1. Run `search` with 2-3 keywords from the user's intent
2. If matches exist, show top 3 results and ask: "Update an existing doc, or create new?"
3. Only create new if user explicitly picks "new"

### 3. For UPDATE — show current content first
Before overwriting:
1. Run `read_content` to show the user what's currently in the doc
2. Confirm: "I'll replace the content with the new version. OK?"
3. Only after confirmation, call `update` with the new content

For small additions, prefer `append` over `update` — it's less destructive.

### 4. Structure the content
Use structured formatting:
- H1 title (document topic)
- H2 sections for logical parts
- Tables for multi-column data
- Bullet lists for steps or short items

Separate paragraphs with **double newlines** — each becomes a Lark paragraph block.

### 5. Meeting note template
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

### 6. PRD / Spec template
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

### 7. Working with doc_token
The `doc_token` is found:
- In search results (`doc_token` field)
- In the Lark doc URL: `https://xxx.larksuite.com/docx/ABC123` → token is `ABC123`
- Returned when you `create` a new doc

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "User said create, so I create" | Search-first prevents team-wide duplication |
| "Just dump the transcript as notes" | Unstructured notes are unused notes |
| "I'll update by creating a new doc" | Use `update` to keep the URL stable |
| "Append is fine for everything" | Append piles up; use `update` for full rewrites |

## Red Flags
- Creating a doc without searching for duplicates
- Calling `update` without showing current content first
- Walls of unstructured text (no H2/H3 sections)
- No "Action Items" in a meeting note
- PRD with no "Non-Goals" or "Open Questions" section
- Forgetting to return the doc_token or URL to the user

## Verification
- [ ] For create: searched for existing first
- [ ] For update: showed current content before overwriting
- [ ] Doc has clear title and sections
- [ ] Meeting notes: Attendees, Decisions, Action Items all present
- [ ] PRD: Problem, Non-Goals, Requirements, Open Questions all present
- [ ] Returned doc_token to user after create/update
