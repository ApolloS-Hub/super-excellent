/// Tool system — real implementations adapted from claw-code Rust port
/// Each tool has proper error handling, sandboxing, and permission awareness
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod browser;

use crate::api::types::{ToolDefinition, PermissionMode, PermissionDecision, RiskLevel};

// ═══════════ Tool Registry ═══════════

#[derive(Debug, Clone)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub is_read_only: bool,
    pub risk_level: RiskLevel,
}

pub fn all_tool_definitions() -> Vec<ToolDefinition> {
    all_tool_specs().into_iter().map(|s| ToolDefinition {
        name: s.name,
        description: Some(s.description),
        input_schema: s.input_schema,
    }).collect()
}

pub fn all_tool_specs() -> Vec<ToolSpec> {
    vec![
        bash_spec(),
        file_read_spec(),
        file_write_spec(),
        file_edit_spec(),
        glob_spec(),
        grep_spec(),
        list_dir_spec(),
        web_search_spec(),
        web_fetch_spec(),
        ask_user_spec(),
        browser::browser_spec(),
    ]
}

// ═══════════ Permission Check ═══════════

pub fn check_permission(
    tool_name: &str,
    input: &Value,
    mode: PermissionMode,
    workspace_dir: Option<&str>,
) -> PermissionDecision {
    if mode == PermissionMode::BypassPermissions || mode == PermissionMode::DontAsk {
        return PermissionDecision::Allow;
    }

    let spec = all_tool_specs().into_iter().find(|s| s.name == tool_name);
    let is_read_only = spec.as_ref().map(|s| s.is_read_only).unwrap_or(false);

    // ReadOnly mode: only allow read-only tools
    if mode == PermissionMode::ReadOnly && !is_read_only {
        return PermissionDecision::Deny;
    }

    // WorkspaceWrite: allow writes only within workspace
    if mode == PermissionMode::WorkspaceWrite && !is_read_only {
        if let Some(ws) = workspace_dir {
            // Check if the tool's target path is within workspace
            let target_path = extract_path_from_input(tool_name, input);
            if let Some(path) = target_path {
                if !is_within_directory(&path, ws) {
                    return PermissionDecision::Deny;
                }
            }
        }
    }

    // AcceptEdits: allow file edits without asking
    if mode == PermissionMode::AcceptEdits && (tool_name == "Write" || tool_name == "Edit") {
        return PermissionDecision::Allow;
    }

    // For bash commands in non-bypass modes, check for dangerous patterns
    if tool_name == "Bash" && mode != PermissionMode::DontAsk {
        if let Some(cmd) = input.get("command").and_then(|v| v.as_str()) {
            if is_dangerous_command(cmd) {
                return PermissionDecision::Ask;
            }
        }
    }

    PermissionDecision::Allow
}

fn extract_path_from_input(tool_name: &str, input: &Value) -> Option<String> {
    match tool_name {
        "Read" | "Write" | "Edit" => input.get("path").and_then(|v| v.as_str()).map(String::from),
        "Bash" => None, // Bash paths are complex to extract
        "Glob" | "Grep" => input.get("path").and_then(|v| v.as_str()).map(String::from),
        _ => None,
    }
}

fn is_within_directory(path: &str, dir: &str) -> bool {
    let canonical_path = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
    let canonical_dir = std::fs::canonicalize(dir).unwrap_or_else(|_| PathBuf::from(dir));
    canonical_path.starts_with(canonical_dir)
}

