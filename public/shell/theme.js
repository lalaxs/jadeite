// Day/night theme toggle (moved from main.js)

let getEls = () => null;

export function bindThemeDeps(deps = {}) {
  if (typeof deps.getEls === "function") getEls = deps.getEls;
}

export const THEME_KEY = "jade-theme";
export const themeIcons = {
  night: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>',
  day: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>'
};

export function applyTheme(theme) {
  const els = getEls();

  const t = theme === "day" ? "day" : "night";
  document.documentElement.dataset.theme = t;
  if (els.themeToggle) els.themeToggle.innerHTML = themeIcons[t === "night" ? "day" : "night"];
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
}

export function initTheme() {
  const els = getEls();

  let saved = "night";
  try { saved = localStorage.getItem(THEME_KEY) || "night"; } catch (e) {}
  applyTheme(saved);
  if (els.themeToggle) els.themeToggle.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "day" ? "night" : "day");
  });
}

