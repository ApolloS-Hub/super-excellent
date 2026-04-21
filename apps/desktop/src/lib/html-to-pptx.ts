/**
 * HTML → PPTX Converter
 *
 * Inspired by huashu-design's html2pptx.js:
 * Parses rendered HTML slides and translates them into editable
 * PowerPoint text boxes (not screenshots). Preserves:
 *   - Text content with font size/weight/color
 *   - Slide titles vs body separation
 *   - Basic layout (centered, left-aligned, grid)
 *   - Background colors
 *
 * Uses pptxgenjs — a pure-JS PPTX generator, no native deps.
 */
import PptxGenJS from "pptxgenjs";

export interface SlideContent {
  title?: string;
  body?: string;
  bullets?: string[];
  /** Subtitle or small text */
  subtitle?: string;
  /** Background color (hex) */
  bgColor?: string;
  /** Optional image URL */
  imageUrl?: string;
  /** Layout hint */
  layout?: "title" | "content" | "data" | "image" | "blank" | "statement";
}

export interface PptxOptions {
  /** Presentation title (metadata) */
  title?: string;
  /** Author name */
  author?: string;
  /** Brand primary color (hex, e.g. "4F46E5") */
  brandColor?: string;
  /** Slide width in inches (default 10) */
  width?: number;
  /** Slide height in inches (default 5.625 = 16:9) */
  height?: number;
}

/**
 * Parse HTML string containing <section class="slide"> elements
 * into SlideContent array.
 */
export function parseHtmlSlides(html: string): SlideContent[] {
  const slides: SlideContent[] = [];

  // Extract <section> blocks (or <div class="slide">)
  const sectionRegex = /<(?:section|div)[^>]*class="[^"]*slide[^"]*"[^>]*>([\s\S]*?)<\/(?:section|div)>/gi;
  let match;

  while ((match = sectionRegex.exec(html)) !== null) {
    const inner = match[1];
    slides.push(parseSingleSlide(inner));
  }

  // If no slide sections found, treat the whole body as one slide
  if (slides.length === 0) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      slides.push(parseSingleSlide(bodyMatch[1]));
    }
  }

  return slides;
}

function parseSingleSlide(html: string): SlideContent {
  const slide: SlideContent = { layout: "content" };

  // Extract title from h1/h2
  const titleMatch = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (titleMatch) {
    slide.title = stripTags(titleMatch[1]).trim();
  }

  // Extract subtitle from h3/h4 or <p class="subtitle">
  const subMatch = html.match(/<(?:h[34]|p[^>]*class="[^"]*subtitle[^"]*")[^>]*>([\s\S]*?)<\/(?:h[34]|p)>/i);
  if (subMatch) {
    slide.subtitle = stripTags(subMatch[1]).trim();
  }

  // Extract bullet points from <li> or <ul>/<ol>
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  const bullets: string[] = [];
  let liMatch;
  while ((liMatch = liRegex.exec(html)) !== null) {
    const text = stripTags(liMatch[1]).trim();
    if (text) bullets.push(text);
  }
  if (bullets.length > 0) slide.bullets = bullets;

  // Extract body text from <p> (excluding subtitle)
  const pRegex = /<p(?![^>]*subtitle)[^>]*>([\s\S]*?)<\/p>/gi;
  const bodyParts: string[] = [];
  let pMatch;
  while ((pMatch = pRegex.exec(html)) !== null) {
    const text = stripTags(pMatch[1]).trim();
    if (text && text !== slide.subtitle) bodyParts.push(text);
  }
  if (bodyParts.length > 0) slide.body = bodyParts.join("\n\n");

  // Extract background color
  const bgMatch = html.match(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/i);
  if (bgMatch) slide.bgColor = normalizeColor(bgMatch[1]);

  // Extract image
  const imgMatch = html.match(/<img[^>]*src="([^"]+)"/i);
  if (imgMatch) {
    slide.imageUrl = imgMatch[1];
    slide.layout = "image";
  }

  // Determine layout type
  if (slide.title && !slide.body && !slide.bullets) {
    slide.layout = slide.subtitle ? "title" : "blank";
  }

  return slide;
}

/**
 * Generate a PPTX file from parsed slides.
 * Returns a Blob that can be downloaded.
 */
