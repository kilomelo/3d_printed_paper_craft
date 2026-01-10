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
  group.traverse((obj) => {
    if (!(obj as any).isMesh) return;
    const mesh = obj as THREE.Mesh;

    mesh.geometry?.dispose();

    const mat = mesh.material as THREE.Material | THREE.Material[];
    const disposeMat = (m: THREE.Material) => {
      for (const k of Object.keys(m)) {
        const v = (m as any)[k];
        if (v?.isTexture) v.dispose();
      }
      m.dispose();
    };

    if (Array.isArray(mat)) mat.forEach(disposeMat);
    else if (mat) disposeMat(mat);
  });

  group.clear();
  // group.removeFromParent();

  // 3) 可选：WebGLRenderer 场景切换/大量删除后，清理内部 renderLists 缓存（历史上对“看似没释放”有帮助）
  (renderer as any)?.renderLists?.dispose?.();
}