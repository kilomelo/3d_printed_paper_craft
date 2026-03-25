import JSZip from "jszip";
import type { BufferGeometry } from "three";

/**
 * 面向浏览器前端的 3MF 处理工具：
 * - 解析 3MF ZIP / OPC 容器
 * - 提供可组合的处理器（processor）
 * - 重新导出并下载
 *
 * 当前内置处理器：
 * 1. 按 X / Y / Z 三轴独立缩放所有模型实例
 * 2. 按名称删除唯一组合对象中的任意子对象
 *
 * 依赖：npm i jszip
 */

const RELS_PATH = "_rels/.rels";
const START_PART_REL_TYPE = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const MODEL_SETTINGS_CONFIG_PATH = "Metadata/model_settings.config";
const LAYER_CONFIG_RANGES_PATH = "Metadata/layer_config_ranges.xml";
const LAYER_CONFIG_RANGES_CACHE_KEY = "__layerConfigRangesDocCache";

export type ThreeMfProcessor = (ctx: ThreeMfDocument) => void | Promise<void>;

export type XmlDocEntry = {
  path: string;
  doc: XMLDocument;
};

export type ThreeMfModelPartInfo = {
  path: string;
  objectCount: number;
  buildItemCount: number;
  unit: string | null;
  xml: XMLDocument;
};

export type ScaleProcessorOptions = {
  /** X 轴缩放系数。默认 1。 */
  xFactor?: number;
  /** Y 轴缩放系数。默认 1。 */
  yFactor?: number;
  /** Z 轴缩放系数。默认 1。 */
  zFactor?: number;
  /** 是否同时缩放 component 的 transform。默认 false，只缩放 build/item。 */
  includeComponentTransforms?: boolean;
};

export type RemoveChildByNameOptions = {
  /** 默认 true：要求且仅要求匹配到 1 个目标子对象，否则报错。 */
  strict?: boolean;
  /** 默认 true：同步删除 model_settings.config 里的对应 <part id="...">。 */
  removeModelSettingsPart?: boolean;
  /** 默认 true：同步删除被引用 .model part 里的对应 <object id="...">。 */
  removeReferencedObject?: boolean;
};

/** 向后兼容旧命名 */
export type RemoveBackingOptions = RemoveChildByNameOptions;

export type ThreeMfMeshData = {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  uvs?: ArrayLike<number>;
  name?: string;
};

export type ThreeMfChildPartKind = "normal" | "negative";

export type AddChildObjectOptions = {
  childName: string;
  mesh: ThreeMfMeshData;
  /**
   * 子对象在 Bambu / Orca 项目中的部件类型。
   * - normal: 普通正模型
   * - negative: 负模型（Negative Part）
   *
   * 默认 normal。
   */
  partKind?: ThreeMfChildPartKind;
};

export type AddChildObjectFromGeometryOptions = {
  childName: string;
  geometry: BufferGeometry;
  partKind?: ThreeMfChildPartKind;
};

export type ThreeMfVector3 = {
  x: number;
  y: number;
  z: number;
};

export type ThreeMfBoundingBox = {
  min: ThreeMfVector3;
  max: ThreeMfVector3;
  size: ThreeMfVector3;
  center: ThreeMfVector3;
};

export type CompositeChildrenUnionBoundingBoxOptions = {
  /**
   * 是否把主 build/item 的 transform 也计入结果。
   * 默认 false：返回唯一组合对象局部坐标系中的包围盒。
   * 当你准备把新子对象直接挂到这个组合对象下时，通常应保持 false。
   */
  includeBuildItemTransform?: boolean;
};

export type HeightRangeModifierOptions = {
  minZ: number;
  maxZ: number;
  slicerOptions: Record<string, string | number | boolean>;
  /**
   * 默认 true：如果同一个 object 下已存在相同 [minZ, maxZ] 的 range，则先删后加。
   */
  replaceSameRange?: boolean;
};

type DisplayNameInfo = {
  name: string;
  source: string;
};

type ResolvedComponentObject = {
  componentEl: Element;
  objectId: string;
  partPath: string;
  objectEl: Element;
  resolutionSource: string;
};


type InternalBoundingBox = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

const IDENTITY_TRANSFORM_12: readonly number[] = Object.freeze([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
  0, 0, 0,
]);

function identityTransform12(): number[] {
  return [...IDENTITY_TRANSFORM_12];
}

function getTransform12OrIdentity(transform: string | null | undefined, context: string): number[] {
  if (!transform || !transform.trim()) return identityTransform12();
  const parsed = parseTransform12(transform);
  if (!parsed) {
    throw new Error(`非法 transform（${context}）: ${transform}`);
  }
  return parsed;
}

function multiplyTransform12(parent: number[], local: number[]): number[] {
  const a00 = parent[0], a01 = parent[1], a02 = parent[2];
  const a10 = parent[3], a11 = parent[4], a12 = parent[5];
  const a20 = parent[6], a21 = parent[7], a22 = parent[8];
  const atx = parent[9], aty = parent[10], atz = parent[11];

  const b00 = local[0], b01 = local[1], b02 = local[2];
  const b10 = local[3], b11 = local[4], b12 = local[5];
  const b20 = local[6], b21 = local[7], b22 = local[8];
  const btx = local[9], bty = local[10], btz = local[11];

  return [
    a00 * b00 + a01 * b10 + a02 * b20,
    a00 * b01 + a01 * b11 + a02 * b21,
    a00 * b02 + a01 * b12 + a02 * b22,

    a10 * b00 + a11 * b10 + a12 * b20,
    a10 * b01 + a11 * b11 + a12 * b21,
    a10 * b02 + a11 * b12 + a12 * b22,

    a20 * b00 + a21 * b10 + a22 * b20,
    a20 * b01 + a21 * b11 + a22 * b21,
    a20 * b02 + a21 * b12 + a22 * b22,

    a00 * btx + a01 * bty + a02 * btz + atx,
    a10 * btx + a11 * bty + a12 * btz + aty,
    a20 * btx + a21 * bty + a22 * btz + atz,
  ];
}

function transformPointBy12(m: number[], x: number, y: number, z: number): ThreeMfVector3 {
  return {
    x: m[0] * x + m[1] * y + m[2] * z + m[9],
    y: m[3] * x + m[4] * y + m[5] * z + m[10],
    z: m[6] * x + m[7] * y + m[8] * z + m[11],
  };
}

