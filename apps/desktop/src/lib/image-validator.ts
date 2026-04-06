/**
 * Image Validator — validate and encode images for API consumption
 *
 * Supports: png, jpg/jpeg, gif, webp
 * Max size: 20 MB
 * Zero external dependencies.
 */

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
}

export interface EncodedImage {
  base64: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

const SUPPORTED_FORMATS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const MAX_SIZE_BYTES = 20 * 1024 * 1024;

const MAX_DIMENSION = 8192;

const MAGIC_BYTES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: "image/png", bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: "image/jpeg", bytes: [0xFF, 0xD8, 0xFF] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
];

function detectMimeFromBytes(header: Uint8Array): string | null {
  for (const sig of MAGIC_BYTES) {
    const offset = sig.offset ?? 0;
    const match = sig.bytes.every((b, i) => header[offset + i] === b);
    if (match) {
      if (sig.mime === "image/webp") {
        return header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
          ? "image/webp"
          : null;
      }
      return sig.mime;
    }
  }
  return null;
}

function mimeFromExtension(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    default: return null;
  }
}

export function validateImageFile(file: File): ImageValidationResult {
  if (file.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  if (file.size > MAX_SIZE_BYTES) {
    return {
      valid: false,
      error: `File too large: ${(file.size / (1024 * 1024)).toFixed(1)} MB (max ${MAX_SIZE_BYTES / (1024 * 1024)} MB)`,
      sizeBytes: file.size,
    };
  }

  const mime = file.type || mimeFromExtension(file.name);
  if (!mime || !(mime in SUPPORTED_FORMATS)) {
    return {
      valid: false,
      error: `Unsupported format: ${mime || file.name}. Supported: png, jpg, gif, webp`,
      sizeBytes: file.size,
    };
  }

  return { valid: true, mimeType: mime, sizeBytes: file.size };
}

export async function validateImageBytes(buffer: ArrayBuffer, filename?: string): Promise<ImageValidationResult> {
  if (buffer.byteLength === 0) {
    return { valid: false, error: "Empty buffer" };
  }

  if (buffer.byteLength > MAX_SIZE_BYTES) {
    return {
      valid: false,
      error: `Buffer too large: ${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB (max ${MAX_SIZE_BYTES / (1024 * 1024)} MB)`,
      sizeBytes: buffer.byteLength,
    };
  }

  const header = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16));
  let mime = detectMimeFromBytes(header);

  if (!mime && filename) {
    mime = mimeFromExtension(filename);
  }

  if (!mime || !(mime in SUPPORTED_FORMATS)) {
    return {
      valid: false,
      error: `Cannot determine image format${filename ? ` for ${filename}` : ""}. Supported: png, jpg, gif, webp`,
      sizeBytes: buffer.byteLength,
    };
  }

  return { valid: true, mimeType: mime, sizeBytes: buffer.byteLength };
}

function loadImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image"));
    };
    img.src = url;
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function encodeImageFile(file: File): Promise<EncodedImage> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);

  const blob = new Blob([buffer], { type: validation.mimeType });
  const dims = await loadImageDimensions(blob);

  if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
    throw new Error(
      `Image dimensions ${dims.width}×${dims.height} exceed max ${MAX_DIMENSION}×${MAX_DIMENSION}`,
    );
  }

  return {
    base64,
    mimeType: validation.mimeType!,
    sizeBytes: file.size,
    width: dims.width,
    height: dims.height,
  };
}

export async function encodeImageBuffer(
  buffer: ArrayBuffer,
  filename?: string,
): Promise<EncodedImage> {
  const validation = await validateImageBytes(buffer, filename);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const base64 = arrayBufferToBase64(buffer);

  const blob = new Blob([buffer], { type: validation.mimeType });
  const dims = await loadImageDimensions(blob);

  if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
    throw new Error(
      `Image dimensions ${dims.width}×${dims.height} exceed max ${MAX_DIMENSION}×${MAX_DIMENSION}`,
    );
  }

  return {
    base64,
    mimeType: validation.mimeType!,
    sizeBytes: buffer.byteLength,
    width: dims.width,
    height: dims.height,
  };
}

export function isImageFile(file: File): boolean {
  return validateImageFile(file).valid;
}

export function getSupportedFormats(): string[] {
  return Object.values(SUPPORTED_FORMATS);
}