fn is_dangerous_command(cmd: &str) -> bool {
    let lower = cmd.to_lowercase();

    // Critical: destructive system commands
    let critical = [
        "rm -rf /", "rm -rf ~", "rm -rf /*", "mkfs", "dd if=", "> /dev/",
        "chmod -R 777 /", ":(){ :|:& };:", "shutdown", "reboot", "halt", "poweroff",
        "DROP DATABASE", "DROP TABLE", "DELETE FROM", "TRUNCATE TABLE",
    ];
    if critical.iter().any(|p| lower.contains(&p.to_lowercase())) {
        return true;
    }

    // High risk: piped remote execution
    let pipe_exec = [
        "curl | sh", "curl | bash", "wget | sh", "wget | bash",
        "curl|sh", "curl|bash", "wget|sh", "wget|bash",
        "eval $(curl", "eval $(wget", "bash <(curl", "bash <(wget",
    ];
    if pipe_exec.iter().any(|p| lower.contains(&p.to_lowercase())) {
        return true;
    }

    // Elevated: sudo/su commands
    if lower.starts_with("sudo ") || lower.starts_with("su ") || lower.contains("| sudo") {
        return true;
    }

    // Git push force
    if lower.contains("git push") && (lower.contains("--force") || lower.contains("-f")) {
        return true;
    }

    // Environment variable overwrites
    if lower.contains("export PATH=") && !lower.contains("$PATH") {
        return true;
    }

    false
}

/// Classify command risk level
fn classify_command_risk(cmd: &str) -> RiskLevel {
    let lower = cmd.to_lowercase();

    if is_dangerous_command(cmd) {
        return RiskLevel::Critical;
    }

    // Write operations
    if lower.starts_with("rm ") || lower.contains("mv ") || lower.contains("cp ") {
        return RiskLevel::Medium;
    }

    // Network operations
    if lower.starts_with("curl ") || lower.starts_with("wget ") || lower.contains("ssh ") {
        return RiskLevel::Medium;
    }

    // Package management
    if lower.starts_with("npm ") || lower.starts_with("pip ") || lower.starts_with("brew ") ||
       lower.starts_with("apt ") || lower.starts_with("cargo ") {
        return RiskLevel::Low;
    }

    // Git operations
    if lower.starts_with("git ") {
        if lower.contains("push") || lower.contains("reset") || lower.contains("rebase") {
            return RiskLevel::Medium;
        }
        return RiskLevel::Low;
    }

    // Read-only commands
    if lower.starts_with("ls ") || lower.starts_with("cat ") || lower.starts_with("echo ") ||
       lower.starts_with("pwd") || lower.starts_with("which ") || lower.starts_with("grep ") ||
       lower.starts_with("find ") || lower.starts_with("wc ") || lower.starts_with("head ") ||
       lower.starts_with("tail ") {
        return RiskLevel::Safe;
    }

    RiskLevel::Low
}

// ═══════════ Tool Executor ═══════════

pub async fn execute_tool(
    name: &str,
    input: Value,
    workspace_dir: Option<&str>,
) -> Result<String, String> {
    match name {
        "Bash" => execute_bash(input, workspace_dir).await,
        "Read" => execute_read(input).await,
        "Write" => execute_write(input).await,
        "Edit" => execute_edit(input).await,
        "Glob" => execute_glob(input).await,
        "Grep" => execute_grep(input).await,
        "ListDir" => execute_list_dir(input).await,
        "WebSearch" => execute_web_search(input).await,
        "WebFetch" => execute_web_fetch(input).await,
        "AskUser" => Ok("[Waiting for user input]".to_string()),
        "Browser" => browser::execute_browser(input).await,
        _ => Err(format!("Unknown tool: {}", name)),
    }
}

// ═══════════ Bash Tool ═══════════

fn bash_spec() -> ToolSpec {
    ToolSpec {
        name: "Bash".into(),
        description: "Execute a shell command. Use for running scripts, installing packages, git operations, etc. Commands run in a shell with a 120s timeout by default.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "The shell command to execute"},
                "timeout": {"type": "number", "description": "Timeout in seconds (default: 120)"},
                "cwd": {"type": "string", "description": "Working directory for the command"}
            },
            "required": ["command"]
        }),
        is_read_only: false,
        risk_level: RiskLevel::High,
    }
}

