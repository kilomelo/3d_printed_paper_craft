import JSZip from "jszip";

/**
 * 检查用户导入的3mf文件是否符合要求
 * 如果用户按照预期的设置使用Lumina-Layers导出的3mf文件，则应满足以下要求：
 * 1、只包含一个盘
 * 2、唯一的盘里只有一个模型对象
 * 3、模型对象是组合对象
 * 4、组合对象至少有两个子对象
 * 5、子对象里有且仅有一个名称为 Backing
 * 
 * 注意：以上要求可能会随着Lumina-Layers的更新而变化
 */
const RELS_PATH = "_rels/.rels";
const START_PART_REL_TYPE = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const MODEL_SETTINGS_CONFIG_PATH = "Metadata/model_settings.config";
const PROJECT_SETTINGS_CONFIG_PATH = "Metadata/project_settings.config";

const DEBUG_PREFIX = "[3MF-VALIDATE]";

export enum ThreeMfExpectedStructureErrorCode {
  INVALID_PLATE_COUNT = "INVALID_PLATE_COUNT",
  INVALID_MODEL_OBJECT_COUNT = "INVALID_MODEL_OBJECT_COUNT",
  ROOT_OBJECT_NOT_COMPOSITE = "ROOT_OBJECT_NOT_COMPOSITE",
  COMPONENT_COUNT_TOO_SMALL = "COMPONENT_COUNT_TOO_SMALL",
  INVALID_BACKING_COUNT = "INVALID_BACKING_COUNT",

  PRIMARY_MODEL_NOT_FOUND = "PRIMARY_MODEL_NOT_FOUND",
  PRIMARY_MODEL_XML_INVALID = "PRIMARY_MODEL_XML_INVALID",
  REFERENCED_MODEL_NOT_FOUND = "REFERENCED_MODEL_NOT_FOUND",
  REFERENCED_OBJECT_NOT_FOUND = "REFERENCED_OBJECT_NOT_FOUND",
  PLATE_METADATA_NOT_FOUND = "PLATE_METADATA_NOT_FOUND",
}

export type ThreeMfExpectedStructureValidationResult =
  | {
      ok: true;
      plateCount: number;
      modelObjectCount: number;
      rootObjectId: string | null;
      componentCount: number;
      backingCount: number;
      primaryModelPath: string;
    }
  | {
      ok: false;
      code: ThreeMfExpectedStructureErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };

type XmlDocEntry = {
  path: string;
  doc: XMLDocument;
};

type PlateCountInfo = {
  count: number | null;
  source: string;
  details?: Record<string, unknown>;
};

type ResolvedComponentObject = {
  partPath: string;
  objectId: string;
  objectEl: Element;
  resolutionSource: string;
};

type DisplayNameInfo = {
  name: string;
  source: string;
  candidates?: string[];
};

function log(...args: unknown[]) {
  console.log(DEBUG_PREFIX, ...args);
}

function warn(...args: unknown[]) {
  console.warn(DEBUG_PREFIX, ...args);
}

function parseXml(text: string, pathForError: string): XMLDocument {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`无法解析 XML: ${pathForError}`);
  }
  return doc;
}

function tryParseXml(text: string, pathForError: string): XMLDocument | null {
  try {
    return parseXml(text, pathForError);
  } catch {
    return null;
  }
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
  return objects.find((obj) => obj.getAttribute("id") === objectId) ?? null;
}

async function findPrimaryModelPath(zip: JSZip): Promise<string | null> {
  const relsFile = zip.file(RELS_PATH);
  if (!relsFile) return null;

  const xml = await relsFile.async("string");
  const doc = parseXml(xml, RELS_PATH);
  const rels = getElementsByLocalName(doc, "Relationship");
  const startRel = rels.find((rel) => rel.getAttribute("Type") === START_PART_REL_TYPE);
  const target = startRel?.getAttribute("Target");
  if (!target) return null;
  return resolveOpcTarget("/", target);
}

async function loadAllModelParts(zip: JSZip): Promise<Map<string, XmlDocEntry>> {
  const map = new Map<string, XmlDocEntry>();
  const modelPaths: string[] = [];

  zip.forEach((relativePath, entry) => {
    if (!entry.dir && relativePath.toLowerCase().endsWith(".model")) {
      modelPaths.push(normalizeZipPath(relativePath));
    }
  });

  for (const path of modelPaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const doc = parseXml(xml, path);
    map.set(path, { path, doc });
  }

  return map;
}

