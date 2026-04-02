use std::process::Command;
use std::path::PathBuf;
use std::fs;
use serde::{Deserialize, Serialize};

// ===== S11: Terminal Command Execution =====

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

// ===== S12: File System Operations with Sandbox =====

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

/// Security gate: check if path is within allowed directories
fn check_path_allowed(path: &str, allowed_dirs: &[String]) -> Result<(), String> {
    if allowed_dirs.is_empty() {
        return Ok(()); // No restrictions configured
    }
    
    let canonical = fs::canonicalize(path)
        .or_else(|_| {
            // File might not exist yet; check parent
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

// ===== S15: Watchdog / Health Check =====

#[derive(Serialize)]
struct HealthStatus {
    config_valid: bool,
    config_error: Option<String>,
    app_version: String,
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
        Err(_) => (true, None), // No config file yet is OK
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
    
    // Backup current config
    if PathBuf::from(&config_path).exists() {
        fs::copy(&config_path, &backup_path).ok();
    }
    
    // Write default config
    let default_config = serde_json::json!({
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

// ===== App Entry =====

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            execute_command,
            read_file,
            write_file,
            list_directory,
            delete_file,
            health_check,
            repair_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
