import * as THREE from "three";

function disposeMaterial(mat: THREE.Material) {
  // 释放材质引用的纹理（常见做法：遍历材质字段，找出 Texture 并 dispose）
  for (const key of Object.keys(mat)) {
    const v = (mat as any)[key];
    if (v && typeof v === "object" && v.isTexture) {
      v.dispose();
    }
  }
  mat.dispose();
}

export function disposeGroupDeep(group: THREE.Object3D, renderer?: THREE.WebGLRenderer) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  group.traverse((obj) => {
    const anyObj = obj as any;

    const g = anyObj.geometry as THREE.BufferGeometry | undefined;
    if (g) geometries.add(g);

    const m = anyObj.material as THREE.Material | THREE.Material[] | undefined;
    const addMat = (mm: THREE.Material) => materials.add(mm);
    if (Array.isArray(m)) m.forEach(addMat);
    else if (m) addMat(m);
  });

  // 先收集纹理，再 dispose（避免遍历过程中对象被改动）
  for (const m of materials) {
    for (const k of Object.keys(m)) {
      const v = (m as any)[k];
      if (v?.isTexture) textures.add(v);
    }
  }

  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());

  group.clear();
  // group.removeFromParent(); // 可选：如果你连 group 自己也要从父节点移除

  (renderer as any)?.renderLists?.dispose?.();
}