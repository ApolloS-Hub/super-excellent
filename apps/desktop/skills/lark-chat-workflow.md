---
name: lark-chat-workflow
description: Use when the user wants to send messages, find chats, or search past messages in Lark/Feishu IM. Drives lark_im with draft-first safety.
phase: business
category: business
tags: [lark, feishu, im, message, chat, 飞书, 消息, 群聊]
triggers: [消息, 群聊, 发消息, 通知, chat, im, notify, message, lark 消息]
workers: [customer_support, operations_director, content_operations]
command: /lark-chat
---

# Lark Chat Workflow

## Overview
IM messages can't be unsent. This skill enforces draft-first for `send` and structures replies so they carry enough context.

## When to Use
- "Send a message to the ops group" / "通知研发组"
- "What did Sam say last week?" (message search)
- "List my active chats"

## Process

### 1. Identify action
- `send` — post to a specific chat (1:1 or group)
- `search` — find messages by keyword
- `list_chats` — enumerate chat IDs for later use

### 2. For SEND — draft + confirm
1. Compose the message text in the user's tone
2. Show the DRAFT: `[To: group-name, Message: ...]`
3. Ask: "Send / edit / cancel?"
4. Only after explicit approval, execute

### 3. For SEARCH — scope it
- Default scope: last 30 days, all chats
- If results >10, group by chat and summarize
- Show: sender, chat, date, snippet

### 4. Message tone rules
- Internal groups: direct, use @ for mentions
- Cross-team: full names + brief context (they don't have your context)
- External partners: formal + signature line

### 5. For LIST_CHATS
- Show: chat name, type (1:1 / group), member count, last activity
- Prioritize active groups (recent activity)

## Message structure guidelines

**Short notify (under 50 chars):**
```
📢 ServerA 重启完成，请注意 5 分钟内验证服务
```

**Rich notify (with links/code):**
```
📊 今日数据日报已生成

📎 链接: https://...
📌 关键指标:
- DAU: 1.2M (+5%)
- 转化率: 3.2%
```

**Cross-team request:**
```
Hi @{person} — 打扰一下，{context 1 sentence}。

{Request in 1-2 sentences}

需要的:
- ...

时限: {date}
```

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "User said send, so send" | They haven't seen the draft yet |
| "Short messages don't need context" | A message with no context = a message that gets ignored |
| "Don't need @mentions in a 5-person group" | Mentions cut through scroll-past |
| "Copy the user's exact words" | Slightly polish grammar/typos |

## Red Flags
- Sending before showing draft
- No context in cross-team messages ("can you do X?" with no background)
- Using @all in large groups for non-critical
- Emoji spam in formal external messages
- Truncating search results silently

## Verification
- [ ] For send: draft shown + user approval before execute
- [ ] Receiver chat_id confirmed (no typos)
- [ ] Tone appropriate for audience (internal vs external)
- [ ] Search results: count stated; grouped if many
- [ ] No sensitive data (API keys, passwords) in messages