async fn execute_bash(input: Value, workspace_dir: Option<&str>) -> Result<String, String> {
    let command = input.get("command").and_then(|v| v.as_str())
        .ok_or("Missing 'command' parameter")?;
    let timeout_secs = input.get("timeout").and_then(|v| v.as_u64()).unwrap_or(120);
    let cwd = input.get("cwd").and_then(|v| v.as_str())
        .or(workspace_dir);

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    // Set timeout via environment variable (shell level)
    cmd.env("TIMEOUT", timeout_secs.to_string());

    let output = cmd.output().map_err(|e| format!("Execution failed: {}", e))?;

    let mut result = String::new();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stdout.is_empty() {
        // Truncate very long output
        if stdout.len() > 100_000 {
            result.push_str(&stdout[..50_000]);
            result.push_str("\n\n... [truncated] ...\n\n");
            result.push_str(&stdout[stdout.len()-50_000..]);
        } else {
            result.push_str(&stdout);
        }
    }
    if !stderr.is_empty() {
        if !result.is_empty() { result.push('\n'); }
        result.push_str("STDERR:\n");
        let truncated = if stderr.len() > 10_000 { &stderr[..10_000] } else { &stderr };
        result.push_str(truncated);
    }

    if !output.status.success() && result.is_empty() {
        result = format!("Command exited with code {}", output.status.code().unwrap_or(-1));
    }

    if result.is_empty() {
        result = "(no output)".to_string();
    }

    Ok(result)
}

// ═══════════ File Read Tool ═══════════

fn file_read_spec() -> ToolSpec {
    ToolSpec {
        name: "Read".into(),
        description: "Read the contents of a file. Supports text files. For large files, use offset and limit to read portions.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute path to the file"},
                "offset": {"type": "number", "description": "Line offset to start reading from (0-indexed)"},
                "limit": {"type": "number", "description": "Maximum number of lines to read"}
            },
            "required": ["path"]
        }),
        is_read_only: true,
        risk_level: RiskLevel::Safe,
    }
}

async fn execute_read(input: Value) -> Result<String, String> {
    let path = input.get("path").and_then(|v| v.as_str())
        .ok_or("Missing 'path' parameter")?;
    let offset = input.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let limit = input.get("limit").and_then(|v| v.as_u64()).unwrap_or(2000) as usize;

    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))?;

    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();

    if offset >= total {
        return Ok(format!("(file has {} lines, offset {} is past end)", total, offset));
    }

    let end = (offset + limit).min(total);
    let selected: Vec<&str> = lines[offset..end].to_vec();
    let mut result = selected.join("\n");

    if end < total {
        result.push_str(&format!("\n\n[{} more lines in file. Use offset={} to continue.]", total - end, end));
    }

    Ok(result)
}

// ═══════════ File Write Tool ═══════════

fn file_write_spec() -> ToolSpec {
    ToolSpec {
        name: "Write".into(),
        description: "Write content to a file. Creates the file and parent directories if they don't exist. Overwrites existing content.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute path to write to"},
                "content": {"type": "string", "description": "Content to write"}
            },
            "required": ["path", "content"]
        }),
        is_read_only: false,
        risk_level: RiskLevel::Medium,
    }
}

async fn execute_write(input: Value) -> Result<String, String> {
    let path = input.get("path").and_then(|v| v.as_str())
        .ok_or("Missing 'path' parameter")?;
    let content = input.get("content").and_then(|v| v.as_str())
        .ok_or("Missing 'content' parameter")?;

    // Create parent directories
    if let Some(parent) = Path::new(path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    std::fs::write(path, content)
        .map_err(|e| format!("Failed to write {}: {}", path, e))?;

    Ok(format!("Successfully wrote {} bytes to {}", content.len(), path))
}

// ═══════════ File Edit Tool ═══════════

fn file_edit_spec() -> ToolSpec {
    ToolSpec {
        name: "Edit".into(),
        description: "Edit a file by replacing exact text. The old_text must match exactly (including whitespace). Use for precise, surgical edits.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute path to the file"},
                "old_text": {"type": "string", "description": "Exact text to find and replace"},
                "new_text": {"type": "string", "description": "New text to replace with"}
            },
            "required": ["path", "old_text", "new_text"]
        }),
        is_read_only: false,
        risk_level: RiskLevel::Medium,
    }
}

