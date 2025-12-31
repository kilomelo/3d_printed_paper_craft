// 展开组业务控制器：封装面增删、组颜色、编辑模式切换、导入/删除组等逻辑，依赖 groups 数据层与事件总线驱动拼缝/界面刷新。
import { Color } from "three";
import {
  setEditGroupId,
  setPreviewGroupId,
  setGroupColor,
  getGroupColor as getGroupColorData,
  setFaceGroup as assignFaceToGroup,
  shareEdgeWithGroup as shareEdgeWithGroupData,
  canRemoveFace as canRemoveFaceData,
  rebuildGroupTree as rebuildGroupTreeData,
  deleteGroup as deleteGroupData,
  applyImportedGroups as applyImportedGroupsData,
  getGroupFaces,
  getFaceGroupMap,
  ensureGroup,
  nextGroupId,
  setEditGroupId,
  getEditGroupId,
  getPreviewGroupId,
} from "./groups";
import { type FaceColorService } from "./faceColorService";
import { type PPCFile } from "./ppc";
import { appEventBus } from "./eventBus";

export type GroupControllerDeps = {
  getFaceAdjacency: () => Map<number, Set<number>>;
  refreshGroupRefs: () => void;
  repaintAllFaces: () => void;
  setStatus: (msg: string, tone?: "info" | "error" | "success") => void;
  startGroupBreath: (groupId: number) => void;
  stopGroupBreath: () => void;
  faceColorService: FaceColorService;
};

export type GroupControllerApi = ReturnType<typeof createGroupController>;

