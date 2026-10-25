// Shared with trading-house equipment cards: rounded, five-unit jade outlines.
export function equipmentOutlineSvg(stage) {
  if (stage === "opening") return `<svg class="workshop-resource-outline" data-equipment-art="opening" viewBox="0 0 160 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M25 83h110M35 83V64h90v19M30 64h100M51 60a29 29 0 1 1 57 0M65 60a15 15 0 1 1 29 0M80 18v9M51 30l7 7M109 30l-7 7M45 50h10M105 50h10"/><path d="m69 58 11-12 11 12"/></g></svg>`;
  if (stage === "finishing") return `<svg class="workshop-resource-outline" data-equipment-art="finishing" viewBox="0 0 160 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M25 83h110M40 80V66h48v14M64 65V52M84 41h29M111 32v26l15 12M122 77h13"/><circle cx="64" cy="34" r="23"/><circle cx="64" cy="34" r="9"/><path d="m100 16 3 5 6 1-5 4-1 6-3-5-6-1 5-4Z" stroke-width="3"/></g></svg>`;
  return `<svg class="workshop-resource-outline" viewBox="0 0 160 100" aria-hidden="true"><path d="M28 85h104M38 82V34h48v48M38 34V20h70v14M100 34v22h22V34M112 56v14M50 47h23M50 58h23M50 69h23" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="112" cy="25" r="5" fill="currentColor"/></svg>`;
}

export function employeeOutlineSvg() {
  return `<svg class="workshop-resource-outline" viewBox="0 0 160 100" aria-hidden="true">
    <g stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M43 85V79Q43 64 61 62L69 59H91L99 62Q117 64 117 79V85Z" fill="currentColor" fill-opacity=".13"/>
      <path d="M69 55V63L80 72L91 63V55" fill="currentColor" fill-opacity=".18"/>
      <path d="M58 32Q58 15 80 15Q102 15 102 32V39Q102 59 80 59Q58 59 58 39Z" fill="currentColor" fill-opacity=".1"/>
      <path d="M58 32Q69 34 77 24Q85 34 102 32M59 67L68 85M101 67L92 85M63 85H97" fill="none"/>
      <path d="M75 47Q80 51 85 47" fill="none" stroke-width="3"/>
    </g>
    <circle cx="72" cy="39" r="2.3" fill="currentColor"/><circle cx="88" cy="39" r="2.3" fill="currentColor"/>
  </svg>`;
}
