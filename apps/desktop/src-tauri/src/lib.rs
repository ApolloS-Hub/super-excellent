// Prevents additional console window on Windows in release, DO NOT REMOVE!!
use std::process::Command;
use std::path::PathBuf;
use std::fs;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Emitter;

mod api;
mod tools;
mod compact;
mod session;
mod config;
mod mcp;

use api::types::*;
use api::ApiClient;

// ═══════════ Tauri State ═══════════

struct AppState {
    workspace_dir: Mutex<Option<String>>,
    permission_mode: Mutex<PermissionMode>,
}

// ═══════════ Agent Commands ═══════════

/// Send a chat message with streaming via Tauri events
#[tauri::command]
async fn agent_chat(
    provider: String,
    api_key: String,
    base_url: Option<String>,
    model: String,
    messages: Vec<Value>,
    system_prompt: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<Value, String> {
    let provider_type = match provider.as_str() {
        "anthropic" => ProviderType::Anthropic,
        "openai" => ProviderType::OpenAI,
        "google" => ProviderType::Google,
        "kimi" => ProviderType::Kimi,
        _ => ProviderType::Compatible,
    };

    let config = ProviderConfig {
        provider: provider_type,
        api_key,
        base_url,
        model,
        max_tokens: 4096,
    };

    let client = ApiClient::new(config);

    let chat_messages: Vec<ChatMessage> = messages.iter().filter_map(|m| {
        let role = m.get("role")?.as_str()?;
        let content = m.get("content")?.as_str()?;
        Some(ChatMessage {
            role: role.to_string(),
            content: MessageContent::Text(content.to_string()),
            tool_call_id: m.get("tool_call_id").and_then(|v| v.as_str()).map(String::from),
        })
    }).collect();

    // Stream via Tauri events
    let handle = app_handle.clone();
    let mut full_text = String::new();
    let mut usage_total = Usage::default();

    client.send_message_stream(
        &chat_messages,
        system_prompt.as_deref(),
        None,
        |event| {
            let _ = handle.emit("agent-stream", serde_json::to_value(&event).unwrap_or_default());
        },
    ).await?;

    // Also do a non-streaming call to get the full response for the return value
    let response = client.send_message(
        &chat_messages,
        system_prompt.as_deref(),
        None,
    ).await?;

    serde_json::to_value(&response).map_err(|e| format!("Serialize error: {}", e))
}

/// Stream-only chat — frontend handles all UI via events
#[tauri::command]
async fn agent_chat_stream(
    provider: String,
    api_key: String,
    base_url: Option<String>,
    model: String,
    messages: Vec<Value>,
    system_prompt: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let provider_type = match provider.as_str() {
        "anthropic" => ProviderType::Anthropic,
        "openai" => ProviderType::OpenAI,
        "google" => ProviderType::Google,
        "kimi" => ProviderType::Kimi,
        _ => ProviderType::Compatible,
    };

    let config = ProviderConfig {
        provider: provider_type,
        api_key,
        base_url,
        model,
        max_tokens: 4096,
    };

    let client = ApiClient::new(config);

    let chat_messages: Vec<ChatMessage> = messages.iter().filter_map(|m| {
        let role = m.get("role")?.as_str()?;
        let content = m.get("content")?.as_str()?;
        Some(ChatMessage {
            role: role.to_string(),
            content: MessageContent::Text(content.to_string()),
            tool_call_id: m.get("tool_call_id").and_then(|v| v.as_str()).map(String::from),
        })
    }).collect();

    let handle = app_handle.clone();

    client.send_message_stream(
        &chat_messages,
        system_prompt.as_deref(),
        None,
        |event| {
            let _ = handle.emit("agent-stream", serde_json::to_value(&event).unwrap_or_default());
        },
    ).await?;

    Ok(())
}

/// Execute a tool by name
#[tauri::command]
async fn agent_execute_tool(
    name: String,
    input: Value,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    // Log invocation
    let input_str = input.to_string();
    let _ = std::fs::write("/tmp/se-tool-log.txt", format!("name={}\ninput={}\n", name, &input_str[..input_str.len().min(500)]));

    let workspace = state.workspace_dir.lock().unwrap().clone();
    let mode = *state.permission_mode.lock().unwrap();

    let decision = tools::check_permission(&name, &input, mode, workspace.as_deref());
    match decision {
        PermissionDecision::Deny => {
            let msg = format!("Permission denied for tool '{}' in {:?} mode", name, mode);
            let _ = std::fs::write("/tmp/se-tool-result.txt", format!("DENY: {}", msg));
            return Err(msg);
        }
        PermissionDecision::Ask => {}
        PermissionDecision::Allow => {}
    }

    // Use tokio::task::spawn_blocking for sync operations
    let name_clone = name.clone();
    let workspace_clone = workspace.clone();
    let result = tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Handle::current();
        rt.block_on(tools::execute_tool(&name_clone, input, workspace_clone.as_deref()))
    }).await.map_err(|e| format!("Task join error: {}", e))?;

    match &result {
        Ok(output) => {
            let _ = std::fs::write("/tmp/se-tool-result.txt", format!("OK[{}]: {}", name, &output[..output.len().min(200)]));
        }
        Err(err) => {
            let _ = std::fs::write("/tmp/se-tool-result.txt", format!("ERR[{}]: {}", name, err));
        }
    }
    result
}

