// 展开组数据层：使用统一的 GroupData 结构管理组的面、颜色与树结构，并维护 face->group 的映射。
import { Color } from "three";

export type GroupData = {
  id: number;
  faces: Set<number>;
  color: Color;
  treeParent: Map<number, number | null>;
};

const GROUP_COLOR_PALETTE = [0x759fff, 0xff5757, 0xffff00, 0x00ee00, 0x00ffff, 0xff70ff];

let groups: GroupData[] = [];
let faceGroupMap: Map<number, number | null> = new Map();
let groupColorCursor = 0;

function nextPaletteColor(): Color {
  const color = new Color(GROUP_COLOR_PALETTE[groupColorCursor % GROUP_COLOR_PALETTE.length]);
  groupColorCursor = (groupColorCursor + 1) % GROUP_COLOR_PALETTE.length;
  return color;
}

function findGroup(id: number): GroupData | undefined {
  return groups.find((g) => g.id === id);
}

function nextGroupId(): number {
  if (!groups.length) return 1;
  const maxId = Math.max(...groups.map((g) => g.id));
  return maxId + 1;
}

export function resetGroups() {
  groups = [];
  faceGroupMap = new Map();
  groupColorCursor = 0;
  addGroup(1);
}

export function addGroup(newGroupId?: number): number | undefined {
  // console.trace(`[groups] Adding group with id: ${newGroupId}`); 
  newGroupId = newGroupId ?? nextGroupId();
  let exists = findGroup(newGroupId);
  if (exists) return undefined;
  else{
    exists = {
      id: newGroupId,
      faces: new Set<number>(),
      color: nextPaletteColor(),
      treeParent: new Map<number, number | null>(),
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
  groups = groups.filter((g) => g.id !== groupId);
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
  return findGroup(id)?.faces;
}

export function getGroupColor(id: number): Color | undefined {
  const g = findGroup(id);
  return g ? g.color.clone() : undefined;
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

export function setFaceGroup(faceId: number, groupId: number | null): boolean {
  const prev = faceGroupMap.get(faceId) ?? null;
  if (prev === groupId) return false;

  if (prev !== null) {
    const pg = findGroup(prev);
    pg?.faces.delete(faceId);
  }

  if (groupId !== null) {
    const g = findGroup(groupId);
    if (!g) return false;
    g.faces.add(faceId);
  }
  faceGroupMap.set(faceId, groupId);
  return true;
}

export function shareEdgeWithGroup(
  faceId: number,
  groupId: number,
  faceAdjacency: Map<number, Set<number>>,
): boolean {
  const neighbors = faceAdjacency.get(faceId);
  if (!neighbors) return false;
  const groupSet = findGroup(groupId)?.faces;
  if (!groupSet || groupSet.size === 0) return false;
  for (const n of neighbors) {
    if (groupSet.has(n)) return true;
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
  const faces = findGroup(groupId)?.faces;
  if (!faces || faces.size <= 1) return true;
  if (!faces.has(faceId)) return true;

  const remaining = new Set(faces);
  remaining.delete(faceId);
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

export function rebuildGroupTree(groupId: number, faceAdjacency: Map<number, Set<number>>) {
  const g = findGroup(groupId);
  if (!g) return;
  g.treeParent.clear();
  if (g.faces.size === 0) return;
  const order = Array.from(g.faces);
  const assigned = new Set<number>();
  const assignedOrder: number[] = [];

  const assign = (face: number, parent: number | null) => {
    g.treeParent.set(face, parent);
    assigned.add(face);
    assignedOrder.push(face);
  };

  assign(order[0], null);

  while (assigned.size < order.length) {
    let progressed = false;
    for (let i = 1; i < order.length; i++) {
      const face = order[i];
      if (assigned.has(face)) continue;
      let parent: number | null = null;
      for (let j = assignedOrder.length - 1; j >= 0; j--) {
        const candidate = assignedOrder[j];
        if (areFacesAdjacent(face, candidate, faceAdjacency)) {
          parent = candidate;
          break;
        }
      }
      if (parent !== null) {
        assign(face, parent);
        progressed = true;
      }
    }
    if (!progressed) {
      const remaining = order.find((f) => !assigned.has(f))!;
      assign(remaining, assignedOrder[0]);
    }
  }
}

export function getGroupTree(groupId: number) {
  return findGroup(groupId)?.treeParent;
}

export function applyImportedGroups(
  imported: NonNullable<{
    id: number;
    color: string;
    faces: number[];
  }[]>,
  faceAdjacency: Map<number, Set<number>>,
) {
  if (!imported || !imported.length) return;
  groups = [];
  faceGroupMap = new Map<number, number | null>();
  groupColorCursor = 0;

  imported
    .sort((a, b) => a.id - b.id)
    .forEach((g) => {
      const data: GroupData = {
        id: g.id,
        faces: new Set<number>(),
        color: new Color(g.color),
        treeParent: new Map<number, number | null>(),
      };
      groups.push(data);
      g.faces.forEach((fid) => setFaceGroup(fid, g.id));
      rebuildGroupTree(g.id, faceAdjacency);
    });

  if (!groups.find((g) => g.id === 1)) {
    addGroup(1);
  }
}