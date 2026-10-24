const SESSION_STORAGE_KEY = "jade-player-session-v1";

function sessionCredentials(socket) {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
    if (stored?.playerId && stored?.resumeToken) return stored;
  } catch (_) {}
  return {
    playerId: socket?.auth?.playerId || "",
    resumeToken: socket?.auth?.resumeToken || ""
  };
}

async function accountRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export function initAccountModule({ socket, showToast = () => {} } = {}) {
  const entry = document.getElementById("accountButton");
  const root = document.getElementById("accountModal");
  const dialog = root?.querySelector('[role="dialog"]');
  const shell = document.querySelector("main.shell");
  const tabs = [...(root?.querySelectorAll("[data-account-tab]") || [])];
  const panels = [...(root?.querySelectorAll("[data-account-panel]") || [])];
  const status = document.getElementById("accountStatus");
  const guestView = document.getElementById("accountGuestView");
  const sessionView = document.getElementById("accountSessionView");
  const sessionName = document.getElementById("accountSessionName");
  const bindForm = document.getElementById("accountBindForm");
  const loginForm = document.getElementById("accountLoginForm");
  const logoutButton = document.getElementById("accountLogoutButton");
  if (!entry || !root || !dialog || !bindForm || !loginForm) return;

  let returnFocus = null;
  let pending = false;

  function setStatus(message = "", tone = "info") {
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = !message;
  }

  function setPending(next, label = "处理中…") {
    pending = next;
    for (const control of root.querySelectorAll("button, input")) control.disabled = next;
    root.setAttribute("aria-busy", String(next));
    if (next) setStatus(label);
  }

  function selectTab(name) {
    for (const tab of tabs) {
      const active = tab.dataset.accountTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.accountPanel !== name;
    const activePanel = panels.find((panel) => !panel.hidden);
    activePanel?.querySelector("input")?.focus();
  }

  function showGuest() {
    guestView.hidden = false;
    sessionView.hidden = true;
    entry.textContent = "账号";
  }

  function showSession(account = {}) {
    guestView.hidden = true;
    sessionView.hidden = false;
    const username = account.username || "已绑定账号";
    sessionName.textContent = username;
    entry.textContent = username;
  }

  async function refreshSession() {
    const { response, payload } = await accountRequest("/api/account/session");
    if (response.ok && payload.account?.bound) {
      showSession(payload.account);
      setStatus("");
      return;
    }
    showGuest();
    setStatus("");
  }

  function open() {
    returnFocus = document.activeElement;
    root.hidden = false;
    shell?.setAttribute("inert", "");
    document.body.classList.add("account-modal-open");
    setStatus("正在读取账号状态…");
    selectTab("bind");
    refreshSession().catch(() => {
      showGuest();
      setStatus("账号状态暂时无法读取，可稍后重试。", "error");
    });
  }

  function close() {
    if (pending) return;
    root.hidden = true;
    shell?.removeAttribute("inert");
    document.body.classList.remove("account-modal-open");
    setStatus("");
    returnFocus?.focus?.();
    returnFocus = null;
  }

  async function submitCredentials(form, path, includeSession) {
    if (pending || !form.reportValidity()) return;
    const fields = new FormData(form);
    const body = {
      username: String(fields.get("username") || "").trim(),
      password: String(fields.get("password") || "")
    };
    if (includeSession) Object.assign(body, sessionCredentials(socket));
    setPending(true, includeSession ? "正在绑定当前角色…" : "正在登录…");
    try {
      const { response, payload } = await accountRequest(path, {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (!response.ok || !payload.ok) {
        setStatus(payload.message || "操作失败，请稍后重试。", "error");
        return;
      }
      form.reset();
      if (includeSession) {
        showSession(payload.account);
        setStatus("当前角色已绑定账号。", "success");
        showToast({ text: "账号绑定成功。", tone: "success" });
        return;
      }
      try {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        sessionStorage.removeItem("jade-player-id");
      } catch (_) {}
      setStatus("登录成功，正在载入角色…", "success");
      window.location.reload();
    } catch (_) {
      setStatus("网络异常，账号操作未完成。", "error");
    } finally {
      setPending(false);
    }
  }

  entry.addEventListener("click", open);
  root.querySelector("[data-account-close]")?.addEventListener("click", close);
  for (const tab of tabs) tab.addEventListener("click", () => selectTab(tab.dataset.accountTab));
  bindForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCredentials(bindForm, "/api/account/bind", true);
  });
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCredentials(loginForm, "/api/account/login", false);
  });
  logoutButton?.addEventListener("click", async () => {
    if (pending) return;
    setPending(true, "正在退出当前账号…");
    try {
      const { response } = await accountRequest("/api/account/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout failed");
      try {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        sessionStorage.removeItem("jade-player-id");
      } catch (_) {}
      window.location.reload();
    } catch (_) {
      setStatus("退出失败，当前角色仍保持登录。", "error");
      setPending(false);
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.closest("[hidden]") && !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  refreshSession().catch(() => showGuest());
}
