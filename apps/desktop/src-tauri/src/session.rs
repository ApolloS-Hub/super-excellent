/// Session persistence — save/load conversations to disk
/// Adapted from claw-code Rust port's session.rs
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::api::types::{ChatMessage, MessageContent, Usage};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<SessionMessage>,
    pub usage: SessionUsage,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<Value>>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub total_cost_usd: f64,
}

fn sessions_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".super-excellent").join("sessions")
}

fn session_path(id: &str) -> PathBuf {
    sessions_dir().join(format!("{}.json", id))
}

/// Save a session to disk
pub fn save_session(session: &SessionData) -> Result<(), String> {
    let dir = sessions_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir: {}", e))?;

    let path = session_path(&session.id);
    let json = serde_json::to_string_pretty(session)
        .map_err(|e| format!("Serialize: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Write: {}", e))?;
    Ok(())
}

/// Load a session from disk
pub fn load_session(id: &str) -> Result<SessionData, String> {
    let path = session_path(id);
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Read session {}: {}", id, e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Parse session {}: {}", id, e))
}

/// List all saved sessions (sorted by updated_at desc)
pub fn list_sessions() -> Result<Vec<SessionData>, String> {
    let dir = sessions_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("Read dir: {}", e))?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(session) = serde_json::from_str::<SessionData>(&content) {
                        sessions.push(session);
                    }
                }
            }
        }
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

/// Delete a session
pub fn delete_session(id: &str) -> Result<(), String> {
    let path = session_path(id);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete: {}", e))?;
    }
    Ok(())
}

/// Export all sessions as JSON
pub fn export_all_sessions() -> Result<String, String> {
    let sessions = list_sessions()?;
    serde_json::to_string_pretty(&sessions)
        .map_err(|e| format!("Serialize: {}", e))
}

/// Import sessions from JSON string
pub fn import_sessions(json: &str) -> Result<usize, String> {
    let sessions: Vec<SessionData> = serde_json::from_str(json)
        .map_err(|e| format!("Parse: {}", e))?;
    let count = sessions.len();
    for session in &sessions {
        save_session(session)?;
    }
    Ok(count)
}

/// Convert ChatMessage to SessionMessage
pub fn chat_to_session_msg(msg: &ChatMessage) -> SessionMessage {
    SessionMessage {
        role: msg.role.clone(),
        content: msg.content.as_text(),
        tool_call_id: msg.tool_call_id.clone(),
        tool_calls: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
    }
}
