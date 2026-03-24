// 贴图管理器：负责加载、存储、删除贴图数据，以及与 3dppc 文件的序列化交互。
import * as THREE from "three";
import type { Object3D, Vector2, Texture as ThreeTexture } from "three";
import { appEventBus } from "./eventBus";
import { ensurePerTriangleUVsIfMissing } from "./geometry";

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
 * @param userInitiated 是否由用户主动触发。用于决定是否输出日志
 */
export function clearAllTextures(userInitiated: boolean = false): void {
  projectTextures.clear();
  appEventBus.emit("texturesChanged", { textureData: null, action: "clear", userInitiated });
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
  clearAllTextures(false); // 自动恢复，不输出日志
  textures.forEach((tex) => {
    projectTextures.set(tex.id, tex);
  });
  // 触发事件，让渲染器知道贴图已恢复
  const firstTexture = textures[0];
  if (firstTexture) {
    appEventBus.emit("texturesChanged", { textureData: firstTexture, action: "add", userInitiated: false });
  }
}

/**
 * 获取用于 3dppc 导出的贴图数据
 */
export function getTexturesForExport(): TextureData[] {
  return getAllTextures();
}

// === 贴图生成功能 ===

const UV_TEXTURE_SIZE = 2048;

function drawBaseUVPattern(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 0; // R
      data[i + 1] = Math.round((y / (height - 1)) * 255); // G
      data[i + 2] = Math.round((x / (width - 1)) * 255); // B
      data[i + 3] = 255; // A
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function forEachUVTriangle(
  geometry: THREE.BufferGeometry,
  callback: (
    u0: number, v0: number,
    u1: number, v1: number,
    u2: number, v2: number
  ) => void
) {
  const uvAttr = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  if (!uvAttr || uvAttr.itemSize < 2) {
    throw new Error("geometry 没有可用的 uv 数据");
  }

  const index = geometry.getIndex();

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const i0 = index.getX(i);
      const i1 = index.getX(i + 1);
      const i2 = index.getX(i + 2);

      callback(
        uvAttr.getX(i0), uvAttr.getY(i0),
        uvAttr.getX(i1), uvAttr.getY(i1),
        uvAttr.getX(i2), uvAttr.getY(i2),
      );
    }
  } else {
    for (let i = 0; i < uvAttr.count; i += 3) {
      callback(
        uvAttr.getX(i), uvAttr.getY(i),
        uvAttr.getX(i + 1), uvAttr.getY(i + 1),
        uvAttr.getX(i + 2), uvAttr.getY(i + 2),
      );
    }
  }
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/**
 * 生成 UV 可视化纹理
 * - 不传 geometry：整张都是调试纹理
 * - 传 geometry：只在 geometry 的 UV 三角形覆盖区域内绘制调试纹理，其余区域为纯黑
 *
 * 注意：
 * 这里为了让"导出的 PNG 直接看起来像 UV 展开图"，采用的是：
 *   UV (0,0) -> 图片左下角
 *   UV (1,1) -> 图片右上角
 * 所以会把 v 转成 y = (1 - v) * (height - 1)
 *
 * 如果你想完全沿用你当前旧逻辑的上下方向，可以把 uvToPixel 中的 y 改回 v * (height - 1)，
 * 同时根据你的纹理加载管线决定 flipY 应该保持 true 还是改成 false。
 */
export async function generateUVTexture(
  geometry?: THREE.BufferGeometry
): Promise<TextureData> {
  const width = UV_TEXTURE_SIZE;
  const height = UV_TEXTURE_SIZE;

  // 先生成一张完整的基础调试图
  const patternCanvas = document.createElement("canvas");
  patternCanvas.width = width;
  patternCanvas.height = height;
  const patternCtx = patternCanvas.getContext("2d");
  if (!patternCtx) {
    throw new Error("无法创建 pattern 画布上下文");
  }
  drawBaseUVPattern(patternCtx, width, height);

  // 输出画布
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建 2D 上下文");
  }

  // 先整张填黑
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  // 不传 geometry 时，保持原行为：整张绘制
  if (!geometry) {
    ctx.drawImage(patternCanvas, 0, 0);
  } else {
    const uvToPixel = (u: number, v: number) => {
      const uu = clamp01(u);
      const vv = clamp01(v);
      return {
        x: uu * (width - 1),
        // y: vv * (height - 1), // 让导出的图直观看起来就是 UV 展开
        y: (1 - vv) * (height - 1), // 让导出的图直观看起来就是 UV 展开
      };
    };

    // 只把 UV 三角形覆盖到的区域画出来
    forEachUVTriangle(geometry, (u0, v0, u1, v1, u2, v2) => {
      const p0 = uvToPixel(u0, v0);
      const p1 = uvToPixel(u1, v1);
      const p2 = uvToPixel(u2, v2);

      const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
      const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));

      const drawW = maxX - minX + 1;
      const drawH = maxY - minY + 1;
      if (drawW <= 0 || drawH <= 0) return;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.clip();

      // 只拷贝这个三角形包围盒区域，避免每个三角都整张 drawImage
      ctx.drawImage(
        patternCanvas,
        minX, minY, drawW, drawH,
        minX, minY, drawW, drawH
      );

      ctx.restore();
    });

    // 可选：再叠一层白色线框，能更直观看出每个三角形
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = Math.max(1, Math.floor(width / 512));

    forEachUVTriangle(geometry, (u0, v0, u1, v1, u2, v2) => {
      const p0 = uvToPixel(u0, v0);
      const p1 = uvToPixel(u1, v1);
      const p2 = uvToPixel(u2, v2);

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.stroke();
    });
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) {
    throw new Error("无法生成纹理图像");
  }

  const arrayBuffer = await blob.arrayBuffer();

  return {
    id: generateTextureId(),
    name: geometry ? "generated_uv_layout_texture.png" : "generated_texture.png",
    format: "png",
    data: arrayBuffer,
    width,
    height,
    colorSpace: "srgb",

    // 这里建议先设成 false，因为我们输出的是"直接看上去像 UV 展开图"的图片
    // 如果你项目里现有纹理导入链要求 generated texture 必须 flipY=true，再按你的加载链改回去。
    flipY: true,
  };
}