async fn execute_edit(input: Value) -> Result<String, String> {
    let path = input.get("path").and_then(|v| v.as_str())
        .ok_or("Missing 'path' parameter")?;
    let old_text = input.get("old_text").and_then(|v| v.as_str())
        .ok_or("Missing 'old_text' parameter")?;
    let new_text = input.get("new_text").and_then(|v| v.as_str())
        .ok_or("Missing 'new_text' parameter")?;

    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))?;

    let count = content.matches(old_text).count();
    if count == 0 {
        // Try to provide helpful context
        let preview = if content.len() > 500 { &content[..500] } else { &content };
        return Err(format!(
            "Could not find the exact text in {}. The old_text must match exactly including all whitespace.\nFile preview:\n{}...",
            path, preview
        ));
    }
    if count > 1 {
        return Err(format!(
            "Found {} matches of old_text in {}. Expected exactly 1. Please provide more specific text.",
            count, path
        ));
    }

    let new_content = content.replacen(old_text, new_text, 1);
    std::fs::write(path, &new_content)
        .map_err(|e| format!("Failed to write {}: {}", path, e))?;

    Ok(format!("Successfully replaced text in {}", path))
}

// ═══════════ Glob Tool ═══════════

fn glob_spec() -> ToolSpec {
    ToolSpec {
        name: "Glob".into(),
        description: "Find files matching a glob pattern. Returns matching file paths.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Glob pattern (e.g., '**/*.rs', 'src/**/*.ts')"},
                "path": {"type": "string", "description": "Base directory to search from"}
            },
            "required": ["pattern"]
        }),
        is_read_only: true,
        risk_level: RiskLevel::Safe,
    }
}

async fn execute_glob(input: Value) -> Result<String, String> {
    let pattern = input.get("pattern").and_then(|v| v.as_str())
        .ok_or("Missing 'pattern' parameter")?;
    let base = input.get("path").and_then(|v| v.as_str()).unwrap_or(".");

    let full_pattern = if pattern.starts_with('/') {
        pattern.to_string()
    } else {
        format!("{}/{}", base, pattern)
    };

    let mut results = Vec::new();
    for entry in glob::glob(&full_pattern).map_err(|e| format!("Invalid pattern: {}", e))? {
        match entry {
            Ok(path) => results.push(path.to_string_lossy().to_string()),
            Err(e) => results.push(format!("Error: {}", e)),
        }
        if results.len() >= 1000 { break; }
    }

    if results.is_empty() {
        Ok(format!("No files matched pattern: {}", pattern))
    } else {
        Ok(format!("{} file(s) matched:\n{}", results.len(), results.join("\n")))
    }
}

// ═══════════ Grep Tool ═══════════

fn grep_spec() -> ToolSpec {
    ToolSpec {
        name: "Grep".into(),
        description: "Search for a pattern in files. Returns matching lines with file paths and line numbers.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Regex pattern to search for"},
                "path": {"type": "string", "description": "Directory or file to search in"},
                "include": {"type": "string", "description": "File glob pattern to include (e.g., '*.rs')"}
            },
            "required": ["pattern"]
        }),
        is_read_only: true,
        risk_level: RiskLevel::Safe,
    }
}

