// 贴图管理器：负责加载、存储、删除贴图数据，以及与 3dppc 文件的序列化交互。
import * as THREE from "three";
import { appEventBus } from "./eventBus";

// 贴图格式类型
export type TextureFormat = "png" | "jpg" | "jpeg" | "webp";

// 贴图颜色空间
export type TextureColorSpace = "srgb" | "linear";

// 贴图数据结构
export type TextureData = {
  id: string;
  name: string;
  format: TextureFormat;
  data: ArrayBuffer;
  width: number;
  height: number;
  colorSpace: TextureColorSpace;
  flipY: boolean;
};

// 项目中的贴图存储
const projectTextures = new Map<string, TextureData>();

// 生成唯一 ID
function generateTextureId(): string {
  return `tex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 获取文件格式
function getFormatFromMime(mimeType: string): TextureFormat | null {
  const mimeMap: Record<string, TextureFormat> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
  };
  return mimeMap[mimeType] || null;
}

// 从文件名获取扩展名
function getFormatFromExtension(ext: string): TextureFormat | null {
  const lower = ext.toLowerCase();
  if (lower === "png") return "png";
  if (lower === "jpg" || lower === "jpeg") return "jpg";
  if (lower === "webp") return "webp";
  return null;
}

/**
 * 从 File 对象加载贴图数据
 */
export async function loadTextureFromFile(file: File): Promise<TextureData> {
  const ext = file.name.split(".").pop() || "";
  const format = getFormatFromExtension(ext) || getFormatFromMime(file.type);

  if (!format) {
    throw new Error(`不支持的图片格式: ${ext || file.type}`);
  }

  const arrayBuffer = await file.arrayBuffer();

  // 获取图片尺寸
  const blob = new Blob([arrayBuffer], { type: file.type });
  const bitmap = await createImageBitmap(blob);

  const textureData: TextureData = {
    id: generateTextureId(),
    name: file.name,
    format,
    data: arrayBuffer,
    width: bitmap.width,
    height: bitmap.height,
    colorSpace: "srgb", // 默认 sRGB
    flipY: true, // 默认 flipY
  };

  bitmap.close();
  return textureData;
}

/**
 * 从 URL 加载贴图数据
 */
export async function loadTextureFromUrl(url: string, name?: string): Promise<TextureData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`加载图片失败: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "";
  const format = getFormatFromMime(contentType);

  if (!format) {
    // 尝试从 URL 推断格式
    const urlObj = new URL(url);
    const ext = urlObj.pathname.split(".").pop() || "";
    const inferredFormat = getFormatFromExtension(ext);
    if (!inferredFormat) {
      throw new Error(`无法确定图片格式`);
    }
  }

  // 获取图片尺寸
  const blob = new Blob([arrayBuffer], { type: contentType || "image/png" });
  const bitmap = await createImageBitmap(blob);

  const textureData: TextureData = {
    id: generateTextureId(),
    name: name || url.split("/").pop() || "texture",
    format: format || "png",
    data: arrayBuffer,
    width: bitmap.width,
    height: bitmap.height,
    colorSpace: "srgb",
    flipY: true,
  };

  bitmap.close();
  return textureData;
}

/**
 * 添加贴图到项目
 */
export function addTexture(texture: TextureData): void {
  projectTextures.set(texture.id, texture);
  // 广播贴图变动事件，携带贴图数据
  appEventBus.emit("texturesChanged", { textureData: texture, action: "add" });
}

/**
 * 获取项目中的所有贴图
 */
export function getAllTextures(): TextureData[] {
  return Array.from(projectTextures.values());
}

/**
 * 根据 ID 获取贴图
 */
export function getTextureById(id: string): TextureData | undefined {
  return projectTextures.get(id);
}

/**
 * 删除贴图
 */
export function removeTexture(id: string): boolean {
  return projectTextures.delete(id);
}

/**
 * 覆盖贴图数据（用新图片替换）
 */
export function replaceTexture(id: string, newTexture: TextureData): boolean {
  if (!projectTextures.has(id)) {
    return false;
  }
  // 保留原有的 id，只更新数据（使用新贴图的名称）
  const oldTexture = projectTextures.get(id)!;
  const updatedTexture: TextureData = {
    ...newTexture,
    id: oldTexture.id,
  };
  projectTextures.set(id, updatedTexture);
  // 广播贴图变动事件，携带更新后的贴图数据
  appEventBus.emit("texturesChanged", { textureData: updatedTexture, action: "replace" });
  return true;
}

/**
 * 更新贴图设置
 */
export function updateTextureSettings(
  id: string,
  settings: { colorSpace?: TextureColorSpace; flipY?: boolean }
): boolean {
  const texture = projectTextures.get(id);
  if (!texture) {
    return false;
  }

  if (settings.colorSpace !== undefined) {
    texture.colorSpace = settings.colorSpace;
  }
  if (settings.flipY !== undefined) {
    texture.flipY = settings.flipY;
  }

  return true;
}

/**
 * 清空所有贴图
 */
export function clearAllTextures(): void {
  projectTextures.clear();
  // 广播贴图清除事件
  appEventBus.emit("texturesChanged", { textureData: null, action: "clear" });
}

/**
 * 将贴图数据导出为 Three.js Texture
 */
