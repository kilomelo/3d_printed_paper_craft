// 展开组数据层：维护组-面映射、组颜色、组树结构等核心数据，提供基础操作并通过事件总线通知变更。
import { Color } from "three";
import { appEventBus } from "./eventBus";

export type GroupFacesMap = Map<number, Set<number>>;
export type FaceGroupMap = Map<number, number | null>;
export type GroupTreeParent = Map<number, Map<number, number | null>>;

const GROUP_COLOR_PALETTE = [0x759fff, 0xff5757, 0xffff00, 0x00ee00, 0x00ffff, 0xff70ff];

let faceGroupMap: FaceGroupMap = new Map();
let groupFaces: GroupFacesMap = new Map();
let groupColors = new Map<number, Color>();
let groupColorCursor = 0;
let groupTreeParent: GroupTreeParent = new Map();
let previewGroupId = 1;
let editGroupId: number | null = null;

export function resetGroups() {
  faceGroupMap = new Map();
  groupFaces = new Map();
  groupColors = new Map();
  groupTreeParent = new Map();
  groupColorCursor = 0;
  previewGroupId = 1;
  editGroupId = null;
  ensureGroup(1);
  appEventBus.emit("groupDataChanged", undefined);
}

export function ensureGroup(id: number) {
  let changed = false;
  if (!groupFaces.has(id)) {
    groupFaces.set(id, new Set<number>());
    changed = true;
  }
  if (!groupColors.has(id)) {
    groupColors.set(id, nextPaletteColor());
    changed = true;
  }
  if (!groupTreeParent.has(id)) {
    groupTreeParent.set(id, new Map<number, number | null>());
    changed = true;
  }
  if (changed) appEventBus.emit("groupDataChanged", undefined);
}

export function getFaceGroupMap() {
  return faceGroupMap;
}

export function getGroupFaces() {
  return groupFaces;
}

export function getGroupColors() {
  return groupColors;
}

export function getGroupTreeParent() {
  return groupTreeParent;
}

export function getPreviewGroupId() {
  return previewGroupId;
}

export function setPreviewGroupId(id: number) {
  previewGroupId = id;
  appEventBus.emit("groupDataChanged", undefined);
}

export function getEditGroupId() {
  return editGroupId;
}

export function setEditGroupId(id: number | null) {
  if (editGroupId === id) return;
  editGroupId = id;
  appEventBus.emit("groupDataChanged", undefined);
}

export function getGroupColorCursor() {
  return groupColorCursor;
}

export function setGroupColorCursor(value: number) {
  groupColorCursor = value;
}

function nextPaletteColor(): Color {
  const color = new Color(GROUP_COLOR_PALETTE[groupColorCursor % GROUP_COLOR_PALETTE.length]);
  groupColorCursor = (groupColorCursor + 1) % GROUP_COLOR_PALETTE.length;
  return color;
}

export function getGroupColor(id: number): Color {
  if (!groupColors.has(id)) {
    groupColors.set(id, nextPaletteColor());
  }
  return groupColors.get(id)!.clone();
}

export function setGroupColor(groupId: number, color: Color) {
  groupColors.set(groupId, color);
  appEventBus.emit("groupDataChanged", undefined);
}

export function setFaceGroup(faceId: number, groupId: number | null) {
  const hasPrev = faceGroupMap.has(faceId);
  const prev = faceGroupMap.get(faceId) ?? null;
  if (hasPrev && prev === groupId) return;

  if (prev !== null) {
    groupFaces.get(prev)?.delete(faceId);
  }

  faceGroupMap.set(faceId, groupId);

  if (groupId !== null) {
    ensureGroup(groupId);
    groupFaces.get(groupId)!.add(faceId);
  }
  if (!hasPrev || prev !== groupId) {
    appEventBus.emit("groupDataChanged", undefined);
  }
}

export function shareEdgeWithGroup(
  faceId: number,
  groupId: number,
  faceAdjacency: Map<number, Set<number>>,
): boolean {
  const neighbors = faceAdjacency.get(faceId);
  if (!neighbors) return false;
  const groupSet = groupFaces.get(groupId);
  if (!groupSet || groupSet.size === 0) return false;
  for (const n of neighbors) {
    if (groupSet.has(n)) return true;
  }
  return false;
}