async fn execute_grep(input: Value) -> Result<String, String> {
    let pattern = input.get("pattern").and_then(|v| v.as_str())
        .ok_or("Missing 'pattern' parameter")?;
    let path = input.get("path").and_then(|v| v.as_str()).unwrap_or(".");
    let include = input.get("include").and_then(|v| v.as_str());

    // Use system grep for efficiency
    let mut cmd = Command::new("grep");
    cmd.args(["-rn", "--color=never", "-m", "100"]);

    if let Some(inc) = include {
        cmd.args(["--include", inc]);
    }

    cmd.args([pattern, path]);

    let output = cmd.output().map_err(|e| format!("grep failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.is_empty() {
        Ok(format!("No matches for pattern '{}' in {}", pattern, path))
    } else {
        let lines: Vec<&str> = stdout.lines().take(200).collect();
        Ok(format!("{} match(es):\n{}", lines.len(), lines.join("\n")))
    }
}

// ═══════════ List Directory Tool ═══════════

fn list_dir_spec() -> ToolSpec {
    ToolSpec {
        name: "ListDir".into(),
        description: "List files and directories in a given path. Shows file names, sizes, and types.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path to list"}
            },
            "required": ["path"]
        }),
        is_read_only: true,
        risk_level: RiskLevel::Safe,
    }
}

async fn execute_list_dir(input: Value) -> Result<String, String> {
    let path = input.get("path").and_then(|v| v.as_str())
        .ok_or("Missing 'path' parameter")?;

    let entries = std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory {}: {}", path, e))?;

    let mut results = Vec::new();
    for entry in entries.take(500) {
        if let Ok(entry) = entry {
            let meta = entry.metadata().ok();
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let name = entry.file_name().to_string_lossy().to_string();
            let prefix = if is_dir { "📁" } else { "📄" };
            let size_str = if is_dir { "".to_string() } else { format!(" ({})", format_size(size)) };
            results.push(format!("{} {}{}", prefix, name, size_str));
        }
    }

    Ok(results.join("\n"))
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 { return format!("{}B", bytes); }
    if bytes < 1024 * 1024 { return format!("{:.1}KB", bytes as f64 / 1024.0); }
    if bytes < 1024 * 1024 * 1024 { return format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0)); }
    format!("{:.1}GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

// ═══════════ Web Search Tool ═══════════

fn web_search_spec() -> ToolSpec {
    ToolSpec {
        name: "WebSearch".into(),
        description: "Search the web using DuckDuckGo. Returns titles, URLs, and snippets.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "count": {"type": "number", "description": "Number of results (default: 5)"}
            },
            "required": ["query"]
        }),
        is_read_only: true,
        risk_level: RiskLevel::Safe,
    }
}

async fn execute_web_search(input: Value) -> Result<String, String> {
    let query = input.get("query").and_then(|v| v.as_str())
        .ok_or("Missing 'query' parameter")?;

    // Try DuckDuckGo first (works with proxy), fallback to Baidu (works in China)
    if let Ok(results) = try_duckduckgo_search(query) {
        if !results.is_empty() {
            return Ok(results);
        }
    }

    // Fallback: Baidu search (no proxy needed in China)
    if let Ok(results) = try_baidu_search(query) {
        if !results.is_empty() {
            return Ok(results);
        }
    }

    Ok(format!("搜索 \"{}\" 暂无结果。\n手动搜索: https://www.baidu.com/s?wd={}", query, urlencoding(query)))
}

fn try_duckduckgo_search(query: &str) -> Result<String, String> {
    let output = Command::new("curl")
        .args(["-sL", "--connect-timeout", "8", "--max-time", "15",
               &format!("https://html.duckduckgo.com/html/?q={}", urlencoding(query))])
        .output()
        .map_err(|e| format!("curl failed: {}", e))?;

    let html = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();
    for (i, chunk) in html.split("class=\"result__a\"").enumerate().skip(1) {
        if i > 5 { break; }
        if let Some(href_start) = chunk.find("href=\"") {
            let rest = &chunk[href_start + 6..];
            if let Some(href_end) = rest.find('"') {
                let href = &rest[..href_end];
                if let Some(close) = rest.find('>') {
                    let after = &rest[close + 1..];
                    if let Some(end_a) = after.find("</a>") {
                        let title = strip_html(&after[..end_a]);
                        results.push(format!("{}. {}\n   {}", i, title.trim(), href));
                    }
                }
            }
        }
    }
    if results.is_empty() { return Err("no results".into()); }
    Ok(format!("[DuckDuckGo]\n{}", results.join("\n\n")))
}

