import type { CoverType } from "./identity.js";
import { VISUAL_IDENTITY } from "./identity.js";

const W = 1200;
const H = 630;
const CX = W / 2;
const CY = H / 2 + 20;

function wrapSvg(content: string, bg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${bg}"/>
  ${content}
  <text x="60" y="560" fill="rgba(255,255,255,0.35)" font-family="Arial,sans-serif" font-size="22" letter-spacing="6">РАДАР БУДУЩЕГО</text>
</svg>`;
}

function radarRings(color: string, opacity: number, count: number): string {
  return Array.from({ length: count }, (_, i) => {
    const r = 80 + i * 55;
    return `<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${color}" stroke-opacity="${opacity - i * 0.08}" stroke-width="1.5"/>`;
  }).join("\n");
}

function radarCross(color: string, opacity: number): string {
  return `
    <line x1="${CX}" y1="${CY - 200}" x2="${CX}" y2="${CY + 200}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1"/>
    <line x1="${CX - 200}" y1="${CY}" x2="${CX + 200}" y2="${CY}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1"/>
  `;
}

function titleBlock(identity: (typeof VISUAL_IDENTITY)[CoverType]): string {
  return `
    <text x="${CX}" y="90" text-anchor="middle" fill="${identity.color}" font-family="Arial,sans-serif" font-size="38" font-weight="bold" letter-spacing="3">${identity.label}</text>
    <text x="${CX}" y="130" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-family="Arial,sans-serif" font-size="20">${identity.subtitle}</text>
  `;
}

function observationCover(): string {
  const c = VISUAL_IDENTITY.observation;
  return wrapSvg(`
    ${titleBlock(c)}
    ${radarRings(c.color, 0.35, 4)}
    ${radarCross(c.color, 0.2)}
    <circle cx="${CX}" cy="${CY}" r="120" fill="url(#glow)"/>
    <circle cx="${CX}" cy="${CY}" r="6" fill="${c.color}" fill-opacity="0.6"/>
    <circle cx="${CX + 40}" cy="${CY - 30}" r="4" fill="${c.color}" fill-opacity="0.35"/>
  `, "#0a1612");
}

function digestCover(): string {
  const c = VISUAL_IDENTITY.digest;
  return wrapSvg(`
    ${titleBlock(c)}
    ${radarRings(c.color, 0.3, 3)}
    ${radarCross(c.color, 0.15)}
    <circle cx="${CX - 50}" cy="${CY + 20}" r="5" fill="${c.color}" fill-opacity="0.5"/>
    <circle cx="${CX + 60}" cy="${CY - 40}" r="4" fill="${c.color}" fill-opacity="0.4"/>
    <circle cx="${CX + 20}" cy="${CY + 50}" r="4" fill="${c.color}" fill-opacity="0.35"/>
    <circle cx="${CX - 70}" cy="${CY - 50}" r="3" fill="${c.color}" fill-opacity="0.3"/>
  `, "#0a1612");
}

function trendsCover(): string {
  const c = VISUAL_IDENTITY.trends;
  return wrapSvg(`
    ${titleBlock(c)}
    ${radarRings(c.color, 0.35, 4)}
    ${radarCross(c.color, 0.2)}
    <path d="M ${CX - 120} ${CY + 40} L ${CX - 40} ${CY - 20} L ${CX + 30} ${CY + 10} L ${CX + 110} ${CY - 50}" fill="none" stroke="${c.color}" stroke-width="3" stroke-opacity="0.7" stroke-linecap="round"/>
    <polygon points="${CX + 110},${CY - 50} ${CX + 95},${CY - 35} ${CX + 100},${CY - 58}" fill="${c.color}" fill-opacity="0.8"/>
    <circle cx="${CX - 40}" cy="${CY - 20}" r="6" fill="${c.color}" fill-opacity="0.5"/>
    <circle cx="${CX + 30}" cy="${CY + 10}" r="5" fill="${c.color}" fill-opacity="0.4"/>
  `, "#0a1218");
}

function inTheBoxCover(): string {
  const c = VISUAL_IDENTITY["in-the-box"];
  return wrapSvg(`
    ${titleBlock(c)}
    <rect x="${CX - 55}" y="${CY - 90}" width="110" height="170" rx="14" fill="none" stroke="${c.color}" stroke-width="3" stroke-opacity="0.85"/>
    <rect x="${CX - 42}" y="${CY - 72}" width="84" height="130" rx="8" fill="${c.color}" fill-opacity="0.08"/>
    <circle cx="${CX - 15}" cy="${CY - 10}" r="18" fill="${c.color}" fill-opacity="0.35"/>
    <circle cx="${CX + 20}" cy="${CY + 25}" r="14" fill="${c.color}" fill-opacity="0.5"/>
    <path d="M ${CX - 30} ${CY + 50} L ${CX} ${CY + 15} L ${CX + 35} ${CY + 45}" fill="none" stroke="${c.color}" stroke-width="2" stroke-opacity="0.7"/>
    <line x1="${CX - 25}" y1="${CY - 35}" x2="${CX + 30}" y2="${CY + 5}" stroke="${c.color}" stroke-width="2" stroke-opacity="0.4" stroke-dasharray="5,4"/>
    <circle cx="${CX}" cy="${CY + 10}" r="45" fill="none" stroke="${c.color}" stroke-opacity="0.25" stroke-width="2"/>
  `, "#0a1218");
}

