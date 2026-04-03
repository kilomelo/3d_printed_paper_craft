// 展开组数据层：使用统一的 GroupData 结构管理组的面、颜色与树结构，并维护 face->group 的映射。
import { Color } from "three";
import { t } from "./i18n";

export type GroupData = {
  id: number;
  faces: number[]; // 运行时派生缓存；持久化真相是 treeParent
  color: Color;
  treeParent: Map<number, number | null>;
  name: string;
  placeAngle: number;
};

const GROUP_COLOR_PALETTE_LEGACY = [0x86a6ee, 0xea7c7c, 0xbfbf20, 0x3ecb3e, 0x20bfbf, 0xed82ed];
const GROUP_COLOR_PALETTE = [0x7088ff, 0xffe770, 0xff7088, 0x88ff70, 0xe770ff, 0x70ffe7];

const groups: GroupData[] = [];
const faceGroupMap: Map<number, number | null> = new Map();
let groupColorCursor = 0;

function nextPaletteColor(): Color {
  const color = new Color(GROUP_COLOR_PALETTE[groupColorCursor % GROUP_COLOR_PALETTE.length]);
  groupColorCursor = (groupColorCursor + 1) % GROUP_COLOR_PALETTE.length;
  return color;
}

function findGroup(id: number): GroupData | undefined {
  return groups.find((g) => g.id === id);
}

function getGroupFaceIdSet(group: GroupData | undefined): Set<number> | undefined {
  if (!group) return undefined;
  const faceIds = new Set<number>(group.faces);
  group.treeParent.forEach((_parentFaceId, faceId) => faceIds.add(faceId));
  return faceIds;
}

function buildFacesCacheFromParentMap(
  parentMap: Map<number, number | null>,
  previousFaces?: number[],
): number[] {
  if (parentMap.size === 0) return [];

  const roots = Array.from(parentMap.entries())
    .filter(([, parentFaceId]) => parentFaceId === null)
    .map(([faceId]) => faceId);
  if (roots.length !== 1) {
    return previousFaces ? Array.from(new Set(previousFaces.filter((faceId) => parentMap.has(faceId)))) : Array.from(parentMap.keys());
  }

  const previousOrderIndex = new Map<number, number>();
  previousFaces?.forEach((faceId, index) => previousOrderIndex.set(faceId, index));

  const childrenByParent = new Map<number | null, number[]>();
  parentMap.forEach((parentFaceId, faceId) => {
    const key = parentFaceId;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(faceId);
  });

  childrenByParent.forEach((childFaceIds) => {
    childFaceIds.sort((a, b) => {
      const orderA = previousOrderIndex.get(a);
      const orderB = previousOrderIndex.get(b);
      if (orderA !== undefined && orderB !== undefined && orderA !== orderB) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return a - b;
    });
  });

  const traversalOrder: number[] = [];
  const stack = [...roots].reverse();
  while (stack.length) {
    const faceId = stack.pop()!;
    traversalOrder.push(faceId);
    const childFaceIds = childrenByParent.get(faceId) ?? [];
    for (let i = childFaceIds.length - 1; i >= 0; i -= 1) {
      stack.push(childFaceIds[i]);
    }
  }

  if (!previousFaces || previousFaces.length === 0) {
    return traversalOrder;
  }

  // `faces` 作为运行时“加入顺序缓存”使用：
  // - 对于树重排，不应被 DFS 顺序覆写；
  // - 对于删面，只过滤掉已不存在的面；
  // - 对于导入新树且缺少旧顺序时，再回退到遍历顺序。
  const mergedOrder: number[] = [];
  const seen = new Set<number>();
  previousFaces.forEach((faceId) => {
    if (!parentMap.has(faceId) || seen.has(faceId)) return;
    seen.add(faceId);
    mergedOrder.push(faceId);
  });
  traversalOrder.forEach((faceId) => {
    if (seen.has(faceId)) return;
    seen.add(faceId);
    mergedOrder.push(faceId);
  });
  return mergedOrder;
}

function getRootFaceId(parentMap: Map<number, number | null>): number | null {
  for (const [faceId, parentFaceId] of parentMap.entries()) {
    if (parentFaceId === null) return faceId;
  }
  return null;
}

