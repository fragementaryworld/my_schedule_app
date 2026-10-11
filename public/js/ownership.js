// 每项任务只选择一个存放位置；项目类型和历史来源不再参与界面分类。
export const LIST_OPTIONS = [
  { value: 'list:inbox', label: '收集箱' },
  { value: 'list:work', label: '工作事务' },
  { value: 'list:personal', label: '生活事务' }
];

export function ownerProjectId(task) {
  return task.projectId !== undefined ? task.projectId : (task.source?.type === 'project' ? task.source.id : null);
}

export function ownership(task, projects = []) {
  const project = projects.find(p => p.id === ownerProjectId(task));
  if (project) return { ownerKey: `project:${project.id}`, ownerLabel: project.name, projectId: project.id, projectName: project.name };
  // 老任务没有 listId 时保留在工作事务，避免突然变成待整理事项。
  const list = LIST_OPTIONS.find(o => o.value === `list:${task.listId || 'work'}`) || LIST_OPTIONS[0];
  return { ownerKey: list.value, ownerLabel: list.label, projectId: null, projectName: '' };
}

export function ownerOptions(projects = []) {
  return [...LIST_OPTIONS, ...projects.map(p => ({ value: `project:${p.id}`, label: `项目 · ${p.name}` }))];
}

export function ownerPatch(value) {
  return value.startsWith('project:') ? { projectId: value.slice(8), listId: null }
    : { projectId: null, listId: value.slice(5) };
}
