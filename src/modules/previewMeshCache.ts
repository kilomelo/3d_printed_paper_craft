// 预览 mesh 缓存：缓存展开组的 3D 预览 mesh，并按历史时间线维护其有效期。
// 这层逻辑并不只是一个简单数组：
// 1. 缓存项带有 historyUidCreated / historyUidAbandoned，用于与 undo/redo 对齐；
// 2. 某些历史动作发生后，需要把“当前仍有效”的缓存标记为失效；
// 3. redo 时又需要按当时记录的规则重新失效一批缓存；
// 4. 读取缓存时还要按当前组角度克隆并旋转 mesh。
import { Matrix4, Mesh } from "three";

type PreviewMeshCacheItem = {
  mesh: Mesh;
  groupId: number;
  historyUidCreated: number;
  historyUidAbandoned: number;
};

type CachedPreviewMesh = { mesh: Mesh; angle: number };

// 每条历史记录对应一条“缓存失效规则”。
// 这层规则要同时满足两种业务：
// 1. 旧逻辑：某些历史动作会让“当前所有有效缓存”整体失效；
// 2. 新逻辑：某些历史动作（例如拼接边编辑）只会让少量展开组的缓存失效。
//
// 这里不用单纯的 Set<number>，而是显式记录：
// - allGroups：是否代表“全量失效”；
// - groupIds：若不是全量失效，则只对这些 group 生效。
//
// 注意：即使一条规则最终升级成 allGroups=true，也仍然保留 groupIds 容器，
// 这样实现上更统一；只是在 allGroups=true 时，groupIds 会被忽略。
type CacheAbandonRule = {
  allGroups: boolean;
  groupIds: Set<number>;
};

const MAX_PREVIEW_MESH_CACHE_SIZE = 30;

