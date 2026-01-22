// 通用文件加载器：根据扩展名加载模型文件，并处理 3dppc 的附加数据。
import type { Object3D } from "three";
import { Mesh } from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { createFrontMaterial } from "./materials";
import { snapGeometryPositions } from "./geometry";
import { load3dppc, type PPCFile } from "./ppc";

const objLoader = new OBJLoader();
const fbxLoader = new FBXLoader();
const stlLoader = new STLLoader();

export async function loadRawObject(
  file: File,
  ext: string,
): Promise<{ object: Object3D; importedGroups?: PPCFile["groups"]; importedColorCursor?: number; importedSeting?: Object }> {
  const url = URL.createObjectURL(file);
  try {
    let object: Object3D;
    let importedGroups: PPCFile["groups"] | undefined;
    let importedColorCursor: number | undefined;
    let importedSeting: Object | undefined;
    if (ext === "obj") {
      const loaded = await objLoader.loadAsync(url);
      const mat = createFrontMaterial();
      loaded.traverse((child) => {
        if ((child as Mesh).isMesh) {
          (child as Mesh).material = mat.clone();
          snapGeometryPositions((child as Mesh).geometry);
        }
      });
      object = loaded;
    } else if (ext === "fbx") {
      const loaded = await fbxLoader.loadAsync(url);
      const mat = createFrontMaterial();
      loaded.traverse((child) => {
        if ((child as Mesh).isMesh) {
          (child as Mesh).material = mat.clone();
          snapGeometryPositions((child as Mesh).geometry);
        }
      });
      object = loaded;
    } else if (ext === "stl") {
      const geometry = await stlLoader.loadAsync(url);
      snapGeometryPositions(geometry);
      const material = createFrontMaterial();
      object = new Mesh(geometry, material);
    } else {
      const loaded = await load3dppc(url, createFrontMaterial());
      object = loaded.object;
      importedGroups = loaded.groups;
      importedColorCursor = loaded.colorCursor;
      if (loaded.annotations && typeof loaded.annotations.settings === "object") {
        importedSeting = loaded.annotations.settings??undefined;
      }
    }
    return { object, importedGroups, importedColorCursor, importedSeting };
  } finally {
    URL.revokeObjectURL(url);
  }
}
