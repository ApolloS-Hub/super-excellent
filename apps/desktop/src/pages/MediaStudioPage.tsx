/**
 * Media Studio — AI Image Generation
 * Left panel: prompt + parameters, Right panel: preview
 * Supports Google Gemini (existing provider)
 * Features: batch generation, image gallery
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, Text, Paper, Group, Badge, Button,
  Textarea, Select, SimpleGrid, ScrollArea, Box,
  Notification,
} from "@mantine/core";
import { loadConfig } from "../lib/agent-bridge";

// ═══════════ Types ═══════════

interface GeneratedImage {
  id: string;
  prompt: string;
  dataUrl: string;
  timestamp: number;
  model: string;
  style: string;
}

interface QueueItem {
  id: string;
  prompt: string;
  status: "pending" | "generating" | "done" | "error";
  result?: GeneratedImage;
  error?: string;
}

interface MediaStudioPageProps {
  onBack: () => void;
}

// ═══════════ Image Generation via Gemini ═══════════

async function generateImageWithGemini(
  prompt: string,
  style: string,
  config: { apiKey: string; model: string; baseURL?: string },
): Promise<string> {
  const baseURL = config.baseURL || "https://generativelanguage.googleapis.com";
  const model = config.model || "gemini-2.0-flash";
  const fullPrompt = style ? `${style} style: ${prompt}` : prompt;

  const resp = await fetch(
    `${baseURL}/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Generate an image: ${fullPrompt}` }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
    },
  );

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Gemini API error ${resp.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await resp.json();
  const candidates = data.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.mimeType?.startsWith("image/")) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
  }

  throw new Error("No image generated. The model may not support image generation with this configuration.");
}

// ═══════════ Component ═══════════

const STYLE_OPTIONS = [
  { value: "", label: "自动 / Auto" },
  { value: "photorealistic", label: "写实 / Photorealistic" },
  { value: "digital art", label: "数字艺术 / Digital Art" },
  { value: "watercolor", label: "水彩 / Watercolor" },
  { value: "oil painting", label: "油画 / Oil Painting" },
  { value: "anime", label: "动漫 / Anime" },
  { value: "pixel art", label: "像素 / Pixel Art" },
  { value: "sketch", label: "素描 / Sketch" },
  { value: "3d render", label: "3D 渲染 / 3D Render" },
];

function MediaStudioPage({ onBack }: MediaStudioPageProps) {
  const { t } = useTranslation();
  // Input state
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  const [batchPrompts, setBatchPrompts] = useState("");

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [gallery, setGallery] = useState<GeneratedImage[]>(() => {
    try {
      const raw = localStorage.getItem("media-studio-gallery");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [error, setError] = useState("");
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);

  const saveGallery = useCallback((images: GeneratedImage[]) => {
    // Keep last 50 images
    const trimmed = images.slice(-50);
    setGallery(trimmed);
    try { localStorage.setItem("media-studio-gallery", JSON.stringify(trimmed)); } catch {}
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    const config = loadConfig();
    if (!config.apiKey) {
      setError("请先在设置页面配置 API Key");
      return;
    }

    setIsGenerating(true);
    setError("");

    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const item: QueueItem = { id, prompt: prompt.trim(), status: "generating" };
    setQueue(prev => [...prev, item]);

    try {
      const dataUrl = await generateImageWithGemini(prompt.trim(), style, {
        apiKey: config.apiKey,
        model: config.model,
        baseURL: config.baseURL,
      });

      const image: GeneratedImage = {
        id,
        prompt: prompt.trim(),
        dataUrl,
        timestamp: Date.now(),
        model: config.model,
        style: style || "auto",
      };

      setQueue(prev => prev.map(q => q.id === id ? { ...q, status: "done", result: image } : q));
      saveGallery([...gallery, image]);
      setSelectedImage(image);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setQueue(prev => prev.map(q => q.id === id ? { ...q, status: "error", error: errMsg } : q));
      setError(errMsg);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, style, gallery, saveGallery]);

  const handleBatchGenerate = useCallback(async () => {
    const prompts = batchPrompts.split("\n").map(p => p.trim()).filter(Boolean);
    if (prompts.length === 0) return;

    const config = loadConfig();
    if (!config.apiKey) {
      setError("请先在设置页面配置 API Key");
      return;
    }

    setIsGenerating(true);
    setError("");

    const items: QueueItem[] = prompts.map((p, i) => ({
      id: `batch_${Date.now()}_${i}`,
      prompt: p,
      status: "pending" as const,
    }));
    setQueue(prev => [...prev, ...items]);

    const newImages: GeneratedImage[] = [];

    for (const item of items) {
      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "generating" } : q));

      try {
        const dataUrl = await generateImageWithGemini(item.prompt, style, {
          apiKey: config.apiKey,
          model: config.model,
          baseURL: config.baseURL,
        });

        const image: GeneratedImage = {
          id: item.id,
          prompt: item.prompt,
          dataUrl,
          timestamp: Date.now(),
          model: config.model,
          style: style || "auto",
        };

        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "done", result: image } : q));
        newImages.push(image);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "error", error: errMsg } : q));
      }
    }

    if (newImages.length > 0) {
      saveGallery([...gallery, ...newImages]);
    }
    setIsGenerating(false);
  }, [batchPrompts, style, gallery, saveGallery]);

  const clearGallery = useCallback(() => {
    setGallery([]);
    try { localStorage.removeItem("media-studio-gallery"); } catch {}
  }, []);

  const downloadImage = useCallback((image: GeneratedImage) => {
    const a = document.createElement("a");
    a.href = image.dataUrl;
    a.download = `${image.prompt.slice(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.png`;
    a.click();
  }, []);

  return (
    <Stack maw={1000} mx="auto" h="calc(100vh - 100px)">
      <Group justify="space-between">
        <Group gap="xs">
          <Text size="xl" fw={700}>🎨 Media Studio</Text>
          <Badge variant="light" color="cyan">{gallery.length} 张图片</Badge>
        </Group>
        <Button variant="subtle" onClick={onBack}>← {t("nav.conversations")}</Button>
      </Group>

      {error && (
        <Notification color="red" withCloseButton onClose={() => setError("")}>
          ❌ {error}
        </Notification>
      )}

      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        {/* Left panel: Input */}
        <Paper p="md" radius="md" withBorder style={{ width: 360, flexShrink: 0 }}>
          <ScrollArea h="100%">
            <Stack gap="md">
              <Text fw={600}>生成设置</Text>

              <Textarea
                label="提示词 / Prompt"
                placeholder="描述你想要生成的图片..."
                value={prompt}
                onChange={(e) => setPrompt(e.currentTarget.value)}
                minRows={3}
                maxRows={6}
                autosize
              />

              <Select
                label="风格 / Style"
                data={STYLE_OPTIONS}
                value={style}
                onChange={(v) => setStyle(v || "")}
              />

              <Button
                onClick={handleGenerate}
                loading={isGenerating}
                disabled={!prompt.trim()}
                fullWidth
              >
                🎨 生成图片
              </Button>

              <Text fw={600} mt="md">批量生成</Text>
              <Textarea
                label="多个提示词（每行一个）"
                placeholder={"一只在雨中撑伞的猫\n日落下的山脉全景\n未来城市的天际线"}
                value={batchPrompts}
                onChange={(e) => setBatchPrompts(e.currentTarget.value)}
                minRows={3}
                maxRows={6}
                autosize
              />

              <Button
                onClick={handleBatchGenerate}
                loading={isGenerating}
                disabled={!batchPrompts.trim()}
                variant="light"
                fullWidth
              >
                🔄 批量生成
              </Button>

              {/* Generation Queue */}
              {queue.length > 0 && (
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text size="xs" fw={600} c="dimmed">生成队列</Text>
                    <Button size="xs" variant="subtle" onClick={() => setQueue([])}>清空</Button>
                  </Group>
                  {queue.slice(-10).reverse().map(item => (
                    <Group key={item.id} gap="xs" wrap="nowrap">
                      <Badge size="xs" color={
                        item.status === "generating" ? "blue" :
                        item.status === "done" ? "green" :
                        item.status === "error" ? "red" : "gray"
                      } variant="light">
                        {item.status === "generating" ? "生成中" :
                         item.status === "done" ? "完成" :
                         item.status === "error" ? "失败" : "等待"}
                      </Badge>
                      <Text size="xs" truncate style={{ flex: 1 }}>{item.prompt}</Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Stack>
          </ScrollArea>
        </Paper>

        {/* Right panel: Preview + Gallery */}
        <Stack style={{ flex: 1, minWidth: 0 }} gap="md">
          {/* Preview */}
          {selectedImage ? (
            <Paper p="md" radius="md" withBorder style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <Group justify="space-between" mb="sm">
                <Text size="sm" fw={600} truncate style={{ flex: 1 }}>{selectedImage.prompt}</Text>
                <Group gap="xs">
                  <Badge size="xs" variant="outline">{selectedImage.model}</Badge>
                  <Button size="xs" variant="light" onClick={() => downloadImage(selectedImage)}>
                    💾 下载
                  </Button>
                </Group>
              </Group>
              <Box style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                <img
                  src={selectedImage.dataUrl}
                  alt={selectedImage.prompt}
                  style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, objectFit: "contain" }}
                />
              </Box>
              <Text size="xs" c="dimmed" mt="xs">
                {new Date(selectedImage.timestamp).toLocaleString()} · {selectedImage.style}
              </Text>
            </Paper>
          ) : (
            <Paper p="xl" radius="md" withBorder style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Stack align="center" gap="md">
                <Text size="xl">🎨</Text>
                <Text c="dimmed">输入提示词并点击生成，图片将在这里显示</Text>
                <Text size="xs" c="dimmed">支持 Google Gemini 图片生成</Text>
              </Stack>
            </Paper>
          )}

          {/* Gallery */}
          {gallery.length > 0 && (
            <Paper p="sm" radius="md" withBorder>
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={600}>画廊 ({gallery.length})</Text>
                <Button size="xs" variant="subtle" color="red" onClick={clearGallery}>清空</Button>
              </Group>
              <ScrollArea h={120}>
                <SimpleGrid cols={{ base: 3, sm: 4, md: 6 }} spacing="xs">
                  {gallery.slice().reverse().map(img => (
                    <Box
                      key={img.id}
                      style={{
                        cursor: "pointer",
                        borderRadius: 6,
                        overflow: "hidden",
                        border: selectedImage?.id === img.id
                          ? "2px solid var(--mantine-color-blue-5)"
                          : "2px solid transparent",
                        aspectRatio: "1",
                      }}
                      onClick={() => setSelectedImage(img)}
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.prompt}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </Box>
                  ))}
                </SimpleGrid>
              </ScrollArea>
            </Paper>
          )}
        </Stack>
      </div>
    </Stack>
  );
}

export default MediaStudioPage;
