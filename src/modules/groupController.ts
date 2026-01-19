// 展开组业务控制器：封装面增删、组颜色、编辑模式切换、导入/删除组等逻辑，依赖 groups 数据层与事件总线驱动拼缝/界面刷新。
import { Color } from "three";
import {
  getGroupColor as getGroupColorData,
  setGroupColor as setGroupColorData,
  setFaceGroup as assignFaceToGroup,
  shareEdgeWithGroup as shareEdgeWithGroupData,
  canRemoveFace as canRemoveFaceData,
  rebuildGroupTree as rebuildGroupTreeData,
  deleteGroup as deleteGroupData,
  applyImportedGroups as applyImportedGroupsData,
  getGroupIds as getGroupIdsData,
  getGroupFaces as getGroupFacesData,
  getFaceGroupMap as getFaceGroupMapData,
  addGroup as addGroupData,
  getGroupsCount as getGroupsCountData,
  getGroupTreeParent as getGroupTreeParentData,
  getGroupName as getGroupNameData,
  setGroupName as setGroupNameData,
  getGroupPlaceAngle as getGroupPlaceAngleData,
  setGroupPlaceAngle as setGroupPlaceAngleData,
  resetGroups,
  setGroupColorCursor,
} from "./groups";
import { type PPCFile } from "./ppc";
import { appEventBus } from "./eventBus";

export type GroupControllerApi = ReturnType<typeof createGroupController>;

