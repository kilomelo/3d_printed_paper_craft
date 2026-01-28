// 展开组数据层：使用统一的 GroupData 结构管理组的面、颜色与树结构，并维护 face->group 的映射。
import { Color } from "three";
import { t } from "./i18n";

export type GroupData = {
  id: number;
  faces: number[]; // 有序数组，按加入顺序存储
  color: Color;
  treeParent: Map<number, number | null>;
  name: string;
  placeAngle: number;
};

const GROUP_COLOR_PALETTE = [0x86a6ee, 0xea6c6c, 0xdfdf20, 0x3ecb3e, 0x20dfdf, 0xed82ed];

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
  const faces = findGroup(id)?.faces;
  return faces ? new Set(faces) : undefined;
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
    faces: Array.from(g.faces),
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
    }
  }

  if (groupId !== null) {
    const g = findGroup(groupId);
    if (!g) return false;
    if (!g.faces.includes(faceId)) {
      g.faces.push(faceId);
    }
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
  const groupFaces = findGroup(groupId)?.faces;
  if (!groupFaces || groupFaces.length === 0) return false;
  for (const n of neighbors) {
    if (groupFaces.includes(n)) return true;
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
  if (!faces || faces.length <= 1) return true;
  if (!faces.includes(faceId)) return true;

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
    faces: number[];
    name?: string;
    placeAngle?: number;
  }[]>,
  faceAdjacency: Map<number, Set<number>>,
) {
  if (!imported || !imported.length) return;
  groups.length = 0;
  faceGroupMap.clear();
  groupColorCursor = 0;

  imported
    .sort((a, b) => a.id - b.id)
    .forEach((g) => {
      const data: GroupData = {
        id: g.id,
        faces: [],
        color: new Color(g.color),
        treeParent: new Map<number, number | null>(),
        name: g.name ?? `展开组 ${g.id}`,
        placeAngle: typeof g.placeAngle === "number" ? g.placeAngle : 0,
      };
      groups.push(data);
      g.faces.forEach((fid) => setFaceGroup(fid, g.id));
      rebuildGroupTree(g.id, faceAdjacency);
    });

  if (!groups.find((g) => g.id === 1)) {
    addGroup(1);
  }
}
