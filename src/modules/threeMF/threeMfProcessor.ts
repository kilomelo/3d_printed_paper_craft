import JSZip from "jszip";
import type { BufferGeometry } from "three";
import {
  buildHeightRangeOptions,
  buildModelSettingsPartNameMap,
  computeNextSourceVolumeId,
  computeObjectBoundingBoxRecursive,
  createObjectElementFromMesh,
  downloadBlob,
  findPartElementInModelSettings,
  formatTransform12,
  getCachedLayerConfigRangesDoc,
  getElementsByLocalName,
  getModelSettingsObjectElement,
  getModelStats,
  getObjectDisplayNameFromObjectEl,
  getOrCreateResourcesElement,
  getTopLevelModelSettingsObjectElement,
  getTransform12OrIdentity,
  makeComponentFromTemplate,
  makePureScaleTransformByAxes,
  meshDataFromBufferGeometry,
  nextNumericIdFromElements,
  normalizeChildPartKind,
  normalizeZipPath,
  parseTransform12,
  parseXml,
  partKindToModelSettingsSubtype,
  removeElement,
  resolveComponentObject,
  resolveOpcTarget,
  scaleTransformLinearPartByAxes,
  serializeXml,
  setCachedLayerConfigRangesDoc,
  setOrCreateMetadataValue,
  setOrCreateModelSettingsMetadataValue,
  toPublicBoundingBox,
  transformBoundingBox,
  unionBoundingBoxes,
  updateOrCreateMeshStatFaceCount,
  normalizeMeshData,
} from "./threeMfHelper";
import type { InternalBoundingBox, ResolvedComponentObject } from "./threeMfHelper";

export { downloadBlob, meshDataFromBufferGeometry } from "./threeMfHelper";

/**
 * 面向浏览器前端的 3MF 处理工具：
 * - 解析 3MF ZIP / OPC 容器
 * - 提供可组合的处理器（processor）
 * - 重新导出并下载
 *
 * 当前内置处理器：
 * 1. 按 X / Y / Z 三轴独立缩放所有模型实例
 * 2. 按名称删除唯一组合对象中的任意子对象
 * 3. 重命名唯一组合模型对象
 *
 * 依赖：npm i jszip
 */

const RELS_PATH = "_rels/.rels";
const START_PART_REL_TYPE = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const MODEL_SETTINGS_CONFIG_PATH = "Metadata/model_settings.config";
const LAYER_CONFIG_RANGES_PATH = "Metadata/layer_config_ranges.xml";

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

export type RenameCompositeRootObjectOptions = {
  /**
   * 默认 true：同步更新 Metadata/model_settings.config 中同 id 根 <object> 的 name / metadata[name]。
   */
  syncModelSettings?: boolean;
  /**
   * 默认 true：同时写入 metadata[name]，避免 slicer 或后续处理器读取到旧值。
   */
  syncMetadataName?: boolean;
};

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

  /**
   * 重命名主 3D/3dmodel.model 中唯一的组合模型对象。
   */
  renameCompositeRootObject(newName: string, options: RenameCompositeRootObjectOptions = {}): this {
    const normalizedName = newName.trim();
    if (!normalizedName) {
      throw new Error("newName 不能为空");
    }

    if (!this.primaryModelPath) {
      throw new Error("未找到主 model part，无法重命名唯一组合模型对象");
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
    const rootObjectId = (rootObject.getAttribute("id") ?? "").trim();
    if (!rootObjectId) {
      throw new Error("主组合对象缺少 id");
    }

    const componentEls = getElementsByLocalName(rootObject, "component");
    if (componentEls.length === 0) {
      throw new Error("唯一模型对象不是组合对象（未找到任何 component）");
    }

    // 1) 改主 3MF model 里的根 object 名称
    rootObject.setAttribute("name", normalizedName);

    if (options.syncMetadataName ?? true) {
      // 这是你原来用于 .model 的 helper，可以继续用于 rootObject
      setOrCreateMetadataValue(rootObject, "name", normalizedName);
    }

    // 2) 改 model_settings.config 里的“顶层 object”，不要碰 part
    if ((options.syncModelSettings ?? true) && this.modelSettingsDoc) {
      const modelSettingsRootObjectEl = getTopLevelModelSettingsObjectElement(
        this.modelSettingsDoc,
        rootObjectId,
      );

      if (modelSettingsRootObjectEl) {
        // 有些文件可能也认 object@name，写上不吃亏
        modelSettingsRootObjectEl.setAttribute("name", normalizedName);

        // 真正关键：model_settings.config 用的是 key/value 形式
        setOrCreateModelSettingsMetadataValue(modelSettingsRootObjectEl, "name", normalizedName);
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

    renameCompositeRootObject:
      (newName: string, options: RenameCompositeRootObjectOptions = {}): ThreeMfProcessor =>
      async (ctx) => {
        ctx.renameCompositeRootObject(newName, options);
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
