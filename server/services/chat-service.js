/**
 * World chat — player UGC with cooldown + basic sensitive-word censoring.
 */
export const WORLD_CHAT_COOLDOWN_MS = 7000;
export const WORLD_CHAT_MAX_LEN = 120;
export const WORLD_CHAT_HISTORY_LIMIT = 80;

/** Sorted longest-first so multi-char phrases win over substrings. */
export const WORLD_CHAT_SENSITIVE_WORDS = [
  "习近平",
  "毛泽东",
  "共产党",
  "法轮功",
  "台独",
  "藏独",
  "疆独",
  "港独",
  "六四",
  "天安门",
  "操你",
  "草你",
  "肏你",
  "草你妈",
  "操你妈",
  "傻屄",
  "傻逼",
  "傻B",
  "傻b",
  "煞笔",
  "妈的",
  "妈逼",
  "妈B",
  "去死",
  "滚蛋",
  "杂种",
  "贱人",
  "婊子",
  "妓女",
  "鸡巴",
  "屌丝",
  "强奸",
  "轮奸",
  "色情",
  "黄色网站",
  "加微信",
  "加QQ",
  "代充",
  "刷单",
  "赌博",
  "博彩",
  "色情服务",
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "nigger",
  "faggot"
].slice().sort((a, b) => b.length - a.length);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function censorWorldChatText(raw) {
  let text = String(raw || "");
  let hit = false;
  for (const word of WORLD_CHAT_SENSITIVE_WORDS) {
    if (!word) continue;
    const pattern = new RegExp(escapeRegExp(word), "gi");
    const next = text.replace(pattern, "*".repeat(Math.min(Math.max(word.length, 1), 8)));
    if (next !== text) {
      hit = true;
      text = next;
    }
  }
  return { text, censored: hit };
}

export function createChatService(deps = {}) {
  const { getState, randomUUID } = deps;
  if (typeof getState !== "function") {
    throw new Error("chat-service: getState is required");
  }
  if (typeof randomUUID !== "function") {
    throw new Error("chat-service: randomUUID is required");
  }

  const lastChatAtByPlayer = new Map();

  function ensureWorldChat() {
    const state = getState();
    if (!Array.isArray(state.worldChat)) state.worldChat = [];
    return state.worldChat;
  }

  function sendWorldChat(player, payload = {}, now = Date.now()) {
    if (!player?.id) return { ok: false, message: "玩家无效" };
    if (Number(player.moderation?.mutedUntil || 0) > Number(now)) {
      return { ok: false, message: player.moderation?.muteReason || "你当前处于禁言状态" };
    }

    const raw = String(payload.text ?? "").trim();
    if (!raw) return { ok: false, message: "消息不能为空" };
    if ([...raw].length > WORLD_CHAT_MAX_LEN) {
      return { ok: false, message: `消息最多 ${WORLD_CHAT_MAX_LEN} 字` };
    }

    const lastAt = Number(lastChatAtByPlayer.get(String(player.id)) || 0);
    const remainMs = WORLD_CHAT_COOLDOWN_MS - (Number(now) - lastAt);
    if (remainMs > 0) {
      const secs = Math.max(1, Math.ceil(remainMs / 1000));
      return { ok: false, message: `发言冷却中，请 ${secs} 秒后再试` };
    }

    const { text } = censorWorldChatText(raw);
    const cleaned = text.trim();
    if (!cleaned || /^[\s*·•.。，,、！!？?\-—_]+$/.test(cleaned)) {
      return { ok: false, message: "消息包含不当内容，请修改后再发" };
    }

    const entry = {
      id: randomUUID(),
      playerId: String(player.id),
      speaker: String(player.name || "掌柜").trim().slice(0, 16) || "掌柜",
      text: cleaned.slice(0, WORLD_CHAT_MAX_LEN),
      at: Number(now) || Date.now(),
      channel: "world"
    };

    const list = ensureWorldChat();
    list.unshift(entry);
    if (list.length > WORLD_CHAT_HISTORY_LIMIT) {
      list.length = WORLD_CHAT_HISTORY_LIMIT;
    }
    lastChatAtByPlayer.set(String(player.id), entry.at);
    return { ok: true, message: "已发送", entry };
  }

  return {
    sendWorldChat,
    censorWorldChatText,
    WORLD_CHAT_COOLDOWN_MS,
    WORLD_CHAT_MAX_LEN,
    WORLD_CHAT_HISTORY_LIMIT
  };
}
