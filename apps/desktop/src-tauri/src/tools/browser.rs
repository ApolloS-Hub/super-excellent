/// Browser control tool — headless browsing via system browser
/// Simple implementation: uses curl for fetching + basic screenshot
use std::process::Command;
use serde_json::{json, Value};

use super::{ToolSpec, RiskLevel};

pub fn browser_spec() -> ToolSpec {
    ToolSpec {
        name: "Browser".into(),
        description: "Open a URL, take a screenshot, or extract page content. For browsing, screenshots, and web interaction.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["navigate", "screenshot", "content", "click"],
                    "description": "Action to perform"
                },
                "url": {"type": "string", "description": "URL to navigate to"},
                "selector": {"type": "string", "description": "CSS selector for click action"}
            },
            "required": ["action"]
        }),
        is_read_only: true,
        risk_level: RiskLevel::Medium,
    }
}

pub async fn execute_browser(input: Value) -> Result<String, String> {
    let action = input.get("action").and_then(|v| v.as_str())
        .ok_or("Missing 'action' parameter")?;

    match action {
        "navigate" | "content" => {
            let url = input.get("url").and_then(|v| v.as_str())
                .ok_or("Missing 'url' parameter for navigate/content")?;
            fetch_page_content(url).await
        }
        "screenshot" => {
            let url = input.get("url").and_then(|v| v.as_str())
                .ok_or("Missing 'url' for screenshot")?;

            // Try wkhtmltoimage if available, otherwise describe the page
            let output = Command::new("which")
                .arg("wkhtmltoimage")
                .output()
                .ok()
                .filter(|o| o.status.success());

            if output.is_some() {
                let tmp = format!("/tmp/se-screenshot-{}.png", std::process::id());
                let result = Command::new("wkhtmltoimage")
                    .args(["--quality", "50", "--width", "1280", url, &tmp])
                    .output()
                    .map_err(|e| format!("Screenshot failed: {}", e))?;

                if result.status.success() {
                    Ok(format!("Screenshot saved to: {}", tmp))
                } else {
                    // Fallback to content extraction
                    let content = fetch_page_content(url).await?;
                    Ok(format!("[Screenshot tool not available, showing content instead]\n\n{}", content))
                }
            } else {
                let content = fetch_page_content(url).await?;
                Ok(format!("[Screenshot tool not available, showing content instead]\n\n{}", content))
            }
        }
        _ => Err(format!("Unknown browser action: {}", action)),
    }
}

async fn fetch_page_content(url: &str) -> Result<String, String> {
    let output = Command::new("curl")
        .args(["-sL", "-m", "30", "--max-filesize", "5000000",
               "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
               url])
        .output()
        .map_err(|e| format!("curl failed: {}", e))?;

    let html = String::from_utf8_lossy(&output.stdout);

    // Extract title
    let title = extract_between(&html, "<title>", "</title>")
        .unwrap_or_default()
        .trim()
        .to_string();

    // Strip scripts, styles, then tags
    let mut cleaned = html.to_string();
    // Remove script blocks
    while let Some(start) = cleaned.find("<script") {
        if let Some(end) = cleaned[start..].find("</script>") {
            cleaned = format!("{}{}", &cleaned[..start], &cleaned[start + end + 9..]);
        } else {
            break;
        }
    }
    // Remove style blocks
    while let Some(start) = cleaned.find("<style") {
        if let Some(end) = cleaned[start..].find("</style>") {
            cleaned = format!("{}{}", &cleaned[..start], &cleaned[start + end + 8..]);
        } else {
            break;
        }
    }

    // Strip HTML tags
    let text = strip_tags(&cleaned);
    let lines: Vec<&str> = text.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    let content = lines.join("\n");
    let truncated = if content.len() > 50000 {
        format!("{}\n\n[Truncated at 50000 chars]", &content[..50000])
    } else {
        content
    };

    Ok(format!("Title: {}\nURL: {}\n\n{}", title, url, truncated))
}

fn extract_between(text: &str, start_tag: &str, end_tag: &str) -> Option<String> {
    let start = text.find(start_tag)? + start_tag.len();
    let end = text[start..].find(end_tag)? + start;
    Some(text[start..end].to_string())
}

fn strip_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        if c == '<' { in_tag = true; }
        else if c == '>' { in_tag = false; result.push(' '); }
        else if !in_tag { result.push(c); }
    }
    result
}