function countPlatesFromExplicitMetadata(zip: JSZip): PlateCountInfo | null {
  const plateIds = new Set<string>();
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const match = normalizeZipPath(relativePath).match(/^Metadata\/plate_(\d+)\.json$/i);
    if (match) plateIds.add(match[1]);
  });

  if (plateIds.size === 0) return null;
  return {
    count: plateIds.size,
    source: "explicit-plate-json",
    details: { plateIds: Array.from(plateIds).sort() },
  };
}

async function loadOptionalXml(zip: JSZip, path: string): Promise<XMLDocument | null> {
  const file = zip.file(path);
  if (!file) return null;
  const text = await file.async("string");
  return tryParseXml(text, path);
}

function collectPlateIdsFromMetadataDoc(doc: XMLDocument): Set<string> {
  const plateIds = new Set<string>();

  const plateElements = getElementsByLocalName(doc, "plate");
  if (plateElements.length > 0) {
    plateElements.forEach((plateEl, index) => {
      const directId = getAttrOneOf(plateEl, ["id", "plate_id", "plater_id", "index"]);
      if (directId) {
        plateIds.add(String(directId));
        return;
      }

      const metadataEls = getElementsByLocalName(plateEl, "metadata");
      const metaId = metadataEls
        .map((m) => ({
          key: getAttrOneOf(m, ["key", "name"]),
          value: getAttrOneOf(m, ["value"]),
        }))
        .find((x) => x.key === "plater_id" || x.key === "plate_id");

      if (metaId?.value) {
        plateIds.add(String(metaId.value));
      } else {
        plateIds.add(`__index_${index}`);
      }
    });
    return plateIds;
  }

  const metadataEls = getElementsByLocalName(doc, "metadata");
  for (const m of metadataEls) {
    const key = getAttrOneOf(m, ["key", "name"]);
    const value = getAttrOneOf(m, ["value"]);
    if (!value) continue;
    if (key === "plater_id" || key === "plate_id") {
      plateIds.add(String(value));
    }
  }

  return plateIds;
}

async function countPlatesFromProjectMetadata(zip: JSZip): Promise<PlateCountInfo | null> {
  const explicit = countPlatesFromExplicitMetadata(zip);
  if (explicit) return explicit;

  const modelSettingsDoc = await loadOptionalXml(zip, MODEL_SETTINGS_CONFIG_PATH);
  if (modelSettingsDoc) {
    const plateIds = collectPlateIdsFromMetadataDoc(modelSettingsDoc);
    if (plateIds.size > 0) {
      return {
        count: plateIds.size,
        source: MODEL_SETTINGS_CONFIG_PATH,
        details: { plateIds: Array.from(plateIds).sort() },
      };
    }
  }

  const projectSettingsDoc = await loadOptionalXml(zip, PROJECT_SETTINGS_CONFIG_PATH);
  if (projectSettingsDoc) {
    const plateIds = collectPlateIdsFromMetadataDoc(projectSettingsDoc);
    if (plateIds.size > 0) {
      return {
        count: plateIds.size,
        source: PROJECT_SETTINGS_CONFIG_PATH,
        details: { plateIds: Array.from(plateIds).sort() },
      };
    }
  }

  return null;
}

function buildSettingsNameMap(doc: XMLDocument | null): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!doc) return map;

  const all = Array.from(doc.getElementsByTagName("*"));
  for (const el of all) {
    const id = (getAttrOneOf(el, ["id", "object_id", "objectid"]) ?? "").trim();
    if (!id) continue;

    const name = (
      getAttrOneOf(el, ["name", "object_name", "part_name", "label", "source_file", "filename"]) ??
      ""
    ).trim();
    if (!name) continue;

    const list = map.get(id) ?? [];
    if (!list.includes(name)) list.push(name);
    map.set(id, list);
  }
  return map;
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
        const nameMeta = metadataEls.find((m) => (getAttrOneOf(m, ["key", "name"]) ?? "").trim().toLowerCase() === "name");
        name = ((nameMeta && getAttrOneOf(nameMeta, ["value"])) ?? nameMeta?.textContent ?? "").trim();
      }

      if (name) {
        partMap.set(partId, name);
      }
    }

    if (partMap.size > 0) {
      rootMap.set(parentObjectId, partMap);
    }
  }

  return rootMap;
}