/// Get all available tool definitions
#[tauri::command]
fn agent_get_tools() -> Vec<Value> {
    tools::all_tool_definitions().into_iter().map(|t| {
        json!({
            "name": t.name,
            "description": t.description,
            "input_schema": t.input_schema,
        })
    }).collect()
}

/// Set the workspace directory for permission checks
#[tauri::command]
fn set_workspace_dir(dir: String, state: tauri::State<'_, AppState>) {
    *state.workspace_dir.lock().unwrap() = Some(dir);
}

/// Set permission mode
#[tauri::command]
fn set_permission_mode(mode: String, state: tauri::State<'_, AppState>) {
    let pm = match mode.as_str() {
        "read-only" => PermissionMode::ReadOnly,
        "workspace-write" => PermissionMode::WorkspaceWrite,
        "accept-edits" => PermissionMode::AcceptEdits,
        "dont-ask" => PermissionMode::DontAsk,
        "bypass" => PermissionMode::BypassPermissions,
        _ => PermissionMode::WorkspaceWrite,
    };
    *state.permission_mode.lock().unwrap() = pm;
}

/// Validate an API key by making a minimal request
#[tauri::command]
async fn validate_api_key(
    provider: String,
    api_key: String,
    base_url: Option<String>,
    model: String,
) -> Result<Value, String> {
    let provider_type = match provider.as_str() {
        "anthropic" => ProviderType::Anthropic,
        "openai" => ProviderType::OpenAI,
        "google" => ProviderType::Google,
        "kimi" => ProviderType::Kimi,
        _ => ProviderType::Compatible,
    };

    let config = ProviderConfig {
        provider: provider_type.clone(),
        api_key: api_key.clone(),
        base_url,
        model,
        max_tokens: 1,
    };

    let client = ApiClient::new(config);
    let test_msg = vec![ChatMessage {
        role: "user".to_string(),
        content: MessageContent::Text("hi".to_string()),
        tool_call_id: None,
    }];

    match client.send_message(&test_msg, None, None).await {
        Ok(_) => Ok(json!({"valid": true})),
        Err(e) => {
            if e.contains("401") || e.contains("Unauthorized") {
                Ok(json!({"valid": false, "error": "API Key 无效 (401)"}))
            } else if e.contains("403") || e.contains("Forbidden") {
                Ok(json!({"valid": false, "error": "API Key 权限不足 (403)"}))
            } else if e.contains("429") || e.contains("Rate") {
                Ok(json!({"valid": true})) // Rate limited = key is valid
            } else if e.contains("model") || e.contains("overloaded") {
                Ok(json!({"valid": true})) // Model issue but key works
            } else {
                Ok(json!({"valid": false, "error": e}))
            }
        }
    }
}

// ═══════════ Session Commands ═══════════

#[tauri::command]
fn save_session(data: Value) -> Result<(), String> {
    let session: session::SessionData = serde_json::from_value(data)
        .map_err(|e| format!("Invalid session data: {}", e))?;
    session::save_session(&session)
}

#[tauri::command]
fn load_session(id: String) -> Result<Value, String> {
    let s = session::load_session(&id)?;
    serde_json::to_value(s).map_err(|e| format!("Serialize: {}", e))
}

#[tauri::command]
fn list_sessions() -> Result<Vec<Value>, String> {
    let sessions = session::list_sessions()?;
    sessions.into_iter()
        .map(|s| serde_json::to_value(s).map_err(|e| format!("Serialize: {}", e)))
        .collect()
}

#[tauri::command]
fn delete_session_cmd(id: String) -> Result<(), String> {
    session::delete_session(&id)
}

#[tauri::command]
fn export_sessions() -> Result<String, String> {
    session::export_all_sessions()
}