function unionBoundingBoxes(a: InternalBoundingBox | null, b: InternalBoundingBox | null): InternalBoundingBox | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function transformBoundingBox(bbox: InternalBoundingBox, transform: number[]): InternalBoundingBox {
  const xs = [bbox.minX, bbox.maxX];
  const ys = [bbox.minY, bbox.maxY];
  const zs = [bbox.minZ, bbox.maxZ];

  let out: InternalBoundingBox | null = null;
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        const p = transformPointBy12(transform, x, y, z);
        const pointBox: InternalBoundingBox = {
          minX: p.x, maxX: p.x,
          minY: p.y, maxY: p.y,
          minZ: p.z, maxZ: p.z,
        };
        out = unionBoundingBoxes(out, pointBox);
      }
    }
  }

  if (!out) {
    throw new Error("无法变换空包围盒");
  }
  return out;
}

function toPublicBoundingBox(bbox: InternalBoundingBox): ThreeMfBoundingBox {
  const size = {
    x: bbox.maxX - bbox.minX,
    y: bbox.maxY - bbox.minY,
    z: bbox.maxZ - bbox.minZ,
  };

  return {
    min: { x: bbox.minX, y: bbox.minY, z: bbox.minZ },
    max: { x: bbox.maxX, y: bbox.maxY, z: bbox.maxZ },
    size,
    center: {
      x: bbox.minX + size.x * 0.5,
      y: bbox.minY + size.y * 0.5,
      z: bbox.minZ + size.z * 0.5,
    },
  };
}

function getMeshBoundingBoxFromObject(objectEl: Element): InternalBoundingBox | null {
  const meshEl = getFirstDirectChildByLocalName(objectEl, "mesh");
  if (!meshEl) return null;

  const verticesEl = getFirstDirectChildByLocalName(meshEl, "vertices");
  if (!verticesEl) return null;

  const vertexEls = getElementsByLocalName(verticesEl, "vertex");
  let bbox: InternalBoundingBox | null = null;

  for (const vertexEl of vertexEls) {
    const x = Number(vertexEl.getAttribute("x"));
    const y = Number(vertexEl.getAttribute("y"));
    const z = Number(vertexEl.getAttribute("z"));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    const pointBox: InternalBoundingBox = {
      minX: x, maxX: x,
      minY: y, maxY: y,
      minZ: z, maxZ: z,
    };
    bbox = unionBoundingBoxes(bbox, pointBox);
  }

  return bbox;
}

function computeObjectBoundingBoxRecursive(
  objectEl: Element,
  currentModelPath: string,
  modelParts: Map<string, XmlDocEntry>,
  stack: Set<string> = new Set(),
): InternalBoundingBox | null {
  const objectId = (objectEl.getAttribute("id") ?? "").trim();
  const stackKey = `${normalizeZipPath(currentModelPath)}#${objectId || "unknown-object"}`;
  if (stack.has(stackKey)) {
    throw new Error(`检测到组件循环引用: ${stackKey}`);
  }
  stack.add(stackKey);

  try {
    let bbox = getMeshBoundingBoxFromObject(objectEl);

    const componentEls = getElementsByLocalName(objectEl, "component");
    for (const componentEl of componentEls) {
      const resolved = resolveComponentObject(componentEl, objectEl, normalizeZipPath(currentModelPath), modelParts);
      if (!resolved) {
        const unresolvedObjectId = (componentEl.getAttribute("objectid") ?? "").trim();
        throw new Error(`无法解析 component 指向的对象: objectid=${unresolvedObjectId || "<empty>"}`);
      }

      const childBox = computeObjectBoundingBoxRecursive(
        resolved.objectEl,
        resolved.partPath,
        modelParts,
        stack,
      );
      if (!childBox) continue;

      const componentTransform = getTransform12OrIdentity(
        componentEl.getAttribute("transform"),
        `component objectid=${resolved.objectId}`,
      );
      bbox = unionBoundingBoxes(bbox, transformBoundingBox(childBox, componentTransform));
    }

    return bbox;
  } finally {
    stack.delete(stackKey);
  }
}

function parseXml(text: string, pathForError: string): XMLDocument {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`无法解析 XML: ${pathForError}`);
  }
  return doc;
}

function serializeXml(doc: XMLDocument): string {
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith("<?xml") ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

function normalizeZipPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\\/g, "/");
}

function dirname(path: string): string {
  const normalized = normalizeZipPath(path);
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx + 1) : "";
}

