/// Multi-provider API client
/// Supports Anthropic, OpenAI, Google, Kimi, and compatible endpoints
/// Adapted from claw-code Rust port with multi-provider extension
use reqwest::Client;
use serde_json::{json, Value};
use futures::StreamExt;

use super::types::*;

pub struct ApiClient {
    http: Client,
    config: ProviderConfig,
}

impl ApiClient {
    pub fn new(config: ProviderConfig) -> Self {
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to build HTTP client");
        Self { http, config }
    }

    /// Send a message and collect the full response (non-streaming)
    pub async fn send_message(
        &self,
        messages: &[ChatMessage],
        system_prompt: Option<&str>,
        tools: Option<&[ToolDefinition]>,
    ) -> Result<ChatResponse, String> {
        match self.config.provider {
            ProviderType::Anthropic => self.send_anthropic(messages, system_prompt, tools).await,
            ProviderType::Google => self.send_google(messages, system_prompt).await,
            ProviderType::OpenAI | ProviderType::Kimi | ProviderType::Compatible => {
                self.send_openai(messages, system_prompt, tools).await
            }
        }
    }

    /// Send a message with streaming, returns events via callback
    pub async fn send_message_stream(
        &self,
        messages: &[ChatMessage],
        system_prompt: Option<&str>,
        tools: Option<&[ToolDefinition]>,
        on_event: impl Fn(StreamEvent),
    ) -> Result<(), String> {
        match self.config.provider {
            ProviderType::Anthropic => {
                self.stream_anthropic(messages, system_prompt, tools, on_event).await
            }
            ProviderType::Google => {
                self.stream_google(messages, system_prompt, on_event).await
            }
            ProviderType::OpenAI | ProviderType::Kimi | ProviderType::Compatible => {
                self.stream_openai(messages, system_prompt, tools, on_event).await
            }
        }
    }

    fn base_url(&self) -> String {
        let raw = self.config.base_url.clone()
            .unwrap_or_else(|| self.config.provider.default_base_url().to_string());
        // Normalize: strip trailing /v1 to avoid double /v1/v1 paths
        let trimmed = raw.trim_end_matches('/');
        if trimmed.ends_with("/v1") {
            trimmed[..trimmed.len()-3].to_string()
        } else {
            trimmed.to_string()
        }
    }

    // ═══════════ Anthropic ═══════════

