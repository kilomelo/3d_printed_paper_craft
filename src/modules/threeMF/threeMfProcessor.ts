import JSZip from "jszip";
import type { BufferGeometry } from "three";

/**
 * 面向浏览器前端的 3MF 处理工具：
 * - 解析 3MF ZIP / OPC 容器
 * - 提供可组合的处理器（processor）
 * - 重新导出并下载
 *
 * 当前内置处理器：
 * 1. 把所有模型实例缩放到 200%
 * 2. 按名称删除唯一组合对象中的任意子对象
 *
 * 依赖：npm i jszip
 */

const RELS_PATH = "_rels/.rels";
const START_PART_REL_TYPE = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const MODEL_SETTINGS_CONFIG_PATH = "Metadata/model_settings.config";

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
  /** 默认 2，即 200% */
  factor?: number;
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

export type AddChildObjectOptions = {
  childName: string;
  mesh: ThreeMfMeshData;
};

export type AddChildObjectFromGeometryOptions = {
  childName: string;
  geometry: BufferGeometry;
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
function scaleTransformLinearPart(m: number[], factor: number): number[] {
  return [
    m[0] * factor, m[1] * factor, m[2] * factor,
    m[3] * factor, m[4] * factor, m[5] * factor,
    m[6] * factor, m[7] * factor, m[8] * factor,
    m[9], m[10], m[11],
  ];
}

function makePureScaleTransform(factor: number): string {
  return formatTransform12([
    factor, 0, 0,
    0, factor, 0,
    0, 0, factor,
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

  async apply(processor: ThreeMfProcessor): Promise<this> {
    await processor(this);
    return this;
  }

  scaleAllModelInstances(options: ScaleProcessorOptions = {}): this {
    const factor = options.factor ?? 2;
    const includeComponentTransforms = options.includeComponentTransforms ?? false;

    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`非法缩放系数: ${factor}`);
    }

    for (const { doc } of this.modelParts.values()) {
      const items = getElementsByLocalName(doc, "item");
      for (const item of items) {
        this.scaleTransformAttribute(item, factor);
      }

      if (includeComponentTransforms) {
        const components = getElementsByLocalName(doc, "component");
        for (const component of components) {
          this.scaleTransformAttribute(component, factor);
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
      if (!newPartEl.getAttribute("subtype")) newPartEl.setAttribute("subtype", "normal_part");

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
    return this.addChildObject({ childName: options.childName, mesh });
  }

  /** 向后兼容旧接口：删除名称为 Backing 的子对象 */
  removeBackingChildObject(options: RemoveBackingOptions = {}): this {
    return this.removeChildObjectsByName("Backing", options);
  }

  static processors = {
    scaleAllModelInstances200Percent:
      (options: Omit<ScaleProcessorOptions, "factor"> = {}): ThreeMfProcessor =>
      async (ctx) => {
        ctx.scaleAllModelInstances({ factor: 2, ...options });
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

    removeBackingChildObject:
      (options: RemoveBackingOptions = {}): ThreeMfProcessor =>
      async (ctx) => {
        ctx.removeChildObjectsByName("Backing", options);
      },
  };

  private scaleTransformAttribute(element: Element, factor: number) {
    const current = element.getAttribute("transform");
    const parsed = parseTransform12(current);
    if (parsed) {
      element.setAttribute("transform", formatTransform12(scaleTransformLinearPart(parsed, factor)));
      return;
    }
    element.setAttribute("transform", makePureScaleTransform(factor));
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

export async function scale3mfTo200PercentAndDownload(
  input: File | Blob | ArrayBuffer | Uint8Array,
  outputFileName = "scaled-200.3mf",
  options: Omit<ScaleProcessorOptions, "factor"> = {},
) {
  const doc = await processThreeMf(input, [
    ThreeMfDocument.processors.scaleAllModelInstances200Percent(options),
  ]);
  await doc.download(outputFileName);
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

export async function addChildObjectAndDownload(
  input: File | Blob | ArrayBuffer | Uint8Array,
  childName: string,
  mesh: ThreeMfMeshData,
  outputFileName = "with-added-child.3mf",
) {
  const doc = await processThreeMf(input, [
    ThreeMfDocument.processors.addChildObject({ childName, mesh }),
  ]);
  await doc.download(outputFileName);
}

export async function addChildObjectFromGeometryAndDownload(
  input: File | Blob | ArrayBuffer | Uint8Array,
  childName: string,
  geometry: BufferGeometry,
  outputFileName = "with-added-child.3mf",
) {
  const doc = await processThreeMf(input, [
    ThreeMfDocument.processors.addChildObjectFromGeometry({ childName, geometry }),
  ]);
  await doc.download(outputFileName);
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