export function createThreeTexture(textureData: TextureData): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    const blob = new Blob([textureData.data], {
      type: `image/${textureData.format}`,
    });
    const url = URL.createObjectURL(blob);

    const loader = new THREE.TextureLoader();
    const texture = loader.load(
      url,
      // onLoad 回调 - 贴图加载完成后返回
      (loadedTexture) => {
        // 在加载完成后设置颜色空间和 flipY
        loadedTexture.colorSpace = textureData.colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
        loadedTexture.flipY = textureData.flipY;
        loadedTexture.needsUpdate = true;
        URL.revokeObjectURL(url);
        resolve(loadedTexture);
      }
    );
  });
}

/**
 * 检查是否有贴图
 */
export function hasTextures(): boolean {
  return projectTextures.size > 0;
}

/**
 * 获取贴图数量
 */
export function getTextureCount(): number {
  return projectTextures.size;
}

// === 与 3dppc 序列化相关的功能 ===

/**
 * 从 3dppc 数据中恢复贴图
 */
export function restoreTexturesFromPPC(textures: TextureData[]): void {
  clearAllTextures();
  textures.forEach((tex) => {
    projectTextures.set(tex.id, tex);
  });
}

/**
 * 获取用于 3dppc 导出的贴图数据
 */
export function getTexturesForExport(): TextureData[] {
  return getAllTextures();
}

// === 贴图生成功能 ===

const UV_TEXTURE_SIZE = 2048;

/**
 * 生成更适合调试 UV 的纹理：
 * - 大格子：每格不同底色，便于定位 UV 区域
 * - 细网格：便于观察拉伸/压缩
 * - 非对称角标：便于观察旋转/镜像
 * - 轻微渐变：保留整体 U/V 方向感
 */
export async function generateUVTexture(width: number | undefined = UV_TEXTURE_SIZE, height: number | undefined = UV_TEXTURE_SIZE): Promise<TextureData> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建 2D 上下文");
  }

  // ===== 参数 =====
  const majorCells = 16;       // 大格子数量（每边）
  const minorPerMajor = 4;     // 每个大格子里的小格子数
  const majorW = width / majorCells;
  const majorH = height / majorCells;
  const minorW = majorW / minorPerMajor;
  const minorH = majorH / minorPerMajor;

  // ===== 背景：按大格子填不同颜色 =====
  for (let cy = 0; cy < majorCells; cy++) {
    for (let cx = 0; cx < majorCells; cx++) {
      const x = cx * majorW;
      const y = cy * majorH;

      // 用 cell 坐标生成稳定但不同的颜色
      const hue = ((cx * 37 + cy * 67) % 360);
      const sat = 65;
      const light = 56 + ((cx + cy) % 2) * 6;

      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
      ctx.fillRect(x, y, majorW, majorH);

      // 左上角红三角（非对称标记）
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + majorW * 0.28, y);
      ctx.lineTo(x, y + majorH * 0.28);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 64, 64, 0.95)";
      ctx.fill();

      // 右下角蓝三角（非对称标记）
      ctx.beginPath();
      ctx.moveTo(x + majorW, y + majorH);
      ctx.lineTo(x + majorW - majorW * 0.28, y + majorH);
      ctx.lineTo(x + majorW, y + majorH - majorH * 0.28);
      ctx.closePath();
      ctx.fillStyle = "rgba(64, 128, 255, 0.95)";
      ctx.fill();

      // 左边粗黑线
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.lineWidth = Math.max(2, Math.floor(width / 512));
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + majorH);
      ctx.stroke();

      // 下边粗白线
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(2, Math.floor(width / 512));
      ctx.beginPath();
      ctx.moveTo(x, y + majorH - 0.5);
      ctx.lineTo(x + majorW, y + majorH - 0.5);
      ctx.stroke();

      // 可选：格子编号（分辨率足够时）
      if (majorW >= 32 && majorH >= 24) {
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.font = `${Math.max(10, Math.floor(majorH * 0.18))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${cx},${majorCells - 1 - cy}`, x + majorW * 0.5, y + majorH * 0.5);
      }
    }
  }

  // ===== 细网格 =====
  ctx.lineWidth = 1;

  // 小网格
  ctx.strokeStyle = "rgba(0,0,0,0.20)";
  for (let i = 0; i <= majorCells * minorPerMajor; i++) {
    const gx = i * minorW;
    const gy = i * minorH;

    ctx.beginPath();
    ctx.moveTo(gx + 0.5, 0);
    ctx.lineTo(gx + 0.5, height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, gy + 0.5);
    ctx.lineTo(width, gy + 0.5);
    ctx.stroke();
  }

  // 大网格
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = Math.max(2, Math.floor(width / 512));
  for (let i = 0; i <= majorCells; i++) {
    const gx = i * majorW;
    const gy = i * majorH;

    ctx.beginPath();
    ctx.moveTo(gx + 0.5, 0);
    ctx.lineTo(gx + 0.5, height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, gy + 0.5);
    ctx.lineTo(width, gy + 0.5);
    ctx.stroke();
  }

  // ===== 叠加一层轻微渐变，保留整体 UV 方向感 =====
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const i = (y * width + x) * 4;

      // 低强度叠加：G 表示 V，B 表示 U
      const overlayG = Math.round(v * 90);
      const overlayB = Math.round(u * 90);

      data[i + 1] = Math.min(255, data[i + 1] + overlayG);
      data[i + 2] = Math.min(255, data[i + 2] + overlayB);
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // ===== 导出 PNG =====
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );

  if (!blob) {
    throw new Error("无法生成纹理图像");
  }

  const arrayBuffer = await blob.arrayBuffer();

  return {
    id: generateTextureId(),
    name: "generated_uv_debug_texture.png",
    format: "png",
    data: arrayBuffer,
    width,
    height,
    colorSpace: "srgb",
    flipY: true,
  };
}
