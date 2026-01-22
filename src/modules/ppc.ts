// 3dppc 格式处理：负责序列化/反序列化自定义 3dppc 文件，提供加载与下载工具。
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from "three";
import { collectGeometry, filterLargestComponent } from "./geometry";
import { getCurrentProject } from "./project";
import { getGroupColorCursor, exportGroupsData } from "./groups";
import { getSettings } from "./settings";

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
    name?: string;
    placeAngle?: number;
  }[];
  groupColorCursor?: number;
  annotations?: Record<string, unknown>;
};

const FORMAT_VERSION = "1.0";

async function computeChecksum(payload: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  if (crypto?.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = (hash << 5) - hash + data[i];
    hash |= 0;
  }
  return hash.toString(16);
}

export async function build3dppcData(object: Group): Promise<PPCFile> {
  const collected = collectGeometry(object);
  const filtered = filterLargestComponent(collected);
  const exportVertices = filtered.vertices;
  const exportTriangles = filtered.triangles;
  const mapping = filtered.mapping;

  const checksum = await computeChecksum({
    vertices: exportVertices,
    triangles: exportTriangles,
  });

  const groupsData: NonNullable<PPCFile["groups"]> = [];
  const rawGroups = exportGroupsData();
  rawGroups.forEach((g) => {
    const filteredFaces: number[] = [];
    g.faces.forEach((faceId) => {
      const mapped = mapping[faceId];
      if (mapped !== undefined && mapped >= 0) filteredFaces.push(mapped);
    });
    groupsData.push({
      id: g.id,
      color: `#${g.color.toString(16).padStart(6, "0")}`,
      faces: filteredFaces,
      name: g.name,
      placeAngle: g.placeAngle,
    });
  });

  return {
    version: FORMAT_VERSION,
    meta: {
      generator: "3D Printed Paper Craft",
      createdAt: new Date().toISOString(),
      source: getCurrentProject().name,
      units: "meter",
      checksum: {
        algorithm: "SHA-256",
        value: checksum,
        scope: "geometry",
      },
    },
    vertices: exportVertices,
    triangles: exportTriangles,
    groupColorCursor: getGroupColorCursor(),
    groups: groupsData,
    annotations: {
      settings: getSettings(),
    },
  };
}

export function download3dppc(data: PPCFile): string {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const base = getCurrentProject().name || "未命名工程";
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}`;
  const name = `${base}_${stamp}.3dppc`;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export async function load3dppc(url: string, frontMaterial: Mesh["material"]) {
  const res = await fetch(url);
  const json = (await res.json()) as PPCFile;
  if (!Array.isArray(json.vertices) || !Array.isArray(json.triangles)) {
    throw new Error("3dppc 格式缺少 vertices/triangles");
  }
  const group = new Group();

  const vertices = json.vertices;
  const triangles = json.triangles;

  const positions: number[] = [];
  const indices: number[] = [];

  vertices.forEach(([x, y, z]) => {
    positions.push(x, y, z);
  });
  triangles.forEach(([a, b, c]) => {
    indices.push(a, b, c);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, frontMaterial);
  group.add(mesh);

  const colorCursor =
    typeof json.groupColorCursor === "number"
      ? json.groupColorCursor
      : undefined;

  return { object: group, groups: json.groups, colorCursor, annotations: json.annotations };
}
