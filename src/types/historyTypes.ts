// 撤销/重做涉及的核心类型定义，供事件总线与 HistoryManager 复用。
import type { Settings } from "../modules/settings.js";

export type MetaAction = { name: string; description: string; timestamp: number; payload?: any };
export type ProjectState = {
  groups: ReturnType<typeof import("../modules/groups.js").exportGroupsData>;
  colorCursor: number;
  previewGroupId: number;
  settings: Settings;
  groupVisibility: Array<[number, boolean]>;
};
export type Snapshot = { data: ProjectState; action: MetaAction; uid: number };
