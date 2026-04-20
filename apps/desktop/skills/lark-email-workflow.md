---
name: lark-email-workflow
description: Use when the user wants to check, send, reply to, or search emails in Lark/Feishu Mail. Drives the lark_email tool with safety rails and draft-first behavior.
phase: business
category: business
tags: [lark, feishu, email, mail, inbox, 飞书, 邮件]
triggers: [邮件, email, mail, 收件, 发件, 回复, 未读, check email, send email, inbox]
workers: [writer, customer_support, operations_director]
command: /lark-mail
---

# Lark Email Workflow

## Overview
Email is high-stakes: bad sends can't be unsent, missed emails cost deals. This skill drives `lark_email` safely — always draft before send, always search before replying cold.

## When to Use
- Check inbox / unread count
- Draft a new email (internal or external)
- Reply to an existing thread
- Search past emails for info / context

## Process

### 1. Identify the action
- `list` — "check my email" / "what's in the inbox?"
- `read` — "open that email from Sam" / "show me the one about X"
- `send` — "send an email to Alice about Y"
- `reply` — "reply to Bob's email saying Z"
- `search` — "find emails about the Q4 launch"

### 2. For SEND — always draft first
**Never** call `send` with `--dry-run=false` on the first turn. Sequence:
1. Compose the full email based on user intent
2. Show the draft back to the user: `To: ..., Subject: ..., Body: ...`
3. Ask: "Send as-is, edit something, or cancel?"
4. Only after explicit user approval, execute the send

### 3. For REPLY — preserve context
- Quote the relevant part of the original in the new body
- Check CC list — would replying all be appropriate?
- Tone-match the original (formal vs casual)

### 4. For SEARCH — refine, don't dump
- If search returns 50 emails, show top 5 by date + summarize the rest
- Offer follow-up: "Want me to read the full thread for #3?"

### 5. Verification
- Show sender / subject / date for all listed emails
- Never delete without explicit user confirmation

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "The user said 'send it'" | They said it before seeing the draft. Show draft first |
| "I'll CC the whole team to be safe" | Spam that trains colleagues to mute your emails |
| "The search had too many results, I'll guess" | Ask for a refined query instead of guessing |
| "Plain text is good enough" | For external emails, basic formatting (greeting, signature) matters |

## Red Flags
- Sending before showing draft
- Replying without reading the full thread
- Search results trimmed without telling user how many were hidden
- "Forwarding" without removing internal-only content
- Large attachments sent without asking

## Verification
- [ ] For send: draft reviewed with user before execution
- [ ] For send: To/CC addresses validated (no typos)
- [ ] For reply: original thread context preserved
- [ ] For search: result count reported; summary if >5
- [ ] No sensitive data (passwords, keys) appears in email body
