import { sampleCubicOutline, pointInOutline } from "./outline-geometry.js";

export const SVG_FILTER_IDS = [
  "jadeVar",
  "jadeMarble",
  "zoneMixA",
  "zoneMixB",
  "wasteBlur",
  "flowerTex",
  "grain",
  "colorWash",
  "crackWarp",
  "skinMottle",
  "rock",
  "scratchMask"
];

export const JADE_OPENING_DEFS = `
<defs>
  <clipPath id="stoneClip"><path id="stonePath" d=""/></clipPath>
  <g id="jadeMaterial"></g>
  <radialGradient id="roughBase" cx="40%" cy="34%" r="82%">
    <stop id="rc0" offset="0%" stop-color="#7a6253"/>
    <stop id="rc1" offset="100%" stop-color="#2c2017"/>
  </radialGradient>
  <filter id="jadeVar" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feTurbulence id="varTurb" type="fractalNoise" baseFrequency="0.005 0.008" numOctaves="5" seed="77" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0.35 0.15 0 0" result="alphaMap"/>
    <feComponentTransfer in="alphaMap" result="varMask"><feFuncA type="linear" slope="2.2" intercept="-0.5"/></feComponentTransfer>
    <feFlood id="varLight" flood-color="#ffffff" flood-opacity="0.50" result="vLight"/>
    <feComposite in="vLight" in2="varMask" operator="in" result="lightArea"/>
    <feFlood id="varDark" flood-color="#000000" flood-opacity="0.50" result="vDark"/>
    <feComponentTransfer in="varMask" result="invMask"><feFuncA type="linear" slope="-1.0" intercept="1.0"/></feComponentTransfer>
    <feComposite in="vDark" in2="invMask" operator="in" result="darkArea"/>
    <feBlend mode="normal" in="lightArea" in2="darkArea" result="variation"/>
    <feGaussianBlur in="variation" stdDeviation="2" result="softVar"/>
  </filter>
  <filter id="jadeMarble" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feTurbulence id="marbleTurb" type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="6" seed="42" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0.30 0.15 0 0" result="alphaMap"/>
    <feComponentTransfer in="alphaMap" result="stretched"><feFuncA type="gamma" amplitude="1.8" exponent="1.4" offset="-0.35"/></feComponentTransfer>
    <feFlood id="marbleLight" flood-color="#ffffff" flood-opacity="0.55" result="white"/>
    <feFlood id="marbleDark" flood-color="#000000" flood-opacity="0.35" result="black"/>
    <feComposite in="white" in2="stretched" operator="in" result="light"/>
    <feComposite in="black" in2="stretched" operator="in" result="dark"/>
    <feBlend mode="screen" in="light" in2="dark" result="marbled"/>
    <feGaussianBlur in="marbled" stdDeviation="1.5" result="softMarble"/>
  </filter>
  <filter id="zoneMixA" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
    <feTurbulence id="zoneATurb" type="fractalNoise" baseFrequency="0.0035 0.005" numOctaves="3" seed="1" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0" result="lum"/>
    <feComponentTransfer in="lum" result="soft"><feFuncA type="table" tableValues="0 0 0.01 0.02 0.05 0.12 0.28 0.52 0.74 0.89 0.96 0.98 1 1"/></feComponentTransfer>
    <feGaussianBlur in="soft" stdDeviation="2.2" result="mask"/>
    <feComposite in="SourceGraphic" in2="mask" operator="in"/>
  </filter>
  <filter id="zoneMixB" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
    <feTurbulence id="zoneBTurb" type="fractalNoise" baseFrequency="0.004 0.0055" numOctaves="3" seed="2" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0" result="lum"/>
    <feComponentTransfer in="lum" result="soft"><feFuncA type="table" tableValues="0 0 0.01 0.02 0.05 0.12 0.28 0.52 0.74 0.89 0.96 0.98 1 1"/></feComponentTransfer>
    <feGaussianBlur in="soft" stdDeviation="2.2" result="mask"/>
    <feComposite in="SourceGraphic" in2="mask" operator="in"/>
  </filter>
  <filter id="wasteBlur" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="flowerTex" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
    <feTurbulence id="flowerTurb" type="fractalNoise" baseFrequency="0.018 0.028" numOctaves="4" seed="3" result="t"/>
    <feColorMatrix in="t" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0" result="lum"/>
    <feComponentTransfer in="lum" result="patch"><feFuncA type="gamma" amplitude="1.8" exponent="1.8" offset="-0.12"/></feComponentTransfer>
    <feFlood id="flowerFlood" flood-color="#1f6f8f" result="col"/>
    <feComposite in="col" in2="patch" operator="in" result="ink"/>
    <feGaussianBlur in="ink" stdDeviation="6" result="soft"/>
    <feGaussianBlur in="SourceAlpha" stdDeviation="20" result="softA"/>
    <feComposite in="soft" in2="softA" operator="in"/>
  </filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence id="grainTurb" type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11" stitchTiles="stitch" result="t"/>
    <feColorMatrix in="t" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0"/>
  </filter>
  <filter id="colorWash" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
    <feTurbulence id="washTurb" type="fractalNoise" baseFrequency="0.0035 0.006" numOctaves="4" seed="88" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.4 0.3 0.2 0 0" result="alphaMask"/>
    <feComponentTransfer in="alphaMask" result="band"><feFuncA type="linear" slope="1.5" intercept="-0.15"/></feComponentTransfer>
    <feFlood id="washColor" flood-color="#2faa55" flood-opacity="0.45" result="colored"/>
    <feComposite in="colored" in2="band" operator="in" result="washed"/>
    <feGaussianBlur in="washed" stdDeviation="3.5" result="finalWash"/>
  </filter>
  <filter id="crackWarp" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
    <feTurbulence id="crackTurb" type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="5" result="t"/>
    <feDisplacementMap in="SourceGraphic" in2="t" scale="4" xChannelSelector="R" yChannelSelector="G" result="disp"/>
    <feGaussianBlur in="disp" stdDeviation="0.5"/>
  </filter>
  <filter id="skinMottle" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feTurbulence id="mottleTurb" type="fractalNoise" baseFrequency="0.01 0.016" numOctaves="4" seed="33" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0.3 0.2 0 0" result="a"/>
    <feComponentTransfer in="a" result="m"><feFuncA type="linear" slope="1.4" intercept="-0.4"/></feComponentTransfer>
    <feFlood id="mottleColor" flood-color="#3a8f4f" flood-opacity="0.32" result="c"/>
    <feComposite in="c" in2="m" operator="in" result="mt"/>
    <feGaussianBlur in="mt" stdDeviation="2.5"/>
  </filter>
  <filter id="rock" x="-12%" y="-12%" width="124%" height="124%">
    <feTurbulence id="rockTurb" type="fractalNoise" baseFrequency="0.013 0.02" numOctaves="5" seed="7" result="n"/>
    <feDiffuseLighting in="n" lighting-color="#ffffff" surfaceScale="2.4" diffuseConstant="1.05" result="l"><feDistantLight azimuth="235" elevation="58"/></feDiffuseLighting>
    <feComposite in="l" in2="SourceAlpha" operator="in" result="lm"/>
    <feBlend in="lm" in2="SourceGraphic" mode="multiply"/>
  </filter>
	<mask id="scratchMask">
		<rect x="0" y="0" width="600" height="600" fill="#fff"/>
		<g id="brushGroup"></g>
	</mask>
</defs>`;

