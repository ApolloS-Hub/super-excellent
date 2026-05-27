# Spec: Proxy URL → LLM 请求真实生效

> Status: `in_progress`

## 目标
Settings 里填写的 `Proxy URL` 之前对模型请求没生效（WebView fetch 无法按请求走 HTTP 代理）。
让 App 内的 LLM 请求在配置了 `proxyURL` 且运行在 Tauri 环境下时，真正经过该 HTTP 代理。

## 改什么
1. `apps/desktop/src-tauri/src/lib.rs`
   - 新增 `#[tauri::command] async fn proxy_fetch(method, url, headers, body, proxy_url) -> ProxyFetchResponse`
   - 使用 `reqwest::Client::builder().proxy(reqwest::Proxy::all(proxy_url))`
   - 注册到 `invoke_handler`
2. `apps/desktop/src/lib/tauri-bridge.ts`
   - 暴露 `proxyFetchTauri` + `ProxyFetchResponse` 类型
3. `apps/desktop/src/lib/agent-bridge.ts`
   - 增加 `llmFetch(config, url, init)`：当 `config.proxyURL` 非空且 `isTauriAvailable()` 时走 `proxy_fetch`，否则回退到 `fetchWithRetry`
   - 替换所有 LLM endpoint 调用：
     - Anthropic `/v1/messages`（含 validate）
     - OpenAI/Compatible `/v1/chat/completions`（含 streaming + non-stream）
     - Google `/v1beta/models/...`（含 validate）

## 怎么验
- `pnpm -r --parallel exec npx tsc --noEmit` 通过
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` 通过
- `pnpm -r test` 全绿（41 test files / 583 passed / 2 skipped；agent-core 8 / 77 passed）
- `pnpm build` 出 aarch64 `.app` + `.dmg`
- 行为：在 Settings 填 `Proxy URL=http://192.168.1.13:1088`，软件请求会真正经过该代理（之前完全不走代理）

## 约束
- 只动这 3 个文件
- 不修改 streaming 协议；OpenAI 流式仍由前端 ReadableStream 处理
- 非 Tauri 环境（开发态浏览器）继续走 fetchWithRetry
- 不把代理写死到全局，仅按当前 `config.proxyURL` 临时使用
