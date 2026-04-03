import type { BufferGeometry } from "three";
import type {
  ThreeMfBoundingBox,
  ThreeMfChildPartKind,
  ThreeMfMeshData,
  ThreeMfVector3,
  XmlDocEntry,
} from "./threeMfProcessor";

const IDENTITY_TRANSFORM_12: readonly number[] = Object.freeze([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
  0, 0, 0,
]);

const LAYER_CONFIG_RANGES_CACHE_KEY = "__layerConfigRangesDocCache";

export type DisplayNameInfo = {
  name: string;
  source: string;
};

export type ResolvedComponentObject = {
  componentEl: Element;
  objectId: string;
  partPath: string;
  objectEl: Element;
  resolutionSource: string;
};

export type InternalBoundingBox = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

function identityTransform12(): number[] {
  return [...IDENTITY_TRANSFORM_12];
}

export function getTransform12OrIdentity(transform: string | null | undefined, context: string): number[] {
  if (!transform || !transform.trim()) return identityTransform12();
  const parsed = parseTransform12(transform);
  if (!parsed) {
    throw new Error(`非法 transform（${context}）: ${transform}`);
  }
  return parsed;
}

function transformPointBy12(m: number[], x: number, y: number, z: number): ThreeMfVector3 {
  return {
    x: m[0] * x + m[1] * y + m[2] * z + m[9],
    y: m[3] * x + m[4] * y + m[5] * z + m[10],
    z: m[6] * x + m[7] * y + m[8] * z + m[11],
  };
}

export function unionBoundingBoxes(a: InternalBoundingBox | null, b: InternalBoundingBox | null): InternalBoundingBox | null {
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

export function transformBoundingBox(bbox: InternalBoundingBox, transform: number[]): InternalBoundingBox {
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

export function toPublicBoundingBox(bbox: InternalBoundingBox): ThreeMfBoundingBox {
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

export function computeObjectBoundingBoxRecursive(
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

export function parseXml(text: string, pathForError: string): XMLDocument {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`无法解析 XML: ${pathForError}`);
  }
  return doc;
}

export function serializeXml(doc: XMLDocument): string {
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith("<?xml") ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

export function normalizeZipPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\\/g, "/");
}

function dirname(path: string): string {
  const normalized = normalizeZipPath(path);
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx + 1) : "";
}

