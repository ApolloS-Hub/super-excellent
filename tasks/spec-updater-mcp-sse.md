# Spec: 超优秀收尾补齐 (Tauri Updater, Windows CI, MCP SSE)

> Status: approved

## 目标
完成项目最后 3 个剩余缺口：Tauri Updater 自动更新、Windows MSI 打包 CI 链路、MCP SSE transport 实现。

## 改什么

### 任务 1: Tauri Updater 自动更新集成
1. 在 `apps/desktop` 安装 `@tauri-apps/plugin-updater`
2. 更新 `apps/desktop/src-tauri/Cargo.toml` 增加 updater 依赖
3. 更新 `apps/desktop/src-tauri/src/lib.rs` 注册 updater plugin: `.plugin(tauri_plugin_updater::Builder::new().build())`
4. 更新 `apps/desktop/src-tauri/tauri.conf.json` 的 `plugins.updater` 配置。将 endpoints 配置为 GitHub Releases 的通用格式（例如 `"https://github.com/ApolloS-Hub/super-excellent/releases/latest/download/latest.json"`），并配置合法的 pubkey（可以使用占位符或生成一对）。
5. 在 `apps/desktop/src/App.tsx` 或类似的主入口中加入检查更新的前端逻辑。

### 任务 2: Windows MSI 打包 CI 链路
1. 修改 `.github/workflows/ci.yaml`
2. 确保在 Windows 环境下不只是跑 smoke job，而是完整跑 `pnpm tauri build`。
3. 记得配置 GitHub Actions 以支持打包（Rust 缓存、Node 依赖、Tauri 依赖等）。

### 任务 3: MCP SSE Transport
1. 更新 `packages/agent-core/src/mcp/client.ts`。
2. 实现 `connectSse()` 方法，替换掉原本抛出的 `Error("SSE transport not yet implemented")`。
3. SSE 连接可以使用 Node 原生的 HTTP/HTTPS 或 Fetch，实现连接指定的 `this.config.url` 并监听事件。

## 怎么验
- `npx vitest run` 继续全绿
- 有至少 3 个新 commit，commit 包含 `[scope-ack]`。
- Tauri build 能够识别 updater 配置而报错的话需要修复（本地验证时不需要配正确的 pubkey 签名，只需语法和配置合法通过 build 即可）。

## 约束
- 只在 `/Users/rmini/super-excellent` 目录内修改。
- 每个任务单独一个 commit。
- 最终跑完提供结论。