---
name: lark-calendar-workflow
description: Use when the user asks about scheduling, meetings, calendar, free time, or coordinating with Lark colleagues. Drives the lark_calendar tool with sensible defaults and error handling.
phase: business
category: business
tags: [lark, feishu, calendar, meeting, schedule, 飞书, 日程, 会议]
triggers: [日程, 日历, 会议, 开会, 约会, calendar, schedule, meeting, 飞书日程, 今天安排, 明天有什么]
workers: [project_manager, customer_support, operations_director]
command: /lark-cal
---

# Lark Calendar Workflow

## Overview
Users speak about calendars in natural language: "what's on tomorrow?", "schedule a 30min sync with Sam Thursday". This skill translates those into the right `lark_calendar` tool action and guards against common pitfalls (time-zone, no-start-time, ambiguous dates).

## When to Use
- User asks to check their agenda today / this week
- User asks to create a meeting or block time
- User wants to find a time that works for multiple people
- User asks who's available for an ad-hoc call

## Process

### 1. Identify the action
Pick exactly ONE:
- `agenda` — "what do I have today/tomorrow/this week?"
- `create` — "schedule X with Y" / "book Z at 3pm"
- `freebusy` — "when is Alice free?" / "find a 30min slot for Bob and Carol"

### 2. Fill required fields
- **agenda**: `days` (default 1)
- **create**: `title`, `start` (ISO8601), `end` (ISO8601), optionally `attendees` (comma emails)
- **freebusy**: `user_ids` (comma), `start`, `end`

### 3. Resolve relative times
- "今天/today" → today 9:00 ~ 18:00
- "明天/tomorrow 3pm" → next day 15:00, default 30min duration
- "下周三/next Wed" → compute date, default 10:00 ~ 10:30
- User's timezone assumed; ask if ambiguous

### 4. Attendees
- If user says "with Alice", look up her email/user_id via `lark_im` list_chats or ask user
- Always use dry-run first for destructive creates

### 5. Verify the result
- `agenda`: summarize count + 3 key upcoming events
- `create`: confirm time + attendees back to user
- `freebusy`: show earliest 3 common free slots

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "The user said 'next week', I'll pick a time" | Ask. 'Next week' has 5 working days |
| "I'll create it without the --dry-run" | Dry-run first saves embarrassing misfires |
| "Defaults are fine" | User didn't say "8am Saturday" — don't schedule there |

## Red Flags
- Creating a calendar event without confirming start/end time back to user
- Assuming attendees' availability without freebusy check
- Using raw user IDs from URLs without validating
- No timezone in ISO8601 timestamps (Z or ±HH:MM required)

## Verification
- [ ] action field is one of: agenda, create, freebusy
- [ ] For create: start < end, ISO8601 with timezone
- [ ] For freebusy: at least 2 user_ids, window ≥ 30 min
- [ ] Confirmed back to user before executing mutation
