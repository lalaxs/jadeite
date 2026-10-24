import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  WORLD_CHAT_COOLDOWN_MS,
  WORLD_CHAT_MAX_LEN,
  censorWorldChatText,
  createChatService
} from "../server/services/chat-service.js";

const state = { worldChat: [] };
const { sendWorldChat } = createChatService({
  getState: () => state,
  randomUUID
});

const player = { id: "chat-p1", name: "翠店掌柜" };
const t0 = 1_000_000;

const ok = sendWorldChat(player, { text: "大家好，今日公盘如何？" }, t0);
assert.equal(ok.ok, true);
assert.equal(state.worldChat.length, 1);
assert.equal(state.worldChat[0].speaker, "翠店掌柜");
assert.equal(state.worldChat[0].text, "大家好，今日公盘如何？");
assert.equal(state.worldChat[0].channel, "world");

const cool = sendWorldChat(player, { text: "再来一条" }, t0 + 1000);
assert.equal(cool.ok, false);
assert.match(cool.message, /冷却/);

const afterCool = sendWorldChat(player, { text: "冷却结束了" }, t0 + WORLD_CHAT_COOLDOWN_MS);
assert.equal(afterCool.ok, true);
assert.equal(state.worldChat[0].text, "冷却结束了");

const censored = sendWorldChat(player, { text: "你这个傻逼别刷单" }, t0 + WORLD_CHAT_COOLDOWN_MS * 2);
assert.equal(censored.ok, true);
assert.doesNotMatch(censored.entry.text, /傻逼|刷单/);
assert.match(censored.entry.text, /\*+/);

const blocked = sendWorldChat(player, { text: "傻逼" }, t0 + WORLD_CHAT_COOLDOWN_MS * 3);
assert.equal(blocked.ok, false);
assert.match(blocked.message, /不当内容/);

assert.equal(sendWorldChat(player, { text: "   " }, t0 + WORLD_CHAT_COOLDOWN_MS * 4).ok, false);
assert.equal(
  sendWorldChat(player, { text: "x".repeat(WORLD_CHAT_MAX_LEN + 1) }, t0 + WORLD_CHAT_COOLDOWN_MS * 5).ok,
  false
);

const { text, censored: hit } = censorWorldChatText("Hello FUCK world");
assert.equal(hit, true);
assert.doesNotMatch(text, /fuck/i);

const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const socketSource = readFileSync("server/shell/socket-handlers.js", "utf8");
const chatSource = readFileSync("public/features/chat/chat-module.js", "utf8");
const html = readFileSync("public/index.html", "utf8");

assert.match(wireSource, /createChatService/);
assert.match(wireSource, /sendWorldChat/);
assert.match(socketSource, /socket\.on\("sendWorldChat"/);
assert.match(chatSource, /socketRef\.emit\("sendWorldChat"/);
assert.match(chatSource, /result\.ok/);
assert.match(socketSource, /acknowledge/);
assert.match(chatSource, /worldChat/);
assert.match(html, /id="chatInput"/);
assert.doesNotMatch(html, /世界聊天即将开放/);
assert.doesNotMatch(html, /chatInput"[^>]*disabled/);

console.log("chat-service-smoke: ok");