function syncGroupFacesCache(group: GroupData, previousFaces?: number[]) {
  group.faces = buildFacesCacheFromParentMap(group.treeParent, previousFaces ?? group.faces);
}

function isAncestorFace(
  ancestorFaceId: number,
  faceId: number,
  parentMap: Map<number, number | null>,
): boolean | null {
  const seen = new Set<number>();
  let walk: number | null = faceId;
  while (walk !== null) {
    if (walk === ancestorFaceId) return true;
    if (seen.has(walk)) return null;
    seen.add(walk);
    const parentFaceId = parentMap.get(walk);
    if (parentFaceId === undefined) return null;
    walk = parentFaceId;
  }
  return false;
}

function collectSubtreeFaceIds(rootFaceId: number, parentMap: Map<number, number | null>): Set<number> {
  const subtree = new Set<number>();
  const stack = [rootFaceId];
  while (stack.length) {
    const faceId = stack.pop()!;
    if (subtree.has(faceId)) continue;
    subtree.add(faceId);
    parentMap.forEach((parentFaceId, childFaceId) => {
      if (parentFaceId === faceId) {
        stack.push(childFaceId);
      }
    });
  }
  return subtree;
}

function findPreferredAdjacentFaceOutsideSet(
  faceId: number,
  excludedFaceIds: Set<number>,
  groupFaceIds: Set<number>,
  faceAdjacency: Map<number, Set<number>>,
  previousFaces: number[],
): number | null {
  const neighbors = faceAdjacency.get(faceId);
  if (!neighbors) return null;
  const orderIndex = new Map<number, number>();
  previousFaces.forEach((candidateFaceId, index) => orderIndex.set(candidateFaceId, index));
  let bestFaceId: number | null = null;
  let bestOrder = -1;
  neighbors.forEach((neighborFaceId) => {
    if (!groupFaceIds.has(neighborFaceId) || excludedFaceIds.has(neighborFaceId)) return;
    const order = orderIndex.get(neighborFaceId) ?? -1;
    if (bestFaceId === null || order > bestOrder || (order === bestOrder && neighborFaceId < bestFaceId)) {
      bestFaceId = neighborFaceId;
      bestOrder = order;
    }
  });
  return bestFaceId;
}

function choosePreferredRootFaceId(
  faceIds: Set<number>,
  previousParentMap: Map<number, number | null>,
  previousFaces: number[],
  preferredRootFaceId?: number | null,
): number | null {
  if (preferredRootFaceId !== undefined && preferredRootFaceId !== null && faceIds.has(preferredRootFaceId)) {
    return preferredRootFaceId;
  }
  const previousRootFaceId = getRootFaceId(previousParentMap);
  if (previousRootFaceId !== null && faceIds.has(previousRootFaceId)) {
    return previousRootFaceId;
  }
  for (const faceId of previousFaces) {
    if (faceIds.has(faceId)) return faceId;
  }
  return faceIds.values().next().value ?? null;
}