function getObjectDisplayNameFromObjectEl(objectEl: Element): DisplayNameInfo {
  const attrName = (objectEl.getAttribute("name") ?? "").trim();
  if (attrName) return { name: attrName, source: "object@name" };

  const metadataEls = getElementsByLocalName(objectEl, "metadata");
  const candidateValues: string[] = [];

  for (const m of metadataEls) {
    const rawKey = (getAttrOneOf(m, ["name", "key", "type"]) ?? "").trim().toLowerCase();
    const rawValue = (getAttrOneOf(m, ["value"]) ?? m.textContent ?? "").trim();
    if (!rawValue) continue;

    if (["name", "object_name", "part_name", "source_file", "source_filename", "filename", "object_name_en"].includes(rawKey)) {
      return { name: rawValue, source: `metadata:${rawKey}` };
    }

    candidateValues.push(rawValue);
  }

  const unique = Array.from(new Set(candidateValues));
  if (unique.length === 1) {
    return { name: unique[0], source: "metadata:single-candidate", candidates: unique };
  }

  return { name: "", source: "none", candidates: unique };
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

function fail(
  code: ThreeMfExpectedStructureErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ThreeMfExpectedStructureValidationResult {
  warn(code, message, details ?? {});
  return { ok: false, code, message, details };
}

export async function validateExpectedThreeMfStructure(
  input: File | Blob | ArrayBuffer | Uint8Array,
): Promise<ThreeMfExpectedStructureValidationResult> {
  const data = input instanceof ArrayBuffer || input instanceof Uint8Array ? input : await input.arrayBuffer();
  const zip = await JSZip.loadAsync(data);

  const primaryModelPath = await findPrimaryModelPath(zip);
  if (!primaryModelPath) {
    return fail(
      ThreeMfExpectedStructureErrorCode.PRIMARY_MODEL_NOT_FOUND,
      "未找到 3MF 主 model part。",
    );
  }

  const modelParts = await loadAllModelParts(zip);
  const normalizedPrimaryPath = normalizeZipPath(primaryModelPath);
  const primaryEntry = modelParts.get(normalizedPrimaryPath);
  if (!primaryEntry) {
    return fail(
      ThreeMfExpectedStructureErrorCode.PRIMARY_MODEL_NOT_FOUND,
      `主 model part 不存在：${primaryModelPath}`,
      { primaryModelPath },
    );
  }

  const modelSettingsDoc = await loadOptionalXml(zip, MODEL_SETTINGS_CONFIG_PATH);
  const projectSettingsDoc = await loadOptionalXml(zip, PROJECT_SETTINGS_CONFIG_PATH);
  const settingsNameMap = buildSettingsNameMap(modelSettingsDoc);
  const settingsPartNameMap = buildModelSettingsPartNameMap(modelSettingsDoc);
  log("model_settings 对象->part 名称映射:", Array.from(settingsPartNameMap.entries()).map(([rootId, partMap]) => ({ rootId, parts: Array.from(partMap.entries()) })));

  const plateInfo = await countPlatesFromProjectMetadata(zip);
  if (!plateInfo || plateInfo.count == null) {
    return fail(
      ThreeMfExpectedStructureErrorCode.PLATE_METADATA_NOT_FOUND,
      "未在项目元数据中找到可用于判断 plate 数量的信息。",
      {
        primaryModelPath,
        checkedSources: [
          "Metadata/plate_*.json",
          MODEL_SETTINGS_CONFIG_PATH,
          PROJECT_SETTINGS_CONFIG_PATH,
        ],
      },
    );
  }

  const plateCount = plateInfo.count;
  if (plateCount !== 1) {
    return fail(
      ThreeMfExpectedStructureErrorCode.INVALID_PLATE_COUNT,
      `预期文件只包含 1 个盘，实际为 ${plateCount} 个。`,
      {
        plateCount,
        primaryModelPath,
        plateCountSource: plateInfo.source,
        ...(plateInfo.details ?? {}),
      },
    );
  }

  const primaryDoc = primaryEntry.doc;
  const rootObjects = getElementsByLocalName(primaryDoc, "object");
  const buildItems = getElementsByLocalName(primaryDoc, "item");

  if (rootObjects.length !== 1 || buildItems.length !== 1) {
    return fail(
      ThreeMfExpectedStructureErrorCode.INVALID_MODEL_OBJECT_COUNT,
      `预期唯一盘里只有 1 个模型对象；实际 primary model 中 object=${rootObjects.length}, build/item=${buildItems.length}。`,
      {
        primaryModelPath,
        objectCount: rootObjects.length,
        buildItemCount: buildItems.length,
      },
    );
  }

  const rootObject = rootObjects[0];
  const rootObjectId = rootObject.getAttribute("id");
  const componentElements = getElementsByLocalName(rootObject, "component");

  if (componentElements.length === 0) {
    return fail(
      ThreeMfExpectedStructureErrorCode.ROOT_OBJECT_NOT_COMPOSITE,
      "唯一模型对象不是组合对象（未找到任何 component）。",
      { primaryModelPath, rootObjectId },
    );
  }

  if (componentElements.length < 2) {
    return fail(
      ThreeMfExpectedStructureErrorCode.COMPONENT_COUNT_TOO_SMALL,
      `组合对象子对象数量不足，预期至少 2 个，实际为 ${componentElements.length} 个。`,
      { primaryModelPath, rootObjectId, componentCount: componentElements.length },
    );
  }

  let backingCount = 0;
  const partNameByComponentId = rootObjectId ? (settingsPartNameMap.get(rootObjectId) ?? new Map<string, string>()) : new Map<string, string>();

  for (let i = 0; i < componentElements.length; i++) {
    const component = componentElements[i];
    const objectId = (component.getAttribute("objectid") ?? "").trim();
    const rawPath = getAttrOneOf(component, ["path", "modelpath"]);

    if (!objectId) {
      return fail(
        ThreeMfExpectedStructureErrorCode.REFERENCED_OBJECT_NOT_FOUND,
        `component[${i}] 缺少 objectid。`,
        { primaryModelPath, rootObjectId, componentIndex: i },
      );
    }

    const resolved = resolveComponentObject(component, rootObject, normalizedPrimaryPath, modelParts);
    if (!resolved) {
      return fail(
        ThreeMfExpectedStructureErrorCode.REFERENCED_OBJECT_NOT_FOUND,
        `component[${i}] 无法解析其引用对象。`,
        {
          primaryModelPath,
          rootObjectId,
          componentIndex: i,
          objectId,
          rawPath,
          availableModelParts: Array.from(modelParts.keys()),
        },
      );
    }

    const objectNameInfo = getObjectDisplayNameFromObjectEl(resolved.objectEl);
    const settingsPartName = partNameByComponentId.get(objectId) ?? "";
    const settingsNames = settingsNameMap.get(objectId) ?? [];
    const finalName = objectNameInfo.name || settingsPartName || (settingsNames.length === 1 ? settingsNames[0] : "");
    const finalSource = objectNameInfo.name
      ? objectNameInfo.source
      : settingsPartName
      ? `model_settings.config object=${rootObjectId} part=${objectId}`
      : (settingsNames.length === 1 ? "model_settings.config:id-map" : "none");

    log(`component[${i}] objectid=${objectId}, rawPath=${rawPath ?? "<none>"}, resolvedPart=${resolved.partPath}, name=${finalName}, source=${finalSource}`);

    if (finalName === "Backing") {
      backingCount++;
    }
  }

  if (backingCount !== 1) {
    return fail(
      ThreeMfExpectedStructureErrorCode.INVALID_BACKING_COUNT,
      `预期子对象中有且仅有 1 个名称为 Backing，实际为 ${backingCount} 个。`,
      {
        primaryModelPath,
        rootObjectId,
        componentCount: componentElements.length,
        backingCount,
      },
    );
  }

  return {
    ok: true,
    plateCount,
    modelObjectCount: 1,
    rootObjectId,
    componentCount: componentElements.length,
    backingCount,
    primaryModelPath,
  };
}

export class ThreeMfStructureValidationError extends Error {
  code: ThreeMfExpectedStructureErrorCode;
  details?: Record<string, unknown>;

  constructor(
    code: ThreeMfExpectedStructureErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ThreeMfStructureValidationError";
    this.code = code;
    this.details = details;
  }
}

export async function assertExpectedThreeMfStructure(
  input: File | Blob | ArrayBuffer | Uint8Array,
): Promise<void> {
  const result = await validateExpectedThreeMfStructure(input);
  if (!result.ok) {
    throw new ThreeMfStructureValidationError(result.code, result.message, result.details);
  }
}