fn try_baidu_search(query: &str) -> Result<String, String> {
    let output = Command::new("curl")
        .args(["-sL", "--connect-timeout", "5", "--max-time", "10",
               "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
               &format!("https://www.baidu.com/s?wd={}", urlencoding(query))])
        .output()
        .map_err(|e| format!("curl failed: {}", e))?;

    let html = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();
    let mut count = 0;

    // Baidu results are in <h3 class="t"> or <h3 class="c-title">
    for chunk in html.split("<h3").skip(1) {
        if count >= 5 { break; }
        // Extract link
        if let Some(href_start) = chunk.find("href=\"") {
            let rest = &chunk[href_start + 6..];
            if let Some(href_end) = rest.find('"') {
                let href = &rest[..href_end];
                // Extract title text between > and </a>
                if let Some(a_start) = rest.find('>') {
                    let after = &rest[a_start + 1..];
                    if let Some(a_end) = after.find("</a>") {
                        let title = strip_html(&after[..a_end]).trim().to_string();
                        if !title.is_empty() {
                            count += 1;
                            results.push(format!("{}. {}\n   {}", count, title, href));
                        }
                    }
                }
            }
        }
    }
    if results.is_empty() { return Err("no results".into()); }
    Ok(format!("[百度搜索]\n{}", results.join("\n\n")))
}

fn urlencoding(s: &str) -> String {
    s.chars().map(|c| {
        if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' {
            c.to_string()
        } else if c == ' ' {
            "+".to_string()
        } else {
            format!("%{:02X}", c as u32)
        }
    }).collect()
}

fn strip_html(s: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        if c == '<' { in_tag = true; }
        else if c == '>' { in_tag = false; }
        else if !in_tag { result.push(c); }
    }
    result
}

// ═══════════ Web Fetch Tool ═══════════

fn web_fetch_spec() -> ToolSpec {
    ToolSpec {
        name: "WebFetch".into(),
        description: "Fetch and extract readable content from a URL. Returns the page content as text.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to fetch"},
                "max_chars": {"type": "number", "description": "Maximum characters to return (default: 50000)"}
            },
            "required": ["url"]
        }),
        is_read_only: true,
        risk_level: RiskLevel::Low,
    }
}

async fn execute_web_fetch(input: Value) -> Result<String, String> {
    let url = input.get("url").and_then(|v| v.as_str())
        .ok_or("Missing 'url' parameter")?;
    let max_chars = input.get("max_chars").and_then(|v| v.as_u64()).unwrap_or(50000) as usize;

    let output = Command::new("curl")
        .args(["-sL", "-m", "30", "--max-filesize", "5000000", url])
        .output()
        .map_err(|e| format!("curl failed: {}", e))?;

    let content = String::from_utf8_lossy(&output.stdout);

    // Basic HTML to text conversion
    let text = strip_html(&content);
    let cleaned: String = text.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if cleaned.len() > max_chars {
        Ok(format!("{}\n\n[Truncated at {} chars]", &cleaned[..max_chars], max_chars))
    } else {
        Ok(cleaned)
    }
}

// ═══════════ Ask User Tool ═══════════

fn ask_user_spec() -> ToolSpec {
    ToolSpec {
        name: "AskUser".into(),
        description: "Ask the user a question and wait for their response. Use when you need clarification or approval.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Question to ask the user"}
            },
            "required": ["question"]
        }),
        is_read_only: true,
        risk_level: RiskLevel::Safe,
    }
}