function resolveOpcTarget(basePartPath: string, target: string): string {
  if (!target) return target;
  if (target.startsWith("/")) return normalizeZipPath(target);

  const baseDir = dirname(basePartPath);
  const stack = (baseDir + target).split("/");
  const out: string[] = [];
  for (const seg of stack) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function getElementsByLocalName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

function getAttrOneOf(el: Element, names: string[]): string | null {
  for (const name of names) {
    const v = el.getAttribute(name);
    if (v != null && v !== "") return v;
  }

  for (const attr of Array.from(el.attributes)) {
    const local = attr.localName || attr.name.split(":").pop() || attr.name;
    if (names.includes(attr.name) || names.includes(local)) {
      return attr.value;
    }
  }
  return null;
}

function findObjectById(doc: XMLDocument, objectId: string): Element | null {
  const objects = getElementsByLocalName(doc, "object");
  return objects.find((obj) => (obj.getAttribute("id") ?? "").trim() === objectId) ?? null;
}

function parseTransform12(transform: string | null | undefined): number[] | null {
  if (!transform) return null;
  const nums = transform.trim().split(/\s+/).map((v) => Number(v));
  if (nums.length !== 12 || nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

function formatTransform12(m: number[]): string {
  return m.map((v) => {
    const s = Number(Math.abs(v) < 1e-12 ? 0 : v).toFixed(12);
    return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }).join(" ");
}

/**
 * 3MF transform 12 元素顺序：
 * m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32
 * 前 9 个是线性部分，最后 3 个是平移。
 */
function scaleTransformLinearPartByAxes(m: number[], xFactor: number, yFactor: number, zFactor: number): number[] {
  return [
    m[0] * xFactor, m[1] * yFactor, m[2] * zFactor,
    m[3] * xFactor, m[4] * yFactor, m[5] * zFactor,
    m[6] * xFactor, m[7] * yFactor, m[8] * zFactor,
    m[9], m[10], m[11],
  ];
}

function makePureScaleTransformByAxes(xFactor: number, yFactor: number, zFactor: number): string {
  return formatTransform12([
    xFactor, 0, 0,
    0, yFactor, 0,
    0, 0, zFactor,
    0, 0, 0,
  ]);
}

function getModelStats(doc: XMLDocument) {
  const model = getElementsByLocalName(doc, "model")[0];
  return {
    objectCount: getElementsByLocalName(doc, "object").length,
    buildItemCount: getElementsByLocalName(doc, "item").length,
    unit: model?.getAttribute("unit") ?? null,
  };
}

function getObjectDisplayNameFromObjectEl(objectEl: Element): DisplayNameInfo {
  const attrName = (objectEl.getAttribute("name") ?? "").trim();
  if (attrName) return { name: attrName, source: "object@name" };

  const metadataEls = getElementsByLocalName(objectEl, "metadata");
  for (const m of metadataEls) {
    const rawKey = (getAttrOneOf(m, ["name", "key", "type"]) ?? "").trim().toLowerCase();
    const rawValue = (getAttrOneOf(m, ["value"]) ?? m.textContent ?? "").trim();
    if (!rawValue) continue;
    if (["name", "object_name", "part_name", "source_file", "source_filename", "filename", "object_name_en"].includes(rawKey)) {
      return { name: rawValue, source: `metadata:${rawKey}` };
    }
  }

  return { name: "", source: "none" };
}

function buildModelSettingsPartNameMap(doc: XMLDocument | null): Map<string, Map<string, string>> {
  const rootMap = new Map<string, Map<string, string>>();
  if (!doc) return rootMap;

  const objectEls = getElementsByLocalName(doc, "object");
  for (const objectEl of objectEls) {
    const parentObjectId = (objectEl.getAttribute("id") ?? "").trim();
    if (!parentObjectId) continue;

    const partMap = new Map<string, string>();
    const partEls = getElementsByLocalName(objectEl, "part");
    for (const partEl of partEls) {
      const partId = (partEl.getAttribute("id") ?? "").trim();
      if (!partId) continue;

      let name = (partEl.getAttribute("name") ?? "").trim();
      if (!name) {
        const metadataEls = getElementsByLocalName(partEl, "metadata");
        const nameMeta = metadataEls.find(
          (m) => ((getAttrOneOf(m, ["key", "name"]) ?? "").trim().toLowerCase() === "name")
        );
        name = ((nameMeta && getAttrOneOf(nameMeta, ["value"])) ?? nameMeta?.textContent ?? "").trim();
      }

      if (name) partMap.set(partId, name);
    }

    if (partMap.size > 0) rootMap.set(parentObjectId, partMap);
  }

  return rootMap;
}

function getModelSettingsObjectElement(doc: XMLDocument | null, rootObjectId: string): Element | null {
  if (!doc) return null;
  const objectEls = getElementsByLocalName(doc, "object");
  return objectEls.find((el) => (el.getAttribute("id") ?? "").trim() === rootObjectId) ?? null;
}

function findAncestorPathHint(el: Element | null, attrNames: string[]): string | null {
  let cur: Element | null = el;
  while (cur) {
    const hit = getAttrOneOf(cur, attrNames);
    if (hit) return hit;
    cur = cur.parentElement;
  }
  return null;
}

function resolveComponentObject(
  componentEl: Element,
  parentObjectEl: Element,
  currentModelPath: string,
  modelParts: Map<string, XmlDocEntry>,
): ResolvedComponentObject | null {
  const objectId = (componentEl.getAttribute("objectid") ?? "").trim();
  if (!objectId) return null;

  const explicitPath = getAttrOneOf(componentEl, ["path", "modelpath"]);
  if (explicitPath) {
    const resolvedPath = resolveOpcTarget(currentModelPath, explicitPath);
    const targetEntry = modelParts.get(normalizeZipPath(resolvedPath));
    if (targetEntry) {
      const objectEl = findObjectById(targetEntry.doc, objectId);
      if (objectEl) {
        return {
          componentEl,
          partPath: normalizeZipPath(resolvedPath),
          objectId,
          objectEl,
          resolutionSource: "component-path",
        };
      }
    }
  }

  const inheritedPath = findAncestorPathHint(parentObjectEl, ["path", "modelpath"]);
  if (inheritedPath) {
    const resolvedPath = resolveOpcTarget(currentModelPath, inheritedPath);
    const targetEntry = modelParts.get(normalizeZipPath(resolvedPath));
    if (targetEntry) {
      const objectEl = findObjectById(targetEntry.doc, objectId);
      if (objectEl) {
        return {
          componentEl,
          partPath: normalizeZipPath(resolvedPath),
          objectId,
          objectEl,
          resolutionSource: "ancestor-path",
        };
      }
    }
  }

  const samePartEntry = modelParts.get(normalizeZipPath(currentModelPath));
  if (samePartEntry) {
    const objectEl = findObjectById(samePartEntry.doc, objectId);
    if (objectEl) {
      return {
        componentEl,
        partPath: normalizeZipPath(currentModelPath),
        objectId,
        objectEl,
        resolutionSource: "same-part",
      };
    }
  }

  const matches: ResolvedComponentObject[] = [];
  for (const [partPath, entry] of modelParts) {
    const objectEl = findObjectById(entry.doc, objectId);
    if (!objectEl) continue;
    matches.push({
      componentEl,
      partPath,
      objectId,
      objectEl,
      resolutionSource: "global-objectid-scan",
    });
  }

  if (matches.length === 1) return matches[0];

  const namedMatches = matches.filter((m) => !!getObjectDisplayNameFromObjectEl(m.objectEl).name);
  if (namedMatches.length === 1) return namedMatches[0];

  return null;
}

function removeElement(el: Element | null | undefined) {
  if (el?.parentNode) {
    el.parentNode.removeChild(el);
  }
}

function findPartElementInModelSettings(
  modelSettingsDoc: XMLDocument | null,
  rootObjectId: string,
  partId: string,
): Element | null {
  const objectEl = getModelSettingsObjectElement(modelSettingsDoc, rootObjectId);
  if (!objectEl) return null;
  const partEls = getElementsByLocalName(objectEl, "part");
  return partEls.find((partEl) => (partEl.getAttribute("id") ?? "").trim() === partId) ?? null;
}

function nextNumericIdFromElements(elements: Element[], attrName = "id"): number {
  let maxId = 0;
  for (const el of elements) {
    const raw = (el.getAttribute(attrName) ?? "").trim();
    const n = Number(raw);
    if (Number.isInteger(n) && n > maxId) maxId = n;
  }
  return maxId + 1;
}

function formatXmlNumber(v: number): string {
  const n = Math.abs(v) < 1e-12 ? 0 : v;
  const s = Number(n).toFixed(9);
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function normalizeChildPartKind(kind: ThreeMfChildPartKind | undefined): ThreeMfChildPartKind {
  return kind === "negative" ? "negative" : "normal";
}

function partKindToModelSettingsSubtype(kind: ThreeMfChildPartKind): string {
  return kind === "negative" ? "negative_part" : "normal_part";
}

function getFirstDirectChildByLocalName(parent: Element, localName: string): Element | null {
  for (const child of Array.from(parent.children)) {
    const childLocal = child.localName || child.tagName.split(":").pop() || child.tagName;
    if (childLocal === localName) return child;
  }
  return null;
}

function getOrCreateResourcesElement(doc: XMLDocument): Element {
  const modelEl = getElementsByLocalName(doc, "model")[0] || doc.documentElement;
  const existing = getFirstDirectChildByLocalName(modelEl, "resources");
  if (existing) return existing;

  const resourcesEl = doc.createElementNS(modelEl.namespaceURI, "resources");
  const buildEl = getFirstDirectChildByLocalName(modelEl, "build");
  if (buildEl) modelEl.insertBefore(resourcesEl, buildEl);
  else modelEl.appendChild(resourcesEl);
  return resourcesEl;
}

function setOrCreateMetadataValue(parentEl: Element, key: string, value: string) {
  const metadataEls = getElementsByLocalName(parentEl, "metadata");
  const hit = metadataEls.find((m) => ((getAttrOneOf(m, ["key", "name"]) ?? "").trim().toLowerCase() === key.toLowerCase()));
  if (hit) {
    if (hit.hasAttribute("value")) hit.setAttribute("value", value);
    else hit.textContent = value;
    return;
  }
  const doc = parentEl.ownerDocument!;
  const newEl = doc.createElementNS(parentEl.namespaceURI || doc.documentElement.namespaceURI, "metadata");
  newEl.setAttribute("key", key);
  newEl.setAttribute("value", value);
  parentEl.appendChild(newEl);
}

function getMetadataValue(parentEl: Element, key: string): string {
  const metadataEls = getElementsByLocalName(parentEl, "metadata");
  const hit = metadataEls.find((m) => ((getAttrOneOf(m, ["key", "name"]) ?? "").trim().toLowerCase() === key.toLowerCase()));
  return ((hit && getAttrOneOf(hit, ["value"])) ?? hit?.textContent ?? "").trim();
}

function updateOrCreateMeshStatFaceCount(partEl: Element, faceCount: number) {
  const meshStatEls = getElementsByLocalName(partEl, "mesh_stat");
  const meshStat = meshStatEls[0];
  if (meshStat) {
    meshStat.setAttribute("face_count", String(faceCount));
    return;
  }
  const doc = partEl.ownerDocument!;
  const newEl = doc.createElementNS(partEl.namespaceURI || doc.documentElement.namespaceURI, "mesh_stat");
  newEl.setAttribute("face_count", String(faceCount));
  newEl.setAttribute("edges_fixed", "0");
  newEl.setAttribute("degenerate_facets", "0");
  newEl.setAttribute("facets_removed", "0");
  newEl.setAttribute("facets_reversed", "0");
  newEl.setAttribute("backwards_edges", "0");
  partEl.appendChild(newEl);
}

function normalizeMeshData(mesh: ThreeMfMeshData): { positions: Float32Array; indices: Uint32Array } {
  const positions = Float32Array.from(Array.from(mesh.positions, Number));
  const indices = Uint32Array.from(Array.from(mesh.indices, Number));

  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error(`非法 mesh.positions 长度: ${positions.length}`);
  }
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new Error(`非法 mesh.indices 长度: ${indices.length}`);
  }

  const vertexCount = positions.length / 3;
  for (let i = 0; i < indices.length; i++) {
    if (!Number.isInteger(indices[i]) || indices[i] < 0 || indices[i] >= vertexCount) {
      throw new Error(`mesh.indices[${i}] 越界: ${indices[i]} / vertexCount=${vertexCount}`);
    }
  }

  return { positions, indices };
}

function getCachedLayerConfigRangesDoc(ctx: unknown): XMLDocument | null {
  return ((ctx as any)[LAYER_CONFIG_RANGES_CACHE_KEY] as XMLDocument | null | undefined) ?? null;
}

function setCachedLayerConfigRangesDoc(ctx: unknown, doc: XMLDocument | null) {
  (ctx as any)[LAYER_CONFIG_RANGES_CACHE_KEY] = doc;
}

function buildHeightRangeOptions(
  userOptions: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  // 这一组是按你给我的“有高度范围修改器.3mf”样本整理的最小稳妥默认值
  // 用户传入的值优先级更高，会覆盖这些默认值
  return {
    bottom_color_penetration_layers: 3,
    extruder: 0,
    infill_direction: 45,
    inner_wall_line_width: 0.45,
    layer_height: 0.2,
    skeleton_infill_density: "15%",
    skeleton_infill_line_width: 0.45,
    skin_infill_density: "15%",
    skin_infill_line_width: 0.45,
    sparse_infill_density: "15%",
    sparse_infill_line_width: 0.45,
    sparse_infill_pattern: "grid",
    top_color_penetration_layers: 5,
    top_shell_layers: 5,
    wall_loops: 2,
    ...userOptions,
  };
}

export function meshDataFromBufferGeometry(geometry: BufferGeometry, name?: string): ThreeMfMeshData {
  const positionAttr = geometry.getAttribute("position") as any;
  if (!positionAttr || positionAttr.itemSize !== 3) {
    throw new Error("geometry 缺少合法的 position attribute");
  }

  const positions = Float32Array.from(Array.from(positionAttr.array as ArrayLike<number>, Number));
  let indices: Uint32Array;

  const indexAttr = geometry.getIndex() as any;
  if (indexAttr) {
    indices = Uint32Array.from(Array.from(indexAttr.array as ArrayLike<number>, Number));
  } else {
    const vertexCount = positionAttr.count as number;
    if (vertexCount % 3 !== 0) {
      throw new Error(`non-indexed geometry 顶点数不是 3 的倍数: ${vertexCount}`);
    }
    indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) indices[i] = i;
  }

  return { positions, indices, name };
}

function createObjectElementFromMesh(
  doc: XMLDocument,
  objectId: number,
  mesh: { positions: Float32Array; indices: Uint32Array },
  childName: string,
): Element {
  const ns = doc.documentElement.namespaceURI;
  const objectEl = doc.createElementNS(ns, "object");
  objectEl.setAttribute("id", String(objectId));
  objectEl.setAttribute("type", "model");
  objectEl.setAttribute("name", childName);

  const meshEl = doc.createElementNS(ns, "mesh");
  const verticesEl = doc.createElementNS(ns, "vertices");
  const trianglesEl = doc.createElementNS(ns, "triangles");

  for (let i = 0; i < mesh.positions.length; i += 3) {
    const vertexEl = doc.createElementNS(ns, "vertex");
    vertexEl.setAttribute("x", formatXmlNumber(mesh.positions[i + 0]));
    vertexEl.setAttribute("y", formatXmlNumber(mesh.positions[i + 1]));
    vertexEl.setAttribute("z", formatXmlNumber(mesh.positions[i + 2]));
    verticesEl.appendChild(vertexEl);
  }

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const triEl = doc.createElementNS(ns, "triangle");
    triEl.setAttribute("v1", String(mesh.indices[i + 0]));
    triEl.setAttribute("v2", String(mesh.indices[i + 1]));
    triEl.setAttribute("v3", String(mesh.indices[i + 2]));
    trianglesEl.appendChild(triEl);
  }

  meshEl.appendChild(verticesEl);
  meshEl.appendChild(trianglesEl);
  objectEl.appendChild(meshEl);
  return objectEl;
}