function buildPreferredSpanningTree(
  faceIds: Set<number>,
  faceAdjacency: Map<number, Set<number>>,
  previousParentMap: Map<number, number | null>,
  previousFaces: number[],
  preferredRootFaceId?: number | null,
): Map<number, number | null> | null {
  if (faceIds.size === 0) return new Map<number, number | null>();
  const rootFaceId = choosePreferredRootFaceId(faceIds, previousParentMap, previousFaces, preferredRootFaceId);
  if (rootFaceId === null) return null;

  const previousOrderIndex = new Map<number, number>();
  previousFaces.forEach((faceId, index) => previousOrderIndex.set(faceId, index));

  const nextParentMap = new Map<number, number | null>();
  const visited = new Set<number>([rootFaceId]);
  nextParentMap.set(rootFaceId, null);

  while (visited.size < faceIds.size) {
    let bestCandidate: {
      parentFaceId: number;
      childFaceId: number;
      edgeScore: number;
      childOrder: number;
      parentOrder: number;
    } | null = null;

    visited.forEach((parentFaceId) => {
      const neighbors = faceAdjacency.get(parentFaceId);
      if (!neighbors) return;
      neighbors.forEach((childFaceId) => {
        if (!faceIds.has(childFaceId) || visited.has(childFaceId)) return;
        let edgeScore = 2;
        if (previousParentMap.get(childFaceId) === parentFaceId) {
          edgeScore = 0;
        } else if (previousParentMap.get(parentFaceId) === childFaceId) {
          edgeScore = 1;
        }
        const childOrder = previousOrderIndex.get(childFaceId) ?? Number.MAX_SAFE_INTEGER;
        const parentOrder = previousOrderIndex.get(parentFaceId) ?? Number.MAX_SAFE_INTEGER;
        const candidate = { parentFaceId, childFaceId, edgeScore, childOrder, parentOrder };
        if (
          !bestCandidate ||
          candidate.edgeScore < bestCandidate.edgeScore ||
          (candidate.edgeScore === bestCandidate.edgeScore && candidate.childOrder < bestCandidate.childOrder) ||
          (candidate.edgeScore === bestCandidate.edgeScore &&
            candidate.childOrder === bestCandidate.childOrder &&
            candidate.parentOrder < bestCandidate.parentOrder) ||
          (candidate.edgeScore === bestCandidate.edgeScore &&
            candidate.childOrder === bestCandidate.childOrder &&
            candidate.parentOrder === bestCandidate.parentOrder &&
            candidate.childFaceId < bestCandidate.childFaceId)
        ) {
          bestCandidate = candidate;
        }
      });
    });

    if (!bestCandidate) return null;
    visited.add(bestCandidate.childFaceId);
    nextParentMap.set(bestCandidate.childFaceId, bestCandidate.parentFaceId);
  }

  return nextParentMap;
}

function nextGroupId(): number {
  if (!groups.length) return 1;
  const maxId = Math.max(...groups.map((g) => g.id));
  return maxId + 1;
}

