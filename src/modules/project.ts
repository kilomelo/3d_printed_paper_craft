let currentProjectName = "未命名工程";

export type ProjectInfo = { name: string };

// 开启一个新的工程，重置当前工程标识
export function startNewProject(name?: string): ProjectInfo {
  console.log("Starting new project:", name);
  currentProjectName = name ?? "未命名工程";
  return { name: currentProjectName };
}

// 获取当前工程信息
export function getCurrentProject(): ProjectInfo {
  return { name: currentProjectName };
}