/**
 * 确保模型的所有 mesh 都有 UV 坐标。
 * 如果模型没有 UV，会自动生成 per-triangle UV。
 * 此函数应在首次生成贴图或加载外部贴图之前调用。
 */
export function ensureUVsForModel(model: Object3D | null): boolean {
  if (!model) return false;

  let hasModified = false;
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (ensurePerTriangleUVsIfMissing(mesh)) {
        hasModified = true;
      }
    }
  });
  return hasModified;
}

// === 展开组贴图生成 ===

// 多边形数据类型
export type PolygonWithPoints = {
  points: [number, number][];
};

// 展开组贴图三角形数据
export type GroupTextureTriangle = {
  faceId: number;
  points: [number, number][];
  uv: Vector2[] | null;
};

// 展开组贴图生成选项
export type GroupTextureOptions = {
  polygons: PolygonWithPoints[];
  faceUVs: Map<number, Vector2[] | null> | GroupTextureTriangle[];
  texture: ThreeTexture | null;
  size?: number;
  /** 展开组旋转角度（弧度），会先旋转多边形再计算包围盒 */
  groupAngle?: number;
};

/**
 * 生成展开组的 PNG 贴图
 * - 三角形外区域透明
 * - 有贴图时使用贴图映射，无贴图时使用不透明白色
 */
