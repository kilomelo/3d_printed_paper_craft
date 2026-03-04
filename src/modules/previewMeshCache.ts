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

const MAX_PREVIEW_MESH_CACHE_SIZE = 30;

export function createPreviewMeshCacheManager() {
  const previewMeshCache: PreviewMeshCacheItem[] = [];
  // 当前项目里真正使用的失效规则只有一种：
  // “把当前仍有效的缓存标记为失效”。
  // 这里按 history uid 记录下来，供 redo 时重放。
  const abandonHistoryRuleUids = new Set<number>();

  const clear = () => {
    previewMeshCache.length = 0;
    abandonHistoryRuleUids.clear();
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

  const abandonCurrentActiveCaches = (historyUid: number) => {
    for (const cache of previewMeshCache) {
      if (cache.historyUidCreated < historyUid && cache.historyUidAbandoned === Infinity) {
        cache.historyUidAbandoned = historyUid;
      }
    }
  };

  const rememberAbandonRule = (historyUid: number) => {
    if (historyUid > 0) {
      abandonHistoryRuleUids.add(historyUid);
    }
  };

  const applyRedoPassedHistory = (snapPassed: number[]) => {
    for (const uid of snapPassed) {
      if (!abandonHistoryRuleUids.has(uid)) continue;
      abandonCurrentActiveCaches(uid);
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
    Array.from(abandonHistoryRuleUids).forEach((uid) => {
      if (uid >= fromUid) abandonHistoryRuleUids.delete(uid);
    });
  };

  return {
    clear,
    getCachedPreviewMesh,
    addCachedPreviewMesh,
    abandonCurrentActiveCaches,
    rememberAbandonRule,
    applyRedoPassedHistory,
    eraseHistory,
  };
}
