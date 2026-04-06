/// Multi-layer configuration system
/// Merges: defaults → global (~/.super-excellent/config.json) → project (.se-config.json)
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub provider: String,
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    pub model: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_permission_mode")]
    pub permission_mode: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default)]
    pub workspace_dirs: Vec<String>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerConfig>,
}

fn default_language() -> String { "zh-CN".to_string() }
fn default_theme() -> String { "dark".to_string() }
fn default_permission_mode() -> String { "workspace-write".to_string() }
fn default_max_tokens() -> u32 { 4096 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            provider: "anthropic".to_string(),
            api_key: String::new(),
            base_url: None,
            model: "claude-sonnet-4-6".to_string(),
            language: default_language(),
            theme: default_theme(),
            permission_mode: default_permission_mode(),
            max_tokens: default_max_tokens(),
            workspace_dirs: Vec::new(),
            mcp_servers: Vec::new(),
        }
    }
}

fn global_config_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".super-excellent").join("config.json")
}

fn project_config_path(project_dir: &str) -> PathBuf {
    PathBuf::from(project_dir).join(".se-config.json")
}

/// Load and merge configs: defaults → global → project
pub fn load_merged_config(project_dir: Option<&str>) -> AppConfig {
    let mut config = AppConfig::default();

    // Layer 1: Global config
    if let Ok(content) = fs::read_to_string(global_config_path()) {
        if let Ok(global) = serde_json::from_str::<Value>(&content) {
            merge_config(&mut config, &global);
        }
    }

    // Layer 2: Project config (overrides global)
    if let Some(dir) = project_dir {
        let project_path = project_config_path(dir);
        if let Ok(content) = fs::read_to_string(&project_path) {
            if let Ok(project) = serde_json::from_str::<Value>(&content) {
                merge_config(&mut config, &project);
            }
        }
    }

    config
}

fn merge_config(config: &mut AppConfig, overlay: &Value) {
    if let Some(v) = overlay.get("provider").and_then(|v| v.as_str()) {
        config.provider = v.to_string();
    }
    if let Some(v) = overlay.get("api_key").and_then(|v| v.as_str()) {
        if !v.is_empty() { config.api_key = v.to_string(); }
    }
    if let Some(v) = overlay.get("base_url").and_then(|v| v.as_str()) {
        config.base_url = Some(v.to_string());
    }
    if let Some(v) = overlay.get("model").and_then(|v| v.as_str()) {
        config.model = v.to_string();
    }
    if let Some(v) = overlay.get("language").and_then(|v| v.as_str()) {
        config.language = v.to_string();
    }
    if let Some(v) = overlay.get("theme").and_then(|v| v.as_str()) {
        config.theme = v.to_string();
    }
    if let Some(v) = overlay.get("permission_mode").and_then(|v| v.as_str()) {
        config.permission_mode = v.to_string();
    }
    if let Some(v) = overlay.get("max_tokens").and_then(|v| v.as_u64()) {
        config.max_tokens = v as u32;
    }
    if let Some(dirs) = overlay.get("workspace_dirs").and_then(|v| v.as_array()) {
        for dir in dirs {
            if let Some(s) = dir.as_str() {
                if !config.workspace_dirs.contains(&s.to_string()) {
                    config.workspace_dirs.push(s.to_string());
                }
            }
        }
    }
    if let Some(servers) = overlay.get("mcp_servers").and_then(|v| v.as_array()) {
        if let Ok(parsed) = serde_json::from_value::<Vec<McpServerConfig>>(Value::Array(servers.clone())) {
            config.mcp_servers.extend(parsed);
        }
    }
}

/// Save config to global path
pub fn save_global_config(config: &AppConfig) -> Result<(), String> {
    let path = global_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| format!("serialize: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("write: {}", e))?;
    Ok(())
}
