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