function makeComponentFromTemplate(templateEl: Element, newObjectId: number): Element {
  const newEl = templateEl.cloneNode(false) as Element;
  for (const attr of Array.from(newEl.attributes)) {
    const local = attr.localName || attr.name.split(":").pop() || attr.name;
    if (local.toLowerCase().includes("uuid")) {
      newEl.removeAttribute(attr.name);
    }
  }
  newEl.setAttribute("objectid", String(newObjectId));
  return newEl;
}

function computeNextSourceVolumeId(modelSettingsRootObjectEl: Element | null): number {
  if (!modelSettingsRootObjectEl) return 0;
  let maxId = -1;
  const partEls = getElementsByLocalName(modelSettingsRootObjectEl, "part");
  for (const partEl of partEls) {
    const raw = getMetadataValue(partEl, "source_volume_id");
    const n = Number(raw);
    if (Number.isInteger(n) && n > maxId) maxId = n;
  }
  return maxId + 1;
}

export class ThreeMfDocument {
  private constructor(
    private readonly zip: JSZip,
    private readonly modelParts: Map<string, XmlDocEntry>,
    private readonly primaryModelPath: string | null,
    private readonly modelSettingsDoc: XMLDocument | null,
  ) {}

  static async from(input: File | Blob | ArrayBuffer | Uint8Array): Promise<ThreeMfDocument> {
    const data = input instanceof ArrayBuffer || input instanceof Uint8Array ? input : await input.arrayBuffer();
    const zip = await JSZip.loadAsync(data);

    const primaryModelPath = await ThreeMfDocument.findPrimaryModelPath(zip);
    const modelParts = await ThreeMfDocument.loadAllModelParts(zip, primaryModelPath);
    if (modelParts.size === 0) {
      throw new Error("3MF 中没有找到任何 .model 文件");
    }

    const modelSettingsDoc = await ThreeMfDocument.loadOptionalXml(zip, MODEL_SETTINGS_CONFIG_PATH);
    return new ThreeMfDocument(zip, modelParts, primaryModelPath, modelSettingsDoc);
  }

