let projectCounter = 0;
let currentProjectId = 0;
let currentProjectName = "未命名工程";

export type ProjectInfo = { id: number; name: string };

// 开启一个新的工程，重置当前工程标识
export function startNewProject(name?: string): ProjectInfo {
  console.log("Starting new project:", name);
  projectCounter += 1;
  currentProjectId = projectCounter;
  currentProjectName = name ?? "未命名工程";
  return { id: currentProjectId, name: currentProjectName };
}

// 获取当前工程信息
export function getCurrentProject(): ProjectInfo {
  return { id: currentProjectId, name: currentProjectName };
}