export function createGroupController(deps: GroupControllerDeps) {
  const faceGroupMap = () => getFaceGroupMap();
  const groupFaces = () => getGroupFaces();
  const faceAdjacency = () => deps.getFaceAdjacency();
  const notifyGroupChange = () => appEventBus.emit("groupDataChanged", undefined);

  function applyGroupColor(groupId: number, color: Color) {
    setGroupColor(groupId, color);
    const faces = groupFaces().get(groupId);
    if (faces) {
      faces.forEach((faceId) => deps.faceColorService.updateFaceColorById(faceId));
    }
    notifyGroupChange();
  }

  function rebuildGroupTree(groupId: number) {
    rebuildGroupTreeData(groupId, faceAdjacency());
    deps.refreshGroupRefs();
  }

  function rebuildGroupTrees(groupIds: Set<number>) {
    groupIds.forEach((gid) => rebuildGroupTree(gid));
  }

  function canRemoveFace(groupId: number, faceId: number): boolean {
    return canRemoveFaceData(groupId, faceId, faceAdjacency());
  }

  function shareEdgeWithGroup(faceId: number, groupId: number): boolean {
    return shareEdgeWithGroupData(faceId, groupId, faceAdjacency());
  }

  function handleRemoveFace(faceId: number, editGroupId: number | null) {
    if (editGroupId === null) return;
    const currentGroup = faceGroupMap().get(faceId);
    if (currentGroup !== editGroupId) return;
    const groupSet = groupFaces().get(editGroupId) ?? new Set<number>();
    const size = groupSet.size;
    if (size <= 2 || canRemoveFace(editGroupId, faceId)) {
      assignFaceToGroup(faceId, null);
      deps.faceColorService.updateFaceColorById(faceId);
      rebuildGroupTree(editGroupId);
      const facesToUpdate = new Set<number>([faceId]);
      (groupFaces().get(editGroupId) ?? new Set<number>()).forEach((f) => facesToUpdate.add(f));
      appEventBus.emit("seamsRebuildFaces", facesToUpdate);
      appEventBus.emit("group2dFaceRemoved", { groupId: editGroupId, faceId });
      notifyGroupChange();
      deps.setStatus(`已从组${editGroupId}移除（面数量 ${groupFaces().get(editGroupId)?.size ?? 0}）`, "success");
    } else {
      deps.setStatus("移除会导致展开组不连通，已取消", "error");
    }
  }

  function handleAddFace(faceId: number, editGroupId: number | null) {
    if (editGroupId === null) return;
    const targetGroup = editGroupId;
    const currentGroup = faceGroupMap().get(faceId) ?? null;
    if (currentGroup === targetGroup) return;

    const targetSet = groupFaces().get(targetGroup) ?? new Set<number>();

    if (currentGroup !== null && !canRemoveFace(currentGroup, faceId)) {
      deps.setStatus("该面所在的组移出后会断开，未加入当前组", "error");
      return;
    }

    if (targetSet.size > 0 && !shareEdgeWithGroup(faceId, targetGroup)) {
      deps.setStatus("该面与当前组无共边，未加入", "error");
      return;
    }

    if (currentGroup !== null) assignFaceToGroup(faceId, null);
    assignFaceToGroup(faceId, targetGroup);
    deps.faceColorService.updateFaceColorById(faceId);
    const affectedGroups = new Set<number>([targetGroup]);
    if (currentGroup !== null) affectedGroups.add(currentGroup);
    rebuildGroupTrees(affectedGroups);
    deps.setStatus(`已加入组${targetGroup}（面数量 ${groupFaces().get(targetGroup)?.size ?? 0}）`, "success");
    const groups = new Set<number>([targetGroup]);
    if (currentGroup !== null) groups.add(currentGroup);
    appEventBus.emit("seamsRebuildGroups", groups);
    appEventBus.emit("group2dFaceAdded", { groupId: targetGroup, faceId });
    if (currentGroup !== null) {
      appEventBus.emit("group2dFaceRemoved", { groupId: currentGroup, faceId });
    }
    notifyGroupChange();
  }

  function setEditGroup(groupId: number | null, currentEdit: number | null, previewGroupId: number) {
    if (currentEdit !== null && groupId === currentEdit) return { editGroupId: currentEdit, previewGroupId };
    setEditGroupId(groupId);
    deps.refreshGroupRefs();
    if (groupId === null) {
      deps.setStatus("已退出展开组编辑模式");
      deps.stopGroupBreath();
      return { editGroupId: null, previewGroupId };
    }
    if (!groupFaces().has(groupId)) {
      groupFaces().set(groupId, new Set<number>());
    }
    setPreviewGroupId(groupId);
    deps.refreshGroupRefs();
    deps.setStatus(`展开组 ${groupId} 编辑模式：左键加入，右键移出`, "info");
    deps.startGroupBreath(groupId);
    notifyGroupChange();
    return { editGroupId: groupId, previewGroupId: groupId };
  }

  function deleteGroup(groupId: number, editGroupId: number | null) {
    if (groupFaces().size <= 1) return { editGroupId, previewGroupId: getPreviewGroupId() };
    const ids = Array.from(groupFaces().keys());
    if (!ids.includes(groupId)) return { editGroupId, previewGroupId: getPreviewGroupId() };
    deleteGroupData(groupId, faceAdjacency(), (gid) => {
      deps.refreshGroupRefs();
      setPreviewGroupId(gid);
      if (editGroupId !== null) {
        setEditGroupId(gid);
      }
    });
    deps.refreshGroupRefs();
    deps.repaintAllFaces();
    appEventBus.emit("seamsRebuildFull", undefined);
    deps.setStatus(`已删除展开组 ${groupId}`, "success");
    notifyGroupChange();
    return { editGroupId: getEditGroupId(), previewGroupId: getPreviewGroupId() };
  }

  function applyImportedGroups(groups: PPCFile["groups"]) {
    if (!groups || !groups.length) return;
    applyImportedGroupsData(groups as NonNullable<PPCFile["groups"]>, faceAdjacency());
    deps.refreshGroupRefs();
    groupFaces().forEach((_, gid) => rebuildGroupTree(gid));
    deps.refreshGroupRefs();
    const pid = Math.min(...Array.from(groupFaces().keys()));
    setPreviewGroupId(pid);
    deps.refreshGroupRefs();
    deps.repaintAllFaces();
    notifyGroupChange();
  }

  function createGroup(currentEditGroupId: number | null): { groupId: number; previewGroupId: number; editGroupId: number | null } {
    const id = nextGroupId();
    ensureGroup(id);
    setPreviewGroupId(id);
    const nextEdit = currentEditGroupId !== null ? id : null;
    setEditGroupId(nextEdit);
    deps.refreshGroupRefs();
    notifyGroupChange();
    deps.setStatus(`已创建展开组 ${id}`, "success");
    return { groupId: id, previewGroupId: id, editGroupId: nextEdit };
  }

  return { applyGroupColor, handleRemoveFace, handleAddFace, setEditGroup, deleteGroup, applyImportedGroups, createGroup };
}