#[tauri::command]
fn import_sessions(json_data: String) -> Result<usize, String> {
    session::import_sessions(&json_data)
}

// ═══════════ Compact Commands ═══════════

#[tauri::command]
fn check_compact_needed(messages: Vec<Value>) -> bool {
    let chat_msgs: Vec<api::types::ChatMessage> = messages.iter().filter_map(|m| {
        let role = m.get("role")?.as_str()?;
        let content = m.get("content")?.as_str()?;
        Some(api::types::ChatMessage {
            role: role.to_string(),
            content: api::types::MessageContent::Text(content.to_string()),
            tool_call_id: None,
        })
    }).collect();
    compact::should_compact(&chat_msgs, &compact::CompactConfig::default())
}

#[tauri::command]
fn compact_conversation(messages: Vec<Value>) -> Result<Value, String> {
    let chat_msgs: Vec<api::types::ChatMessage> = messages.iter().filter_map(|m| {
        let role = m.get("role")?.as_str()?;
        let content = m.get("content")?.as_str()?;
        Some(api::types::ChatMessage {
            role: role.to_string(),
            content: api::types::MessageContent::Text(content.to_string()),
            tool_call_id: None,
        })
    }).collect();

    let config = compact::CompactConfig::default();
    let result = compact::compact_messages(&chat_msgs, &config);
    let new_msgs = compact::build_compacted_messages(&chat_msgs, &config);

    let new_msgs_json: Vec<Value> = new_msgs.iter().map(|m| {
        json!({ "role": m.role, "content": m.content.as_text() })
    }).collect();

    Ok(json!({
        "result": serde_json::to_value(&result).unwrap_or_default(),
        "messages": new_msgs_json,
    }))
}

// ═══════════ Legacy Commands (kept for compatibility) ═══════════

#[derive(Serialize)]
struct CommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    success: bool,
}

#[tauri::command]
fn execute_command(command: String, cwd: Option<String>, timeout_ms: Option<u64>) -> Result<CommandResult, String> {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", &command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", &command]);
        c
    };

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let output = cmd.output().map_err(|e| format!("Failed to execute: {}", e))?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        success: output.status.success(),
    })
}

#[derive(Serialize)]
struct FileInfo {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[tauri::command]
fn read_file(path: String, allowed_dirs: Vec<String>) -> Result<String, String> {
    check_path_allowed(&path, &allowed_dirs)?;
    fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))
}

#[tauri::command]
fn write_file(path: String, content: String, allowed_dirs: Vec<String>) -> Result<String, String> {
    check_path_allowed(&path, &allowed_dirs)?;
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Mkdir error: {}", e))?;
    }
    fs::write(&path, &content).map_err(|e| format!("Write error: {}", e))?;
    Ok(format!("Wrote {} bytes to {}", content.len(), path))
}

#[tauri::command]
fn list_directory(path: String, allowed_dirs: Vec<String>) -> Result<Vec<FileInfo>, String> {
    check_path_allowed(&path, &allowed_dirs)?;
    let entries = fs::read_dir(&path).map_err(|e| format!("Read dir error: {}", e))?;
    
    let mut files: Vec<FileInfo> = Vec::new();
    for entry in entries.take(500) {
        if let Ok(entry) = entry {
            let metadata = entry.metadata().unwrap_or_else(|_| fs::metadata(entry.path()).unwrap());
            files.push(FileInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
            });
        }
    }
    Ok(files)
}

#[tauri::command]
fn delete_file(path: String, allowed_dirs: Vec<String>) -> Result<String, String> {
    check_path_allowed(&path, &allowed_dirs)?;
    let p = PathBuf::from(&path);
    if p.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Delete dir error: {}", e))?;
    } else {
        fs::remove_file(&path).map_err(|e| format!("Delete file error: {}", e))?;
    }
    Ok(format!("Deleted {}", path))
}

fn check_path_allowed(path: &str, allowed_dirs: &[String]) -> Result<(), String> {
    if allowed_dirs.is_empty() { return Ok(()); }
    
    let canonical = fs::canonicalize(path)
        .or_else(|_| {
            if let Some(parent) = PathBuf::from(path).parent() {
                fs::canonicalize(parent).map(|p| p.join(PathBuf::from(path).file_name().unwrap_or_default()))
            } else {
                Err(std::io::Error::new(std::io::ErrorKind::NotFound, "Cannot resolve path"))
            }
        })
        .map_err(|e| format!("Path resolution error: {}", e))?;
    
    let canonical_str = canonical.to_string_lossy().to_string();
    
    for allowed in allowed_dirs {
        if let Ok(allowed_canonical) = fs::canonicalize(allowed) {
            if canonical_str.starts_with(&allowed_canonical.to_string_lossy().to_string()) {
                return Ok(());
            }
        }
    }
    
    Err(format!("Access denied: {} is outside allowed directories", path))
}