export const KIT_LIB = [
  { id: "egg", name: "蛋面", r: 34, priceMul: 0.65, shape: `<ellipse cx="0" cy="0" rx="24" ry="32"/>` },
  { id: "ping", name: "平安扣", r: 76, priceMul: 1.00, shape: `<path d="M0,-76 A76,76 0 1,0 0,76 A76,76 0 1,0 0,-76 Z M0,-26 A26,26 0 1,1 0,26 A26,26 0 1,1 0,-26 Z" clip-rule="evenodd"/>` },
  { id: "rect", name: "方牌", r: 104, priceMul: 1.30, shape: `<rect x="-64" y="-86" width="128" height="172" rx="14"/>` },
  { id: "drop", name: "水滴", r: 98, priceMul: 0.92, shape: `<path d="M0,-98 C30,-56 56,-12 56,30 C56,68 30,96 0,96 C-30,96 -56,68 -56,30 C-56,-12 -30,-56 0,-98 Z"/>` },
  { id: "leaf", name: "叶子", r: 106, priceMul: 0.90, shape: `<path d="M0,-104 C50,-70 66,-8 50,46 C40,82 18,104 0,106 C-18,104 -40,82 -50,46 C-66,-8 -50,-70 0,-104 Z"/>` },
  { id: "bangle", name: "手镯", r: 88, priceMul: 1.85, shape: `<path d="M0,-88 A88,88 0 1,0 0,88 A88,88 0 1,0 0,-88 Z M0,-62 A62,62 0 1,1 0,62 A62,62 0 1,1 0,-62 Z" clip-rule="evenodd"/>` },
  { id: "buddha", name: "佛公", r: 110, priceMul: 1.15, shape: `<path d="M0,-100 C22,-103 42,-92 44,-70 C46,-54 40,-46 44,-38 C60,-30 78,-14 80,10 C82,32 92,46 84,64 C78,82 70,92 46,96 C28,99 14,100 0,100 C-14,100 -28,99 -46,96 C-70,92 -78,82 -84,64 C-92,46 -82,32 -80,10 C-78,-14 -60,-30 -44,-38 C-40,-46 -46,-54 -44,-70 C-42,-92 -22,-103 0,-100 Z"/>` }
];

export const OPENING_KIT_KIND_MAP = {
  egg: "cabochon",
  ping: "peacePendant",
  rect: "plaque",
  drop: "dropPendant",
  leaf: "leafPendant",
  bangle: "bracelet",
  buddha: "buddhaPendant"
};

export const PALETTES = [
  { name: "帝王绿", base: "#0e7a3e", vein: "#06481f", flower: "#1f6f8f", flowerName: "蓝绿飘花", rarity: 6, w: 0.5 },
  { name: "阳绿", base: "#2fb557", vein: "#1c8a3e", flower: "#3a7fb0", flowerName: "晴蓝飘花", rarity: 5, w: 3 },
  { name: "翠绿", base: "#1ba050", vein: "#0e6e34", flower: "#2faa55", flowerName: "翠绿飘花", rarity: 4, w: 5 },
  { name: "苹果绿", base: "#4cb868", vein: "#2e8a48", flower: "#2faa55", flowerName: "翠绿飘花", rarity: 4, w: 7 },
  { name: "秧苗绿", base: "#5aa84e", vein: "#3a7a38", flower: "#4f9a44", flowerName: "嫩绿飘花", rarity: 3, w: 6 },
  { name: "葱心绿", base: "#7bc46a", vein: "#4f9a44", flower: "#5aa84e", flowerName: "嫩绿飘花", rarity: 3, w: 6 },
  { name: "豆绿", base: "#6fae66", vein: "#4a8a44", flower: "#5aa84e", flowerName: "淡绿飘花", rarity: 3, w: 6 },
  { name: "瓜皮绿", base: "#4a8a5a", vein: "#2e5e3a", flower: "#3a7a4a", flowerName: "深绿飘花", rarity: 3, w: 6 },
  { name: "菠菜绿", base: "#2f6b46", vein: "#1d4a2e", flower: "#3a7a4a", flowerName: "深绿飘花", rarity: 3, w: 6 },
  { name: "江水绿", base: "#5a9a7a", vein: "#3a6e54", flower: "#4f9a7a", flowerName: "淡青飘花", rarity: 3, w: 6 },
  { name: "墨绿", base: "#1c4030", vein: "#0e2418", flower: "#2f6b45", flowerName: "暗绿飘花", rarity: 3, w: 5 },
  { name: "油青", base: "#41615a", vein: "#2c433d", flower: "#6f97a0", flowerName: "蓝灰飘花", rarity: 3, w: 8 },
  { name: "干青", base: "#0e6e3a", vein: "#064a26", flower: "#1f8a4a", flowerName: "浓绿飘花", rarity: 3, w: 5 },
  { name: "铁龙生", base: "#1f9a4a", vein: "#0f6e30", flower: "#2faa55", flowerName: "翠绿飘花", rarity: 3, w: 5 },
  { name: "花青", base: "#2e7a4e", vein: "#14502e", flower: "#3a8a52", flowerName: "花青飘花", rarity: 3, w: 6 },
  { name: "金丝种", base: "#dfe9d8", vein: "#1f9a4e", flower: "#1f9a4e", flowerName: "金丝飘花", rarity: 4, w: 3 },
  { name: "白底青", base: "#eef3ec", vein: "#2faa55", flower: "#2faa55", flowerName: "翠绿飘花", rarity: 3, w: 6 },
  { name: "芙蓉种", base: "#a8d0b0", vein: "#6fae84", flower: "#8fc79a", flowerName: "淡绿飘花", rarity: 4, w: 4 },
  { name: "蓝水", base: "#7fb6c4", vein: "#5a93a3", flower: "#6fa8b8", flowerName: "飘蓝花", rarity: 4, w: 5 },
  { name: "晴水", base: "#bfe3da", vein: "#9fcbc2", flower: "#7fb8c9", flowerName: "淡青飘花", rarity: 4, w: 5 },
  { name: "紫罗兰", base: "#8a6db0", vein: "#6a4f96", flower: "#b58fd0", flowerName: "粉紫飘花", rarity: 4, w: 7 },
  { name: "粉紫", base: "#b08fc0", vein: "#8a6da0", flower: "#a07fc0", flowerName: "飘紫花", rarity: 3, w: 5 },
  { name: "茄紫", base: "#6a4f8a", vein: "#4a3566", flower: "#7a5f9a", flowerName: "飘紫花", rarity: 3, w: 5 },
  { name: "蓝紫", base: "#7a6aa8", vein: "#564a80", flower: "#8a7ab0", flowerName: "飘紫花", rarity: 3, w: 4 },
  { name: "春带彩", base: "#b89cc8", vein: "#2faa55", flower: "#2faa55", flowerName: "翠绿飘花", rarity: 5, w: 1.8 },
  { name: "红翡", base: "#b5482f", vein: "#8f3520", flower: "#7d2a18", flowerName: "暗红飘花", rarity: 3, w: 5 },
  { name: "黄翡", base: "#d99a2b", vein: "#b87c1a", flower: "#7d5a12", flowerName: "蜜糖飘花", rarity: 3, w: 5 },
  { name: "鸡油黄", base: "#e8b53a", vein: "#c8902a", flower: "#d9a82a", flowerName: "飘黄花", rarity: 4, w: 3.6 },
  { name: "黄加绿", base: "#d99a2b", vein: "#2faa55", flower: "#2faa55", flowerName: "翠绿飘花", rarity: 5, w: 1.2 },
  { name: "红黄翡", base: "#c0602a", vein: "#b5482f", flower: "#d99a2b", flowerName: "黄翡飘花", rarity: 4, w: 3.6 },
  { name: "墨翠", base: "#16331f", vein: "#0c2415", flower: "#2f6b45", flowerName: "暗绿飘花", rarity: 5, w: 4.4 },
  { name: "黑翡翠", base: "#1a1a1c", vein: "#0c0c0e", flower: "#3a3a40", flowerName: "飘灰花", rarity: 3, w: 3 },
  { name: "无色玻璃种", base: "#eef2f3", vein: "#c8d0d2", flower: "#7fb8c9", flowerName: "飘蓝花", rarity: 4, cv: 1.8, w: 3 },
  { name: "白冰", base: "#e8eef0", vein: "#c0ccce", flower: "#2faa55", flowerName: "飘绿花", rarity: 3, cv: 1.6, w: 4 },
  { name: "飘蓝花", base: "#d6e6e2", vein: "#7fb8c9", flower: "#7fb8c9", flowerName: "飘蓝花", rarity: 3, cv: 2.2, w: 6 },
  { name: "飘绿花", base: "#e3ece2", vein: "#2faa55", flower: "#2faa55", flowerName: "飘绿花", rarity: 3, cv: 2.2, w: 6 },
  { name: "藕粉种", base: "#ecd2cb", vein: "#d3ada3", flower: "#d9b0a8", flowerName: "飘粉花", rarity: 3, cv: 2.0, w: 5 },
  { name: "马牙种", base: "#d8dccf", vein: "#aeb39c", flower: "#b8bda8", flowerName: "飘灰花", rarity: 2, cv: 1.4, w: 5 },
  { name: "福禄寿", base: "#ece0c8", vein: "#2faa55", flower: "#c0462e", flowerName: "红翡飘花", rarity: 5, w: 1.0 }
];