export function createGroupController(
  log: (msg: string, tone?: "info" | "error" | "success") => void,
  getFaceAdjacency: () => Map<number, Set<number>>,
) {
  let previewGroupId = 1;
  resetGroups();

  appEventBus.on("modelCleared", () => {
    previewGroupId = 1;
    resetGroups();
  });
  
  function setGroupColor(groupId: number, color: Color) {
    if (setGroupColorData(groupId, color))
    {
      appEventBus.emit("groupColorChanged", { groupId, color });
    }
  }

  function setGroupName(groupId: number, name: string) {
    if (setGroupNameData(groupId, name)) {
      appEventBus.emit("groupNameChanged", { groupId, name });
    }
  }

  function getGroupPlaceAngle(groupId: number): number | undefined {
    return getGroupPlaceAngleData(groupId);
  }

  function setGroupPlaceAngle(groupId: number, angle: number) {
    const oldAngle = getGroupPlaceAngleData(groupId);
    if (setGroupPlaceAngleData(groupId, angle)) {
      appEventBus.emit("groupPlaceAngleChanged", { groupId, newAngle: angle, oldAngle: oldAngle ?? 0 });
    }
  }

  function updateCurrentGroupPlaceAngle(deltaAngle: number) {
    const currentAngle = getGroupPlaceAngle(previewGroupId) || 0;
    setGroupPlaceAngle(previewGroupId, currentAngle + deltaAngle);
  }

  function removeFace(faceId: number, groupId: number | null): boolean {
    if (groupId === null) return false;
    const currentGroup = getFaceGroupMapData().get(faceId);
    if (currentGroup !== groupId) return false;
    const groupSet = getGroupFacesData(groupId) ?? new Set<number>();
    const size = groupSet.size;
    if (size <= 2 || canRemoveFaceData(groupId, faceId, getFaceAdjacency())) {
      if (assignFaceToGroup(faceId, null)) {
        rebuildGroupTreeData(groupId, getFaceAdjacency());
        log(`已从组 ${getGroupIdsData().indexOf(groupId) + 1} 移除`, "success");
        appEventBus.emit("groupFaceRemoved", { groupId: groupId, faceId });
          return true;
      }
      else{
        log(`移除失败`, "error");
        return false;
      }
    } else {
      log("移除会导致展开组不连通，已取消", "error");
      return false;
    }
  }

  function addFace(faceId: number, groupId: number | null): boolean {
    // console.log('[GroupController] addFace called with faceId:', faceId, 'groupId:', groupId, 'getFaceAdjacency', getFaceAdjacency);
    if (groupId === null) return false;
    const currentGroup = getFaceGroupMapData().get(faceId) ?? null;
    if (currentGroup === groupId) return false;
    const targetSet = getGroupFacesData(groupId) ?? new Set<number>();

    if (currentGroup !== null && !canRemoveFaceData(currentGroup, faceId, getFaceAdjacency())) {
      log("该面所在的组移出后会断开，未加入当前组", "error");
      return false;
    }

    if (targetSet.size > 0 && !shareEdgeWithGroupData(faceId, groupId, getFaceAdjacency())) {
      log("该面与当前组无共边，未加入当前组", "error");
      return false;
    }

    if (!assignFaceToGroup(faceId, groupId)) return false;
    rebuildGroupTreeData(groupId, getFaceAdjacency());
    if (currentGroup) rebuildGroupTreeData(currentGroup, getFaceAdjacency());

    log(`已加入组 ${getGroupIdsData().indexOf(groupId) + 1}`, "success");
    appEventBus.emit("groupFaceAdded", { groupId: groupId, faceId });
    if (currentGroup !== null) {
      appEventBus.emit("groupFaceRemoved", { groupId: currentGroup, faceId });
    }
    return true;
  }

  function deleteGroup(groupId: number) {
    const deletedGroupFaces = getGroupFacesData(groupId);
    const ids = getGroupIdsData();
    const indexOfGroup = ids.indexOf(groupId);
    const groupName = getGroupNameData(groupId) ?? `展开组 ${groupId + 1}`;
    if (!ids.includes(groupId)) {
      console.error(`展开组 ${groupId} 不存在，删除取消`);
      return;
    }
    if (ids.length <= 1) {
      log("至少保留一个展开组，删除取消", "error");
      return;
    }
    const nextPreviewId = indexOfGroup === ids.length - 1 ? ids[indexOfGroup - 1] : ids[indexOfGroup + 1];
    if (deleteGroupData(groupId)) {
      previewGroupId = nextPreviewId;
      appEventBus.emit("groupRemoved", {
        groupId: groupId,
        groupName,
        faces: deletedGroupFaces ?? new Set<number>(),
      });
      log(`已删除 ${groupName}`, "success");
    }
  }

  function applyImportedGroups(groups: PPCFile["groups"], groupColorCursor?: number) {
    if (!groups || !groups.length) return;
    applyImportedGroupsData(groups as NonNullable<PPCFile["groups"]>, getFaceAdjacency());
    setGroupColorCursor(groupColorCursor ?? 0);
    const groupIds = getGroupIdsData();
    setPreviewGroupId(groupIds[0]);
  }

  function addGroup() {
    const newGroupId = addGroupData();
    if (newGroupId) {
      const groupName = getGroupNameData(newGroupId) ?? `展开组 ${newGroupId + 1}`;
      previewGroupId = newGroupId;
      appEventBus.emit("groupAdded", { groupId: newGroupId, groupName });
      log(`已创建 ${groupName}`, "success");
      appEventBus.emit("groupCurrentChanged", previewGroupId);
    }
  }

  function getPreviewGroupId() {
    return previewGroupId;
  }

  function setPreviewGroupId(groupId: number) {
    if (previewGroupId === groupId) return;
    previewGroupId = groupId;
    appEventBus.emit("groupCurrentChanged", previewGroupId);
  }

  return {
    getGroupsCount: getGroupsCountData,
    getGroupColor: getGroupColorData,
    getGroupIds: getGroupIdsData,
    getGroupFaces: getGroupFacesData,
    getFaceGroupMap: getFaceGroupMapData,
    getGroupTreeParent: getGroupTreeParentData,
    getGroupName: getGroupNameData,
    getGroupPlaceAngle,
    setGroupColor,
    setGroupName,
    setGroupPlaceAngle,
    updateCurrentGroupPlaceAngle,
    removeFace,
    addFace,
    deleteGroup,
    applyImportedGroups,
    addGroup,
    getPreviewGroupId,
    setPreviewGroupId };
}
