/// Conversation compaction — summarize old messages to save context window
/// Adapted from claw-code Rust port's compact.rs
use serde::{Deserialize, Serialize};

use crate::api::types::{ChatMessage, MessageContent};

const COMPACT_PREAMBLE: &str = "This conversation was compacted from an earlier, longer exchange. The summary below covers what happened before.\n\n";
const RECENT_NOTE: &str = "\n\nRecent messages are preserved verbatim below.";

#[derive(Debug, Clone)]
pub struct CompactConfig {
    /// Number of recent messages to always preserve
    pub preserve_recent: usize,
    /// Estimated token threshold to trigger compaction
    pub token_threshold: usize,
    /// Maximum summary length in characters
    pub max_summary_chars: usize,
}

impl Default for CompactConfig {
    fn default() -> Self {
        Self {
            preserve_recent: 6,
            token_threshold: 8000,
            max_summary_chars: 4000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactResult {
    pub summary: String,
    pub messages_removed: usize,
    pub messages_kept: usize,
    pub estimated_tokens_before: usize,
    pub estimated_tokens_after: usize,
}

/// Estimate tokens for a message (~4 chars per token)
pub fn estimate_tokens(msg: &ChatMessage) -> usize {
    let text = msg.content.as_text();
    text.len() / 4 + 1
}

/// Estimate total tokens for all messages
pub fn estimate_total_tokens(messages: &[ChatMessage]) -> usize {
    messages.iter().map(estimate_tokens).sum()
}

/// Check if compaction is needed
pub fn should_compact(messages: &[ChatMessage], config: &CompactConfig) -> bool {
    if messages.len() <= config.preserve_recent + 2 {
        return false;
    }
    estimate_total_tokens(messages) >= config.token_threshold
}

/// Perform compaction: summarize old messages, keep recent ones
/// Returns the new message list with a summary message replacing older ones
pub fn compact_messages(
    messages: &[ChatMessage],
    config: &CompactConfig,
) -> CompactResult {
    let total = messages.len();
    if total <= config.preserve_recent {
        return CompactResult {
            summary: String::new(),
            messages_removed: 0,
            messages_kept: total,
            estimated_tokens_before: estimate_total_tokens(messages),
            estimated_tokens_after: estimate_total_tokens(messages),
        };
    }

    let split_point = total.saturating_sub(config.preserve_recent);
    let to_summarize = &messages[..split_point];
    let to_keep = &messages[split_point..];

    // Build summary from older messages
    let mut summary_parts = Vec::new();
    for msg in to_summarize {
        let role = match msg.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            "tool" => "Tool",
            _ => &msg.role,
        };
        let text = msg.content.as_text();
        // Truncate individual messages in summary
        let truncated = if text.len() > 500 {
            format!("{}...", &text[..500])
        } else {
            text
        };
        summary_parts.push(format!("{}: {}", role, truncated));
    }

    let mut summary = summary_parts.join("\n\n");
    if summary.len() > config.max_summary_chars {
        summary = format!("{}...\n[Summary truncated]", &summary[..config.max_summary_chars]);
    }

    let formatted = format!("{}{}{}", COMPACT_PREAMBLE, summary, RECENT_NOTE);

    let tokens_before = estimate_total_tokens(messages);
    let kept_tokens = estimate_total_tokens(to_keep);
    let summary_tokens = formatted.len() / 4 + 1;

    CompactResult {
        summary: formatted,
        messages_removed: split_point,
        messages_kept: to_keep.len(),
        estimated_tokens_before: tokens_before,
        estimated_tokens_after: kept_tokens + summary_tokens,
    }
}

/// Build the compacted message list
pub fn build_compacted_messages(
    messages: &[ChatMessage],
    config: &CompactConfig,
) -> Vec<ChatMessage> {
    let result = compact_messages(messages, config);
    if result.messages_removed == 0 {
        return messages.to_vec();
    }

    let split_point = messages.len().saturating_sub(config.preserve_recent);
    let to_keep = &messages[split_point..];

    let mut new_messages = Vec::with_capacity(1 + to_keep.len());

    // Add summary as a user message
    new_messages.push(ChatMessage {
        role: "user".to_string(),
        content: MessageContent::Text(result.summary),
        tool_call_id: None,
    });

    // Add preserved recent messages
    new_messages.extend_from_slice(to_keep);
    new_messages
}