export function nextGroupName(): string {
  const currentPrefix = t("group.default.prefix") || "Group";
  const escaped = currentPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\s+(\\d+)$`, "i");

  let maxNumber = 0;
  groups.forEach((g) => {
    const m = pattern.exec(g.name);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!Number.isNaN(num)) {
        maxNumber = Math.max(maxNumber, num);
      }
    }
  });

  return `${currentPrefix} ${maxNumber + 1}`;
}

export function resetGroups() {
  groups.length = 0;
  faceGroupMap.clear();
  groupColorCursor = 0;
  addGroup(1);
}

export function addGroup(newGroupId?: number): number | undefined {
  newGroupId = newGroupId ?? nextGroupId();
  let exists = findGroup(newGroupId);
  if (exists) return undefined;
  else{
    exists = {
      id: newGroupId,
      faces: [],
      color: nextPaletteColor(),
      treeParent: new Map<number, number | null>(),
      name: nextGroupName(),
      placeAngle: 0,
    };
    groups.push(exists);
    return newGroupId;
  }
}

export function deleteGroup(
  groupId: number,
): boolean {
  if (groups.length <= 1) return false;
  const target = findGroup(groupId);
  if (!target) return false;

  // 清理 face->group
  faceGroupMap.forEach((gid, fid) => {
    if (gid === groupId) {
      faceGroupMap.set(fid, null);
    }
  });
  // 移除组数据
  groups.splice(groups.indexOf(target), 1);
  return true;
}

export function getGroupsCount(): number {
  return groups.length;
}

export function getGroupIds(): number[] {
  return groups.map((g) => g.id);
}

export function getFaceGroupMap() {
  return faceGroupMap;
}

export function getGroupFaces(id: number): Set<number> | undefined {
  return getGroupFaceIdSet(findGroup(id));
}

export function getGroupColor(id: number): Color | undefined {
  const g = findGroup(id);
  return g ? g.color.clone() : undefined;
}

export function getGroupName(id: number): string | undefined {
  return findGroup(id)?.name;
}

export function setGroupName(id: number, name: string): boolean {
  const g = findGroup(id);
  if (!g) return false;
  g.name = name;
  return true;
}

export function getGroupPlaceAngle(id: number): number | undefined {
  return findGroup(id)?.placeAngle;
}

export function setGroupPlaceAngle(id: number, angle: number): boolean {
  const g = findGroup(id);
  if (!g) return false;
  g.placeAngle = angle;
  return true;
}

export function setGroupColor(groupId: number, color: Color): boolean {
  const g = findGroup(groupId);
  if (!g) return false;
  g.color = color;
  return true;
}

export function getGroupTreeParent(id: number): Map<number, number | null> | undefined {
  return findGroup(id)?.treeParent;
}

export function getGroupColorCursor() {
  return groupColorCursor;
}

export function setGroupColorCursor(value: number) {
  groupColorCursor = value;
}

export function setGroupsPlaceAngles(data: { id: number; placeAngle?: number }[]) {
  data.forEach(({ id, placeAngle }) => {
    const g = findGroup(id);
    if (g && typeof placeAngle === "number") {
      g.placeAngle = placeAngle;
    }
  });
}

export function exportGroupsData() {
  return groups.map((g) => ({
    id: g.id,
    color: g.color.getHex(),
    treeParent: Array.from(g.treeParent.entries()),
    name: g.name,
    placeAngle: Math.round(g.placeAngle * 100) / 100,
  }));
}

export function setFaceGroup(faceId: number, groupId: number | null): boolean {
  const prev = faceGroupMap.get(faceId) ?? null;
  if (prev === groupId) return false;

  if (prev !== null) {
    const pg = findGroup(prev);
    if (pg) {
      const idx = pg.faces.indexOf(faceId);
      if (idx >= 0) pg.faces.splice(idx, 1);
      pg.treeParent.delete(faceId);
    }
  }

  if (groupId !== null) {
    const g = findGroup(groupId);
    if (!g) return false;
    if (!g.faces.includes(faceId)) {
      g.faces.push(faceId);
    }
    if (!g.treeParent.has(faceId)) {
      g.treeParent.set(faceId, null);
    }
  }
  faceGroupMap.set(faceId, groupId);
  return true;
}

export function removeFaceFromGroup(
  faceId: number,
  groupId: number,
  faceAdjacency: Map<number, Set<number>>,
): boolean {
  const group = findGroup(groupId);
  if (!group) return false;
  if (!group.treeParent.has(faceId)) return false;

  const previousFaces = [...group.faces];
  const previousParentMap = new Map(group.treeParent);
  const remainingFaceIds = new Set<number>(group.treeParent.keys());
  remainingFaceIds.delete(faceId);

  group.treeParent.delete(faceId);
  faceGroupMap.set(faceId, null);

  if (remainingFaceIds.size === 0) {
    group.faces = [];
    return true;
  }

  const previousRootFaceId = getRootFaceId(previousParentMap);
  const nextParentMap = buildPreferredSpanningTree(
    remainingFaceIds,
    faceAdjacency,
    previousParentMap,
    previousFaces.filter((id) => id !== faceId),
    previousRootFaceId === faceId ? null : previousRootFaceId,
  );
  if (!nextParentMap) {
    group.treeParent = previousParentMap;
    faceGroupMap.set(faceId, groupId);
    return false;
  }

  group.treeParent = nextParentMap;
  syncGroupFacesCache(group, previousFaces.filter((id) => id !== faceId));
  return true;
}

export function addFaceToGroup(
  faceId: number,
  groupId: number,
  faceAdjacency: Map<number, Set<number>>,
): boolean {
  const group = findGroup(groupId);
  if (!group) return false;
  if (group.treeParent.has(faceId)) return false;

  const previousFaces = [...group.faces];
  let parentFaceId: number | null = null;
  if (group.treeParent.size > 0) {
    const neighbors = faceAdjacency.get(faceId);
    if (!neighbors) return false;
    const orderIndex = new Map<number, number>();
    previousFaces.forEach((id, index) => orderIndex.set(id, index));
    let bestParentOrder = -1;
    neighbors.forEach((neighborFaceId) => {
      if (!group.treeParent.has(neighborFaceId)) return;
      const neighborOrder = orderIndex.get(neighborFaceId) ?? -1;
      if (neighborOrder >= bestParentOrder) {
        bestParentOrder = neighborOrder;
        parentFaceId = neighborFaceId;
      }
    });
    if (parentFaceId === null) return false;
  }

  group.treeParent.set(faceId, parentFaceId);
  faceGroupMap.set(faceId, groupId);
  syncGroupFacesCache(group, [...previousFaces, faceId]);
  return true;
}

export function shareEdgeWithGroup(
  faceId: number,
  groupId: number,
  faceAdjacency: Map<number, Set<number>>,
): boolean {
  const neighbors = faceAdjacency.get(faceId);
  if (!neighbors) return false;
  const groupFaces = getGroupFaceIdSet(findGroup(groupId));
  if (!groupFaces || groupFaces.size === 0) return false;
  for (const n of neighbors) {
    if (groupFaces.has(n)) return true;
  }
  return false;
}

export function sharedEdgeIsSeam(a: number, b: number): boolean {
  const g1 = faceGroupMap.get(a) ?? null;
  const g2 = faceGroupMap.get(b) ?? null;
  if (g1 === null && g2 === null) return false;
  if (g1 === null || g2 === null) return true;
  if (g1 !== g2) return true;
  const parentMap = getGroupTreeParent(g1);
  if (!parentMap) return false;
  return !(parentMap.get(a) === b || parentMap.get(b) === a);
}

export function canRemoveFace(
  groupId: number,
  faceId: number,
  faceAdjacency: Map<number, Set<number>>,
): boolean {
  const faceSet = getGroupFaceIdSet(findGroup(groupId));
  const faces = faceSet ? Array.from(faceSet) : undefined;
  if (!faces || faces.length <= 1) return true;
  if (!faceSet?.has(faceId)) return true;

  const remaining = new Set(faces.filter((f) => f !== faceId));
  if (remaining.size === 0) return true;

  const start = remaining.values().next().value as number;
  const visited = new Set<number>();
  const queue = [start];
  visited.add(start);

  while (queue.length) {
    const cur = queue.pop()!;
    const neighbors = faceAdjacency.get(cur);
    if (!neighbors) continue;
    neighbors.forEach((n) => {
      if (!remaining.has(n)) return;
      if (visited.has(n)) return;
      visited.add(n);
      queue.push(n);
    });
  }

  return visited.size === remaining.size;
}

function areFacesAdjacent(a: number, b: number, faceAdjacency: Map<number, Set<number>>): boolean {
  const set = faceAdjacency.get(a);
  return set ? set.has(b) : false;
}

export type ReorderGroupTreeResult =
  | {
      ok: true;
      movedFaceId: number;
      previousParentFaceId: number | null;
      nextParentFaceId: number;
    }
  | {
      ok: false;
      reason:
        | "group-not-found"
        | "face-not-in-group"
        | "faces-not-adjacent"
        | "same-face"
        | "already-parent"
        | "already-parent-child"
        | "invalid-parent-map"
        | "tree-rebuild-failed";
    };

function buildTreeAdjacency(parentMap: Map<number, number | null>): Map<number, Set<number>> | null {
  const faceSet = new Set(parentMap.keys());
  const treeAdj = new Map<number, Set<number>>();
  let rootCount = 0;

  faceSet.forEach((faceId) => treeAdj.set(faceId, new Set<number>()));

  for (const faceId of faceSet) {
    const parent = parentMap.get(faceId);
    if (parent === undefined) return null;
    if (parent === null) {
      rootCount += 1;
      continue;
    }
    if (parent === faceId || !faceSet.has(parent)) return null;
    treeAdj.get(faceId)!.add(parent);
    treeAdj.get(parent)!.add(faceId);
  }

  if (rootCount !== 1) return null;
  if (faceSet.size === 0) return treeAdj;

  const visited = new Set<number>();
  const startFaceId = faceSet.values().next().value as number;
  const stack = [startFaceId];
  visited.add(startFaceId);
  while (stack.length) {
    const faceId = stack.pop()!;
    treeAdj.get(faceId)?.forEach((neighbor) => {
      if (visited.has(neighbor)) return;
      visited.add(neighbor);
      stack.push(neighbor);
    });
  }

  return visited.size === faceSet.size ? treeAdj : null;
}

function cloneTreeAdjacency(treeAdj: Map<number, Set<number>>) {
  const cloned = new Map<number, Set<number>>();
  treeAdj.forEach((neighbors, faceId) => cloned.set(faceId, new Set(neighbors)));
  return cloned;
}

function removeUndirectedEdge(treeAdj: Map<number, Set<number>>, a: number, b: number): boolean {
  const aNeighbors = treeAdj.get(a);
  const bNeighbors = treeAdj.get(b);
  if (!aNeighbors || !bNeighbors || !aNeighbors.has(b) || !bNeighbors.has(a)) return false;
  aNeighbors.delete(b);
  bNeighbors.delete(a);
  return true;
}

function addUndirectedEdge(treeAdj: Map<number, Set<number>>, a: number, b: number): boolean {
  const aNeighbors = treeAdj.get(a);
  const bNeighbors = treeAdj.get(b);
  if (!aNeighbors || !bNeighbors || aNeighbors.has(b) || bNeighbors.has(a)) return false;
  aNeighbors.add(b);
  bNeighbors.add(a);
  return true;
}

function findPathInTree(
  startFaceId: number,
  endFaceId: number,
  treeAdj: Map<number, Set<number>>,
): number[] | null {
  if (!treeAdj.has(startFaceId) || !treeAdj.has(endFaceId)) return null;
  const previous = new Map<number, number | null>();
  const queue = [startFaceId];
  previous.set(startFaceId, null);

  while (queue.length) {
    const current = queue.shift()!;
    if (current === endFaceId) break;
    treeAdj.get(current)?.forEach((neighbor) => {
      if (previous.has(neighbor)) return;
      previous.set(neighbor, current);
      queue.push(neighbor);
    });
  }

  if (!previous.has(endFaceId)) return null;
  const path: number[] = [];
  let walk: number | null = endFaceId;
  while (walk !== null) {
    path.push(walk);
    walk = previous.get(walk) ?? null;
  }
  path.reverse();
  return path;
}

function orientTreeFromRoot(
  rootFaceId: number,
  treeAdj: Map<number, Set<number>>,
): Map<number, number | null> | null {
  if (!treeAdj.has(rootFaceId)) return null;
  const parentMap = new Map<number, number | null>();
  const stack: Array<[number, number | null]> = [[rootFaceId, null]];

  while (stack.length) {
    const [faceId, parentFaceId] = stack.pop()!;
    if (parentMap.has(faceId)) continue;
    parentMap.set(faceId, parentFaceId);
    treeAdj.get(faceId)?.forEach((neighbor) => {
      if (neighbor === parentFaceId) return;
      stack.push([neighbor, faceId]);
    });
  }

  return parentMap.size === treeAdj.size ? parentMap : null;
}

export function reorderGroupTree(
  groupId: number,
  nextParentFaceId: number,
  movedFaceId: number,
  faceAdjacency: Map<number, Set<number>>,
): ReorderGroupTreeResult {
  const g = findGroup(groupId);
  if (!g) {
    return { ok: false, reason: "group-not-found" };
  }
  if (!g.treeParent.has(nextParentFaceId) || !g.treeParent.has(movedFaceId)) {
    return { ok: false, reason: "face-not-in-group" };
  }
  if (nextParentFaceId === movedFaceId) {
    return { ok: false, reason: "same-face" };
  }
  if (!areFacesAdjacent(nextParentFaceId, movedFaceId, faceAdjacency)) {
    return { ok: false, reason: "faces-not-adjacent" };
  }
  const previousParentFaceId = g.treeParent.get(movedFaceId);
  if (previousParentFaceId === undefined) {
    return { ok: false, reason: "invalid-parent-map" };
  }
  if (previousParentFaceId === nextParentFaceId) {
    return { ok: false, reason: "already-parent" };
  }

  const currentTreeAdj = buildTreeAdjacency(g.treeParent);
  if (!currentTreeAdj) {
    return { ok: false, reason: "invalid-parent-map" };
  }
  const currentRootFaceId = getRootFaceId(g.treeParent);
  const treePath = findPathInTree(movedFaceId, nextParentFaceId, currentTreeAdj);
  if (!treePath || treePath.length < 2) {
    return { ok: false, reason: "invalid-parent-map" };
  }
  const nextTreeAdj = cloneTreeAdjacency(currentTreeAdj);
  const nextParentIsDescendantOfMoved = isAncestorFace(movedFaceId, nextParentFaceId, g.treeParent);
  if (nextParentIsDescendantOfMoved === null) {
    return { ok: false, reason: "invalid-parent-map" };
  }

  const detachedEdges: string[] = [];
  const attachedEdges: string[] = [];
  let nextRootFaceId = currentRootFaceId;
  let selectedWFaceId: number | null = null;
  let selectedKFaceId: number | null = null;

  if (nextParentIsDescendantOfMoved) {
    /*
    const movedSubtreeFaceIds = collectSubtreeFaceIds(movedFaceId, g.treeParent);
    const groupFaceIds = new Set<number>(g.treeParent.keys());
    const candidateWFaces = [...treePath].reverse().slice(0, -1);

    for (const candidateWFaceId of candidateWFaces) {
      const candidateKFaceId = findPreferredAdjacentFaceOutsideSet(
        candidateWFaceId,
        movedSubtreeFaceIds,
        groupFaceIds,
        faceAdjacency,
        g.faces,
      );
      if (candidateKFaceId === null) continue;
      selectedWFaceId = candidateWFaceId;
      selectedKFaceId = candidateKFaceId;
      break;
    }

    if (selectedWFaceId !== null && selectedKFaceId !== null) {
      if (previousParentFaceId !== null) {
        if (!removeUndirectedEdge(nextTreeAdj, movedFaceId, previousParentFaceId)) {
          return { ok: false, reason: "invalid-parent-map" };
        }
        detachedEdges.push(`${movedFaceId}-${previousParentFaceId}`);
      }

      const previousParentOfW = g.treeParent.get(selectedWFaceId);
      if (previousParentOfW === undefined || previousParentOfW === null) {
        return { ok: false, reason: "invalid-parent-map" };
      }
      if (!removeUndirectedEdge(nextTreeAdj, selectedWFaceId, previousParentOfW)) {
        return { ok: false, reason: "invalid-parent-map" };
      }
      detachedEdges.push(`${selectedWFaceId}-${previousParentOfW}`);

      if (!addUndirectedEdge(nextTreeAdj, selectedWFaceId, selectedKFaceId)) {
        return { ok: false, reason: "invalid-parent-map" };
      }
      attachedEdges.push(`${selectedWFaceId}-${selectedKFaceId}`);

      if (!addUndirectedEdge(nextTreeAdj, movedFaceId, nextParentFaceId)) {
        return { ok: false, reason: "invalid-parent-map" };
      }
      attachedEdges.push(`${movedFaceId}-${nextParentFaceId}`);
      nextRootFaceId = currentRootFaceId;
    } else {
    */
      const childOnPathFaceId = treePath[1];
      if (childOnPathFaceId === undefined || childOnPathFaceId === null) {
        return { ok: false, reason: "invalid-parent-map" };
      }
      if (!removeUndirectedEdge(nextTreeAdj, movedFaceId, childOnPathFaceId)) {
        return { ok: false, reason: "invalid-parent-map" };
      }
      detachedEdges.push(`${movedFaceId}-${childOnPathFaceId}`);

      if (!addUndirectedEdge(nextTreeAdj, movedFaceId, nextParentFaceId)) {
        return { ok: false, reason: "invalid-parent-map" };
      }
      attachedEdges.push(`${movedFaceId}-${nextParentFaceId}`);
      nextRootFaceId = childOnPathFaceId;
    /*
    }
    */
  } else {
    if (previousParentFaceId === null) {
      return { ok: false, reason: "already-parent-child" };
    }
    if (!removeUndirectedEdge(nextTreeAdj, movedFaceId, previousParentFaceId)) {
      return { ok: false, reason: "invalid-parent-map" };
    }
    detachedEdges.push(`${movedFaceId}-${previousParentFaceId}`);
    if (!addUndirectedEdge(nextTreeAdj, movedFaceId, nextParentFaceId)) {
      return { ok: false, reason: "invalid-parent-map" };
    }
    attachedEdges.push(`${movedFaceId}-${nextParentFaceId}`);
  }

  const nextParentMap = orientTreeFromRoot(nextRootFaceId ?? nextParentFaceId, nextTreeAdj);
  if (!nextParentMap || nextParentMap.get(movedFaceId) !== nextParentFaceId) {
    return { ok: false, reason: "tree-rebuild-failed" };
  }

  const previousFaces = [...g.faces];
  g.treeParent = nextParentMap;
  syncGroupFacesCache(g, previousFaces);
  return {
    ok: true,
    movedFaceId,
    previousParentFaceId,
    nextParentFaceId,
  };
}

export function rebuildGroupTree(groupId: number, faceAdjacency: Map<number, Set<number>>) {
  const g = findGroup(groupId);
  if (!g) return;
  g.treeParent.clear();
  if (g.faces.length === 0) return;
  const assigned: number[] = [];

  const assign = (face: number, parent: number | null) => {
    g.treeParent.set(face, parent);
    assigned.push(face);
  };

  assign(g.faces[0], null);

  while (assigned.length < g.faces.length) {
    for (let i = 1; i < g.faces.length; i++) {
      const face = g.faces[i];
      if (assigned.includes(face)) continue;
      let parent: number | null = null;
      for (let j = assigned.length - 1; j >= 0; j--) {
        const candidate = assigned[j];
        if (areFacesAdjacent(face, candidate, faceAdjacency)) {
          parent = candidate;
          break;
        }
      }
      if (parent !== null) {
        assign(face, parent);
      }
    }
  }
  g.faces = assigned;
}

export function getGroupTree(groupId: number) {
  return findGroup(groupId)?.treeParent;
}

export function applyImportedGroups(
  imported: NonNullable<{
    id: number;
    color: string;
    treeParent?: [number, number | null][];
    faces?: number[];
    name?: string;
    placeAngle?: number;
  }[]>,
  faceAdjacency: Map<number, Set<number>>,
  options?: {
    replaceLegacyPaletteColors?: boolean;
  },
) {
  if (!imported || !imported.length) return;
  groups.length = 0;
  faceGroupMap.clear();
  groupColorCursor = 0;
  const replaceLegacyPaletteColors = options?.replaceLegacyPaletteColors === true;

  imported
    .sort((a, b) => a.id - b.id)
    .forEach((g) => {
      const importedColor = new Color(g.color);
      if (replaceLegacyPaletteColors) {
        const legacyColorIndex = GROUP_COLOR_PALETTE_LEGACY.findIndex((hex) => hex === importedColor.getHex());
        if (legacyColorIndex >= 0 && legacyColorIndex < GROUP_COLOR_PALETTE.length) {
          importedColor.setHex(GROUP_COLOR_PALETTE[legacyColorIndex]);
        }
      }
      const data: GroupData = {
        id: g.id,
        faces: [],
        color: importedColor,
        treeParent: new Map<number, number | null>(),
        name: g.name ?? `展开组 ${g.id}`,
        placeAngle: typeof g.placeAngle === "number" ? g.placeAngle : 0,
      };
      groups.push(data);

      if (Array.isArray(g.treeParent) && g.treeParent.length > 0) {
        data.treeParent = new Map<number, number | null>(g.treeParent);
        data.faces = buildFacesCacheFromParentMap(data.treeParent, g.faces);
        data.treeParent.forEach((_parentFaceId, faceId) => {
          faceGroupMap.set(faceId, g.id);
        });
        return;
      }

      (g.faces ?? []).forEach((fid) => setFaceGroup(fid, g.id));
      rebuildGroupTree(g.id, faceAdjacency);
    });

  // 仅当导入结果里确实没有任何组时，才补一个默认组。
  // 不能把“缺少 id=1”误判成“没有组”，因为合法工程的组 ID 可能并非从 1 连续开始。
  if (groups.length === 0) {
    addGroup(1);
  }
}