export function createPreviewMeshCacheManager() {
  const previewMeshCache: PreviewMeshCacheItem[] = [];
  // 按 history uid 存储缓存失效规则，供 redo 时重放。
  //
  // 为什么这里必须存“规则”而不是直接存“某次操作时删了哪些缓存”：
  // 1. undo/redo 是按历史时间线跳转，不是简单回放对象引用；
  // 2. redo 时需要基于“当前仍有效的缓存”重新执行一次失效；
  // 3. 因此这里记录的应当是“怎么失效（全量/哪些组）”，而不是某次运行时删掉的具体条目。
  const abandonHistoryRules = new Map<number, CacheAbandonRule>();

  const clear = () => {
    previewMeshCache.length = 0;
    abandonHistoryRules.clear();
  };

  const getCachedPreviewMesh = (
    groupId: number,
    currentHistoryUid: number,
    currentGroupAngle: number,
  ): CachedPreviewMesh | null => {
    const cached = previewMeshCache.find(
      (c) =>
        c.groupId === groupId &&
        c.historyUidCreated <= currentHistoryUid &&
        c.historyUidAbandoned > currentHistoryUid,
    );
    if (!cached) return null;
    const mesh = cached.mesh.clone();
    if (Math.abs(currentGroupAngle) > 1e-8) {
      mesh.applyMatrix4(new Matrix4().makeRotationZ(-currentGroupAngle));
    }
    mesh.updateMatrixWorld(true);
    mesh.geometry?.computeBoundingBox?.();
    mesh.geometry?.computeBoundingSphere?.();
    return { mesh, angle: currentGroupAngle };
  };

  // 仅判断“当前历史时间点上，这个组是否存在有效缓存”，不做 clone 或角度处理。
  // 这个接口主要给 UI 做缓存有效性提示，避免为了一个布尔判断就走完整的 clone 路径。
  const hasActiveCachedPreviewMesh = (
    groupId: number,
    currentHistoryUid: number,
  ): boolean => {
    return previewMeshCache.some(
      (c) =>
        c.groupId === groupId &&
        c.historyUidCreated <= currentHistoryUid &&
        c.historyUidAbandoned > currentHistoryUid,
    );
  };

  const addCachedPreviewMesh = (groupId: number, mesh: Mesh, currentHistoryUid: number) => {
    previewMeshCache.push({
      mesh,
      groupId,
      historyUidCreated: currentHistoryUid,
      historyUidAbandoned: Infinity,
    });
    if (previewMeshCache.length > MAX_PREVIEW_MESH_CACHE_SIZE) {
      previewMeshCache.splice(0, previewMeshCache.length - MAX_PREVIEW_MESH_CACHE_SIZE);
    }
  };

  // 将“当前仍有效”的缓存标记为在指定 history uid 处失效。
  //
  // groupIds 未传时，表示沿用旧逻辑：全量失效。
  // groupIds 传入时，仅使这些 group 的当前有效缓存失效。
  //
  // 这里故意只处理：
  // - historyUidCreated < historyUid
  // - historyUidAbandoned === Infinity
  // 的条目，原因是：
  // 1. 只有在当前历史时间点之前创建的缓存，才可能是“现有缓存”；
  // 2. 已经失效过的缓存不能再次覆写它的失效点，否则会破坏历史时间线。
  const abandonCurrentActiveCaches = (historyUid: number, groupIds?: Iterable<number> | null) => {
    const targetGroups = normalizeGroupIds(groupIds);
    for (const cache of previewMeshCache) {
      if (targetGroups && !targetGroups.has(cache.groupId)) continue;
      if (cache.historyUidCreated < historyUid && cache.historyUidAbandoned === Infinity) {
        cache.historyUidAbandoned = historyUid;
      }
    }
  };

  // 记录一条供 redo 使用的缓存失效规则。
  //
  // 规则合并策略：
  // 1. 任何一次“全量失效”都会把该 uid 的规则升级为 allGroups=true；
  // 2. 多次“按组失效”会做 group 并集；
  // 3. 一旦 allGroups=true，后续再追加具体 group 已经没有意义，直接保持全量。
  //
  // 这个合并逻辑是后续支持“同一个历史 uid 上堆叠多个 seam 编辑”的基础。
  const rememberAbandonRule = (historyUid: number, groupIds?: Iterable<number> | null) => {
    if (historyUid <= 0) return;
    const nextGroups = normalizeGroupIds(groupIds);
    const existing = abandonHistoryRules.get(historyUid);

    if (!existing) {
      abandonHistoryRules.set(historyUid, {
        allGroups: !nextGroups,
        groupIds: nextGroups ?? new Set<number>(),
      });
      return;
    }

    if (existing.allGroups) return;
    if (!nextGroups) {
      existing.allGroups = true;
      existing.groupIds.clear();
      return;
    }
    nextGroups.forEach((groupId) => existing.groupIds.add(groupId));
  };

  const applyRedoPassedHistory = (snapPassed: number[]) => {
    for (const uid of snapPassed) {
      const rule = abandonHistoryRules.get(uid);
      if (!rule) continue;
      abandonCurrentActiveCaches(uid, rule.allGroups ? null : rule.groupIds);
    }
  };

  const eraseHistory = (erasedHistoryUid: number[]) => {
    const fromUid = erasedHistoryUid[0];
    for (let i = previewMeshCache.length - 1; i >= 0; i--) {
      if (previewMeshCache[i].historyUidAbandoned >= fromUid) {
        previewMeshCache[i].historyUidAbandoned = Infinity;
      }
      if (previewMeshCache[i].historyUidCreated >= fromUid) {
        previewMeshCache.splice(i, 1);
      }
    }
    Array.from(abandonHistoryRules.keys()).forEach((uid) => {
      if (uid >= fromUid) abandonHistoryRules.delete(uid);
    });
  };

  // 可选的辅助能力：把旧 uid 上记录的失效规则迁移到新 uid。
  //
  // 这一步当前还没有调用，但它是为“历史堆叠后旧 uid 被替换”准备的基础设施。
  // 后续 seam 编辑接入 history stack 时，需要把旧 uid 上累积的 group 脏集合迁到新 uid。
  //
  // 合并规则与 rememberAbandonRule 保持一致：
  // - 若 source 是全量，则 target 直接升级为全量；
  // - 若双方都是按组规则，则做并集。
  const moveAbandonRule = (fromHistoryUid: number, toHistoryUid: number) => {
    if (fromHistoryUid <= 0 || toHistoryUid <= 0 || fromHistoryUid === toHistoryUid) return;
    const source = abandonHistoryRules.get(fromHistoryUid);
    if (!source) return;
    rememberAbandonRule(toHistoryUid, source.allGroups ? null : source.groupIds);
    abandonHistoryRules.delete(fromHistoryUid);
  };

  function normalizeGroupIds(groupIds?: Iterable<number> | null): Set<number> | null {
    if (groupIds == null) return null;
    const normalized = new Set<number>();
    for (const groupId of groupIds) {
      if (!Number.isFinite(groupId)) continue;
      normalized.add(groupId);
    }
    // 空集合没有任何失效意义，直接当成“不记录具体规则”。
    // 调用方若真的传入空集合，等价于本次无需做按组失效。
    return normalized.size > 0 ? normalized : new Set<number>();
  }

  return {
    clear,
    getCachedPreviewMesh,
    hasActiveCachedPreviewMesh,
    addCachedPreviewMesh,
    abandonCurrentActiveCaches,
    rememberAbandonRule,
    applyRedoPassedHistory,
    eraseHistory,
    moveAbandonRule,
  };
}