  private static async loadOptionalXml(zip: JSZip, path: string): Promise<XMLDocument | null> {
    const file = zip.file(path);
    if (!file) return null;
    const text = await file.async("string");
    return parseXml(text, path);
  }

  private static async findPrimaryModelPath(zip: JSZip): Promise<string | null> {
    const relsFile = zip.file(RELS_PATH);
    if (!relsFile) return null;

    try {
      const xml = await relsFile.async("string");
      const doc = parseXml(xml, RELS_PATH);
      const rels = getElementsByLocalName(doc, "Relationship");
      const startRel = rels.find((rel) => rel.getAttribute("Type") === START_PART_REL_TYPE);
      const target = startRel?.getAttribute("Target");
      if (!target) return null;
      return resolveOpcTarget("/", target);
    } catch {
      return null;
    }
  }

  private static async findAllModelPaths(zip: JSZip, primaryModelPath: string | null): Promise<string[]> {
    const all = new Set<string>();
    if (primaryModelPath) all.add(normalizeZipPath(primaryModelPath));

    zip.forEach((relativePath, entry) => {
      if (!entry.dir && relativePath.toLowerCase().endsWith(".model")) {
        all.add(normalizeZipPath(relativePath));
      }
    });

    return Array.from(all);
  }

  private static async loadAllModelParts(zip: JSZip, primaryModelPath: string | null): Promise<Map<string, XmlDocEntry>> {
    const map = new Map<string, XmlDocEntry>();
    const modelPaths = await ThreeMfDocument.findAllModelPaths(zip, primaryModelPath);

    for (const path of modelPaths) {
      const file = zip.file(path);
      if (!file) continue;
      const xml = await file.async("string");
      map.set(path, { path, doc: parseXml(xml, path) });
    }
    return map;
  }

  getPrimaryModelPath(): string | null {
    return this.primaryModelPath;
  }

  getModelParts(): ThreeMfModelPartInfo[] {
    return Array.from(this.modelParts.values()).map(({ path, doc }) => ({
      path,
      xml: doc,
      ...getModelStats(doc),
    }));
  }

  getModelXml(path?: string): XMLDocument {
    if (!path) {
      const first = Array.from(this.modelParts.values())[0];
      if (!first) throw new Error("没有可用的 model XML");
      return first.doc;
    }

    const hit = this.modelParts.get(normalizeZipPath(path));
    if (!hit) throw new Error(`未找到 model part: ${path}`);
    return hit.doc;
  }

  getModelSettingsXml(): XMLDocument | null {
    return this.modelSettingsDoc;
  }

  /**
   * 计算主 3D/3dmodel.model 中唯一组合对象的所有子对象（递归展开后的并集）包围盒。
   * 默认返回组合对象局部坐标系中的结果；若 includeBuildItemTransform=true，
   * 则会把唯一 build/item 的 transform 也一起乘进去。
   */
  getCompositeChildrenUnionBoundingBox(
    options: CompositeChildrenUnionBoundingBoxOptions = {},
  ): ThreeMfBoundingBox {
    if (!this.primaryModelPath) {
      throw new Error("未找到主 model part，无法计算组合模型包围盒");
    }

    const primaryEntry = this.modelParts.get(normalizeZipPath(this.primaryModelPath));
    if (!primaryEntry) {
      throw new Error(`主 model part 不存在：${this.primaryModelPath}`);
    }

    const primaryDoc = primaryEntry.doc;
    const rootObjects = getElementsByLocalName(primaryDoc, "object");
    const buildItems = getElementsByLocalName(primaryDoc, "item");
    if (rootObjects.length !== 1 || buildItems.length !== 1) {
      throw new Error(`预期主 model 中只有 1 个 object 和 1 个 build/item，实际 object=${rootObjects.length}, item=${buildItems.length}`);
    }

    const rootObject = rootObjects[0];
    const componentEls = getElementsByLocalName(rootObject, "component");
    if (componentEls.length === 0) {
      throw new Error("唯一模型对象不是组合对象（未找到任何 component）");
    }

    let bbox: InternalBoundingBox | null = null;
    for (const componentEl of componentEls) {
      const resolved = resolveComponentObject(
        componentEl,
        rootObject,
        normalizeZipPath(this.primaryModelPath),
        this.modelParts,
      );
      if (!resolved) {
        const unresolvedObjectId = (componentEl.getAttribute("objectid") ?? "").trim();
        throw new Error(`无法解析主组合对象中的 component: objectid=${unresolvedObjectId || "<empty>"}`);
      }

      const childBox = computeObjectBoundingBoxRecursive(
        resolved.objectEl,
        resolved.partPath,
        this.modelParts,
      );
      if (!childBox) continue;

      const componentTransform = getTransform12OrIdentity(
        componentEl.getAttribute("transform"),
        `root component objectid=${resolved.objectId}`,
      );
      bbox = unionBoundingBoxes(bbox, transformBoundingBox(childBox, componentTransform));
    }

    if (!bbox) {
      throw new Error("未能从唯一组合对象的子对象中计算出有效包围盒");
    }

    if (options.includeBuildItemTransform) {
      const buildItemTransform = getTransform12OrIdentity(
        buildItems[0].getAttribute("transform"),
        "build/item",
      );
      bbox = transformBoundingBox(bbox, buildItemTransform);
    }

    return toPublicBoundingBox(bbox);
  }

