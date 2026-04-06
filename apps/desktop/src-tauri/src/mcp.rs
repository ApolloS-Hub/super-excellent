/// MCP (Model Context Protocol) Client — stdio transport
/// Connects to external MCP servers via stdin/stdout
/// Adapted from claw-code's mcp_stdio.rs (simplified)
use std::collections::HashMap;
use std::process::{Command, Stdio, Child};
use std::io::{BufRead, BufReader, Write};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Value,
    pub server_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResource {
    pub uri: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub mime_type: Option<String>,
    pub server_name: String,
}

pub struct McpClient {
    servers: HashMap<String, McpServerProcess>,
}

struct McpServerProcess {
    config: McpServerConfig,
    child: Child,
    request_id: u64,
}

impl McpClient {
    pub fn new() -> Self {
        Self { servers: HashMap::new() }
    }

    /// Start an MCP server
    pub fn start_server(&mut self, config: McpServerConfig) -> Result<(), String> {
        let name = config.name.clone();

        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        for (k, v) in &config.env {
            cmd.env(k, v);
        }

        let child = cmd.spawn().map_err(|e| format!("Failed to start MCP server '{}': {}", name, e))?;

        let mut process = McpServerProcess {
            config,
            child,
            request_id: 0,
        };

        // Initialize the server
        let init_result = send_request(&mut process, "initialize", json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "super-excellent",
                "version": "0.1.0"
            }
        }))?;

        // Send initialized notification
        send_notification(&mut process, "notifications/initialized", json!({}))?;

        self.servers.insert(name, process);
        Ok(())
    }

    /// Stop an MCP server
    pub fn stop_server(&mut self, name: &str) -> Result<(), String> {
        if let Some(mut process) = self.servers.remove(name) {
            let _ = process.child.kill();
        }
        Ok(())
    }

    /// Stop all servers
    pub fn stop_all(&mut self) {
        let names: Vec<String> = self.servers.keys().cloned().collect();
        for name in names {
            let _ = self.stop_server(&name);
        }
    }

    /// List tools from all connected servers
    pub fn list_tools(&mut self) -> Result<Vec<McpTool>, String> {
        let mut all_tools = Vec::new();
        let names: Vec<String> = self.servers.keys().cloned().collect();

        for name in names {
            if let Some(process) = self.servers.get_mut(&name) {
                let result = send_request(process, "tools/list", json!({}))?;
                if let Some(tools) = result.get("tools").and_then(|v| v.as_array()) {
                    for tool in tools {
                        all_tools.push(McpTool {
                            name: tool.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            description: tool.get("description").and_then(|v| v.as_str()).map(String::from),
                            input_schema: tool.get("inputSchema").cloned().unwrap_or(json!({})),
                            server_name: name.clone(),
                        });
                    }
                }
            }
        }

        Ok(all_tools)
    }

    /// Call a tool on the appropriate server
    pub fn call_tool(&mut self, server_name: &str, tool_name: &str, arguments: Value) -> Result<String, String> {
        let process = self.servers.get_mut(server_name)
            .ok_or_else(|| format!("MCP server '{}' not found", server_name))?;

        let result = send_request(process, "tools/call", json!({
            "name": tool_name,
            "arguments": arguments,
        }))?;

        // Extract text content from result
        if let Some(content) = result.get("content").and_then(|v| v.as_array()) {
            let texts: Vec<String> = content.iter()
                .filter_map(|c| {
                    if c.get("type").and_then(|v| v.as_str()) == Some("text") {
                        c.get("text").and_then(|v| v.as_str()).map(String::from)
                    } else {
                        None
                    }
                })
                .collect();
            Ok(texts.join("\n"))
        } else {
            Ok(serde_json::to_string_pretty(&result).unwrap_or_default())
        }
    }

    /// List resources from all connected servers
    pub fn list_resources(&mut self) -> Result<Vec<McpResource>, String> {
        let mut all_resources = Vec::new();
        let names: Vec<String> = self.servers.keys().cloned().collect();

        for name in names {
            if let Some(process) = self.servers.get_mut(&name) {
                let result = send_request(process, "resources/list", json!({}))?;
                if let Some(resources) = result.get("resources").and_then(|v| v.as_array()) {
                    for res in resources {
                        all_resources.push(McpResource {
                            uri: res.get("uri").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            name: res.get("name").and_then(|v| v.as_str()).map(String::from),
                            description: res.get("description").and_then(|v| v.as_str()).map(String::from),
                            mime_type: res.get("mimeType").and_then(|v| v.as_str()).map(String::from),
                            server_name: name.clone(),
                        });
                    }
                }
            }
        }

        Ok(all_resources)
    }

    /// Read a resource
    pub fn read_resource(&mut self, server_name: &str, uri: &str) -> Result<String, String> {
        let process = self.servers.get_mut(server_name)
            .ok_or_else(|| format!("MCP server '{}' not found", server_name))?;

        let result = send_request(process, "resources/read", json!({
            "uri": uri,
        }))?;

        if let Some(contents) = result.get("contents").and_then(|v| v.as_array()) {
            let texts: Vec<String> = contents.iter()
                .filter_map(|c| c.get("text").and_then(|v| v.as_str()).map(String::from))
                .collect();
            Ok(texts.join("\n"))
        } else {
            Ok(serde_json::to_string_pretty(&result).unwrap_or_default())
        }
    }

    pub fn server_names(&self) -> Vec<String> {
        self.servers.keys().cloned().collect()
    }
}

impl Drop for McpClient {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn send_request(process: &mut McpServerProcess, method: &str, params: Value) -> Result<Value, String> {
    process.request_id += 1;
    let id = process.request_id;

    let request = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });

    let stdin = process.child.stdin.as_mut()
        .ok_or("MCP server stdin not available")?;
    let msg = serde_json::to_string(&request).map_err(|e| format!("serialize: {}", e))?;
    writeln!(stdin, "{}", msg).map_err(|e| format!("write: {}", e))?;
    stdin.flush().map_err(|e| format!("flush: {}", e))?;

    // Read response
    let stdout = process.child.stdout.as_mut()
        .ok_or("MCP server stdout not available")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    // Read lines until we get our response
    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).map_err(|e| format!("read: {}", e))?;
        if bytes == 0 {
            return Err("MCP server closed connection".to_string());
        }

        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        if let Ok(response) = serde_json::from_str::<Value>(trimmed) {
            // Check if this is our response
            if response.get("id").and_then(|v| v.as_u64()) == Some(id) {
                if let Some(error) = response.get("error") {
                    let msg = error.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                    return Err(format!("MCP error: {}", msg));
                }
                return Ok(response.get("result").cloned().unwrap_or(json!({})));
            }
            // Otherwise it's a notification — skip
        }
    }
}

fn send_notification(process: &mut McpServerProcess, method: &str, params: Value) -> Result<(), String> {
    let notification = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    });

    let stdin = process.child.stdin.as_mut()
        .ok_or("MCP server stdin not available")?;
    let msg = serde_json::to_string(&notification).map_err(|e| format!("serialize: {}", e))?;
    writeln!(stdin, "{}", msg).map_err(|e| format!("write: {}", e))?;
    stdin.flush().map_err(|e| format!("flush: {}", e))?;
    Ok(())
}