    async fn send_anthropic(
        &self,
        messages: &[ChatMessage],
        system_prompt: Option<&str>,
        tools: Option<&[ToolDefinition]>,
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/v1/messages", self.base_url());

        let mut body = json!({
            "model": self.config.model,
            "max_tokens": self.config.max_tokens,
            "messages": self.format_anthropic_messages(messages),
        });

        if let Some(sp) = system_prompt {
            body["system"] = json!(sp);
        }
        if let Some(t) = tools {
            if !t.is_empty() {
                body["tools"] = serde_json::to_value(t).unwrap_or_default();
            }
        }

        let resp = self.http.post(&url)
            .header("x-api-key", &self.config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, &text[..text.len().min(500)]));
        }

        let data: Value = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
        self.parse_anthropic_response(&data)
    }

    async fn stream_anthropic(
        &self,
        messages: &[ChatMessage],
        system_prompt: Option<&str>,
        tools: Option<&[ToolDefinition]>,
        on_event: impl Fn(StreamEvent),
    ) -> Result<(), String> {
        let url = format!("{}/v1/messages", self.base_url());

        let mut body = json!({
            "model": self.config.model,
            "max_tokens": self.config.max_tokens,
            "stream": true,
            "messages": self.format_anthropic_messages(messages),
        });

        if let Some(sp) = system_prompt {
            body["system"] = json!(sp);
        }
        if let Some(t) = tools {
            if !t.is_empty() {
                body["tools"] = serde_json::to_value(t).unwrap_or_default();
            }
        }

        let resp = self.http.post(&url)
            .header("x-api-key", &self.config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            on_event(StreamEvent::Error { error: format!("API error {}: {}", status, &text[..text.len().min(500)]) });
            return Ok(());
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut current_tool_id = String::new();
        let mut current_tool_name = String::new();
        let mut current_tool_json = String::new();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("Stream error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if !line.starts_with("data: ") { continue; }
                let data = &line[6..];
                if data.trim().is_empty() { continue; }

                if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                    let event_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    match event_type {
                        "content_block_start" => {
                            if let Some(block) = parsed.get("content_block") {
                                let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                if block_type == "tool_use" {
                                    current_tool_id = block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    current_tool_name = block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    current_tool_json.clear();
                                }
                            }
                        }
                        "content_block_delta" => {
                            if let Some(delta) = parsed.get("delta") {
                                let delta_type = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                match delta_type {
                                    "text_delta" => {
                                        if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                                            on_event(StreamEvent::Text { text: text.to_string() });
                                        }
                                    }
                                    "thinking_delta" => {
                                        if let Some(text) = delta.get("thinking").and_then(|v| v.as_str()) {
                                            on_event(StreamEvent::Thinking { text: text.to_string() });
                                        }
                                    }
                                    "input_json_delta" => {
                                        if let Some(json_str) = delta.get("partial_json").and_then(|v| v.as_str()) {
                                            current_tool_json.push_str(json_str);
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        "content_block_stop" => {
                            if !current_tool_name.is_empty() {
                                let input = serde_json::from_str::<Value>(&current_tool_json)
                                    .unwrap_or(Value::Object(serde_json::Map::new()));
                                on_event(StreamEvent::ToolUse {
                                    id: current_tool_id.clone(),
                                    name: current_tool_name.clone(),
                                    input,
                                });
                                current_tool_name.clear();
                                current_tool_json.clear();
                            }
                        }
                        "message_delta" => {
                            if let Some(delta) = parsed.get("delta") {
                                if let Some(reason) = delta.get("stop_reason").and_then(|v| v.as_str()) {
                                    on_event(StreamEvent::Done { stop_reason: reason.to_string() });
                                }
                            }
                            if let Some(usage) = parsed.get("usage") {
                                if let Ok(u) = serde_json::from_value::<Usage>(usage.clone()) {
                                    on_event(StreamEvent::Usage { usage: u });
                                }
                            }
                        }
                        "message_start" => {
                            if let Some(msg) = parsed.get("message") {
                                if let Some(usage) = msg.get("usage") {
                                    if let Ok(u) = serde_json::from_value::<Usage>(usage.clone()) {
                                        on_event(StreamEvent::Usage { usage: u });
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        Ok(())
    }

    fn format_anthropic_messages(&self, messages: &[ChatMessage]) -> Vec<Value> {
        messages.iter().map(|m| {
            let content = match &m.content {
                MessageContent::Text(t) => json!(t),
                MessageContent::Blocks(blocks) => serde_json::to_value(blocks).unwrap_or(json!("")),
            };
            let mut msg = json!({ "role": m.role, "content": content });
            if let Some(ref id) = m.tool_call_id {
                msg["tool_use_id"] = json!(id);
            }
            msg
        }).collect()
    }

    fn parse_anthropic_response(&self, data: &Value) -> Result<ChatResponse, String> {
        let content_arr = data.get("content").and_then(|v| v.as_array())
            .ok_or("Missing content in response")?;

        let mut content = Vec::new();
        for block in content_arr {
            let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
            match block_type {
                "text" => {
                    let text = block.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    content.push(ContentBlock::Text { text });
                }
                "tool_use" => {
                    content.push(ContentBlock::ToolUse {
                        id: block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        name: block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        input: block.get("input").cloned().unwrap_or(json!({})),
                    });
                }
                "thinking" => {
                    let thinking = block.get("thinking").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    content.push(ContentBlock::Thinking { thinking });
                }
                _ => {}
            }
        }

        let usage_val = data.get("usage").cloned().unwrap_or(json!({}));
        let usage = serde_json::from_value(usage_val).unwrap_or_default();

        Ok(ChatResponse {
            content,
            stop_reason: data.get("stop_reason").and_then(|v| v.as_str()).map(String::from),
            usage,
            model: data.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        })
    }

    // ═══════════ OpenAI / Kimi / Compatible ═══════════

    async fn send_openai(
        &self,
        messages: &[ChatMessage],
        system_prompt: Option<&str>,
        tools: Option<&[ToolDefinition]>,
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/v1/chat/completions", self.base_url());

        let mut oai_messages = Vec::new();
        if let Some(sp) = system_prompt {
            oai_messages.push(json!({"role": "system", "content": sp}));
        }
        for m in messages {
            oai_messages.push(json!({"role": m.role, "content": m.content.as_text()}));
        }

        let mut body = json!({
            "model": self.config.model,
            "max_tokens": self.config.max_tokens,
            "messages": oai_messages,
        });

        if let Some(t) = tools {
            if !t.is_empty() {
                let oai_tools: Vec<Value> = t.iter().map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.input_schema,
                        }
                    })
                }).collect();
                body["tools"] = json!(oai_tools);
            }
        }

        let resp = self.http.post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, &text[..text.len().min(500)]));
        }

        let data: Value = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
        self.parse_openai_response(&data)
    }

    async fn stream_openai(
        &self,
        messages: &[ChatMessage],
        system_prompt: Option<&str>,
        tools: Option<&[ToolDefinition]>,
        on_event: impl Fn(StreamEvent),
    ) -> Result<(), String> {
        let url = format!("{}/v1/chat/completions", self.base_url());

        let mut oai_messages = Vec::new();
        if let Some(sp) = system_prompt {
            oai_messages.push(json!({"role": "system", "content": sp}));
        }
        for m in messages {
            oai_messages.push(json!({"role": m.role, "content": m.content.as_text()}));
        }

        let mut body = json!({
            "model": self.config.model,
            "max_tokens": self.config.max_tokens,
            "stream": true,
            "messages": oai_messages,
        });

        if let Some(t) = tools {
            if !t.is_empty() {
                let oai_tools: Vec<Value> = t.iter().map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.input_schema,
                        }
                    })
                }).collect();
                body["tools"] = json!(oai_tools);
            }
        }

        let resp = self.http.post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            on_event(StreamEvent::Error { error: format!("API error {}: {}", status, &text[..text.len().min(500)]) });
            return Ok(());
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("Stream error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if !line.starts_with("data: ") { continue; }
                let data = line[6..].trim();
                if data == "[DONE]" {
                    on_event(StreamEvent::Done { stop_reason: "stop".to_string() });
                    continue;
                }

                if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                    if let Some(choices) = parsed.get("choices").and_then(|v| v.as_array()) {
                        for choice in choices {
                            if let Some(delta) = choice.get("delta") {
                                // Content text
                                if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
                                    if !text.is_empty() {
                                        on_event(StreamEvent::Text { text: text.to_string() });
                                    }
                                }
                                // Reasoning content (Kimi K2.5 / OpenAI o-series)
                                if let Some(text) = delta.get("reasoning_content").and_then(|v| v.as_str()) {
                                    if !text.is_empty() {
                                        on_event(StreamEvent::Thinking { text: text.to_string() });
                                    }
                                }
                                // Tool calls
                                if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                                    for tc in tool_calls {
                                        if let Some(func) = tc.get("function") {
                                            let name = func.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let args = func.get("arguments").and_then(|v| v.as_str()).unwrap_or("{}");
                                            let input = serde_json::from_str(args).unwrap_or(json!({}));
                                            if !name.is_empty() {
                                                let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                                on_event(StreamEvent::ToolUse { id, name, input });
                                            }
                                        }
                                    }
                                }
                            }
                            // Finish reason
                            if let Some(reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
                                on_event(StreamEvent::Done { stop_reason: reason.to_string() });
                            }
                        }
                    }
                    // Usage
                    if let Some(usage) = parsed.get("usage") {
                        if let Ok(u) = serde_json::from_value::<Usage>(usage.clone()) {
                            on_event(StreamEvent::Usage { usage: u });
                        }
                    }
                }
            }
        }

        Ok(())
    }

    fn parse_openai_response(&self, data: &Value) -> Result<ChatResponse, String> {
        let choice = data.get("choices")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .ok_or("No choices in response")?;

        let message = choice.get("message").ok_or("No message in choice")?;
        let mut content = Vec::new();

        if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                content.push(ContentBlock::Text { text: text.to_string() });
            }
        }

        if let Some(tool_calls) = message.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in tool_calls {
                if let Some(func) = tc.get("function") {
                    let name = func.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let args_str = func.get("arguments").and_then(|v| v.as_str()).unwrap_or("{}");
                    let input = serde_json::from_str(args_str).unwrap_or(json!({}));
                    let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    content.push(ContentBlock::ToolUse { id, name, input });
                }
            }
        }

        let usage_val = data.get("usage").cloned().unwrap_or(json!({}));
        let usage: Usage = serde_json::from_value(usage_val).unwrap_or_default();

        Ok(ChatResponse {
            content,
            stop_reason: choice.get("finish_reason").and_then(|v| v.as_str()).map(String::from),
            usage,
            model: data.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        })
    }

    // ═══════════ Google Gemini ═══════════

    async fn send_google(
        &self,
        messages: &[ChatMessage],
        system_prompt: Option<&str>,
    ) -> Result<ChatResponse, String> {
        let base = self.base_url();
        let url = format!("{}/v1beta/models/{}:generateContent?key={}", base, self.config.model, self.config.api_key);

        let mut contents = Vec::new();
        for m in messages {
            contents.push(json!({
                "role": if m.role == "assistant" { "model" } else { &m.role },
                "parts": [{"text": m.content.as_text()}],
            }));
        }

        let mut body = json!({
            "contents": contents,
            "generationConfig": {"maxOutputTokens": self.config.max_tokens},
        });

        if let Some(sp) = system_prompt {
            body["systemInstruction"] = json!({"parts": [{"text": sp}]});
        }

        let resp = self.http.post(&url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Gemini API error {}: {}", status, &text[..text.len().min(500)]));
        }

        let data: Value = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;

        let mut content = Vec::new();
        if let Some(candidates) = data.get("candidates").and_then(|v| v.as_array()) {
            if let Some(first) = candidates.first() {
                if let Some(parts) = first.get("content").and_then(|v| v.get("parts")).and_then(|v| v.as_array()) {
                    for part in parts {
                        if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                            content.push(ContentBlock::Text { text: text.to_string() });
                        }
                    }
                }
            }
        }

        Ok(ChatResponse {
            content,
            stop_reason: Some("stop".to_string()),
            usage: Usage::default(),
            model: self.config.model.clone(),
        })
    }

    async fn stream_google(
        &self,
        messages: &[ChatMessage],
        system_prompt: Option<&str>,
        on_event: impl Fn(StreamEvent),
    ) -> Result<(), String> {
        let base = self.base_url();
        let url = format!("{}/v1beta/models/{}:streamGenerateContent?alt=sse&key={}", base, self.config.model, self.config.api_key);

        let mut contents = Vec::new();
        for m in messages {
            contents.push(json!({
                "role": if m.role == "assistant" { "model" } else { &m.role },
                "parts": [{"text": m.content.as_text()}],
            }));
        }

        let mut body = json!({
            "contents": contents,
            "generationConfig": {"maxOutputTokens": self.config.max_tokens},
        });

        if let Some(sp) = system_prompt {
            body["systemInstruction"] = json!({"parts": [{"text": sp}]});
        }

        let resp = self.http.post(&url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            on_event(StreamEvent::Error { error: format!("Gemini API error {}: {}", status, &text[..text.len().min(500)]) });
            return Ok(());
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("Stream error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if !line.starts_with("data: ") { continue; }
                let data = &line[6..];

                if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                    if let Some(candidates) = parsed.get("candidates").and_then(|v| v.as_array()) {
                        for candidate in candidates {
                            if let Some(parts) = candidate.get("content").and_then(|v| v.get("parts")).and_then(|v| v.as_array()) {
                                for part in parts {
                                    if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                                        on_event(StreamEvent::Text { text: text.to_string() });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        on_event(StreamEvent::Done { stop_reason: "stop".to_string() });
        Ok(())
    }
}