export function canRemoveFace(
  groupId: number,
  faceId: number,
  faceAdjacency: Map<number, Set<number>>,
): boolean {
  const faces = groupFaces.get(groupId);
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
  const faces = groupFaces.get(groupId);
  const parentMap = new Map<number, number | null>();
  if (!faces || faces.size === 0) {
    groupTreeParent.set(groupId, parentMap);
    return;
  }
  const order = Array.from(faces);
  const assigned = new Set<number>();
  const assignedOrder: number[] = [];

  const assign = (face: number, parent: number | null) => {
    parentMap.set(face, parent);
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

  groupTreeParent.set(groupId, parentMap);
}

export function getGroupTree(groupId: number) {
  return groupTreeParent.get(groupId);
}

export function nextGroupId(): number {
  let id = 1;
  while (groupFaces.has(id)) id += 1;
  return id;
}

export function deleteGroup(
  groupId: number,
  faceAdjacency: Map<number, Set<number>>,
  rebuildCb: (gid: number) => void,
) {
  if (groupFaces.size <= 1) return;
  const ids = Array.from(groupFaces.keys());
  if (!ids.includes(groupId)) return;

  const newColors = new Map<number, Color>();
  groupColors.forEach((c, id) => {
    if (id === groupId) return;
    const newId = id > groupId ? id - 1 : id;
    newColors.set(newId, c);
  });

  const assignments: Array<{ faceId: number; groupId: number | null }> = [];
  faceGroupMap.forEach((gid, faceId) => {
    if (gid === null) {
      assignments.push({ faceId, groupId: null });
    } else if (gid === groupId) {
      assignments.push({ faceId, groupId: null });
    } else {
      assignments.push({ faceId, groupId: gid > groupId ? gid - 1 : gid });
    }
  });

  faceGroupMap.clear();
  groupColors = newColors;
  groupFaces = new Map<number, Set<number>>();
  groupColors.forEach((_, id) => {
    groupFaces.set(id, new Set<number>());
  });
  groupTreeParent = new Map<number, Map<number, number | null>>();
  if (groupFaces.size === 0) {
    const color = getGroupColor(1);
    groupFaces.set(1, new Set<number>());
    groupColors.set(1, color);
  }

  assignments.forEach(({ faceId, groupId }) => {
    setFaceGroup(faceId, groupId);
  });
  groupFaces.forEach((_, gid) => rebuildGroupTree(gid, faceAdjacency));
  const candidates = Array.from(groupFaces.keys()).sort((a, b) => a - b);
  const maxId = candidates[candidates.length - 1];
  let target = groupId - 1;
  if (target < 1) target = 1;
  if (target > maxId) target = maxId;
  previewGroupId = target;
  if (editGroupId !== null) {
    setEditGroupId(previewGroupId);
  }
  if (rebuildCb) rebuildCb(previewGroupId);
  appEventBus.emit("groupDataChanged", undefined);
}

export function applyImportedGroups(
  groups: NonNullable<PPCFile["groups"]>,
  faceAdjacency: Map<number, Set<number>>,
) {
  if (!groups || !groups.length) return;
  groupFaces = new Map<number, Set<number>>();
  groupColors = new Map<number, Color>();
  groups
    .sort((a, b) => a.id - b.id)
    .forEach((g) => {
      const id = g.id;
      groupFaces.set(id, new Set<number>());
      const color = new Color(g.color);
      groupColors.set(id, color);
      g.faces.forEach((faceId) => {
        setFaceGroup(faceId, id);
      });
      rebuildGroupTree(id, faceAdjacency);
    });
  const ids = Array.from(groupFaces.keys());
  if (!ids.includes(1)) {
    groupFaces.set(1, new Set<number>());
    groupColors.set(1, getGroupColor(1));
  }
  previewGroupId = Math.min(...Array.from(groupFaces.keys()));
  appEventBus.emit("groupDataChanged", undefined);
}

export type PPCFile = {
  version: string;
  meta: {
    generator: string;
    createdAt: string;
    source: string;
    units: string;
    checksum: {
      algorithm: string;
      value: string;
      scope: string;
    };
  };
  vertices: number[][];
  triangles: number[][];
  groups?: {
    id: number;
    color: string;
    faces: number[];
  }[];
  groupColorCursor?: number;
  annotations?: Record<string, unknown>;
};