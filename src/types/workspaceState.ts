export type WorkspaceState = "mainPage" | "normal" | "editingGroup" | "previewGroupModel" | "loading";

let currentWorkspaceState: WorkspaceState = "mainPage";

export const getWorkspaceState = () => currentWorkspaceState;

// 仅主模块应调用该方法以驱动状态机与相关副作用
export const setWorkspaceState = (state: WorkspaceState) => {
  currentWorkspaceState = state;
};