  async apply(processor: ThreeMfProcessor): Promise<this> {
    await processor(this);
    return this;
  }

    private async getOrCreateLayerConfigRangesDoc(): Promise<XMLDocument> {
    const cached = getCachedLayerConfigRangesDoc(this);
    if (cached) return cached;

    const existing = this.zip.file(LAYER_CONFIG_RANGES_PATH);
    let doc: XMLDocument;

    if (existing) {
      const text = await existing.async("string");
      doc = parseXml(text, LAYER_CONFIG_RANGES_PATH);
    } else {
      doc = parseXml(
        '<?xml version="1.0" encoding="utf-8"?><objects></objects>',
        LAYER_CONFIG_RANGES_PATH,
      );
    }

    setCachedLayerConfigRangesDoc(this, doc);
    return doc;
  }

  /**
   * 给主 3D/3dmodel.model 中唯一组合对象的所有子对象增加相同的高度范围修改器。
   * 这会在 Metadata/layer_config_ranges.xml 中为每个 component.objectid 写入同一组 range。
   */
  async addHeightRangeModifier(options: HeightRangeModifierOptions): Promise<this> {
    const minZ = options.minZ;
    const maxZ = options.maxZ;

    if (!Number.isFinite(minZ) || !Number.isFinite(maxZ) || !(maxZ > minZ)) {
      throw new Error(`非法高度范围: minZ=${minZ}, maxZ=${maxZ}`);
    }

    if (!this.primaryModelPath) {
      throw new Error("未找到主 model part，无法添加高度范围修改器");
    }

    const primaryEntry = this.modelParts.get(normalizeZipPath(this.primaryModelPath));
    if (!primaryEntry) {
      throw new Error(`主 model part 不存在：${this.primaryModelPath}`);
    }

    const primaryDoc = primaryEntry.doc;
    const rootObjects = getElementsByLocalName(primaryDoc, "object");
    const buildItems = getElementsByLocalName(primaryDoc, "item");

    if (rootObjects.length !== 1 || buildItems.length !== 1) {
      throw new Error(
        `预期主 model 中只有 1 个 object 和 1 个 build/item，实际 object=${rootObjects.length}, item=${buildItems.length}`,
      );
    }

    const rootObject = rootObjects[0];
    const componentEls = getElementsByLocalName(rootObject, "component");
    if (componentEls.length === 0) {
      throw new Error("唯一模型对象不是组合对象（未找到任何 component）");
    }

    const targetObjectIds = Array.from(
      new Set(
        componentEls
          .map((componentEl) => (componentEl.getAttribute("objectid") ?? "").trim())
          .filter(Boolean),
      ),
    );

    if (targetObjectIds.length === 0) {
      throw new Error("未能解析出任何 component.objectid");
    }

    const layerDoc = await this.getOrCreateLayerConfigRangesDoc();
    const objectsRoot = layerDoc.documentElement;
    const replaceSameRange = options.replaceSameRange ?? true;

    for (const objectId of targetObjectIds) {
      let objectEl =
        getElementsByLocalName(layerDoc, "object").find(
          (el) => (el.getAttribute("id") ?? "").trim() === objectId,
        ) ?? null;

      if (!objectEl) {
        objectEl = layerDoc.createElement("object");
        objectEl.setAttribute("id", objectId);
        objectsRoot.appendChild(objectEl);
      }

      if (replaceSameRange) {
        const existingRanges = getElementsByLocalName(objectEl, "range");
        for (const rangeEl of existingRanges) {
          const existingMin = Number(rangeEl.getAttribute("min_z"));
          const existingMax = Number(rangeEl.getAttribute("max_z"));
          if (
            Number.isFinite(existingMin) &&
            Number.isFinite(existingMax) &&
            Math.abs(existingMin - minZ) < 1e-9 &&
            Math.abs(existingMax - maxZ) < 1e-9
          ) {
            removeElement(rangeEl);
          }
        }
      }

      const rangeEl = layerDoc.createElement("range");
      rangeEl.setAttribute("min_z", String(minZ));
      rangeEl.setAttribute("max_z", String(maxZ));

      const mergedSlicerOptions = buildHeightRangeOptions(options.slicerOptions);

      for (const [optKey, rawValue] of Object.entries(mergedSlicerOptions)) {
        const optionEl = layerDoc.createElement("option");
        optionEl.setAttribute("opt_key", optKey);
        optionEl.textContent =
          typeof rawValue === "boolean" ? (rawValue ? "1" : "0") : String(rawValue);
        rangeEl.appendChild(optionEl);
      }

      objectEl.appendChild(rangeEl);
    }

    // 直接回写到 zip，避免你去改现有 flushXmlBackToZip 的签名/字段
    this.zip.file(LAYER_CONFIG_RANGES_PATH, serializeXml(layerDoc));

    return this;
  }

  scaleAllModelInstances(options: ScaleProcessorOptions = {}): this {
    const xFactor = options.xFactor ?? 1;
    const yFactor = options.yFactor ?? 1;
    const zFactor = options.zFactor ?? 1;
    const includeComponentTransforms = options.includeComponentTransforms ?? false;

    for (const [axis, factor] of [["x", xFactor], ["y", yFactor], ["z", zFactor]] as const) {
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new Error(`非法 ${axis.toUpperCase()} 轴缩放系数: ${factor}`);
      }
    }

    for (const { doc } of this.modelParts.values()) {
      const items = getElementsByLocalName(doc, "item");
      for (const item of items) {
        this.scaleTransformAttribute(item, xFactor, yFactor, zFactor);
      }

      if (includeComponentTransforms) {
        const components = getElementsByLocalName(doc, "component");
        for (const component of components) {
          this.scaleTransformAttribute(component, xFactor, yFactor, zFactor);
        }
      }
    }