export async function generateGroupTexture(options: GroupTextureOptions): Promise<Blob> {
  const { polygons, faceUVs, texture, size = 1024, groupAngle = 0 } = options;

  const textureImage = texture?.image ? (texture.image as CanvasImageSource) : null;
  const textureFlipY = texture?.flipY ?? true;
  const defaultUV = [new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 1), new THREE.Vector2(1, 0)];

  type XY = { x: number; y: number };
  type DrawTri = {
    faceId: number;
    points: [XY, XY, XY];
    uv: [Vector2, Vector2, Vector2] | null;
  };

  const triangles: DrawTri[] = [];

  if (Array.isArray(faceUVs)) {
    faceUVs.forEach((tri) => {
      if (!tri?.points || tri.points.length < 3) return;
      const [p0, p1, p2] = tri.points;
      const uv = tri.uv && tri.uv.length >= 3
        ? [tri.uv[0], tri.uv[1], tri.uv[2]] as [Vector2, Vector2, Vector2]
        : null;
      triangles.push({
        faceId: tri.faceId,
        points: [
          { x: p0[0], y: p0[1] },
          { x: p1[0], y: p1[1] },
          { x: p2[0], y: p2[1] },
        ],
        uv,
      });
    });
  } else {
    let triIndex = 0;
    polygons.forEach((polygon) => {
      const points = polygon.points;
      if (!points || points.length < 3) return;
      for (let i = 1; i < points.length - 1; i++) {
        const uv = faceUVs.get(triIndex);
        triangles.push({
          faceId: triIndex,
          points: [
            { x: points[0][0], y: points[0][1] },
            { x: points[i][0], y: points[i][1] },
            { x: points[i + 1][0], y: points[i + 1][1] },
          ],
          uv: uv && uv.length >= 3
            ? [uv[0], uv[1], uv[2]] as [Vector2, Vector2, Vector2]
            : null,
        });
        triIndex++;
      }
    });
  }

  // 先旋转再计算包围盒（与 unfold2dManager.ts 中 updateBBoxRuler 逻辑一致）
  if (Math.abs(groupAngle) > 1e-9) {
    const cos = Math.cos(groupAngle);
    const sin = Math.sin(groupAngle);
    triangles.forEach((tri) => {
      tri.points = tri.points.map((p) => ({
        x: p.x * cos - p.y * sin,
        y: p.x * sin + p.y * cos,
      })) as [XY, XY, XY];
    });
  }

  // 计算旋转后的包围盒
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  triangles.forEach((tri) => {
    tri.points.forEach((p) => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
  });

  // 根据包围盒尺寸动态设置画布分辨率（保持宽高比）
  const PIXELS_PER_UNIT = 20;
  const MIN_SIZE = 64;
  const MAX_SIZE = 4096;
  const rawWidth = Math.ceil((maxX - minX) * PIXELS_PER_UNIT);
  const rawHeight = Math.ceil((maxY - minY) * PIXELS_PER_UNIT);

  // 保持宽高比，计算最终的画布尺寸
  const aspectRatio = rawWidth / rawHeight;
  let canvasWidth: number;
  let canvasHeight: number;

  if (rawWidth > MAX_SIZE && rawHeight > MAX_SIZE) {
    // 如果两边都超过最大值，选择较大的那个作为限制
    if (aspectRatio > 1) {
      canvasWidth = MAX_SIZE;
      canvasHeight = Math.max(MIN_SIZE, Math.round(MAX_SIZE / aspectRatio));
    } else {
      canvasHeight = MAX_SIZE;
      canvasWidth = Math.max(MIN_SIZE, Math.round(MAX_SIZE * aspectRatio));
    }
  } else if (rawWidth > MAX_SIZE) {
    canvasWidth = MAX_SIZE;
    canvasHeight = Math.max(MIN_SIZE, Math.round(MAX_SIZE / aspectRatio));
  } else if (rawHeight > MAX_SIZE) {
    canvasHeight = MAX_SIZE;
    canvasWidth = Math.max(MIN_SIZE, Math.round(MAX_SIZE * aspectRatio));
  } else {
    canvasWidth = Math.max(MIN_SIZE, rawWidth);
    canvasHeight = Math.max(MIN_SIZE, rawHeight);
  }

  console.log(`[generateGroupTexture] raw size: ${rawWidth}x${rawHeight}, canvas size: ${canvasWidth}x${canvasHeight}`)

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (triangles.length === 0) {
    const blankBlob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob || new Blob([], { type: "image/png" })), "image/png");
    });
    return blankBlob;
  }

  // 计算缩放和偏移，将多边形居中画入画布（预留 5% 边距）
  const padding = 0;//0.05;
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((canvasWidth * (1 - padding * 2)) / spanX, (canvasHeight * (1 - padding * 2)) / spanY);
  const offsetX = (canvasWidth - spanX * scale) * 0.5;
  const offsetY = (canvasHeight - spanY * scale) * 0.5;

  const toCanvas = (x: number, y: number): XY => ({
    x: (x - minX) * scale + offsetX,
    y: canvasHeight - ((y - minY) * scale + offsetY),
  });

  const sourceWidth = textureImage ? Number((textureImage as any).width ?? 0) : 0;
  const sourceHeight = textureImage ? Number((textureImage as any).height ?? 0) : 0;
  const uvToImage = (uv: Vector2): XY => ({
    x: uv.x * sourceWidth,
    y: (textureFlipY ? (1 - uv.y) : uv.y) * sourceHeight,
  });

  const computeAffine = (src: [XY, XY, XY], dst: [XY, XY, XY]) => {
    const [s0, s1, s2] = src;
    const [d0, d1, d2] = dst;
    const det = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
    if (Math.abs(det) < 1e-8) return null;

    const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / det;
    const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / det;
    const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / det;
    const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / det;
    const e = (
      d0.x * (s1.x * s2.y - s2.x * s1.y) +
      d1.x * (s2.x * s0.y - s0.x * s2.y) +
      d2.x * (s0.x * s1.y - s1.x * s0.y)
    ) / det;
    const f = (
      d0.y * (s1.x * s2.y - s2.x * s1.y) +
      d1.y * (s2.x * s0.y - s0.x * s2.y) +
      d2.y * (s0.x * s1.y - s1.x * s0.y)
    ) / det;

    return { a, b, c, d, e, f };
  };

  triangles.forEach((tri) => {
    const [p0, p1, p2] = tri.points.map((p) => toCanvas(p.x, p.y)) as [XY, XY, XY];

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.clip();

    if (textureImage) {
      const uv = tri.uv ?? (defaultUV as [Vector2, Vector2, Vector2]);
      const [uv0, uv1, uv2] = uv;
      const s0 = uvToImage(uv0);
      const s1 = uvToImage(uv1);
      const s2 = uvToImage(uv2);
      const m = computeAffine([s0, s1, s2], [p0, p1, p2]);
      if (m) {
        ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        ctx.drawImage(textureImage, 0, 0);
      } else {
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
      }
    } else {
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
    }

    ctx.restore();
  });

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob([], { type: "image/png" })), "image/png");
  });
  return blob;
}