export function resolveOpcTarget(basePartPath: string, target: string): string {
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

export function getElementsByLocalName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

export function getAttrOneOf(el: Element, names: string[]): string | null {
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

export function findObjectById(doc: XMLDocument, objectId: string): Element | null {
  const objects = getElementsByLocalName(doc, "object");
  return objects.find((obj) => (obj.getAttribute("id") ?? "").trim() === objectId) ?? null;
}

export function parseTransform12(transform: string | null | undefined): number[] | null {
  if (!transform) return null;
  const nums = transform.trim().split(/\s+/).map((v) => Number(v));
  if (nums.length !== 12 || nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

export function formatTransform12(m: number[]): string {
  return m.map((v) => {
    const s = Number(Math.abs(v) < 1e-12 ? 0 : v).toFixed(12);
    return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }).join(" ");
}

export function scaleTransformLinearPartByAxes(m: number[], xFactor: number, yFactor: number, zFactor: number): number[] {
  return [
    m[0] * xFactor, m[1] * yFactor, m[2] * zFactor,
    m[3] * xFactor, m[4] * yFactor, m[5] * zFactor,
    m[6] * xFactor, m[7] * yFactor, m[8] * zFactor,
    m[9], m[10], m[11],
  ];
}

export function makePureScaleTransformByAxes(xFactor: number, yFactor: number, zFactor: number): string {
  return formatTransform12([
    xFactor, 0, 0,
    0, yFactor, 0,
    0, 0, zFactor,
    0, 0, 0,
  ]);
}

export function getModelStats(doc: XMLDocument) {
  const model = getElementsByLocalName(doc, "model")[0];
  return {
    objectCount: getElementsByLocalName(doc, "object").length,
    buildItemCount: getElementsByLocalName(doc, "item").length,
    unit: model?.getAttribute("unit") ?? null,
  };
}

export function getObjectDisplayNameFromObjectEl(objectEl: Element): DisplayNameInfo {
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

export function buildModelSettingsPartNameMap(doc: XMLDocument | null): Map<string, Map<string, string>> {
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

export function getModelSettingsObjectElement(doc: XMLDocument | null, rootObjectId: string): Element | null {
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

export function resolveComponentObject(
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

export function removeElement(el: Element | null | undefined) {
  if (el?.parentNode) {
    el.parentNode.removeChild(el);
  }
}

export function findPartElementInModelSettings(
  modelSettingsDoc: XMLDocument | null,
  rootObjectId: string,
  partId: string,
): Element | null {
  const objectEl = getModelSettingsObjectElement(modelSettingsDoc, rootObjectId);
  if (!objectEl) return null;
  const partEls = getElementsByLocalName(objectEl, "part");
  return partEls.find((partEl) => (partEl.getAttribute("id") ?? "").trim() === partId) ?? null;
}

export function nextNumericIdFromElements(elements: Element[], attrName = "id"): number {
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

export function normalizeChildPartKind(kind: ThreeMfChildPartKind | undefined): ThreeMfChildPartKind {
  return kind === "negative" ? "negative" : "normal";
}

export function partKindToModelSettingsSubtype(kind: ThreeMfChildPartKind): string {
  return kind === "negative" ? "negative_part" : "normal_part";
}

export function getFirstDirectChildByLocalName(parent: Element, localName: string): Element | null {
  for (const child of Array.from(parent.children)) {
    const childLocal = child.localName || child.tagName.split(":").pop() || child.tagName;
    if (childLocal === localName) return child;
  }
  return null;
}

export function getOrCreateResourcesElement(doc: XMLDocument): Element {
  const modelEl = getElementsByLocalName(doc, "model")[0] || doc.documentElement;
  const existing = getFirstDirectChildByLocalName(modelEl, "resources");
  if (existing) return existing;

  const resourcesEl = doc.createElementNS(modelEl.namespaceURI, "resources");
  const buildEl = getFirstDirectChildByLocalName(modelEl, "build");
  if (buildEl) modelEl.insertBefore(resourcesEl, buildEl);
  else modelEl.appendChild(resourcesEl);
  return resourcesEl;
}

export function setOrCreateMetadataValue(parentEl: Element, key: string, value: string) {
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

export function getMetadataValue(parentEl: Element, key: string): string {
  const metadataEls = getElementsByLocalName(parentEl, "metadata");
  const hit = metadataEls.find((m) => ((getAttrOneOf(m, ["key", "name"]) ?? "").trim().toLowerCase() === key.toLowerCase()));
  return ((hit && getAttrOneOf(hit, ["value"])) ?? hit?.textContent ?? "").trim();
}

export function updateOrCreateMeshStatFaceCount(partEl: Element, faceCount: number) {
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

export function normalizeMeshData(mesh: ThreeMfMeshData): { positions: Float32Array; indices: Uint32Array } {
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

export function getTopLevelModelSettingsObjectElement(modelSettingsDoc: XMLDocument, objectId: string): Element | null {
  const root = modelSettingsDoc.documentElement;
  const directChildren = Array.from(root.children).filter(
    (el): el is Element => el instanceof Element,
  );

  for (const el of directChildren) {
    if (el.localName !== "object") continue;
    if ((el.getAttribute("id") ?? "").trim() === objectId) {
      return el;
    }
  }

  return null;
}

export function setOrCreateModelSettingsMetadataValue(parent: Element, key: string, value: string) {
  const children = Array.from(parent.children).filter(
    (el): el is Element => el instanceof Element,
  );

  let target = children.find(
    (el) => el.localName === "metadata" && (el.getAttribute("key") ?? "").trim() === key,
  );

  if (!target) {
    target = parent.ownerDocument.createElement("metadata");
    target.setAttribute("key", key);
    parent.appendChild(target);
  }

  target.setAttribute("value", value);

  while (target.firstChild) {
    target.removeChild(target.firstChild);
  }
}

export function getCachedLayerConfigRangesDoc(ctx: unknown): XMLDocument | null {
  return ((ctx as Record<string, XMLDocument | null | undefined>)[LAYER_CONFIG_RANGES_CACHE_KEY]) ?? null;
}

export function setCachedLayerConfigRangesDoc(ctx: unknown, doc: XMLDocument | null) {
  (ctx as Record<string, XMLDocument | null | undefined>)[LAYER_CONFIG_RANGES_CACHE_KEY] = doc;
}

export function buildHeightRangeOptions(
  userOptions: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
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
  const positionAttr = geometry.getAttribute("position") as {
    itemSize: number;
    array: ArrayLike<number>;
    count: number;
  } | null;
  if (!positionAttr || positionAttr.itemSize !== 3) {
    throw new Error("geometry 缺少合法的 position attribute");
  }

  const positions = Float32Array.from(Array.from(positionAttr.array, Number));
  let indices: Uint32Array;

  const indexAttr = geometry.getIndex() as { array: ArrayLike<number> } | null;
  if (indexAttr) {
    indices = Uint32Array.from(Array.from(indexAttr.array, Number));
  } else {
    const vertexCount = positionAttr.count;
    if (vertexCount % 3 !== 0) {
      throw new Error(`non-indexed geometry 顶点数不是 3 的倍数: ${vertexCount}`);
    }
    indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) indices[i] = i;
  }

  return { positions, indices, name };
}

export function createObjectElementFromMesh(
  doc: XMLDocument,
  objectId: number,
  mesh: ThreeMfMeshData,
  childName: string,
): Element {
  const normalizedMesh = normalizeMeshData(mesh);
  const ns = doc.documentElement.namespaceURI;
  const objectEl = doc.createElementNS(ns, "object");
  objectEl.setAttribute("id", String(objectId));
  objectEl.setAttribute("type", "model");
  objectEl.setAttribute("name", childName);

  const meshEl = doc.createElementNS(ns, "mesh");
  const verticesEl = doc.createElementNS(ns, "vertices");
  const trianglesEl = doc.createElementNS(ns, "triangles");

  for (let i = 0; i < normalizedMesh.positions.length; i += 3) {
    const vertexEl = doc.createElementNS(ns, "vertex");
    vertexEl.setAttribute("x", formatXmlNumber(normalizedMesh.positions[i + 0]));
    vertexEl.setAttribute("y", formatXmlNumber(normalizedMesh.positions[i + 1]));
    vertexEl.setAttribute("z", formatXmlNumber(normalizedMesh.positions[i + 2]));
    verticesEl.appendChild(vertexEl);
  }

  for (let i = 0; i < normalizedMesh.indices.length; i += 3) {
    const triEl = doc.createElementNS(ns, "triangle");
    triEl.setAttribute("v1", String(normalizedMesh.indices[i + 0]));
    triEl.setAttribute("v2", String(normalizedMesh.indices[i + 1]));
    triEl.setAttribute("v3", String(normalizedMesh.indices[i + 2]));
    trianglesEl.appendChild(triEl);
  }

  meshEl.appendChild(verticesEl);
  meshEl.appendChild(trianglesEl);
  objectEl.appendChild(meshEl);
  return objectEl;
}

export function makeComponentFromTemplate(templateEl: Element, newObjectId: number): Element {
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

export function computeNextSourceVolumeId(modelSettingsRootObjectEl: Element | null): number {
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