function signalCover(): string {
  const c = VISUAL_IDENTITY.signal;
  const blipX = CX + 70;
  const blipY = CY - 45;
  return wrapSvg(`
    ${titleBlock(c)}
    ${radarRings(c.color, 0.5, 5)}
    ${radarCross(c.color, 0.3)}
    <circle cx="${blipX}" cy="${blipY}" r="28" fill="${c.color}" fill-opacity="0.15"/>
    <circle cx="${blipX}" cy="${blipY}" r="14" fill="${c.color}" fill-opacity="0.5"/>
    <circle cx="${blipX}" cy="${blipY}" r="6" fill="${c.color}"/>
    <line x1="${CX}" y1="${CY}" x2="${blipX}" y2="${blipY}" stroke="${c.color}" stroke-opacity="0.4" stroke-width="2" stroke-dasharray="6,4"/>
  `, "#14120a");
}

function impactCover(): string {
  const c = VISUAL_IDENTITY.impact;
  const blips = [
    [CX + 80, CY - 50],
    [CX - 60, CY + 30],
    [CX + 30, CY + 70],
    [CX - 90, CY - 40],
  ];
  const blipSvg = blips
    .map(
      ([x, y]) => `
      <circle cx="${x}" cy="${y}" r="20" fill="${c.color}" fill-opacity="0.2"/>
      <circle cx="${x}" cy="${y}" r="8" fill="${c.color}" fill-opacity="0.8"/>
    `
    )
    .join("");
  return wrapSvg(`
    ${titleBlock(c)}
    ${radarRings(c.color, 0.55, 5)}
    ${radarCross(c.color, 0.35)}
    ${blipSvg}
    <circle cx="${CX}" cy="${CY}" r="160" fill="none" stroke="${c.color}" stroke-opacity="0.25" stroke-width="3">
      <animate attributeName="r" values="140;180;140" dur="3s" repeatCount="indefinite"/>
      <animate attributeName="stroke-opacity" values="0.35;0.1;0.35" dur="3s" repeatCount="indefinite"/>
    </circle>
  `, "#160a0a");
}

function breakthroughCover(): string {
  const c = VISUAL_IDENTITY.breakthrough;
  return wrapSvg(`
    ${titleBlock(c)}
    <rect x="0" y="${H - 180}" width="${W}" height="180" fill="#1a0a2e"/>
    <line x1="0" y1="${H - 180}" x2="${W}" y2="${H - 180}" stroke="${c.color}" stroke-opacity="0.4" stroke-width="2"/>
    <ellipse cx="${CX}" cy="${H - 200}" rx="200" ry="30" fill="${c.color}" fill-opacity="0.15"/>
    <polygon points="${CX - 25},${H - 250} ${CX},${H - 340} ${CX + 25},${H - 250}" fill="${c.color}" fill-opacity="0.9"/>
    <polygon points="${CX - 15},${H - 250} ${CX},${H - 310} ${CX + 15},${H - 250}" fill="#fff" fill-opacity="0.3"/>
    <rect x="${CX - 8}" y="${H - 250}" width="16" height="40" fill="${c.color}"/>
    <circle cx="${CX}" cy="${H - 280}" r="60" fill="${c.color}" fill-opacity="0.2"/>
    <circle cx="${CX}" cy="${H - 280}" r="100" fill="none" stroke="${c.color}" stroke-opacity="0.3" stroke-width="2"/>
    <circle cx="${CX}" cy="${H - 280}" r="140" fill="none" stroke="${c.color}" stroke-opacity="0.15" stroke-width="1"/>
    <line x1="${CX - 180}" y1="${H - 320}" x2="${CX + 180}" y2="${H - 240}" stroke="${c.color}" stroke-opacity="0.5" stroke-width="3"/>
  `, "#0d0618");
}

function failureCover(): string {
  const c = VISUAL_IDENTITY.failure;
  return wrapSvg(`
    ${titleBlock(c)}
    ${radarRings("#555", 0.25, 3)}
    <line x1="${CX - 150}" y1="${CY - 80}" x2="${CX + 80}" y2="${CY + 60}" stroke="${c.color}" stroke-width="3" stroke-opacity="0.6"/>
    <line x1="${CX - 150}" y1="${CY + 60}" x2="${CX + 80}" y2="${CY - 80}" stroke="${c.color}" stroke-width="3" stroke-opacity="0.6"/>
    <polygon points="${CX + 120},${CY - 100} ${CX + 160},${CY - 60} ${CX + 140},${CY - 40} ${CX + 100},${CY - 80}" fill="#E74C3C" fill-opacity="0.7"/>
    <text x="${CX + 135}" y="${CY - 62}" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="22" font-weight="bold">!</text>
    <path d="M ${CX - 200} ${CY} Q ${CX - 100} ${CY - 30}, ${CX} ${CY} T ${CX + 200} ${CY}" fill="none" stroke="#E74C3C" stroke-width="2" stroke-opacity="0.5" stroke-dasharray="12,8"/>
    <path d="M ${CX - 180} ${CY + 40} Q ${CX - 80} ${CY + 10}, ${CX + 20} ${CY + 40}" fill="none" stroke="#555" stroke-width="2" stroke-dasharray="8,12"/>
  `, "#0a0e14");
}

const GENERATORS: Record<CoverType, () => string> = {
  observation: observationCover,
  digest: digestCover,
  trends: trendsCover,
  "in-the-box": inTheBoxCover,
  signal: signalCover,
  impact: impactCover,
  breakthrough: breakthroughCover,
  failure: failureCover,
};

export function buildCoverSvg(type: CoverType): string {
  return GENERATORS[type]();
}
