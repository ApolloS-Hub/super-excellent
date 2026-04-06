# Final Wave Plan

## Goal
补齐超优秀项目当前最关键缺口，使其从“可用样机”推进到“可交付产品”。

## Priority
1. P0: Long-term vector memory 真正落地（embedding + 检索 + 注入链路）
2. P0: 测试主链路补齐（至少覆盖 memory / coordinator / permission 关键路径）
3. P0: CI 质量门禁（typecheck / build / test）
4. P1: 运营角色 workflow 模板化
5. P1: Windows 验收准备（仅补链路，不宣称通过）

## Validation
- typecheck 通过
- 相关测试通过
- build 通过
- git commit + push 到 main

## Out of Scope (this round)
- 宣称 Windows 实机验收通过
- 复杂云端发布基础设施
- 大规模 UI 重构

## Immediate Next Step
先完成 vector memory 的现状盘点、缺口清单、实现方案，再开始编码。

## Vector Memory MVP
- **Goal**: Ship end-to-end vector memory — embed conversation turns, store in a local vector index, and retrieve semantically relevant context before each LLM call.
- **Approach**: Add an embedding step in the coordinator pipeline (via a local or provider-backed embedding model), persist vectors with metadata to an on-disk store (e.g. hnswlib or SQLite-vec), and inject top-k recalled chunks into the system prompt at query time.
- **Validation**: Integration test asserts that a fact stated in turn N is retrieved and present in the prompt context of turn N+10 after the in-memory history window has been cleared; typecheck and build remain green.
