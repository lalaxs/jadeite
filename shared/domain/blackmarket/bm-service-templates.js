/** Black market service offer templates — shared by server + client. */
export const BM_SERVICE_TEMPLATES = [
  {
    id: "open-window",
    title: "代开料",
    defaultDesc: "",
    defaultEta: 35,
    skillKeys: ["jieliao", "damo"],
    deviceStage: "opening",
    sortOrder: 0
  },
  {
    id: "carve-plan",
    title: "代规划取镯",
    defaultDesc: "",
    defaultEta: 45,
    skillKeys: ["qieliao", "xiuxing"],
    deviceStage: "carving",
    sortOrder: 1
  },
  {
    id: "inlay-finish",
    title: "代镶嵌收口",
    defaultDesc: "",
    defaultEta: 60,
    skillKeys: ["diaozhuo", "xiangqian"],
    deviceStage: "finishing",
    sortOrder: 2
  }
];

export function bmServiceTemplateById(id) {
  return BM_SERVICE_TEMPLATES.find((t) => t.id === id) || null;
}

export function bmServiceTemplateSortOrder(templateId) {
  return bmServiceTemplateById(templateId)?.sortOrder ?? 50;
}

/** Player-selectable headline tags (must match auto-eligibility on server). */
export const BM_SERVICE_HEADLINE_TAGS = [
  { id: "open-window", label: "代开料" },
  { id: "carve-plan", label: "代规划" },
  { id: "inlay-finish", label: "代镶嵌" }
];

export const BM_SERVICE_ACCEPT_SCOPES = [
  { id: "sealed", label: "暗料" },
  { id: "opened", label: "明料" },
  { id: "finished", label: "成品" },
  { id: "premium", label: "高货" }
];

export function bmServiceHeadlineTagById(id) {
  return BM_SERVICE_HEADLINE_TAGS.find((tag) => tag.id === id) || null;
}

export function bmServiceAcceptScopeById(id) {
  return BM_SERVICE_ACCEPT_SCOPES.find((scope) => scope.id === id) || null;
}