    return this;
  }

  /**
   * 按名称删除唯一组合对象中的任意子对象。
   * 名称优先从 model_settings.config 的 object -> part -> metadata[name] 读取；
   * 若没有，再回退到目标 object 的 name / metadata。
   */
  removeChildObjectsByName(targetName: string, options: RemoveChildByNameOptions = {}): this {
    const normalizedTargetName = targetName.trim();
    if (!normalizedTargetName) {
      throw new Error("targetName 不能为空");
    }

    const strict = options.strict ?? true;
    const removeModelSettingsPart = options.removeModelSettingsPart ?? true;
    const removeReferencedObject = options.removeReferencedObject ?? true;

    if (!this.primaryModelPath) {
      throw new Error(`未找到主 model part，无法删除名称为 ${normalizedTargetName} 的子对象`);
    }

    const primaryEntry = this.modelParts.get(normalizeZipPath(this.primaryModelPath));
    if (!primaryEntry) {
      throw new Error(`主 model part 不存在：${this.primaryModelPath}`);
    }

    const primaryDoc = primaryEntry.doc;
    const rootObjects = getElementsByLocalName(primaryDoc, "object");
    const buildItems = getElementsByLocalName(primaryDoc, "item");
    if (rootObjects.length !== 1 || buildItems.length !== 1) {
      throw new Error(`预期主 model 中只有 1 个 object 和 1 个 build/item，实际 object=${rootObjects.length}, item=${buildItems.length}`);
    }

    const rootObject = rootObjects[0];
    const rootObjectId = (rootObject.getAttribute("id") ?? "").trim();
    if (!rootObjectId) {
      throw new Error("主组合对象缺少 id");
    }

    const componentElements = getElementsByLocalName(rootObject, "component");
    if (componentElements.length === 0) {
      throw new Error("唯一模型对象不是组合对象（未找到任何 component）");
    }

    const settingsPartNameMap = buildModelSettingsPartNameMap(this.modelSettingsDoc);
    const partNameByComponentId = settingsPartNameMap.get(rootObjectId) ?? new Map<string, string>();

    const resolvedComponents = componentElements.map((componentEl) => {
      const resolved = resolveComponentObject(componentEl, rootObject, normalizeZipPath(this.primaryModelPath!), this.modelParts);
      if (!resolved) {
        return null;
      }
      const directNameInfo = getObjectDisplayNameFromObjectEl(resolved.objectEl);
      const settingsName = partNameByComponentId.get(resolved.objectId) ?? "";
      const finalName = directNameInfo.name || settingsName;
      return {
        ...resolved,
        finalName,
        finalSource: directNameInfo.name
          ? directNameInfo.source
          : (settingsName ? `model_settings.config object=${rootObjectId} part=${resolved.objectId}` : "none"),
      };
    }).filter(Boolean) as Array<ResolvedComponentObject & { finalName: string; finalSource: string }>;

    const matches = resolvedComponents.filter((item) => item.finalName === normalizedTargetName);

    if (strict && matches.length !== 1) {
      throw new Error(`预期且仅预期找到 1 个名称为 ${normalizedTargetName} 的子对象，实际为 ${matches.length}`);
    }
    if (!strict && matches.length === 0) {
      return this;
    }

    for (const match of matches) {
      removeElement(match.componentEl);

      if (removeReferencedObject) {
        removeElement(match.objectEl);
      }

      if (removeModelSettingsPart) {
        const partEl = findPartElementInModelSettings(this.modelSettingsDoc, rootObjectId, match.objectId);
        removeElement(partEl);
      }
    }

    return this;
  }

  addChildObject(options: AddChildObjectOptions): this {
    const childName = options.childName.trim();
    if (!childName) throw new Error("childName 不能为空");

    const partKind = normalizeChildPartKind(options.partKind);
    const mesh = normalizeMeshData(options.mesh);

    if (!this.primaryModelPath) {
      throw new Error("未找到主 model part，无法添加子对象");
    }

    const primaryEntry = this.modelParts.get(normalizeZipPath(this.primaryModelPath));
    if (!primaryEntry) {
      throw new Error(`主 model part 不存在：${this.primaryModelPath}`);
    }

    const primaryDoc = primaryEntry.doc;
    const rootObjects = getElementsByLocalName(primaryDoc, "object");
    const buildItems = getElementsByLocalName(primaryDoc, "item");
    if (rootObjects.length !== 1 || buildItems.length !== 1) {
      throw new Error(`预期主 model 中只有 1 个 object 和 1 个 build/item，实际 object=${rootObjects.length}, item=${buildItems.length}`);
    }

    const rootObject = rootObjects[0];
    const rootObjectId = (rootObject.getAttribute("id") ?? "").trim();
    if (!rootObjectId) throw new Error("主组合对象缺少 id");

    const componentElements = getElementsByLocalName(rootObject, "component");
    if (componentElements.length === 0) {
      throw new Error("唯一模型对象不是组合对象（未找到任何 component）");
    }

    const resolvedComponents = componentElements
      .map((componentEl) => resolveComponentObject(componentEl, rootObject, normalizeZipPath(this.primaryModelPath!), this.modelParts))
      .filter(Boolean) as ResolvedComponentObject[];

    if (resolvedComponents.length !== componentElements.length) {
      throw new Error("存在无法解析到目标 object 的 component，无法安全添加新子对象");
    }

    const distinctPartPaths = Array.from(new Set(resolvedComponents.map((r) => normalizeZipPath(r.partPath))));
    if (distinctPartPaths.length !== 1) {
      throw new Error(`预期所有 component 都指向同一个子 model part，实际为: ${distinctPartPaths.join(", ")}`);
    }

    const targetPartPath = distinctPartPaths[0];
    const targetEntry = this.modelParts.get(targetPartPath);
    if (!targetEntry) {
      throw new Error(`未找到被组合对象引用的子 model part: ${targetPartPath}`);
    }

    const targetDoc = targetEntry.doc;
    const targetResourcesEl = getOrCreateResourcesElement(targetDoc);
    const existingTargetObjects = getElementsByLocalName(targetDoc, "object");
    const newObjectId = nextNumericIdFromElements(existingTargetObjects, "id");

    const newObjectEl = createObjectElementFromMesh(targetDoc, newObjectId, mesh, childName);
    targetResourcesEl.appendChild(newObjectEl);

    const templateComponentEl = componentElements[0];
    const newComponentEl = makeComponentFromTemplate(templateComponentEl, newObjectId);
    rootObject.appendChild(newComponentEl);

    const modelSettingsRootObjectEl = getModelSettingsObjectElement(this.modelSettingsDoc, rootObjectId);
    if (modelSettingsRootObjectEl) {
      const partEls = getElementsByLocalName(modelSettingsRootObjectEl, "part");
      const templatePartEl = partEls[0] ?? null;
      const newPartEl = templatePartEl
        ? (templatePartEl.cloneNode(true) as Element)
        : this.modelSettingsDoc!.createElement("part");

      newPartEl.setAttribute("id", String(newObjectId));
      newPartEl.setAttribute("subtype", partKindToModelSettingsSubtype(partKind));

      setOrCreateMetadataValue(newPartEl, "name", childName);
      setOrCreateMetadataValue(newPartEl, "source_volume_id", String(computeNextSourceVolumeId(modelSettingsRootObjectEl)));
      updateOrCreateMeshStatFaceCount(newPartEl, mesh.indices.length / 3);

      modelSettingsRootObjectEl.appendChild(newPartEl);

      const rootFaceCountMeta = getElementsByLocalName(modelSettingsRootObjectEl, "metadata").find((m) => m.hasAttribute("face_count"));
      if (rootFaceCountMeta) {
        const current = Number(rootFaceCountMeta.getAttribute("face_count") ?? "0");
        if (Number.isFinite(current)) {
          rootFaceCountMeta.setAttribute("face_count", String(current + mesh.indices.length / 3));
        }
      }
    }

    return this;
  }

  addChildObjectFromGeometry(options: AddChildObjectFromGeometryOptions): this {
    const mesh = meshDataFromBufferGeometry(options.geometry, options.childName);
    return this.addChildObject({
      childName: options.childName,
      mesh,
      partKind: options.partKind,
    });
  }

  addNegativeChildObject(options: Omit<AddChildObjectOptions, "partKind">): this {
    return this.addChildObject({ ...options, partKind: "negative" });
  }

  addNegativeChildObjectFromGeometry(options: Omit<AddChildObjectFromGeometryOptions, "partKind">): this {
    return this.addChildObjectFromGeometry({ ...options, partKind: "negative" });
  }

  /** 向后兼容旧接口：删除名称为 Backing 的子对象 */
  removeBackingChildObject(options: RemoveBackingOptions = {}): this {
    return this.removeChildObjectsByName("Backing", options);
  }

  static processors = {
    scaleAllModelInstances:
      (options: ScaleProcessorOptions = {}): ThreeMfProcessor =>
      async (ctx) => {
        ctx.scaleAllModelInstances(options);
      },

    removeChildObjectsByName:
      (targetName: string, options: RemoveChildByNameOptions = {}): ThreeMfProcessor =>
      async (ctx) => {
        ctx.removeChildObjectsByName(targetName, options);
      },

    addChildObject:
      (options: AddChildObjectOptions): ThreeMfProcessor =>
      async (ctx) => {
        ctx.addChildObject(options);
      },

    addChildObjectFromGeometry:
      (options: AddChildObjectFromGeometryOptions): ThreeMfProcessor =>
      async (ctx) => {
        ctx.addChildObjectFromGeometry(options);
      },

    addNegativeChildObject:
      (options: Omit<AddChildObjectOptions, "partKind">): ThreeMfProcessor =>
      async (ctx) => {
        ctx.addNegativeChildObject(options);
      },

    addNegativeChildObjectFromGeometry:
      (options: Omit<AddChildObjectFromGeometryOptions, "partKind">): ThreeMfProcessor =>
      async (ctx) => {
        ctx.addNegativeChildObjectFromGeometry(options);
      },

    removeBackingChildObject:
      (options: RemoveBackingOptions = {}): ThreeMfProcessor =>
      async (ctx) => {
        ctx.removeChildObjectsByName("Backing", options);
      },

    addHeightRangeModifier:
      (options: HeightRangeModifierOptions): ThreeMfProcessor =>
      async (ctx) => {
        await ctx.addHeightRangeModifier(options);
      },
  };

  private scaleTransformAttribute(element: Element, xFactor: number, yFactor: number, zFactor: number) {
    const current = element.getAttribute("transform");
    const parsed = parseTransform12(current);
    if (parsed) {
      element.setAttribute(
        "transform",
        formatTransform12(scaleTransformLinearPartByAxes(parsed, xFactor, yFactor, zFactor)),
      );
      return;
    }
    element.setAttribute("transform", makePureScaleTransformByAxes(xFactor, yFactor, zFactor));
  }

  async toUint8Array(): Promise<Uint8Array> {
    this.flushXmlBackToZip();
    return this.zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  async toBlob(): Promise<Blob> {
    this.flushXmlBackToZip();
    return this.zip.generateAsync({
      type: "blob",
      mimeType: "model/3mf",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  async download(fileName: string) {
    const blob = await this.toBlob();
    downloadBlob(blob, fileName);
  }

  private flushXmlBackToZip() {
    for (const { path, doc } of this.modelParts.values()) {
      this.zip.file(path, serializeXml(doc));
    }
    if (this.modelSettingsDoc) {
      this.zip.file(MODEL_SETTINGS_CONFIG_PATH, serializeXml(this.modelSettingsDoc));
    }
  }
}

export async function parseThreeMf(input: File | Blob | ArrayBuffer | Uint8Array) {
  return ThreeMfDocument.from(input);
}

export async function processThreeMf(
  input: File | Blob | ArrayBuffer | Uint8Array,
  processors: ThreeMfProcessor[],
) {
  const doc = await ThreeMfDocument.from(input);
  for (const processor of processors) {
    await doc.apply(processor);
  }
  return doc;
}
export async function removeChildObjectsByNameAndDownload(
  input: File | Blob | ArrayBuffer | Uint8Array,
  targetName: string,
  outputFileName = "removed-child.3mf",
  options: RemoveChildByNameOptions = {},
) {
  const doc = await processThreeMf(input, [
    ThreeMfDocument.processors.removeChildObjectsByName(targetName, options),
  ]);
  await doc.download(outputFileName);
}

export async function removeBackingChildAndDownload(
  input: File | Blob | ArrayBuffer | Uint8Array,
  outputFileName = "removed-backing.3mf",
  options: RemoveBackingOptions = {},
) {
  await removeChildObjectsByNameAndDownload(input, "Backing", outputFileName, options);
}

export async function getCompositeChildrenUnionBoundingBoxFrom3mf(
  input: File | Blob | ArrayBuffer | Uint8Array,
  options: CompositeChildrenUnionBoundingBoxOptions = {},
): Promise<ThreeMfBoundingBox> {
  const doc = await parseThreeMf(input);
  return doc.getCompositeChildrenUnionBoundingBox(options);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
