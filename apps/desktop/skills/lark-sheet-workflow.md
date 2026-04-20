---
name: lark-sheet-workflow
description: Use when the user needs to read, write, or create Lark/Feishu spreadsheets. Drives lark_sheet with safety rails against accidental data loss.
phase: business
category: data
tags: [lark, feishu, sheet, spreadsheet, table, 飞书, 表格]
triggers: [表格, sheet, spreadsheet, 填表, 读表, 数据表, lark sheet, 飞书表格]
workers: [data_analyst, operations_director, financial_analyst]
command: /lark-sheet
---

# Lark Sheet Workflow

## Overview
Spreadsheets hold critical business data. A single bad `+write` can nuke a column. This skill enforces read-before-write and range discipline.

## When to Use
- Read data from a sheet for analysis/reporting
- Append new rows of data
- Update specific cells based on user intent
- Create a new tracking sheet

## Process

### 1. Identify action
- `read` — fetch a range of cells
- `write` — update/insert cells in a range
- `create` — new spreadsheet

### 2. For READ — narrow the range
- Never read the entire sheet if you only need a column
- Use `Sheet1!A1:D100` style, not `Sheet1`
- If user says "all data", ask for sheet size first or limit to 1000 rows

### 3. For WRITE — read-first policy
1. READ the target range first to see current content
2. Show the BEFORE state to user
3. Describe the change: "I'll write 5 rows to A10:F14"
4. Ask confirmation
5. Execute write
6. READ again to verify AFTER state
7. Confirm to user with row count and cell count changed

### 4. Data format rules
- Dates: ISO 8601 (YYYY-MM-DD) unless sheet has existing format
- Numbers: raw numbers, no currency symbols or thousand separators (unless format column)
- Text: preserve quotes; escape internal quotes with "

### 5. For CREATE
- Title naming: `{Topic} - {YYYY-MM-DD}` unless user specifies
- Return the spreadsheet_token to user so they can bookmark

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "User said write, so I write" | Read-first catches mismatched ranges |
| "The range is obvious from context" | Off-by-one range errors corrupt data silently |
| "I'll fix the format after" | Mixed formats break downstream formulas |
| "Skip the BEFORE snapshot" | Without it, undo requires an unavailable backup |

## Red Flags
- Writing without reading first
- Reading a whole sheet (unbounded range) for a small task
- Writing to a column that currently has formulas
- Not showing the change to user before committing
- Returning "done" without verifying via re-read

## Verification
- [ ] Range specified with sheet name + bounds (A1:D100 form)
- [ ] For write: BEFORE state captured via read
- [ ] For write: user approved the planned change
- [ ] For write: AFTER state verified via re-read
- [ ] Row/cell count change reported back