export const GRADES = [
  { name: "玻璃种", fine: "极细", freq: 0.95, gOp: 0.04, water: 1.00, gloss: 0.55, rarity: 5, w: 1 },
  { name: "高冰", fine: "极细", freq: 0.86, gOp: 0.07, water: 0.90, gloss: 0.42, rarity: 5, w: 4 },
  { name: "正冰", fine: "细", freq: 0.72, gOp: 0.13, water: 0.75, gloss: 0.25, rarity: 4, w: 8 },
  { name: "糯冰", fine: "细", freq: 0.58, gOp: 0.19, water: 0.55, gloss: 0.00, rarity: 3, w: 12 },
  { name: "糯种", fine: "中", freq: 0.45, gOp: 0.30, water: 0.35, gloss: 0.00, rarity: 3, w: 30 },
  { name: "豆种", fine: "粗", freq: 0.22, gOp: 0.50, water: 0.08, gloss: 0.00, rarity: 2, w: 45 }
];

const QUALITY_GRADE_NAMES = Object.freeze({
  bean: "豆种",
  glutinous: "糯种",
  stickyIce: "糯冰",
  ice: "正冰",
  icy: "正冰",
  highIce: "高冰",
  glass: "玻璃种",
  imperial: "玻璃种",
  冰种: "正冰"
});

const COLOR_PALETTE_NAMES = Object.freeze({
  灰绿: "油青",
  青白: "白冰",
  浅绿: "葱心绿",
  晴水: "晴水",
  飘花绿: "翠绿",
  阳绿: "阳绿",
  帝王绿: "帝王绿"
});

export function openingGradeForQuality(value) {
  const raw = String(value || "").trim();
  const name = QUALITY_GRADE_NAMES[raw] || raw;
  return GRADES.find((grade) => grade.name === name) || null;
}

export function openingPaletteForColor(value) {
  const raw = String(value || "").trim();
  const name = COLOR_PALETTE_NAMES[raw] || raw;
  return PALETTES.find((entry) => entry.name === name) || null;
}

export const SKINS = [
  { name: "黑乌沙", a: "#2a2622", b: "#0d0b09", trait: "砂感强、易藏高绿" },
  { name: "黄沙皮", a: "#8a6b3f", b: "#463314", trait: "皮紧肉细、多见色根" },
  { name: "白盐沙", a: "#cfc6b4", b: "#8a8070", trait: "翻砂均匀、多出冰种" },
  { name: "红蜡皮", a: "#7a4030", b: "#341910", trait: "皮润如蜡、底张偏灰" }
];

const GRADE_TIERS = [
  { min: 95, label: "S+", css: "gs-plus", desc: "传世级" },
  { min: 88, label: "S", css: "gs", desc: "顶级" },
  { min: 80, label: "S-", css: "gs-minus", desc: "超优" },
  { min: 73, label: "A+", css: "ga-plus", desc: "优异" },
  { min: 65, label: "A", css: "ga", desc: "优良" },
  { min: 57, label: "A-", css: "ga-minus", desc: "良好" },
  { min: 49, label: "B+", css: "gb-plus", desc: "中上" },
  { min: 41, label: "B", css: "gb", desc: "中等" },
  { min: 33, label: "B-", css: "gb-minus", desc: "中下" },
  { min: 25, label: "C+", css: "gc-plus", desc: "较差" },
  { min: 17, label: "C", css: "gc", desc: "差" },
  { min: 9, label: "C-", css: "gc-minus", desc: "很差" },
  { min: 4, label: "D", css: "gd", desc: "劣质" },
  { min: 0, label: "F", css: "gf", desc: "废石" }
];

const BANGLE_BASE = 58;
const SIZE_FACTOR = { L: 1.25, M: 1, S: 0.75 };
let openingSvgInstanceCounter = 0;
const OPENING_SVG_MARKUP_CACHE_LIMIT = 96;
const openingSvgMarkupCache = new Map();
const stoneOutlineCache = new WeakMap();
const kitOutlineCache = new Map();

export function openingStoneOutline(stone) {
  if (!stoneOutlineCache.has(stone)) stoneOutlineCache.set(stone, sampleCubicOutline(stone.stonePath));
  return stoneOutlineCache.get(stone);
}

export function openingKitOutline(tplId) {
  if (!kitOutlineCache.has(tplId)) {
    let points;
    if (["egg", "ping", "bangle"].includes(tplId)) {
      const rx = tplId === "egg" ? 24 : tplId === "ping" ? 76 : 88;
      const ry = tplId === "egg" ? 32 : rx;
      points = Array.from({ length: 72 }, (_, i) => [Math.cos(i * Math.PI / 36) * rx, Math.sin(i * Math.PI / 36) * ry]);
    } else if (tplId === "rect") {
      points = [[50, 72], [-50, 72], [-50, -72], [50, -72]].flatMap(([x, y], corner) =>
        Array.from({ length: 9 }, (_, i) => {
          const angle = (corner * 90 + i * 90 / 8) * Math.PI / 180;
          return [x + Math.cos(angle) * 14, y + Math.sin(angle) * 14];
        }));
    } else {
      const path = KIT_LIB.find((kit) => kit.id === tplId)?.shape.match(/d="([^"]+)"/)?.[1];
      if (!path) throw new Error(`Unsupported opening outline: ${tplId}`);
      points = sampleCubicOutline(path);
    }
    kitOutlineCache.set(tplId, points);
  }
  return kitOutlineCache.get(tplId);
}

function rememberOpeningSvgMarkup(key, markup) {
  if (!key || !markup) return markup;
  if (openingSvgMarkupCache.has(key)) openingSvgMarkupCache.delete(key);
  openingSvgMarkupCache.set(key, markup);
  while (openingSvgMarkupCache.size > OPENING_SVG_MARKUP_CACHE_LIMIT) {
    const oldest = openingSvgMarkupCache.keys().next().value;
    openingSvgMarkupCache.delete(oldest);
  }
  return markup;
}

function openingSvgWindowsKey(windows = []) {
  if (!Array.isArray(windows) || !windows.length) return "0";
  return windows.map((w) => [
    Math.round(Number(w.x) || 0),
    Math.round(Number(w.y) || 0),
    Math.round(Number(w.r) || 0)
  ].join(",")).join(";");
}