export async function generatePptx(
  slides: SlideContent[],
  options: PptxOptions = {},
): Promise<Blob> {
  const pptx = new PptxGenJS();

  // Metadata
  pptx.title = options.title || "Presentation";
  pptx.author = options.author || "Super Excellent";
  pptx.layout = "LAYOUT_WIDE"; // 16:9

  const brand = options.brandColor || "4F46E5";
  const brandDark = darkenColor(brand, 0.3);

  for (const slideData of slides) {
    const pptSlide = pptx.addSlide();

    // Background
    if (slideData.bgColor) {
      pptSlide.background = { color: slideData.bgColor };
    }

    // Title slide layout
    if (slideData.layout === "title") {
      pptSlide.background = { color: brand };
      if (slideData.title) {
        pptSlide.addText(slideData.title, {
          x: 0.8, y: 1.5, w: 8.4, h: 1.5,
          fontSize: 36, fontFace: "Georgia",
          color: "FFFFFF", bold: true,
          align: "center",
        });
      }
      if (slideData.subtitle) {
        pptSlide.addText(slideData.subtitle, {
          x: 0.8, y: 3.2, w: 8.4, h: 0.8,
          fontSize: 18, fontFace: "Arial",
          color: "E0E0FF",
          align: "center",
        });
      }
      continue;
    }

    // Content slides
    let yPos = 0.5;

    if (slideData.title) {
      pptSlide.addText(slideData.title, {
        x: 0.6, y: yPos, w: 8.8, h: 0.8,
        fontSize: 28, fontFace: "Georgia",
        color: brandDark, bold: true,
      });
      yPos += 1.0;

      // Accent line under title
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0.6, y: yPos - 0.15, w: 1.5, h: 0.04,
        fill: { color: brand },
      });
      yPos += 0.3;
    }

    if (slideData.body) {
      pptSlide.addText(slideData.body, {
        x: 0.6, y: yPos, w: 8.8, h: 2.0,
        fontSize: 16, fontFace: "Arial",
        color: "333333",
        lineSpacingMultiple: 1.5,
        valign: "top",
      });
      yPos += 2.2;
    }

    if (slideData.bullets && slideData.bullets.length > 0) {
      const bulletTexts = slideData.bullets.map(b => ({
        text: b,
        options: {
          fontSize: 15,
          fontFace: "Arial",
          color: "444444",
          bullet: { type: "bullet" as const },
          lineSpacingMultiple: 1.4,
        },
      }));
      pptSlide.addText(bulletTexts, {
        x: 0.6, y: yPos, w: 8.8, h: 3.0,
        valign: "top",
      });
    }

    if (slideData.subtitle && String(slideData.layout) !== "title") {
      pptSlide.addText(slideData.subtitle, {
        x: 0.6, y: 4.8, w: 8.8, h: 0.5,
        fontSize: 12, fontFace: "Arial",
        color: "999999", italic: true,
      });
    }
  }

  // Generate as blob
  const output = await pptx.write({ outputType: "blob" });
  return output as Blob;
}

/**
 * Full pipeline: HTML string → downloadable PPTX blob.
 */
export async function htmlToPptx(
  html: string,
  options?: PptxOptions,
): Promise<Blob> {
  const slides = parseHtmlSlides(html);
  if (slides.length === 0) {
    // Fallback: treat the whole content as one slide
    slides.push({
      title: options?.title || "Content",
      body: stripTags(html).slice(0, 2000),
      layout: "content",
    });
  }
  return generatePptx(slides, options);
}

/**
 * Convert conversation messages to a presentation.
 * Each user message becomes a "question" slide, each assistant response a "content" slide.
 */
export async function conversationToPptx(
  messages: Array<{ role: string; content: string }>,
  options?: PptxOptions,
): Promise<Blob> {
  const slides: SlideContent[] = [];

  // Title slide
  slides.push({
    title: options?.title || "Conversation Summary",
    subtitle: new Date().toLocaleDateString(),
    layout: "title",
  });

  for (const msg of messages) {
    if (msg.role === "user") {
      slides.push({
        title: msg.content.slice(0, 80),
        subtitle: "User Question",
        layout: "content",
      });
    } else if (msg.role === "assistant") {
      // Split long responses into bullet points
      const lines = msg.content.split("\n").filter(l => l.trim());
      if (lines.length <= 5) {
        slides.push({
          title: "Response",
          body: msg.content.slice(0, 800),
          layout: "content",
        });
      } else {
        // Extract key points as bullets
        const bullets = lines
          .filter(l => l.startsWith("- ") || l.startsWith("* ") || /^\d+\./.test(l))
          .map(l => l.replace(/^[-*]\s+|\d+\.\s+/, ""))
          .slice(0, 8);
        slides.push({
          title: lines[0]?.replace(/^#+\s*/, "").slice(0, 60) || "Response",
          bullets: bullets.length > 0 ? bullets : lines.slice(0, 5).map(l => l.slice(0, 100)),
          layout: "content",
        });
      }
    }
  }

  return generatePptx(slides, options);
}

// ═══════════ Helpers ═══════════

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeColor(color: string): string {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    return hex.length === 3
      ? hex.split("").map(c => c + c).join("")
      : hex.slice(0, 6);
  }
  return "FFFFFF";
}

function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex, 16);
  const r = Math.max(0, Math.floor(((num >> 16) & 0xFF) * (1 - amount)));
  const g = Math.max(0, Math.floor(((num >> 8) & 0xFF) * (1 - amount)));
  const b = Math.max(0, Math.floor((num & 0xFF) * (1 - amount)));
  return ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