// ═══════════ Health Check ═══════════

#[derive(Serialize)]
struct HealthStatus {
    config_valid: bool,
    config_error: Option<String>,
    app_version: String,
}

#[tauri::command]
async fn web_search(query: String) -> Result<String, String> {
    let encoded = urlencoding::encode(&query);
    let url = format!(
        "https://hn.algolia.com/api/v1/search_by_date?query={}&tags=story&hitsPerPage=5",
        encoded
    );
    
    // Use tokio::process (async) with timeout to avoid blocking the runtime
    use tokio::process::Command as AsyncCommand;
    
    let child = AsyncCommand::new("/usr/bin/curl")
        .args(["-x", "http://127.0.0.1:11088", "-sL", "--connect-timeout", "8", "--max-time", "12", &url])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("curl 启动失败: {}", e))?;
    
    // Hard 15s timeout
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        child.wait_with_output()
    ).await;
    
    let output = match result {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("curl 执行错误: {}", e)),
        Err(_) => return Err("搜索超时 (15s) — 网络或代理不可用".to_string()),
    };
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("curl 失败 (exit {}): {}", output.status.code().unwrap_or(-1), stderr.trim()));
    }
    
    let body = String::from_utf8_lossy(&output.stdout);
    if body.is_empty() {
        return Err("搜索返回空 — 代理可能不可用".to_string());
    }
    
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| format!("非 JSON 响应: {}", &body[..body.len().min(200)]))?;
    
    let empty = vec![];
    let hits = json["hits"].as_array().unwrap_or(&empty);
    if hits.is_empty() {
        return Ok(format!("搜索 \"{}\" 无匹配结果", query));
    }
    
    let mut results = Vec::new();
    for (i, hit) in hits.iter().take(5).enumerate() {
        let title = hit["title"].as_str().unwrap_or("N/A");
        let hn_url = format!("https://news.ycombinator.com/item?id={}", hit["objectID"].as_str().unwrap_or(""));
        let u = hit["url"].as_str().unwrap_or(&hn_url);
        let date = hit["created_at"].as_str().unwrap_or("").split('T').next().unwrap_or("");
        results.push(format!("{}. {}\n   {}\n   {}", i + 1, title, u, date));
    }
    Ok(format!("\u{1f50d} ({}):\n\n{}", query, results.join("\n\n")))
}

#[tauri::command]
fn health_check() -> HealthStatus {

    let config_dir = dirs_config_path();
    let (config_valid, config_error) = match fs::read_to_string(&config_dir) {
        Ok(content) => {
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(_) => (true, None),
                Err(e) => (false, Some(format!("Invalid JSON: {}", e))),
            }
        }
        Err(_) => (true, None),
    };
    
    HealthStatus {
        config_valid,
        config_error,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
fn repair_config() -> Result<String, String> {
    let config_path = dirs_config_path();
    let backup_path = format!("{}.backup", config_path);
    
    if PathBuf::from(&config_path).exists() {
        fs::copy(&config_path, &backup_path).ok();
    }
    
    let default_config = json!({
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "language": "zh-CN"
    });
    
    if let Some(parent) = PathBuf::from(&config_path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Mkdir error: {}", e))?;
    }
    fs::write(&config_path, serde_json::to_string_pretty(&default_config).unwrap())
        .map_err(|e| format!("Write error: {}", e))?;
    
    Ok(format!("Config repaired. Backup saved to {}", backup_path))
}

fn dirs_config_path() -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    format!("{}/.super-excellent/config.json", home)
}

// ═══════════ App Entry ═══════════

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            workspace_dir: Mutex::new(None),
            permission_mode: Mutex::new(PermissionMode::WorkspaceWrite),
        })
        .invoke_handler(tauri::generate_handler![
            // Agent commands
            agent_chat,
            agent_chat_stream,
            agent_execute_tool,
            agent_get_tools,
            set_workspace_dir,
            set_permission_mode,
            validate_api_key,
            // Session commands
            save_session,
            load_session,
            list_sessions,
            delete_session_cmd,
            export_sessions,
            import_sessions,
            // Compact commands
            check_compact_needed,
            compact_conversation,
            // Legacy commands
            execute_command,
            read_file,
            write_file,
            list_directory,
            delete_file,
            web_search,
            health_check,
            repair_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