function openingSvgKitsKey(kits = []) {
  if (!Array.isArray(kits) || !kits.length) return "0";
  return kits.map((kit) => [
    kit.uid ?? kit.id ?? "",
    kit.tpl || kit.type || "",
    Number(kit.x) || 0,
    Number(kit.y) || 0,
    Number(kit.rot) || 0,
    Number(kit.scale) || 0,
    kit.size || "",
    kit.extracted ? 1 : 0
  ].join(":")).join("|");
}

function openingStoneCacheId(stone = {}) {
  return String(stone.id || stone.seed || stone.roughId || "stone");
}

function normalizeSeed(value) {
  const text = String(value ?? "jade-opening");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rngFor(seed) {
  let state = normalizeSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(arr, rng) {
  const total = arr.reduce((sum, item) => sum + (item.w || 1), 0);
  let roll = rng() * total;
  for (const item of arr) {
    roll -= item.w || 1;
    if (roll <= 0) return item;
  }
  return arr.at(-1);
}

function hx(hex) {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

function rh(r, g, b) {
  const c = (value) => `0${Math.max(0, Math.min(255, Math.round(value))).toString(16)}`.slice(-2);
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(a, b, t) {
  const A = hx(a);
  const B = hx(b);
  return rh(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

const lighten = (hex, t) => mix(hex, "#ffffff", t);
const darken = (hex, t) => mix(hex, "#000000", t);

function hash2(i, j, seed) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, seed, oct, freq) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = freq;
  for (let o = 0; o < oct; o += 1) {
    sum += amp * vnoise(x * f, y * f, seed + o * 977);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function cubicPoint(x1, y1, c1x, c1y, c2x, c2y, x2, y2, t) {
  const m = 1 - t;
  return [
    m * m * m * x1 + 3 * m * m * t * c1x + 3 * m * t * t * c2x + t * t * t * x2,
    m * m * m * y1 + 3 * m * m * t * c1y + 3 * m * t * t * c2y + t * t * t * y2
  ];
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPoly(px, py, points) {
  let min = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    min = Math.min(min, distSeg(px, py, points[index][0], points[index][1], points[index + 1][0], points[index + 1][1]));
  }
  return min;
}

function catmull(points) {
  const n = points.length;
  let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)} `;
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
  }
  return `${d}Z`;
}

function makeStone(rng) {
  const points = [];
  for (let i = 0; i < 13; i += 1) {
    const angle = (i / 13) * Math.PI * 2;
    const radius = 210 + rng() * 55;
    points.push([300 + Math.cos(angle) * radius, 300 + Math.sin(angle) * radius]);
  }
  return catmull(points);
}

function naturalCrack(x1, y1, x2, y2, color, maxW, rng) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const perpX = -dy * (0.25 + rng() * 0.35);
  const perpY = dx * (0.25 + rng() * 0.35);
  const c1x = mx + perpX * (rng() > 0.5 ? 1 : -1) + (rng() - 0.5) * 30;
  const c1y = my + perpY * (rng() > 0.5 ? 1 : -1) + (rng() - 0.5) * 30;
  const c2x = mx - perpX * 0.6 * (rng() > 0.5 ? 1 : -1) + (rng() - 0.5) * 20;
  const c2y = my - perpY * 0.6 * (rng() > 0.5 ? 1 : -1) + (rng() - 0.5) * 20;
  const w = (maxW * (0.6 + rng() * 0.4)).toFixed(1);
  const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  const line = [[x1, y1]];
  for (let i = 1; i <= 16; i += 1) line.push(cubicPoint(x1, y1, c1x, c1y, c2x, c2y, x2, y2, i / 16));
  return {
    svg: `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round" opacity="0.78"/>`,
    line
  };
}

function jadeCracks(color, rng) {
  let svg = "";
  const cracks = [];
  const roll = rng();
  const count = roll < 0.25 ? 0 : roll < 0.6 ? 1 : roll < 0.85 ? 2 + Math.floor(rng() * 2) : 4 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i += 1) {
    const x1 = 40 + rng() * 520;
    const y1 = 40 + rng() * 520;
    const angle = rng() * Math.PI * 2;
    const length = 110 + rng() * 280;
    const x2 = Math.max(20, Math.min(580, x1 + Math.cos(angle) * length));
    const y2 = Math.max(20, Math.min(580, y1 + Math.sin(angle) * length));
    const crack = naturalCrack(x1, y1, x2, y2, color, i === 0 ? 8 : 3 + rng() * 4, rng);
    svg += crack.svg;
    cracks.push(crack.line);
  }
  return { svg: `<g filter="url(#crackWarp)">${svg}</g>`, cracks };
}

function flowers(has, rng) {
  if (!has) return "";
  let svg = "";
  const count = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i += 1) {
    const cx = 110 + rng() * 380;
    const cy = 110 + rng() * 380;
    const rx = 70 + rng() * 90;
    const ry = 50 + rng() * 70;
    svg += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="#000" filter="url(#flowerTex)" opacity="0.8"/>`;
  }
  return svg;
}

function colorWashLayer(hasColor) {
  return hasColor ? `<rect x="0" y="0" width="600" height="600" fill="#fff" filter="url(#colorWash)" opacity="0.55"/>` : "";
}

export function buildJadeMap(palList, grade, withWaste, cracksSegs, seeds) {
  const RES = 40;
  const CELL = 600 / RES;
  const grid = new Array(RES * RES);
  for (let r = 0; r < RES; r += 1) {
    for (let c = 0; c < RES; c += 1) {
      const gx = c * CELL + CELL / 2;
      const gy = r * CELL + CELL / 2;
      let waste = false;
      if (withWaste) {
        const nW = fbm(gx, gy, seeds.waste, 3, 0.009);
        waste = smoothstep(0.56, 0.76, nW) > 0.5;
      }
      let cat = 0;
      if (!waste) {
        if (palList[2]) {
          const nB = fbm(gx, gy, seeds.zoneB, 3, 0.0042);
          if (smoothstep(0.42, 0.70, nB) > 0.5) cat = 2;
        }
        if (cat === 0 && palList[1]) {
          const nA = fbm(gx, gy, seeds.zoneA, 3, 0.0042);
          if (smoothstep(0.42, 0.70, nA) > 0.5) cat = 1;
        }
      }
      let crack = false;
      for (const crackLine of cracksSegs || []) {
        if (distToPoly(gx, gy, crackLine) < 6) {
          crack = true;
          break;
        }
      }
      grid[r * RES + c] = { cat, waste, crack };
    }
  }
  return { RES, CELL, grid };
}

export function buildJadeMaterial({ palList, grade, hasColor, hasFlower, withWaste, cracksSvg, jadeMap, flowerSvg }) {
  const dom = palList[0].pal;
  const water = grade.water || 0;
  const gloss = grade.gloss || 0;
  let svg = `<rect x="0" y="0" width="600" height="600" fill="${dom.base}"/>`;
  if (palList[1]) svg += `<rect x="0" y="0" width="600" height="600" fill="${palList[1].pal.base}" filter="url(#zoneMixA)"/>`;
  if (palList[2]) svg += `<rect x="0" y="0" width="600" height="600" fill="${palList[2].pal.base}" filter="url(#zoneMixB)"/>`;
  svg += `<rect x="0" y="0" width="600" height="600" fill="#fff" filter="url(#jadeVar)" style="mix-blend-mode:normal" opacity="0.35"/>`;
  svg += `<rect x="0" y="0" width="600" height="600" fill="#fff" filter="url(#jadeMarble)" style="mix-blend-mode:soft-light" opacity="0.50"/>`;
  svg += cracksSvg || "";
  svg += colorWashLayer(hasColor);
  svg += `<g>${flowerSvg ?? flowers(hasFlower, rngFor(`${dom.name}-${grade.name}-flowers`))}</g>`;
  if (water > 0.02) svg += `<rect x="0" y="0" width="600" height="600" fill="#e8fff3" style="mix-blend-mode:screen" opacity="${(water * 0.32).toFixed(3)}"/>`;
  if (water < 0.98) svg += `<rect x="0" y="0" width="600" height="600" fill="#0a0f0c" style="mix-blend-mode:multiply" opacity="${((1 - water) * 0.18).toFixed(3)}"/>`;
  if (gloss > 0) {
    svg += `<defs><linearGradient id="sheenGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.42" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.58" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect x="0" y="0" width="600" height="600" fill="url(#sheenGrad)" style="mix-blend-mode:screen" opacity="${gloss.toFixed(3)}"/>`;
  }
  svg += `<rect x="0" y="0" width="600" height="600" fill="#000" filter="url(#grain)" opacity="${grade.gOp}"/>`;
  if (withWaste && jadeMap) {
    let wasteSvg = "";
    for (let r = 0; r < jadeMap.RES; r += 1) {
      for (let c = 0; c < jadeMap.RES; c += 1) {
        if (!jadeMap.grid[r * jadeMap.RES + c].waste) continue;
        const x = Math.round(c * jadeMap.CELL);
        const y = Math.round(r * jadeMap.CELL);
        wasteSvg += `<rect x="${x + 1}" y="${y + 1}" width="${Math.round(jadeMap.CELL) - 2}" height="${Math.round(jadeMap.CELL) - 2}" rx="4" fill="#5c5648"/>`;
      }
    }
    if (wasteSvg) svg += `<g filter="url(#wasteBlur)">${wasteSvg}</g>`;
  }
  return svg;
}

export function buildOpeningStone(options = {}) {
  const seed = normalizeSeed(options.seed ?? options.roughId ?? options.id);
  const rng = rngFor(seed);
  const grade = options.grade
    || openingGradeForQuality(options.qualityKey ?? options.quality)
    || weightedPick(GRADES, rng);
  const skin = options.skin || SKINS[Math.floor(rng() * SKINS.length)];
  const nCatsRoll = rng();
  const nCats = nCatsRoll < 0.38 ? 1 : nCatsRoll < 0.80 ? 2 : 3;
  const chosen = new Set();
  const palList = [];
  const primaryPalette = options.palette || openingPaletteForColor(options.color);
  if (primaryPalette) {
    chosen.add(primaryPalette.name);
    palList.push({ pal: primaryPalette });
  }
  for (let index = palList.length; index < nCats; index += 1) {
    let pal;
    do {
      pal = weightedPick(PALETTES, rng);
    } while (chosen.has(pal.name) && chosen.size < PALETTES.length);
    chosen.add(pal.name);
    palList.push({ pal });
  }
  const dom = palList[0].pal;
  const stonePath = makeStone(rng);
  const crackDark = darken(darken(darken(dom.base, 0.50), 0.45), 0.35);
  const crackData = jadeCracks(crackDark, rng);
  const seeds = {
    zoneA: Math.floor(rng() * 999),
    zoneB: Math.floor(rng() * 999),
    waste: Math.floor(rng() * 999),
    flower: Math.floor(rng() * 999),
    marble: Math.floor(rng() * 9999),
    var: Math.floor(rng() * 9999),
    wash: Math.floor(rng() * 9999),
    crack: Math.floor(rng() * 999),
    mottle: Math.floor(rng() * 999),
    grain: Math.floor(rng() * 999),
    rock: Math.floor(rng() * 999),
    grainBaseFrequency: grade.freq
  };
  const withWaste = options.withWaste ?? true;
  let jadeMap = buildJadeMap(palList, grade, withWaste, crackData.cracks, seeds);
  let guard = 0;
  while (withWaste && !jadeMap.grid.some((cell) => cell.waste) && guard < 24) {
    seeds.waste += 37;
    jadeMap = buildJadeMap(palList, grade, withWaste, crackData.cracks, seeds);
    guard += 1;
  }
  const hasFlower = options.hasFlower ?? rng() < 0.6;
  const hasColor = options.hasColor ?? rng() > 0.35;
  const flowerSvg = flowers(hasFlower, rng);
  const material = buildJadeMaterial({
    palList,
    grade,
    hasColor,
    hasFlower,
    withWaste,
    cracksSvg: crackData.svg,
    jadeMap,
    flowerSvg
  });
  const whole = evaluateWholeStone({ palList, grade, jadeMap });
  const overallGrade = computeGrade(whole, { grade });
  const low = Math.round((whole.price || 1200) * 0.82);
  const high = Math.round((whole.price || 1800) * 1.62);
  return {
    id: options.roughId || options.id || `opening-${seed}`,
    seed,
    palList,
    grade,
    skin,
    withWaste,
    hasFlower,
    hasColor,
    stonePath,
    cracks: crackData.cracks,
    cracksSvg: crackData.svg,
    jadeMap,
    material,
    seeds,
    value: `¥${low.toLocaleString("zh-CN")} – ¥${high.toLocaleString("zh-CN")}`,
    report: { whole, grade: overallGrade },
    labels: {
      color: palList.map((entry) => entry.pal.name).join(" / "),
      grade: grade.name,
      skin: skin.name
    }
  };
}

function evaluateWholeStone(stone) {
  const { jadeMap, palList, grade } = stone;
  const catCounts = [0, 0, 0];
  let total = 0;
  let goodN = 0;
  let wasteCount = 0;
  let crackCount = 0;
  let catRarSum = 0;
  let cvSum = 0;
  for (const cell of jadeMap.grid) {
    total += 1;
    if (cell.waste) {
      wasteCount += 1;
      continue;
    }
    if (cell.crack) crackCount += 1;
    goodN += 1;
    catCounts[cell.cat] += 1;
    catRarSum += palList[cell.cat].pal.rarity;
    cvSum += palList[cell.cat].pal.cv || palList[cell.cat].pal.rarity;
  }
  const avgRar = goodN ? catRarSum / goodN : palList[0].pal.rarity;
  const avgCv = goodN ? cvSum / goodN : palList[0].pal.cv || palList[0].pal.rarity;
  const crackRatio = total ? crackCount / total : 0;
  const wasteRatio = total ? wasteCount / total : 0;
  const penalty = defectPenalty(crackRatio, wasteRatio);
  const valueFactor = jadeValueFactor(avgCv, grade.water);
  return {
    total,
    goodN,
    wasteCount,
    crackCount,
    catCounts,
    avgRar,
    avgCv,
    crackRatio,
    wasteRatio,
    penalty,
    price: goodN ? Math.round(goodN * 55 * valueFactor * (1 - penalty)) : 0
  };
}

function tplById(id) {
  return KIT_LIB.find((kit) => kit.id === id) || KIT_LIB[0];
}

export function scaleForOpeningKit(tplId, sizeVal = tplId === "bangle" ? 56 : "M") {
  if (tplId === "bangle") return Number(sizeVal || 56) / BANGLE_BASE;
  return SIZE_FACTOR[sizeVal] ?? 1;
}

function toLocal(gx, gy, kit) {
  const scale = kit.scale || scaleForOpeningKit(kit.tpl, kit.size);
  const dx = gx - kit.x;
  const dy = gy - kit.y;
  const angle = (kit.rot || 0) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [(dx * cos + dy * sin) / scale, (-dx * sin + dy * cos) / scale];
}

function ellipseHit(x, y, rx, ry) {
  return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
}

export function openingKitHit(tplId, x, y) {
  if (tplId === "egg") return ellipseHit(x, y, 24, 32);
  if (tplId === "ping") {
    const r = Math.hypot(x, y);
    return r <= 76 && r >= 26;
  }
  if (tplId === "rect") return Math.abs(x) <= 64 && Math.abs(y) <= 86;
  if (tplId === "drop") {
    // 轮廓 tip 在 y=-98；旧公式对 y<-98 仍命中，会在尖端上方拖出隐形长条，导致远处手镯误判重叠
    const lower = ellipseHit(x, y - 22, 56, 74);
    if (y >= -98 && y < 22) {
      const t = (y + 98) / 120;
      const halfW = 1.5 + 54.5 * (t ** 1.2);
      if (Math.abs(x) <= halfW) return true;
    }
    return lower;
  }
  if (tplId === "leaf") return ellipseHit(x, y, 54, 106) && Math.abs(x) < 58 * (1 - Math.abs(y) / 160 + 0.25);
  if (tplId === "bangle") {
    const r = Math.hypot(x, y);
    return r <= 88 && r >= 62;
  }
  if (tplId === "buddha") {
    const head = ellipseHit(x, y + 72, 44, 32);
    const body = ellipseHit(x, y - 18, 82, 86);
    return head || body;
  }
  return false;
}

export function evaluateOpeningKit(kit, stone) {
  const tpl = tplById(kit.tpl);
  const palList = stone.palList;
  const { jadeMap } = stone;
  const catCounts = [0, 0, 0];
  let total = 0;
  let goodN = 0;
  let wasteCount = 0;
  let crackCount = 0;
  let catRarSum = 0;
  let cvSum = 0;
  for (let r = 0; r < jadeMap.RES; r += 1) {
    for (let c = 0; c < jadeMap.RES; c += 1) {
      const gx = c * jadeMap.CELL + jadeMap.CELL / 2;
      const gy = r * jadeMap.CELL + jadeMap.CELL / 2;
      const [lx, ly] = toLocal(gx, gy, kit);
      if (!openingKitHit(tpl.id, lx, ly)) continue;
      total += 1;
      const cell = jadeMap.grid[r * jadeMap.RES + c];
      if (cell.waste) {
        wasteCount += 1;
        continue;
      }
      if (cell.crack) crackCount += 1;
      goodN += 1;
      catCounts[cell.cat] += 1;
      catRarSum += palList[cell.cat].pal.rarity;
      cvSum += palList[cell.cat].pal.cv || palList[cell.cat].pal.rarity;
    }
  }
  const avgRar = goodN ? catRarSum / goodN : palList[0].pal.rarity;
  const avgCv = goodN ? cvSum / goodN : palList[0].pal.cv || palList[0].pal.rarity;
  const crackRatio = total ? crackCount / total : 0;
  const wasteRatio = total ? wasteCount / total : 0;
  const penalty = defectPenalty(crackRatio, wasteRatio);
  const valueFactor = jadeValueFactor(avgCv, stone.grade.water);
  return {
    total,
    goodN,
    wasteCount,
    crackCount,
    catCounts,
    avgRar,
    avgCv,
    crackRatio,
    wasteRatio,
    penalty,
    price: goodN ? Math.round(goodN * 55 * valueFactor * (1 - penalty) * tpl.priceMul) : 0,
    priceMul: tpl.priceMul
  };
}

/** 规划套件覆盖之外的余料评价（与 evaluateOpeningKit 同口径） */
export function evaluateLeftoverMaterial(kits, stone, { withinStone = false } = {}) {
  const list = Array.isArray(kits) ? kits.filter(Boolean) : [];
  const palList = stone.palList;
  const { jadeMap } = stone;
  const catCounts = [0, 0, 0];
  let total = 0;
  let goodN = 0;
  let wasteCount = 0;
  let crackCount = 0;
  let catRarSum = 0;
  let cvSum = 0;
  let sourceTotal = 0;
  const boundary = withinStone ? openingStoneOutline(stone) : null;
  for (let r = 0; r < jadeMap.RES; r += 1) {
    for (let c = 0; c < jadeMap.RES; c += 1) {
      const gx = c * jadeMap.CELL + jadeMap.CELL / 2;
      const gy = r * jadeMap.CELL + jadeMap.CELL / 2;
      if (boundary && !pointInOutline(gx, gy, boundary)) continue;
      sourceTotal += 1;
      let covered = false;
      for (const kit of list) {
        const tpl = tplById(kit.tpl);
        const [lx, ly] = toLocal(gx, gy, kit);
        const hit = withinStone && !["ping", "bangle"].includes(tpl.id)
          ? pointInOutline(lx, ly, openingKitOutline(tpl.id)) : openingKitHit(tpl.id, lx, ly);
        if (hit) {
          covered = true;
          break;
        }
      }
      if (covered) continue;
      total += 1;
      const cell = jadeMap.grid[r * jadeMap.RES + c];
      if (cell.waste) {
        wasteCount += 1;
        continue;
      }
      if (cell.crack) crackCount += 1;
      goodN += 1;
      catCounts[cell.cat] += 1;
      catRarSum += palList[cell.cat].pal.rarity;
      cvSum += palList[cell.cat].pal.cv || palList[cell.cat].pal.rarity;
    }
  }
  const avgRar = goodN ? catRarSum / goodN : palList[0].pal.rarity;
  const avgCv = goodN ? cvSum / goodN : palList[0].pal.cv || palList[0].pal.rarity;
  const crackRatio = total ? crackCount / total : 0;
  const wasteRatio = total ? wasteCount / total : 0;
  const penalty = defectPenalty(crackRatio, wasteRatio);
  const valueFactor = jadeValueFactor(avgCv, stone.grade.water);
  const coverage = sourceTotal ? 1 - total / sourceTotal : 0;
  return {
    total,
    goodN,
    wasteCount,
    crackCount,
    catCounts,
    avgRar,
    avgCv,
    crackRatio,
    wasteRatio,
    penalty,
    coverage,
    remainRatio: sourceTotal ? total / sourceTotal : 0,
    price: goodN ? Math.round(goodN * 55 * valueFactor * (1 - penalty) * 0.72) : 0
  };
}

export function computeOverlaps(kits) {
  const overlaps = new Set();
  if (!Array.isArray(kits) || kits.length < 2) return overlaps;
  const step = 12;
  for (let y = 0; y <= 600; y += step) {
    for (let x = 0; x <= 600; x += step) {
      const owners = [];
      for (const kit of kits) {
        const [lx, ly] = toLocal(x, y, kit);
        if (openingKitHit(kit.tpl, lx, ly)) owners.push(kit.uid ?? kit.id);
      }
      if (owners.length >= 2) owners.forEach((owner) => overlaps.add(owner));
    }
  }
  return overlaps;
}

export function defectPenalty(cr, wr) {
  const crackPen = cr > 0.02 ? Math.min(0.70, 0.15 + cr * 1.2) : 0;
  const wastePen = wr > 0.10 ? Math.min(0.55, 0.10 + wr * 0.6) : 0;
  return 1 - (1 - crackPen) * (1 - wastePen);
}

export function jadeValueFactor(avgCv, water) {
  const c = Math.min(1, Math.max(0, avgCv / 6));
  const q = Math.min(1, Math.max(0, water));
  return 0.10 + c * 0.62 + q * 0.38 + c * q * 0.55;
}

export function computeGrade(ev, stone) {
  const colorScore = (ev.avgRar / 6) * 40;
  const waterScore = (stone.grade.water || 0) * 30;
  const integrityScore = Math.max(0, (1 - ev.wasteRatio - ev.crackRatio)) * 20;
  const purityScore = (1 - ev.penalty) * 10;
  const score = Math.min(100, Math.max(0, Math.round(colorScore + waterScore + integrityScore + purityScore)));
  const tier = GRADE_TIERS.find((item) => score >= item.min) || GRADE_TIERS.at(-1);
  return {
    score,
    letter: tier.label,
    css: tier.css,
    desc: tier.desc,
    breakdown: {
      color: Math.round(colorScore),
      water: Math.round(waterScore),
      integrity: Math.round(integrityScore),
      purity: Math.round(purityScore)
    }
  };
}

export function mapOpeningKitToProductKind(kitId) {
  return OPENING_KIT_KIND_MAP[kitId] || "pendant";
}

function defsForStone(stone, scratchSvg = "", windowHoles = "") {
  const dom = stone.palList[0].pal;
  const washCol = dom.name === "白底青" || dom.name === "晴水" || dom.name === "福禄寿" ? dom.vein : lighten(dom.base, 0.22);
  return JADE_OPENING_DEFS
    .replace('<path id="stonePath" d=""/>', `<path id="stonePath" d="${stone.stonePath}"/>`)
    .replace('<g id="jadeMaterial"></g>', `<g id="jadeMaterial">${stone.material}</g>`)
    .replace('<g id="brushGroup"></g>', `<g id="brushGroup">${scratchSvg}${windowHoles}</g>`)
    .replace('id="rc0" offset="0%" stop-color="#7a6253"', `id="rc0" offset="0%" stop-color="${stone.skin.a}"`)
    .replace('id="rc1" offset="100%" stop-color="#2c2017"', `id="rc1" offset="100%" stop-color="${stone.skin.b}"`)
    .replace('id="flowerFlood" flood-color="#1f6f8f"', `id="flowerFlood" flood-color="${dom.flower}"`)
    .replace('id="flowerTurb" type="fractalNoise" baseFrequency="0.018 0.028" numOctaves="4" seed="3"', `id="flowerTurb" type="fractalNoise" baseFrequency="0.018 0.028" numOctaves="4" seed="${stone.seeds.flower}"`)
    .replace('id="marbleLight" flood-color="#ffffff"', `id="marbleLight" flood-color="${lighten(dom.base, 0.35)}"`)
    .replace('id="marbleDark" flood-color="#000000"', `id="marbleDark" flood-color="${darken(dom.base, 0.25)}"`)
    .replace('id="marbleTurb" type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="6" seed="42"', `id="marbleTurb" type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="6" seed="${stone.seeds.marble}"`)
    .replace('id="varTurb" type="fractalNoise" baseFrequency="0.005 0.008" numOctaves="5" seed="77"', `id="varTurb" type="fractalNoise" baseFrequency="0.005 0.008" numOctaves="5" seed="${stone.seeds.var}"`)
    .replace('id="washColor" flood-color="#2faa55"', `id="washColor" flood-color="${washCol}"`)
    .replace('id="washTurb" type="fractalNoise" baseFrequency="0.0035 0.006" numOctaves="4" seed="88"', `id="washTurb" type="fractalNoise" baseFrequency="0.0035 0.006" numOctaves="4" seed="${stone.seeds.wash}"`)
    .replace('id="crackTurb" type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="5"', `id="crackTurb" type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="${stone.seeds.crack}"`)
    .replace('id="mottleColor" flood-color="#3a8f4f"', `id="mottleColor" flood-color="${lighten(dom.base, 0.05)}"`)
    .replace('id="mottleTurb" type="fractalNoise" baseFrequency="0.01 0.016" numOctaves="4" seed="33"', `id="mottleTurb" type="fractalNoise" baseFrequency="0.01 0.016" numOctaves="4" seed="${stone.seeds.mottle}"`)
    .replace('id="zoneATurb" type="fractalNoise" baseFrequency="0.0035 0.005" numOctaves="3" seed="1"', `id="zoneATurb" type="fractalNoise" baseFrequency="0.0035 0.005" numOctaves="3" seed="${stone.seeds.zoneA}"`)
    .replace('id="zoneBTurb" type="fractalNoise" baseFrequency="0.004 0.0055" numOctaves="3" seed="2"', `id="zoneBTurb" type="fractalNoise" baseFrequency="0.004 0.0055" numOctaves="3" seed="${stone.seeds.zoneB}"`)
    .replace('id="grainTurb" type="fractalNoise" baseFrequency="0.7"', `id="grainTurb" type="fractalNoise" baseFrequency="${stone.seeds.grainBaseFrequency}"`)
    .replace('id="grainTurb" type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11"', `id="grainTurb" type="fractalNoise" baseFrequency="${stone.seeds.grainBaseFrequency}" numOctaves="2" seed="${stone.seeds.grain}"`)
    .replace('id="rockTurb" type="fractalNoise" baseFrequency="0.013 0.02" numOctaves="5" seed="7"', `id="rockTurb" type="fractalNoise" baseFrequency="0.013 0.02" numOctaves="5" seed="${stone.seeds.rock}"`);
}

function scratchSvg(scratches = []) {
  return scratches.map((point, index) => {
    const radius = Number(point.r || point.radius || 34);
    if (point.path) return `<path d="${point.path}" stroke="#000" stroke-width="${radius * 2}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${point.opacity ?? 1}"/>`;
    return `<circle cx="${Number(point.x || 300).toFixed(1)}" cy="${Number(point.y || 300).toFixed(1)}" r="${radius.toFixed(1)}" fill="#000" opacity="${point.opacity ?? 1}" data-scratch="${index}"/>`;
  }).join("");
}

function kitOutlineWithAttrs(shape, attrs) {
  if (shape.endsWith("/>")) return shape.replace("/>", ` ${attrs}/>`);
  return shape.replace(">", ` ${attrs}>`);
}

function sanitizeSvgIdPart(value) {
  const clean = String(value ?? "opening").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "opening";
}

function namespaceSvgReferences(svg, prefix) {
  const base = `${sanitizeSvgIdPart(prefix)}-`;
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${base}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${base}${id})`)
    .replace(/\bhref="#([^"]+)"/g, (_, id) => `href="#${base}${id}"`)
    .replace(/\bxlink:href="#([^"]+)"/g, (_, id) => `xlink:href="#${base}${id}"`);
}

function openingKitRenderMetrics(kit) {
  const tpl = tplById(kit.tpl || kit.type);
  const scale = kit.scale || scaleForOpeningKit(tpl.id, kit.size);
  return {
    tpl,
    scale,
    x: Number(kit.x || 300),
    y: Number(kit.y || 300),
    rot: Number(kit.rot || 0)
  };
}

function openingKitMaterialTransform({ x, y, rot }, scale) {
  return `scale(${(1 / scale).toFixed(5)}) rotate(${(-rot).toFixed(1)}) translate(${-x.toFixed(1)} ${-y.toFixed(1)})`;
}

function defsInnerSvg(defs) {
  return String(defs || "").trim().replace(/^<defs>/, "").replace(/<\/defs>$/, "");
}

export function renderOpeningKitSvg(kit, options = {}) {
  const { tpl, scale, x, y, rot } = openingKitRenderMetrics(kit);
  const selected = options.selected;
  const overlapping = options.overlap;
  const extracted = options.extracted || kit.extracted;
  const stroke = extracted ? "rgba(0,0,0,.6)" : selected ? "#d4af37" : overlapping ? "#ff4636" : "rgba(255,255,255,.58)";
  const fill = "none";
  const uid = kit.uid ?? kit.id ?? `${tpl.id}-kit`;
  const outline = kitOutlineWithAttrs(tpl.shape, `fill="${fill}" stroke="${stroke}" stroke-width="${selected || overlapping ? 3 : 2}" stroke-opacity=".95" stroke-linejoin="round" fill-rule="evenodd"`);
  const transform = `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${scale.toFixed(4)})`;
  if (extracted) {
    const rim = kitOutlineWithAttrs(tpl.shape, `fill="none" stroke="rgba(20,38,32,.35)" stroke-width="${(5 / scale).toFixed(2)}" stroke-linejoin="round"`);
    const lip = kitOutlineWithAttrs(tpl.shape, `fill="none" stroke="rgba(244,249,238,.48)" stroke-width="${(1.5 / scale).toFixed(2)}" stroke-linejoin="round"`);
    return `<g class="kit extracted" data-cutout="hollow" data-uid="${uid}" transform="${transform}"><g class="kit-wire" pointer-events="none">${rim}${lip}</g></g>`;
  }
  // The revealed planning board already shows this material. A transparent hit
  // area keeps the whole piece draggable without covering other pieces' wires
  // or rendering another copy of the expensive filtered stone texture.
  if (options.outlineOnly) {
    const hit = kitOutlineWithAttrs(tpl.shape, 'fill="transparent" fill-rule="evenodd"');
    return `<g class="kit${selected ? " sel" : ""}" data-uid="${uid}" transform="${transform}">${hit}<g class="kit-wire" pointer-events="none">${outline}</g></g>`;
  }
  const clipId = `kc${uid}`;
  const useTf = openingKitMaterialTransform({ x, y, rot }, scale);
  return `<g class="kit${selected ? " sel" : ""}" data-uid="${uid}" transform="${transform}"><clipPath id="${clipId}">${tpl.shape}</clipPath><g clip-path="url(#${clipId})"><use href="#jadeMaterial" transform="${useTf}"/></g><g class="kit-wire" pointer-events="none">${outline}</g></g>`;
}

export function renderJadeOpeningProductSvg(stone, kit, options = {}) {
  const { tpl, scale, x, y, rot } = openingKitRenderMetrics(kit);
  const shape = options.shape || tpl.shape;
  const uid = kit.uid ?? kit.id ?? `${tpl.id}-product`;
  const cacheKey = [
    "product",
    openingStoneCacheId(stone),
    uid,
    tpl.id,
    x.toFixed(2),
    y.toFixed(2),
    rot.toFixed(2),
    scale.toFixed(5),
    options.label || "",
    options.surfaceOnly ? "surface" : "finished",
    shape
  ].join("::");
  let svg = openingSvgMarkupCache.get(cacheKey);
  if (!svg) {
    const materialStone = options.surfaceOnly ? { ...stone, material: stone.material.replace(/<rect[^>]*fill="url\(#sheenGrad\)"[^>]*\/>/g, "") } : stone;
    const defs = defsForStone(materialStone, "");
    const useTf = openingKitMaterialTransform({ x, y, rot }, scale);
    const pad = Math.ceil(tpl.r * 1.18);
    const outline = kitOutlineWithAttrs(shape, `fill="none" stroke="rgba(28,49,45,.50)" stroke-width="${Math.max(2, tpl.r * 0.026).toFixed(2)}" stroke-opacity=".95" stroke-linejoin="round" fill-rule="evenodd"`);
    const shine = kitOutlineWithAttrs(shape, `fill="rgba(255,255,255,.16)" stroke="rgba(255,255,255,.34)" stroke-width="${Math.max(1, tpl.r * 0.012).toFixed(2)}" stroke-linejoin="round" fill-rule="evenodd"`);
    svg = `<svg class="jade-opening-product-svg" viewBox="${-pad} ${-pad} ${pad * 2} ${pad * 2}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${options.label || tpl.name}"><defs>${defsInnerSvg(defs)}<clipPath id="productClip">${shape}</clipPath></defs><g clip-path="url(#productClip)"><use href="#jadeMaterial" transform="${useTf}"/></g>${options.surfaceOnly ? "" : `<g class="product-finish" pointer-events="none">${shine}${outline}</g>`}</svg>`;
    rememberOpeningSvgMarkup(cacheKey, svg);
  }
  const instanceId = options.idPrefix || `jop-${sanitizeSvgIdPart(stone.id || stone.seed)}-${sanitizeSvgIdPart(uid)}-${openingSvgInstanceCounter += 1}`;
  return namespaceSvgReferences(svg, instanceId);
}

export function renderJadeOpeningSvg(stone, options = {}) {
  const scratches = options.scratches || [];
  const windows = (!options.revealed && Array.isArray(options.windows) && options.windows.length) ? options.windows : [];
  const kits = options.kits || [];
  const canCache = !scratches.length && !options.selectedUid;
  const cacheKey = canCache ? [
    "stone",
    openingStoneCacheId(stone),
    options.revealed ? 1 : 0,
    options.outlineOnly ? 1 : 0,
    openingSvgWindowsKey(windows),
    openingSvgKitsKey(kits),
    options.label || ""
  ].join("::") : "";
  let svg = cacheKey ? openingSvgMarkupCache.get(cacheKey) : null;
  if (!svg) {
    let windowHoles = "";
    if (windows.length) {
      windowHoles = windows.map((w) => {
        const cx = (Number(w.x) || 50) / 100 * 600;
        const cy = (Number(w.y) || 50) / 100 * 600;
        const r = (Number(w.r) || 10) / 100 * 600 * 0.55;
        return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.8).toFixed(1)}" fill="#000"/>`;
      }).join("");
    }
    const cutouts = kits.filter((kit) => kit.extracted).map((kit) => {
      const { tpl, scale, x, y, rot } = openingKitRenderMetrics(kit);
      return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${scale.toFixed(4)})">${kitOutlineWithAttrs(tpl.shape, 'fill="#000" fill-rule="evenodd"')}</g>`;
    }).join("");
    const cutMask = cutouts ? `<mask id="remainingStoneMask" maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="600" style="mask-type:luminance"><rect x="0" y="0" width="600" height="600" fill="#fff"/>${cutouts}</mask>` : "";
    const defs = defsForStone(stone, scratchSvg(scratches), windowHoles).replace("</defs>", `${cutMask}</defs>`);
    const overlapUids = computeOverlaps(kits);
    const kitLayer = kits.map((kit) => renderOpeningKitSvg(kit, {
      selected: options.selectedUid === (kit.uid ?? kit.id),
      overlap: overlapUids.has(kit.uid ?? kit.id),
      extracted: kit.extracted,
      outlineOnly: options.outlineOnly
    })).join("");
    const roughStyle = options.revealed ? ' style="opacity:0"' : "";
    svg = `<svg class="jade-opening-svg" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${options.label || "翡翠原石开料"}">${defs}<g clip-path="url(#stoneClip)"${cutouts ? ' mask="url(#remainingStoneMask)"' : ""}><use href="#jadeMaterial" id="jadeUse"/><g id="roughExterior" mask="url(#scratchMask)"${roughStyle}><rect x="0" y="0" width="600" height="600" fill="url(#roughBase)" filter="url(#rock)"/><rect x="0" y="0" width="600" height="600" fill="#fff" filter="url(#skinMottle)" opacity="0.7"/></g></g><g id="kitLayer" clip-path="url(#stoneClip)">${kitLayer}</g><path id="stoneOutline" d="${stone.stonePath}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="2"/></svg>`;
    if (cacheKey) rememberOpeningSvgMarkup(cacheKey, svg);
  }
  const instanceId = options.idPrefix || `jo-${sanitizeSvgIdPart(stone.id || stone.seed)}-${openingSvgInstanceCounter += 1}`;
  const namespaced = namespaceSvgReferences(svg, instanceId);
  return namespaced.replace('stroke="rgba(0,0,0,.45)"', 'stroke="var(--stone-outline, rgba(0,0,0,.45))"');
}
