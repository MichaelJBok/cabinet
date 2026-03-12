import { useState, useMemo, useRef, useEffect } from "react";
import { useSupabase } from "./hooks/useSupabase";
import { ALL_TAGS, DRINK_VISUALS } from "./data";

// Each ingredient: { name, oz: number|null, displayAmt: string (for non-numeric like "rim", "2 dashes") }
// oz is the canonical numeric value in fluid ounces; displayAmt used when oz is null
const ML_PER_OZ = 29.5735;

// Measure how many ingredient chips fit in `containerW` across max `maxRows` rows.
// Returns { visible: string[], extra: number }
const _chipCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
function fitChips(names, containerW, maxRows, chipFont = "9px DM Sans, system-ui, sans-serif") {
  const ctx = _chipCanvas ? _chipCanvas.getContext("2d") : null;
  if (!ctx || !containerW) return { visible: names, extra: 0 };
  ctx.font = chipFont;
  const GAP = 3, PADX = 10, BADGE_W = 28; // "+99" badge worst case
  const ROW_H = 22, maxH = maxRows * ROW_H;
  let x = 0, y = 0, visible = [];
  for (let i = 0; i < names.length; i++) {
    const w = Math.ceil(ctx.measureText(names[i]).width) + PADX;
    const remaining = names.length - i;
    // Would we need a badge after this chip?
    const needBadge = remaining > 1;
    const wWithBadge = needBadge ? w + GAP + BADGE_W : w;
    if (x > 0 && x + w > containerW) { x = 0; y += ROW_H; } // wrap
    if (y + ROW_H > maxH) break; // no more rows
    // If adding this chip + a badge would overflow the row, stop and leave room for badge
    if (needBadge && x + wWithBadge > containerW && y + ROW_H * 2 > maxH) break;
    visible.push(names[i]);
    x += w + GAP;
  }
  return { visible, extra: names.length - visible.length };
}

function parseOz(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase().replace(/\s*oz\s*$/, "").replace(/\s*ml\s*$/, "").trim();
  // Unicode fractions (¼ ½ etc.)
  const fracEntries = [["¼",0.25],["½",0.5],["¾",0.75],["⅓",0.333],["⅔",0.667],["⅛",0.125]];
  for (let fi = 0; fi < fracEntries.length; fi++) {
    const f = fracEntries[fi][0], fv = fracEntries[fi][1];
    if (s === f) return fv;
    const m = s.match(new RegExp("^(\\d+)\\s*" + f + "$"));
    if (m) return parseInt(m[1]) + fv;
  }
  // Slash fractions: "1/2", "3/4", "1 1/2", "1 3/4"
  const slashMixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (slashMixed) return parseInt(slashMixed[1]) + parseInt(slashMixed[2]) / parseInt(slashMixed[3]);
  const slashOnly = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (slashOnly) return parseInt(slashOnly[1]) / parseInt(slashOnly[2]);
  // Only accept if the entire string is numeric (no trailing words like "dashes")
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  if (!/^[\d.\s/¼½¾⅓⅔⅛]+$/.test(s)) return null;
  return n;
}

function formatAmt(oz, unit, servings) {
  if (oz === null) return null;
  const val = oz * servings * (unit === "ml" ? ML_PER_OZ : 1);
  if (unit === "ml") return `${Math.round(val)} ml`;
  // nice fraction display
  const fracs = [[0.25,"¼"],[0.5,"½"],[0.75,"¾"],[0.333,"⅓"],[0.667,"⅔"],[0.125,"⅛"]];
  const whole = Math.floor(val);
  const rem = val - whole;
  let fracStr = "";
  for (let fi = 0; fi < fracs.length; fi++) {
    if (Math.abs(rem - fracs[fi][0]) < 0.04) { fracStr = fracs[fi][1]; break; }
  }
  if (Math.abs(rem) < 0.04) return whole === 0 ? "0 oz" : `${whole} oz`;
  if (fracStr) return whole === 0 ? `${fracStr} oz` : `${whole}${fracStr} oz`;
  return `${val % 1 === 0 ? val : val.toFixed(1)} oz`;
}

function ing(name, ozVal, displayAmt) {
  return { name, oz: ozVal, displayAmt: displayAmt || null };
}

// ── Cocktail illustration lookup ──
// Maps glass type + drink name to SVG rendering params
function CocktailIllustration({ name, glass, color, size = 64, visOverride = null, lightMode = false }) {
  const gl = (glass || "").toLowerCase();
  const vis = visOverride || DRINK_VISUALS[name] || {
    glass: gl.includes("high") || gl.includes("collins") ? "highball" :
           gl.includes("mart") ? "martini" :
           gl.includes("flute") ? "flute" :
           gl.includes("wine") ? "wine" :
           gl.includes("hurr") ? "hurricane" :
           gl.includes("mule") || gl.includes("mug") ? "mule" :
           gl.includes("shot") || gl.includes("shooter") ? "shot" :
           gl.includes("snif") || gl.includes("brandy") || gl.includes("cognac") ? "snifter" :
           gl.includes("nick") || gl.includes("nora") ? "nick" :
           gl.includes("tiki") ? "tiki" :
           "rocks",
    liquid: color || "#a0c8f0",
    foam: false, garnish: null, ice: false, bubbles: false,
    crushed: false, layered: false, salt: false, sugar: false,
  };

  const s = size;
  const cx = s / 2;
  // Pre-compute the viewBox string once — avoids template literals in JSX attributes
  const vb = "0 0 " + s + " " + s;

  // Shared defs
  const liquidColor = vis.liquid;
  const glassStroke = lightMode ? "rgba(80,50,20,0.35)" : "rgba(255,255,255,0.35)";
  const glassFill = lightMode ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
  const iceColor = "rgba(200,230,255,0.55)";
  const iceStroke = "rgba(140,180,220,0.8)";

  const IceCubes = ({ x1,y1,x2,y2,x3,y3 }) => (
    <g opacity="0.85">
      <rect x={x1} y={y1} width={s*0.12} height={s*0.12} rx={1} fill={iceColor} stroke={iceStroke} strokeWidth="1"/>
      <rect x={x2} y={y2} width={s*0.10} height={s*0.10} rx={1} fill={iceColor} stroke={iceStroke} strokeWidth="1"/>
      <rect x={x3} y={y3} width={s*0.11} height={s*0.11} rx={1} fill={iceColor} stroke={iceStroke} strokeWidth="1"/>
    </g>
  );

  // C: Crushed ice — scattered small shards
  const CrushedIce = ({ cx: bx, top, bottom, width }) => {
    const shards = [
      [bx-width*0.3, bottom-s*0.05, s*0.06, s*0.04, -15],
      [bx+width*0.1, bottom-s*0.08, s*0.05, s*0.035, 10],
      [bx-width*0.1, bottom-s*0.12, s*0.04, s*0.03, -5],
      [bx+width*0.28, bottom-s*0.06, s*0.055, s*0.038, 20],
      [bx-width*0.22, bottom-s*0.16, s*0.045, s*0.032, -20],
      [bx+width*0.05, bottom-s*0.18, s*0.05, s*0.035, 8],
    ];
    return <g opacity="0.65">
      {shards.map(([x,y,rw,rh,rot],i) => (
        <ellipse key={i} cx={x} cy={y} rx={rw} ry={rh}
          fill={iceColor} stroke={iceStroke} strokeWidth="0.8"
          transform={"rotate("+rot+","+x+","+y+")"}/>
      ))}
    </g>;
  };

  // C: Salt or sugar rim — dotted band at the top of the glass
  const RimCoating = ({ rimY, rimX1, rimX2, type }) => {
    const col = type==="sugar" ? "rgba(255,240,180,0.85)" : "rgba(220,220,240,0.85)";
    const dots = [];
    const steps = Math.round((rimX2 - rimX1) / (s*0.035));
    for (let i = 0; i <= steps; i++) {
      const x = rimX1 + (rimX2-rimX1)*(i/steps);
      const jitter = (i%3===0?-1:i%3===1?1:0)*s*0.008;
      dots.push(<circle key={i} cx={x} cy={rimY+jitter} r={s*0.012} fill={col} opacity="0.9"/>);
    }
    return <g>{dots}</g>;
  };

  const Bubbles = ({ bx, by, r1=1.2, r2=0.8, r3=1 }) => (
    <g opacity="0.6">
      <circle cx={bx}    cy={by}    r={r1} fill="rgba(255,255,255,0.5)" stroke="rgba(180,210,240,0.9)" strokeWidth="0.6"/>
      <circle cx={bx+4}  cy={by+5}  r={r2} fill="rgba(255,255,255,0.5)" stroke="rgba(180,210,240,0.9)" strokeWidth="0.6"/>
      <circle cx={bx-3}  cy={by+8}  r={r3} fill="rgba(255,255,255,0.5)" stroke="rgba(180,210,240,0.9)" strokeWidth="0.6"/>
    </g>
  );

  const Foam = ({ fx, fy, fw }) => (
    <ellipse cx={fx} cy={fy} rx={fw} ry={fw*0.28} fill="rgba(255,255,255,0.75)" opacity="0.9"/>
  );

  // Garnish
  // rimX, rimY = the point on the glass rim where the garnish sits
  const Garnish = ({ type, rimX, rimY }) => {
    if (!type) return null;
    // Default to top-right of svg if not provided
    const gx = rimX !== undefined ? rimX : s * 0.78;
    const gy = rimY !== undefined ? rimY : s * 0.18;
    // Garnish hovers slightly above the rim
    const hover = s * 0.04;
    const gy2 = gy - hover;
    if (type === "lime" || type === "lemon" || type === "orange" || type === "grapefruit") {
      const gc = type==="lime"?"#7ec850":type==="lemon"?"#f8d840":type==="orange"?"#f87830":"#f8b060";
      const gDark = type==="lime"?"#4a8020":type==="lemon"?"#c8a010":type==="orange"?"#c04010":"#c87020";
      return <g>
        <circle cx={gx} cy={gy2} r={s*0.1} fill={gc} opacity="0.95" stroke={gDark} strokeWidth="1"/>
        <circle cx={gx} cy={gy2} r={s*0.065} fill={gc} opacity="0.35" stroke={gc} strokeWidth="0.8"/>
        <line x1={gx-s*0.07} y1={gy2} x2={gx+s*0.07} y2={gy2} stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"/>
        <line x1={gx} y1={gy2-s*0.07} x2={gx} y2={gy2+s*0.07} stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"/>
      </g>;
    }
    if (type === "cherry") {
      const cp = "M" + gx + "," + (gy2-s*0.04) + " Q" + (gx+s*0.06) + "," + (gy2-s*0.13) + " " + (gx+s*0.03) + "," + (gy2-s*0.17);
      return <g>
        <circle cx={gx} cy={gy2+s*0.01} r={s*0.075} fill="#d02040" opacity="0.95" stroke="#880010" strokeWidth="1"/>
        <path d={cp} stroke="#508030" strokeWidth="1.2" fill="none"/>
      </g>;
    }
    if (type === "mint") {
      const t1 = "rotate(-30," + (gx-2) + "," + gy2 + ")";
      const t2 = "rotate(20," + (gx+3) + "," + (gy2-2) + ")";
      const t3 = "rotate(-10," + gx + "," + (gy2+3) + ")";
      return <g>
        <ellipse cx={gx-2} cy={gy2}   rx={s*0.06}  ry={s*0.035} fill="#50c060" opacity="0.95" stroke="#207030" strokeWidth="0.8" transform={t1}/>
        <ellipse cx={gx+3} cy={gy2-2} rx={s*0.055} ry={s*0.032} fill="#60d070" opacity="0.95" stroke="#288038" strokeWidth="0.8" transform={t2}/>
        <ellipse cx={gx}   cy={gy2+3} rx={s*0.05}  ry={s*0.03}  fill="#58c868" opacity="0.85" stroke="#207030" strokeWidth="0.7" transform={t3}/>
      </g>;
    }
    if (type === "pineapple") {
      const pp = "M" + (gx-4) + "," + (gy2-s*0.06) + " Q" + gx + "," + (gy2-s*0.17) + " " + (gx+4) + "," + (gy2-s*0.06);
      return <g>
        <ellipse cx={gx} cy={gy2+s*0.02} rx={s*0.07} ry={s*0.09} fill="#f8c020" opacity="0.95" stroke="#c07800" strokeWidth="1"/>
        <path d={pp} stroke="#50a030" strokeWidth="1.8" fill="none"/>
      </g>;
    }
    if (type === "olive") return <g>
      <ellipse cx={gx} cy={gy2} rx={s*0.055} ry={s*0.08} fill="#708030" opacity="0.95" stroke="#404810" strokeWidth="1"/>
      <ellipse cx={gx} cy={gy2} rx={s*0.02}  ry={s*0.03} fill="#e83020" opacity="0.95" stroke="#800800" strokeWidth="0.7"/>
    </g>;
    if (type === "beans") return <g>
      <ellipse cx={gx-3} cy={gy2+2} rx={3} ry={4.5} fill="#301808" opacity="0.95" stroke="#181008" strokeWidth="0.8"/>
      <ellipse cx={gx+2} cy={gy2}   rx={3} ry={4.5} fill="#301808" opacity="0.95" stroke="#181008" strokeWidth="0.8"/>
      <ellipse cx={gx-1} cy={gy2-3} rx={3} ry={4.5} fill="#301808" opacity="0.95" stroke="#181008" strokeWidth="0.8"/>
    </g>;
    if (type === "passion") return <g>
      <ellipse cx={gx} cy={gy2} rx={s*0.1}   ry={s*0.08}  fill="#f0a830" opacity="0.95" stroke="#a05800" strokeWidth="1"/>
      <circle  cx={gx} cy={gy2} r={s*0.055} fill="#e06820" opacity="0.7" stroke="#904010" strokeWidth="0.7"/>
    </g>;
    if (type === "jalapeño") {
      const jt = "rotate(20," + gx + "," + gy2 + ")";
      return <g>
        <ellipse cx={gx} cy={gy2} rx={s*0.045} ry={s*0.10} fill="#48b030" opacity="0.95" stroke="#206010" strokeWidth="1" transform={jt}/>
      </g>;
    }
    if (type === "berry") return <g>
      <circle cx={gx} cy={gy2} r={s*0.075} fill="#8030a0" opacity="0.95" stroke="#501060" strokeWidth="1"/>
      <circle cx={gx} cy={gy2} r={s*0.04} fill="#9840c0" opacity="0.6"/>
    </g>;
    if (type === "ginger" || type === "nutmeg") return <g>
      <ellipse cx={gx} cy={gy2} rx={s*0.08} ry={s*0.05} fill="#c88040" opacity="0.85" stroke="#805020" strokeWidth="1"/>
    </g>;
    if (type === "bitters") return <g>
      <circle cx={gx-4} cy={gy2}   r={2}   fill="#c83020" opacity="0.85" stroke="#801010" strokeWidth="0.7"/>
      <circle cx={gx+2} cy={gy2-3} r={1.5} fill="#c83020" opacity="0.85" stroke="#801010" strokeWidth="0.7"/>
      <circle cx={gx+4} cy={gy2+2} r={2}   fill="#c83020" opacity="0.85" stroke="#801010" strokeWidth="0.7"/>
    </g>;
    if (type === "rosemary") {
      const rr = "rotate(-40," + gx + "," + gy2 + ")";
      return <g transform={rr}>
        <line x1={gx} y1={gy2-s*0.12} x2={gx} y2={gy2+s*0.04} stroke="#4a8030" strokeWidth="1.2"/>
        {[-0.10,-0.07,-0.04,-0.01].map((dy,i) => (
          <g key={i}>
            <ellipse cx={gx-s*0.025} cy={gy2+dy*s} rx={s*0.025} ry={s*0.01} fill="#50a040" opacity="0.9" stroke="#206020" strokeWidth="0.6"/>
            <ellipse cx={gx+s*0.025} cy={gy2+(dy-0.015)*s} rx={s*0.025} ry={s*0.01} fill="#58b048" opacity="0.9" stroke="#206020" strokeWidth="0.6"/>
          </g>
        ))}
      </g>;
    }
    if (type === "cucumber") {
      return <g>
        <ellipse cx={gx} cy={gy2} rx={s*0.055} ry={s*0.09} fill="#6ab04c" opacity="0.95" stroke="#306820" strokeWidth="1"/>
        <ellipse cx={gx} cy={gy2} rx={s*0.03}  ry={s*0.07} fill="#90d060" opacity="0.7"/>
        <line x1={gx} y1={gy2-s*0.07} x2={gx} y2={gy2+s*0.07} stroke="#80c050" strokeWidth="0.6" opacity="0.6"/>
      </g>;
    }
    if (type === "salt" || type === "sugar") {
      const rc = type==="salt" ? "#e8e8f0" : "#f8f0d0";
      const rs = type==="salt" ? "#a0a0c0" : "#c0a840";
      return <g>
        {[-1,0,1].map(dx => [-1,0,1].map(dy => (
          <rect key={dx+","+dy} x={gx+dx*4-1} y={gy2+dy*4-1} width={2} height={2} rx={0.5} fill={rc} opacity="0.9" stroke={rs} strokeWidth="0.4"/>
        )))}
      </g>;
    }
    // A: Custom garnish text label — any unrecognised string renders as a small badge above the rim
    if (typeof type === "string" && type.length > 0) {
      return <g>
        <rect x={gx-s*0.14} y={gy2-s*0.09} width={s*0.28} height={s*0.12} rx={3} fill="rgba(0,0,0,0.45)"/>
        <text x={gx} y={gy2+s*0.015} textAnchor="middle" fontSize={s*0.075} fill="#fff" fontFamily="sans-serif" opacity="0.95">{type.length>6?type.slice(0,5)+"…":type}</text>
      </g>;
    }
    return null;
  };

  // ── Glass shapes ──
  if (vis.glass === "martini" || vis.glass === "coupe") {
    const isMartini = vis.glass === "martini";
    const bowlTop  = s * 0.10;
    const bowlMid  = s * (isMartini ? 0.58 : 0.55);
    const bowlW    = s * 0.40;
    const stemBot  = s * 0.88;
    const baseW    = s * 0.28;
    const liquidH  = s * 0.72;
    const clipId   = "clip-" + name.replace(/[^a-zA-Z0-9]/g,"") + "-" + size;
    const clipUrl  = "url(#" + clipId + ")";
    const mPts     = (cx-bowlW) + "," + bowlTop + " " + (cx+bowlW) + "," + bowlTop + " " + cx + "," + bowlMid;
    const cPath    = "M" + (cx-bowlW) + "," + bowlTop + " Q" + (cx-bowlW) + "," + (bowlMid*0.7) + " " + cx + "," + bowlMid + " Q" + (cx+bowlW) + "," + (bowlMid*0.7) + " " + (cx+bowlW) + "," + bowlTop + " Z";
    const cOutline = "M" + (cx-bowlW) + "," + bowlTop + " Q" + (cx-bowlW) + "," + (bowlMid*0.75) + " " + cx + "," + bowlMid + " Q" + (cx+bowlW) + "," + (bowlMid*0.75) + " " + (cx+bowlW) + "," + bowlTop + " Z";
    // Garnish sits on the right rim edge
    const gRimX = cx + bowlW * 0.75;
    const gRimY = bowlTop;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs>
          <clipPath id={clipId}>
            {isMartini
              ? <polygon points={mPts}/>
              : <path d={cPath}/>
            }
          </clipPath>
        </defs>
        <rect x={cx-bowlW} y={bowlTop} width={bowlW*2} height={bowlMid-bowlTop} clipPath={clipUrl} fill={liquidColor} opacity="0.88"/>
        {vis.redwine && <rect x={cx-bowlW} y={s*0.12} width={bowlW*2} height={s*0.07} clipPath={clipUrl} fill="#8b0000" opacity="0.7"/>}
        {vis.foam && <Foam fx={cx} fy={s*0.13} fw={bowlW*0.82}/>}
        {vis.layered && <rect x={cx-bowlW} y={bowlTop+(bowlMid-bowlTop)*0.6} width={bowlW*2} height={(bowlMid-bowlTop)*0.28} clipPath={clipUrl} fill="rgba(200,80,20,0.3)" opacity="0.8"/>}
        {vis.salt && <RimCoating rimY={bowlTop} rimX1={cx-bowlW} rimX2={cx+bowlW} type="salt"/>}
        {vis.sugar && <RimCoating rimY={bowlTop} rimX1={cx-bowlW} rimX2={cx+bowlW} type="sugar"/>}
        {isMartini
          ? <polygon points={mPts} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
          : <path d={cOutline} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
        }
        <line x1={cx-bowlW} y1={bowlTop} x2={cx+bowlW} y2={bowlTop} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx} y1={bowlMid} x2={cx} y2={stemBot} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-baseW/2} y1={stemBot} x2={cx+baseW/2} y2={stemBot} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={cx-bowlW+2} y1={bowlTop+2} x2={cx-bowlW*0.5} y2={bowlMid*0.6} stroke="rgba(255,255,255,0.25)" strokeWidth="0.8"/>
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  if (vis.glass === "rocks") {
    const gx = s*0.14, gy = s*0.22, gw = s*0.72, gh = s*0.65;
    const liqH = gh * 0.72;
    const clipId = "clip-" + name.replace(/[^a-zA-Z0-9]/g,"") + "-" + size;
    const clipUrl = "url(#" + clipId + ")";
    const outline = "M" + (gx+4) + "," + gy + " L" + (gx+gw-4) + "," + gy + " L" + (gx+gw) + "," + (gy+gh) + " L" + gx + "," + (gy+gh) + " Z";
    // Garnish sits on the right side of the rim
    const gRimX = gx + gw * 0.78;
    const gRimY = gy;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs><clipPath id={clipId}><path d={outline}/></clipPath></defs>
        <rect x={gx} y={gy+gh-liqH} width={gw} height={liqH} clipPath={clipUrl} fill={liquidColor} opacity="0.85"/>
        {vis.redwine && <rect x={gx} y={gy+gh-liqH} width={gw} height={s*0.07} clipPath={clipUrl} fill="#8b0000" opacity="0.7"/>}
        {vis.cream   && <rect x={gx} y={gy+gh-liqH} width={gw} height={s*0.09} clipPath={clipUrl} fill="rgba(255,248,235,0.85)" opacity="0.9"/>}
        {vis.ice && <IceCubes x1={gx+6} y1={gy+gh-s*0.22} x2={gx+gw-s*0.22} y2={gy+gh-s*0.28} x3={gx+gw*0.42} y3={gy+gh-s*0.20}/>}
        {vis.crushed && <CrushedIce cx={cx} top={gy} bottom={gy+gh} width={gw}/>}
        {vis.layered && <rect x={gx} y={gy+gh-liqH*0.42} width={gw} height={liqH*0.3} clipPath={clipUrl} fill="rgba(200,80,20,0.3)" opacity="0.8"/>}
        {vis.salt && <RimCoating rimY={gy} rimX1={gx+4} rimX2={gx+gw-4} type="salt"/>}
        {vis.sugar && <RimCoating rimY={gy} rimX1={gx+4} rimX2={gx+gw-4} type="sugar"/>}
        {vis.foam && <Foam fx={cx} fy={gy+gh-liqH+s*0.04} fw={gw*0.44}/>}
        <path d={outline} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={gx} y1={gy} x2={gx+gw} y2={gy} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={gx+5} y1={gy+4} x2={gx+9} y2={gy+gh-8} stroke="rgba(255,255,255,0.2)" strokeWidth="0.9"/>
        {vis.bubbles && <Bubbles bx={gx+gw*0.7} by={gy+gh-liqH+s*0.1}/>}
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  if (vis.glass === "highball" || vis.glass === "mule") {
    const isMule = vis.glass === "mule";
    const gx = s*0.20, gy = s*0.10, gw = s*0.60, gh = s*0.78;
    const liqH = gh * 0.78;
    const clipId  = "clip-" + name.replace(/[^a-zA-Z0-9]/g,"") + "-" + size;
    const clipUrl = "url(#" + clipId + ")";
    const muleHandle = "M" + (gx+gw) + "," + (gy+gh*0.3) + " Q" + (gx+gw+s*0.18) + "," + (gy+gh*0.3) + " " + (gx+gw+s*0.18) + "," + (gy+gh*0.55) + " Q" + (gx+gw+s*0.18) + "," + (gy+gh*0.8) + " " + (gx+gw) + "," + (gy+gh*0.8);
    // Garnish sits on top-right of rim
    const gRimX = gx + gw * 0.78;
    const gRimY = gy;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs><clipPath id={clipId}><rect x={gx} y={gy} width={gw} height={gh} rx={isMule?4:2}/></clipPath></defs>
        {vis.sunrise ? (
          <g clipPath={clipUrl}>
            <rect x={gx} y={gy}          width={gw} height={gh}      fill="#f8a820"/>
            <rect x={gx} y={gy+gh*0.65}  width={gw} height={gh*0.35} fill="#e03020" opacity="0.7"/>
            <rect x={gx} y={gy+gh*0.5}   width={gw} height={gh*0.2}  fill="#f06020" opacity="0.5"/>
          </g>
        ) : (
          <rect x={gx} y={gy+gh-liqH} width={gw} height={liqH} clipPath={clipUrl} fill={liquidColor} opacity="0.85"/>
        )}
        {vis.ice     && <IceCubes x1={gx+5} y1={gy+8} x2={gx+gw-s*0.18} y2={gy+14} x3={gx+gw*0.38} y3={gy+5}/>}
        {vis.crushed && <CrushedIce cx={cx} top={gy} bottom={gy+gh} width={gw}/>}
        {vis.layered && <rect x={gx} y={gy+gh-liqH*0.42} width={gw} height={liqH*0.3} clipPath={clipUrl} fill="rgba(200,80,20,0.3)" opacity="0.8"/>}
        {vis.salt && <RimCoating rimY={gy} rimX1={gx} rimX2={gx+gw} type="salt"/>}
        {vis.sugar && <RimCoating rimY={gy} rimX1={gx} rimX2={gx+gw} type="sugar"/>}
        {vis.bubbles && <Bubbles bx={gx+gw*0.65} by={gy+gh-liqH+s*0.12}/>}
        {vis.foam    && <Foam fx={cx} fy={gy+gh-liqH+s*0.04} fw={gw*0.44}/>}
        {isMule      && <path d={muleHandle} fill="none" stroke={glassStroke} strokeWidth="2"/>}
        <rect x={gx} y={gy} width={gw} height={gh} rx={isMule?4:2} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={gx} y1={gy} x2={gx+gw} y2={gy} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={gx+4} y1={gy+4} x2={gx+6} y2={gy+gh-8} stroke="rgba(255,255,255,0.18)" strokeWidth="0.9"/>
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  if (vis.glass === "flute") {
    const fw = s*0.28, fh = s*0.80, fx = cx-s*0.14, fy = s*0.08;
    const stemBot = fy+fh, baseW = s*0.30;
    const liqH = fh * 0.78;
    const clipId  = "clip-" + name.replace(/[^a-zA-Z0-9]/g,"") + "-" + size;
    const clipUrl = "url(#" + clipId + ")";
    const fluteClip = "M" + fx + "," + fy + " L" + (fx+fw) + "," + fy + " L" + (fx+fw*0.85) + "," + (fy+fh*0.78) + " L" + (fx+fw*0.15) + "," + (fy+fh*0.78) + " Z";
    // Garnish sits on the right rim edge of the flute
    const gRimX = fx + fw;
    const gRimY = fy;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs><clipPath id={clipId}><path d={fluteClip}/></clipPath></defs>
        <rect x={fx} y={fy+fh*0.78-liqH*0.9} width={fw} height={liqH*0.9} clipPath={clipUrl} fill={liquidColor} opacity="0.85"/>
        {vis.bubbles && <Bubbles bx={cx+2} by={fy+fh*0.5} r1={0.9} r2={0.6} r3={0.8}/>}
        <path d={fluteClip} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={fx} y1={fy} x2={fx+fw} y2={fy} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={cx} y1={fy+fh*0.78} x2={cx} y2={stemBot} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-baseW/2} y1={stemBot} x2={cx+baseW/2} y2={stemBot} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={fx+3} y1={fy+4} x2={fx+5} y2={fy+fh*0.6} stroke="rgba(255,255,255,0.2)" strokeWidth="0.8"/>
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  if (vis.glass === "wine") {
    const bowlW=s*0.38, bowlTop=s*0.12, bowlBot=s*0.65, stemBot=s*0.90, baseW=s*0.32;
    const liqH = (bowlBot-bowlTop)*0.70;
    const clipId  = "clip-" + name.replace(/[^a-zA-Z0-9]/g,"") + "-" + size;
    const clipUrl = "url(#" + clipId + ")";
    const winePath = "M" + (cx-bowlW) + "," + bowlTop + " Q" + (cx-bowlW*1.1) + "," + (bowlBot*0.7) + " " + (cx-s*0.08) + "," + bowlBot + " L" + (cx+s*0.08) + "," + bowlBot + " Q" + (cx+bowlW*1.1) + "," + (bowlBot*0.7) + " " + (cx+bowlW) + "," + bowlTop + " Z";
    const gRimX = cx + bowlW * 0.82;
    const gRimY = bowlTop;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs><clipPath id={clipId}><path d={winePath}/></clipPath></defs>
        <rect x={cx-bowlW} y={bowlBot-liqH} width={bowlW*2} height={liqH} clipPath={clipUrl} fill={liquidColor} opacity="0.85"/>
        {vis.ice     && <IceCubes x1={cx-s*0.2} y1={bowlBot-liqH+4} x2={cx+s*0.06} y2={bowlBot-liqH+8} x3={cx-s*0.05} y3={bowlBot-liqH+2}/>}
        {vis.bubbles && <Bubbles bx={cx+10} by={bowlBot-liqH+s*0.1} r1={1} r2={0.7} r3={0.9}/>}
        <path d={winePath} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-bowlW} y1={bowlTop} x2={cx+bowlW} y2={bowlTop} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={cx-s*0.08} y1={bowlBot} x2={cx+s*0.08} y2={bowlBot} stroke={glassStroke} strokeWidth="1"/>
        <line x1={cx} y1={bowlBot} x2={cx} y2={stemBot} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-baseW/2} y1={stemBot} x2={cx+baseW/2} y2={stemBot} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={cx-bowlW+3} y1={bowlTop+4} x2={cx-bowlW*0.55} y2={bowlBot*0.6} stroke="rgba(255,255,255,0.2)" strokeWidth="0.8"/>
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  if (vis.glass === "hurricane") {
    // Hurricane: wide at top, pinches to a narrow neck mid-glass, flares slightly at base
    const rimW  = s * 0.36;  // half-width at rim
    const neckW = s * 0.10;  // half-width at narrowest point
    const ht = s * 0.08;     // top y
    const hb = s * 0.88;     // base y
    const neckY = s * 0.55;  // y of narrowest point
    const liqH = (hb - ht) * 0.72;
    const clipId  = "clip-" + name.replace(/[^a-zA-Z0-9]/g,"") + "-" + size;
    const clipUrl = "url(#" + clipId + ")";
    // Left side: rim → neck (curve in) → base (slight flare)
    // Right side: base → neck → rim (mirror)
    const hPath = "M" + (cx - rimW) + "," + ht
      + " Q" + (cx - rimW * 1.05) + "," + (neckY * 0.6) + " " + (cx - neckW) + "," + neckY
      + " Q" + (cx - neckW * 1.2) + "," + (hb * 0.85) + " " + (cx - neckW * 0.7) + "," + hb
      + " L" + (cx + neckW * 0.7) + "," + hb
      + " Q" + (cx + neckW * 1.2) + "," + (hb * 0.85) + " " + (cx + neckW) + "," + neckY
      + " Q" + (cx + rimW * 1.05) + "," + (neckY * 0.6) + " " + (cx + rimW) + "," + ht
      + " Z";
    const gRimX = cx + rimW * 0.78;
    const gRimY = ht;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs><clipPath id={clipId}><path d={hPath}/></clipPath></defs>
        <rect x={cx-rimW} y={hb-liqH} width={rimW*2} height={liqH} clipPath={clipUrl} fill={liquidColor} opacity="0.85"/>
        {vis.foam && <Foam fx={cx} fy={ht+s*0.05} fw={rimW*0.75}/>}
        {vis.crushed && <CrushedIce cx={cx} top={ht} bottom={hb} width={rimW*1.8}/>}
        {vis.layered && <rect x={cx-rimW} y={hb-liqH*0.4} width={rimW*2} height={liqH*0.28} clipPath={clipUrl} fill="rgba(200,80,20,0.3)" opacity="0.8"/>}
        {vis.salt && <RimCoating rimY={ht} rimX1={cx-rimW} rimX2={cx+rimW} type="salt"/>}
        {vis.sugar && <RimCoating rimY={ht} rimX1={cx-rimW} rimX2={cx+rimW} type="sugar"/>}
        {vis.ice  && <IceCubes x1={cx-s*0.18} y1={hb-s*0.22} x2={cx+s*0.06} y2={hb-s*0.28} x3={cx-s*0.04} y3={hb-s*0.19}/>}
        <path d={hPath} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-rimW} y1={ht} x2={cx+rimW} y2={ht} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={cx-rimW+3} y1={ht+3} x2={cx-neckW+2} y2={neckY-4} stroke="rgba(255,255,255,0.2)" strokeWidth="0.8"/>
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  // B: Shot glass — short, wide, slight taper
  if (vis.glass === "shot") {
    const gx=s*0.28, gy=s*0.30, gw=s*0.44, gh=s*0.58;
    const liqH = gh*0.72;
    const clipId = "clip-"+name.replace(/[^a-zA-Z0-9]/g,"")+"-"+size;
    const clipUrl = "url(#"+clipId+")";
    const shotPath = "M"+(gx+4)+","+gy+" L"+(gx+gw-4)+","+gy+" L"+(gx+gw)+","+(gy+gh)+" L"+gx+","+(gy+gh)+" Z";
    const gRimX = gx+gw*0.82, gRimY = gy;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs><clipPath id={clipId}><path d={shotPath}/></clipPath></defs>
        <rect x={gx} y={gy+gh-liqH} width={gw} height={liqH} clipPath={clipUrl} fill={liquidColor} opacity="0.88"/>
        {vis.crushed && <CrushedIce cx={cx} top={gy} bottom={gy+gh} width={gw}/>}
        {vis.salt && <RimCoating rimY={gy} rimX1={gx+4} rimX2={gx+gw-4} type="salt"/>}
        {vis.sugar && <RimCoating rimY={gy} rimX1={gx+4} rimX2={gx+gw-4} type="sugar"/>}
        <path d={shotPath} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={gx} y1={gy} x2={gx+gw} y2={gy} stroke={glassStroke} strokeWidth="1.5"/>
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  // B: Snifter / brandy — wide round bowl tapering to narrow rim, short stem
  if (vis.glass === "snifter") {
    const bowlW=s*0.36, rimW=s*0.18, bowlTop=s*0.10, bowlBot=s*0.68, stemBot=s*0.88, baseW=s*0.26;
    const liqH=(bowlBot-bowlTop)*0.68;
    const clipId="clip-"+name.replace(/[^a-zA-Z0-9]/g,"")+"-"+size;
    const clipUrl="url(#"+clipId+")";
    // Wide curve in, then narrow at top
    const snPath = "M"+(cx-rimW)+","+bowlTop
      +" Q"+(cx-bowlW*1.15)+","+(bowlTop+(bowlBot-bowlTop)*0.4)+" "+(cx-s*0.07)+","+bowlBot
      +" L"+(cx+s*0.07)+","+bowlBot
      +" Q"+(cx+bowlW*1.15)+","+(bowlTop+(bowlBot-bowlTop)*0.4)+" "+(cx+rimW)+","+bowlTop+" Z";
    const gRimX=cx+rimW*0.8, gRimY=bowlTop;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs><clipPath id={clipId}><path d={snPath}/></clipPath></defs>
        <rect x={cx-bowlW} y={bowlBot-liqH} width={bowlW*2} height={liqH} clipPath={clipUrl} fill={liquidColor} opacity="0.85"/>
        {vis.ice && <IceCubes x1={cx-s*0.18} y1={bowlBot-liqH+4} x2={cx+s*0.05} y2={bowlBot-liqH+8} x3={cx-s*0.04} y3={bowlBot-liqH+3}/>}
        {vis.layered && <rect x={cx-bowlW} y={bowlBot-liqH*0.38} width={bowlW*2} height={liqH*0.28} clipPath={clipUrl} fill="rgba(80,20,10,0.35)" opacity="0.8"/>}
        <path d={snPath} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-rimW} y1={bowlTop} x2={cx+rimW} y2={bowlTop} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={cx-s*0.07} y1={bowlBot} x2={cx+s*0.07} y2={bowlBot} stroke={glassStroke} strokeWidth="1"/>
        <line x1={cx} y1={bowlBot} x2={cx} y2={stemBot} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-baseW/2} y1={stemBot} x2={cx+baseW/2} y2={stemBot} stroke={glassStroke} strokeWidth="1.5"/>
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  // B: Nick & Nora — elegant egg-shaped bowl on a long stem, narrower than coupe
  if (vis.glass === "nick") {
    const bowlW=s*0.28, bowlTop=s*0.12, bowlBot=s*0.56, stemBot=s*0.88, baseW=s*0.24;
    const liqH=(bowlBot-bowlTop)*0.78;
    const clipId="clip-"+name.replace(/[^a-zA-Z0-9]/g,"")+"-"+size;
    const clipUrl="url(#"+clipId+")";
    const nPath="M"+(cx-bowlW)+","+bowlTop
      +" Q"+(cx-bowlW*1.15)+","+(bowlTop+(bowlBot-bowlTop)*0.55)+" "+(cx-s*0.06)+","+bowlBot
      +" L"+(cx+s*0.06)+","+bowlBot
      +" Q"+(cx+bowlW*1.15)+","+(bowlTop+(bowlBot-bowlTop)*0.55)+" "+(cx+bowlW)+","+bowlTop+" Z";
    const gRimX=cx+bowlW*0.85, gRimY=bowlTop;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs><clipPath id={clipId}><path d={nPath}/></clipPath></defs>
        <rect x={cx-bowlW} y={bowlBot-liqH} width={bowlW*2} height={liqH} clipPath={clipUrl} fill={liquidColor} opacity="0.88"/>
        {vis.foam && <Foam fx={cx} fy={bowlTop+s*0.08} fw={bowlW*0.75}/>}
        {vis.layered && <rect x={cx-bowlW} y={bowlBot-liqH*0.35} width={bowlW*2} height={liqH*0.25} clipPath={clipUrl} fill="rgba(200,80,20,0.3)" opacity="0.8"/>}
        <path d={nPath} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-bowlW} y1={bowlTop} x2={cx+bowlW} y2={bowlTop} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-s*0.06} y1={bowlBot} x2={cx+s*0.06} y2={bowlBot} stroke={glassStroke} strokeWidth="1"/>
        <line x1={cx} y1={bowlBot} x2={cx} y2={stemBot} stroke={glassStroke} strokeWidth="1.2"/>
        <line x1={cx-baseW/2} y1={stemBot} x2={cx+baseW/2} y2={stemBot} stroke={glassStroke} strokeWidth="1.5"/>
        <line x1={cx-bowlW+2} y1={bowlTop+3} x2={cx-bowlW*0.5} y2={bowlBot*0.58} stroke="rgba(255,255,255,0.22)" strokeWidth="0.7"/>
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  // B: Tiki mug — barrel shape with slight texture lines, no stem
  if (vis.glass === "tiki") {
    const gx=s*0.18, gy=s*0.08, gw=s*0.64, gh=s*0.80;
    const liqH=gh*0.80;
    const clipId="clip-"+name.replace(/[^a-zA-Z0-9]/g,"")+"-"+size;
    const clipUrl="url(#"+clipId+")";
    // Barrel: slight bulge in middle
    const tikPath="M"+(gx+6)+","+gy
      +" Q"+(gx-s*0.04)+","+(gy+gh*0.5)+" "+(gx+4)+","+(gy+gh)
      +" L"+(gx+gw-4)+","+(gy+gh)
      +" Q"+(gx+gw+s*0.04)+","+(gy+gh*0.5)+" "+(gx+gw-6)+","+gy+" Z";
    const gRimX=gx+gw*0.82, gRimY=gy;
    return (
      <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
        <defs><clipPath id={clipId}><path d={tikPath}/></clipPath></defs>
        {vis.sunrise ? (
          <g clipPath={clipUrl}>
            <rect x={gx} y={gy} width={gw} height={gh} fill="#f8a820"/>
            <rect x={gx} y={gy+gh*0.65} width={gw} height={gh*0.35} fill="#e03020" opacity="0.7"/>
            <rect x={gx} y={gy+gh*0.5} width={gw} height={gh*0.2} fill="#f06020" opacity="0.5"/>
          </g>
        ) : (
          <rect x={gx} y={gy+gh-liqH} width={gw} height={liqH} clipPath={clipUrl} fill={liquidColor} opacity="0.85"/>
        )}
        {vis.layered && <rect x={gx} y={gy+gh-liqH*0.4} width={gw} height={liqH*0.3} clipPath={clipUrl} fill="rgba(240,80,20,0.3)" opacity="0.8"/>}
        {vis.crushed && <CrushedIce cx={cx} top={gy} bottom={gy+gh} width={gw}/>}
        {vis.foam && <Foam fx={cx} fy={gy+gh-liqH+s*0.04} fw={gw*0.42}/>}
        {vis.bubbles && <Bubbles bx={gx+gw*0.65} by={gy+gh-liqH+s*0.14}/>}
        {/* Barrel ring lines */}
        <path d={tikPath} fill={glassFill} stroke={glassStroke} strokeWidth="1.3"/>
        {[0.25,0.5,0.75].map((f,i) => (
          <line key={i} x1={gx+3} y1={gy+gh*f} x2={gx+gw-3} y2={gy+gh*f} stroke={glassStroke} strokeWidth="0.5" opacity="0.4"/>
        ))}
        <line x1={gx+6} y1={gy} x2={gx+gw-6} y2={gy} stroke={glassStroke} strokeWidth="1.5"/>
        <Garnish type={vis.garnish} rimX={gRimX} rimY={gRimY}/>
      </svg>
    );
  }

  // fallback rocks
  const gx=s*0.14, gy=s*0.22, gw=s*0.72, gh=s*0.65, liqH=gh*0.7;
  const clipId  = "clip-fb-" + name.replace(/[^a-zA-Z0-9]/g,"") + "-" + size;
  const clipUrl = "url(#" + clipId + ")";
  const fbPath  = "M" + (gx+4) + "," + gy + " L" + (gx+gw-4) + "," + gy + " L" + (gx+gw) + "," + (gy+gh) + " L" + gx + "," + (gy+gh) + " Z";
  return (
    <svg width={s} height={s} viewBox={vb} style={{display:"block",overflow:"visible"}}>
      <defs><clipPath id={clipId}><path d={fbPath}/></clipPath></defs>
      <rect x={gx} y={gy+gh-liqH} width={gw} height={liqH} clipPath={clipUrl} fill={liquidColor} opacity="0.85"/>
      <path d={fbPath} fill={glassFill} stroke={glassStroke} strokeWidth="1.2"/>
      <line x1={gx} y1={gy} x2={gx+gw} y2={gy} stroke={glassStroke} strokeWidth="1.5"/>
      <Garnish type={vis.garnish} rimX={gx+gw*0.78} rimY={gy}/>
    </svg>
  );
}

// ── Inline amount editor used in detail view ──
function AmountEditor({ oz, displayAmt, unit, servings, onChange, t = {} }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");

  const displayed = oz !== null
    ? formatAmt(oz, unit, servings)
    : (displayAmt || "—");

  const startEdit = () => {
    setRaw(oz !== null ? String(oz) : (displayAmt || ""));
    setEditing(true);
  };

  const commit = () => {
    const n = parseFloat(raw.replace(/[^\d.\/]/g, ""));
    if (!isNaN(n) && n > 0) onChange({ oz: n, displayAmt: null });
    else if (raw.trim()) onChange({ oz: null, displayAmt: raw.trim() });
    setEditing(false);
  };

  if (editing) return (
    <input autoFocus value={raw}
      onChange={e => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      style={{
        width:70, padding:"2px 6px", borderRadius:6,
        border:"1px solid "+t.accent, background:t.accentBg,
        color:t.accent, fontSize:13, fontFamily:"inherit", outline:"none", textAlign:"center",
      }}
    />
  );

  return (
    <span onClick={startEdit} title="Click to edit" style={{
      fontSize:13, color:t.accent, fontStyle:"italic", fontWeight:"bold",
      background:t.hlBg, padding:"3px 9px", borderRadius:6,
      cursor:"pointer", display:"flex", alignItems:"center", gap:5,
      border:"1px solid "+t.accentBorder, transition:"background 0.15s",
    }}
    onMouseEnter={e => e.currentTarget.style.background=t.accentBg}
    onMouseLeave={e => e.currentTarget.style.background=t.hlBg}
    >
      {displayed}
      <span style={{fontSize:9, opacity:0.6}}>✏</span>
    </span>
  );
}

// ── Cluster Map ──────────────────────────────────────────────────────────────
function ClusterMap({ recipes, lightMode, onSelectRecipe, t }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const nodesRef = useRef([]);
  const linksRef = useRef([]);
  const animRef = useRef(null);
  const tooltipNodeRef = useRef(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [filterTag, setFilterTag] = useState(null);
  const [ready, setReady] = useState(false);
  const [mapScale, setMapScale] = useState(1);

  const ERA_TAGS = new Set(["Classic", "Modern Classic"]);
  const primaryTag = (tags) => tags.find(t => !ERA_TAGS.has(t)) || tags[0] || "Other";
  const TAG_COLORS = {
    "Classic":"#f5c842","Modern Classic":"#f5a020","Sour":"#a8e06e",
    "Highball":"#60c8f0","Martini":"#c0a8f0","Tiki":"#f08050",
    "Spirit Forward":"#7060c0","Bitter":"#d05080","Sparkling":"#a0e8d0","Spritz":"#f0a0c0",
    "Hot":"#f06040","Frozen":"#80d0f0",
    "Creamy":"#f0e0b0","Shot":"#d0d0d0","Low-ABV":"#b0e8b0","Non-Alcoholic":"#a0f0c0",
  };
  const DEFAULT_COLOR = "#888877";

  // Hex to rgb helper
  function hexRgb(hex, alpha=1) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Build graph data
  const graphData = useMemo(() => {
    const pool = filterTag ? recipes.filter(r=>(r.tags||[]).includes(filterTag)) : recipes;

    const nodes = pool.map(r => ({
      id: r.id, name: r.name, tags: r.tags||[],
      color: TAG_COLORS[primaryTag(r.tags||[])] || DEFAULT_COLOR,
      ings: new Set(r.ingredients.map(i=>i.name)),
      recipe: r,
      x: 0, y: 0, vx: 0, vy: 0,
      r: 7,
    }));

    // Build edges: Jaccard similarity, keep only top edges per node
    const edges = [];
    const nodeMap = {};
    nodes.forEach(n => { nodeMap[n.id] = n; });

    const candidateEdges = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let shared = 0;
        a.ings.forEach(ing => { if (b.ings.has(ing)) shared++; });
        if (shared < 2) continue;
        const union = new Set([...a.ings,...b.ings]).size;
        const jaccard = shared / union;
        candidateEdges.push({ source: a, target: b, shared, jaccard });
      }
    }
    candidateEdges.sort((a,b) => b.jaccard - a.jaccard);

    // Each node gets at most 6 strongest connections
    const degree = {};
    const kept = [];
    candidateEdges.forEach(e => {
      const si = e.source.id, ti = e.target.id;
      degree[si] = (degree[si]||0);
      degree[ti] = (degree[ti]||0);
      if (degree[si] < 6 && degree[ti] < 6) {
        kept.push(e);
        degree[si]++; degree[ti]++;
      }
    });

    return { nodes, edges: kept };
  }, [recipes, filterTag]);

  // Layout: deterministic tag-cluster positioning, no simulation needed
  useEffect(() => {
    let cancelled = false;

    const runLayout = (W, H) => {
      const nodes = graphData.nodes.map(n => ({ ...n, vx:0, vy:0 }));
      const nodeById = {};
      nodes.forEach(n => { nodeById[n.id] = n; });

      const edges = graphData.edges.map(e => ({
        source: nodeById[e.source.id],
        target: nodeById[e.target.id],
        jaccard: e.jaccard,
        shared: e.shared,
      }));

      // Place tag group centers — use primaryTag to skip era tags
      const tagList = [...new Set(nodes.flatMap(n => primaryTag(n.tags)).filter(Boolean))];
      const tagCenters = {};
      tagList.forEach((tag, i) => {
        const angle = (i / tagList.length) * Math.PI * 2 - Math.PI / 2;
        const radius = Math.min(W, H) * 0.32;
        tagCenters[tag] = { x: W/2 + radius * Math.cos(angle), y: H/2 + radius * Math.sin(angle) };
      });

      // Place nodes: cluster around their primary tag center using golden-angle spiral per group
      const tagCounts = {};
      const tagIdx = {};
      nodes.forEach(n => {
        const tag = primaryTag(n.tags);
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
      nodes.forEach(n => {
        const tag = primaryTag(n.tags);
        const center = tagCenters[tag] || { x: W/2, y: H/2 };
        const idx = tagIdx[tag] = (tagIdx[tag] || 0);
        tagIdx[tag]++;
        const count = tagCounts[tag];
        const angle = idx * 2.399963;
        const r = Math.sqrt(idx / Math.max(count, 1)) * Math.min(W, H) * 0.13 + 18;
        n.x = Math.max(20, Math.min(W-20, center.x + r * Math.cos(angle)));
        n.y = Math.max(20, Math.min(H-20, center.y + r * Math.sin(angle)));
      });

      nodesRef.current = nodes;
      linksRef.current = edges;
      if (!cancelled) setReady(true);
    };

    const tryRun = () => {
      if (cancelled) return;
      const el = containerRef.current;
      if (!el) { requestAnimationFrame(tryRun); return; }
      const W = el.clientWidth, H = el.clientHeight;
      if (W > 50 && H > 50) { runLayout(W, H); }
      else { requestAnimationFrame(tryRun); }
    };
    requestAnimationFrame(tryRun);
    return () => { cancelled = true; };
  }, [graphData]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !ready) return;

    // Size canvas FIRST before anything reads dimensions
    const dpr = window.devicePixelRatio || 1;
    const CW = Math.max(container.clientWidth, 200);
    const CH = Math.max(container.clientHeight, 200);
    canvas.width = CW * dpr;
    canvas.height = CH * dpr;
    canvas.style.width = CW + "px";
    canvas.style.height = CH + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const W = CW, H = CH;

    const nodes = nodesRef.current;
    const edges = linksRef.current;

    // Clamp any NaN positions that might have slipped through
    nodes.forEach(n => {
      if (!isFinite(n.x)) n.x = W / 2;
      if (!isFinite(n.y)) n.y = H / 2;
    });

    const drawRef = { fn: null };

    function draw(hoverId = null) {
      const { x: tx, y: ty, scale: ts } = transformRef.current;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(ts, ts);

      // Draw edges
      edges.forEach(e => {
        const { source: s, target: tgt, jaccard } = e;
        const isConnected = hoverId && (s.id === hoverId || tgt.id === hoverId);
        const fade = hoverId && !isConnected;
        const op = fade ? 0.03 : (isConnected ? 0.85 : (0.06 + jaccard * 0.3));
        const lw = fade ? 0.3 : (isConnected ? 2 + jaccard*2 : 0.4 + jaccard * 1.8);
        const strokeColor = isConnected
          ? (nodes.find(n=>n.id===hoverId)?.color || "#ffd700")
          : (lightMode ? `rgba(100,70,20,${op})` : `rgba(255,210,100,${op})`);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lw / ts;
        ctx.stroke();
      });

      // Draw nodes
      nodes.forEach(n => {
        const isHover = n.id === hoverId;
        const isFaded = hoverId && !isHover;
        const radius = isHover ? 10 : 6;
        if (!isFinite(n.x) || !isFinite(n.y)) return;

        if (isHover || !isFaded) {
          const gradient = ctx.createRadialGradient(n.x, n.y, radius, n.x, n.y, radius * 2.8);
          gradient.addColorStop(0, hexRgb(n.color, isHover ? 0.4 : 0.15));
          gradient.addColorStop(1, hexRgb(n.color, 0));
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius * 2.8, 0, Math.PI*2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI*2);
        ctx.fillStyle = isFaded ? hexRgb(n.color, 0.2) : n.color;
        ctx.fill();
        ctx.strokeStyle = lightMode ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1.5 / ts;
        ctx.stroke();

        const labelAlpha = isFaded ? 0.15 : (isHover ? 1 : 0.7);
        const fontSize = Math.max(7, Math.min(13, (isHover ? 11 : 8) / ts));
        ctx.font = `${fontSize}px "DM Sans", system-ui, sans-serif`;
        ctx.fillStyle = lightMode ? `rgba(50,30,5,${labelAlpha})` : `rgba(220,190,100,${labelAlpha})`;
        ctx.textAlign = "center";
        const label = isHover ? n.name : (n.name.length > 16 ? n.name.slice(0,14)+"…" : n.name);
        ctx.fillText(label, n.x, n.y + radius + (isHover ? 16 : 13));
      });

      // Tag cluster labels
      if (!hoverId) {
        const tagCentroids = {};
        const tagCounts = {};
        nodes.forEach(n => {
          const tag = primaryTag(n.tags);
          if (!tag) return;
          if (!tagCentroids[tag]) { tagCentroids[tag] = {x:0,y:0}; tagCounts[tag] = 0; }
          tagCentroids[tag].x += n.x; tagCentroids[tag].y += n.y; tagCounts[tag]++;
        });
        Object.entries(tagCentroids).forEach(([tag, c]) => {
          const count = tagCounts[tag];
          if (count < 2) return;
          const cx = c.x/count, cy = c.y/count;
          const color = TAG_COLORS[tag] || DEFAULT_COLOR;
          const labelSize = Math.max(8, Math.min(14, 10 / ts));
          ctx.font = `700 ${labelSize}px "DM Sans", system-ui, sans-serif`;
          ctx.fillStyle = hexRgb(color, 0.5);
          ctx.textAlign = "center";
          ctx.fillText(tag.toUpperCase(), cx, cy - 28);
        });
      }

      ctx.restore();
    }

    drawRef.fn = draw;
    draw();

    // Convert client coords → logical canvas node coords (accounting for transform)
    const toNodeCoords = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const cssX = (clientX - rect.left) * (W / rect.width);
      const cssY = (clientY - rect.top) * (H / rect.height);
      const { x: tx, y: ty, scale: ts } = transformRef.current;
      return { mx: (cssX - tx) / ts, my: (cssY - ty) / ts };
    };

    const getNodeAt = (mx, my) => {
      const ts = transformRef.current.scale;
      const hitRadius = Math.max(14, 18 / ts);
      return nodesRef.current.find(n => {
        const dx = n.x - mx, dy = n.y - my;
        return Math.sqrt(dx*dx+dy*dy) < hitRadius;
      });
    };

    // Wheel zoom
    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cssX = (e.clientX - rect.left) * (W / rect.width);
      const cssY = (e.clientY - rect.top) * (H / rect.height);
      const { x: tx, y: ty, scale: ts } = transformRef.current;
      const delta = e.deltaY < 0 ? 1.12 : 0.89;
      const newScale = Math.max(0.3, Math.min(8, ts * delta));
      // Zoom toward mouse position
      const newX = cssX - (cssX - tx) * (newScale / ts);
      const newY = cssY - (cssY - ty) * (newScale / ts);
      transformRef.current = { x: newX, y: newY, scale: newScale };
      setMapScale(newScale);
      tooltipNodeRef.current = null;
      setTooltip(null);
      draw(null);
    };

    // Pan with mousedown/mousemove/mouseup
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      const { mx, my } = toNodeCoords(e.clientX, e.clientY);
      const node = getNodeAt(mx, my);
      if (node) return; // don't pan when clicking a node
      dragRef.current = { startX: e.clientX, startY: e.clientY, tx: transformRef.current.x, ty: transformRef.current.y };
      canvas.style.cursor = "grabbing";
    };

    const onMouseMove = (e) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        transformRef.current = { ...transformRef.current, x: dragRef.current.tx + dx * (W / canvas.getBoundingClientRect().width), y: dragRef.current.ty + dy * (H / canvas.getBoundingClientRect().height) };
        tooltipNodeRef.current = null;
        setTooltip(null);
        draw(null);
        return;
      }
      const { mx, my } = toNodeCoords(e.clientX, e.clientY);
      const node = getNodeAt(mx, my);
      canvas.style.cursor = node ? "pointer" : "grab";
      if (node !== tooltipNodeRef.current) {
        tooltipNodeRef.current = node || null;
        draw(node ? node.id : null);
        if (node) {
          const connected = linksRef.current.filter(l => l.source.id === node.id || l.target.id === node.id).length;
          const ingList = [...node.ings].slice(0, 5).join(", ");
          setTooltip({ x: e.clientX, y: e.clientY, recipe: node.recipe, connections: connected, ingredients: ingList });
        } else {
          setTooltip(null);
        }
      } else if (node) {
        setTooltip(prev => prev ? {...prev, x: e.clientX, y: e.clientY} : prev);
      }
    };

    const onMouseUp = () => {
      dragRef.current = null;
      canvas.style.cursor = "grab";
    };

    const onClick = (e) => {
      if (dragRef.current) return;
      const { mx, my } = toNodeCoords(e.clientX, e.clientY);
      const node = getNodeAt(mx, my);
      if (node) onSelectRecipe(node.recipe);
    };

    canvas.style.cursor = "grab";
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mouseleave", () => {
      dragRef.current = null;
      tooltipNodeRef.current = null;
      setTooltip(null);
      draw();
    });

    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("click", onClick);
    };
  }, [ready, lightMode]);

  const uniqueTags = useMemo(() => {
    const s = new Set(); recipes.forEach(r=>(r.tags||[]).forEach(t=>s.add(t))); return [...s].sort();
  }, [recipes]);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 130px)", minHeight:500 }}>
      {/* Tag filter chips */}
      <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center", marginBottom:8, padding:"0 2px" }}>
        <span style={{ fontSize:9, letterSpacing:2, textTransform:"uppercase", color:t.textSecond, marginRight:4 }}>Filter</span>
        <button onClick={()=>{ setFilterTag(null); transformRef.current={x:0,y:0,scale:1}; setMapScale(1); }} style={{
          padding:"3px 10px", borderRadius:12, fontSize:10, cursor:"pointer",
          border:`1px solid ${!filterTag ? t.accent : t.btnBorder}`,
          background: !filterTag ? t.accentBg : "transparent",
          color: !filterTag ? t.accent : t.textSecond, fontFamily:"inherit",
        }}>All</button>
        {Object.entries(TAG_COLORS).filter(([tag])=>uniqueTags.includes(tag)).map(([tag,color])=>(
          <button key={tag} onClick={()=>{ setFilterTag(filterTag===tag?null:tag); transformRef.current={x:0,y:0,scale:1}; setMapScale(1); }} style={{
            padding:"3px 10px", borderRadius:12, fontSize:10, cursor:"pointer",
            border:`1px solid ${filterTag===tag ? color : t.btnBorder}`,
            background: filterTag===tag ? color+"22" : "transparent",
            color: filterTag===tag ? color : t.textSecond, fontFamily:"inherit",
          }}>{tag}</button>
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <div style={{ fontSize:9, color:t.textMuted, letterSpacing:0.5 }}>
          Nodes by tag · edges = shared ingredients · scroll to zoom · drag to pan · click to open
        </div>
        {mapScale !== 1 && (
          <button onClick={() => { transformRef.current = {x:0,y:0,scale:1}; setMapScale(1); }} style={{
            fontSize:9, padding:"3px 10px", borderRadius:8, border:"1px solid "+t.btnBorder,
            background:"transparent", color:t.textSecond, cursor:"pointer", fontFamily:"inherit", letterSpacing:1,
          }}>RESET VIEW</button>
        )}
      </div>

      {/* Canvas container */}
      <div ref={containerRef} style={{ flex:1, position:"relative", borderRadius:16, overflow:"hidden", border:`1px solid ${t.cardBorder}`, background: lightMode ? "#f5f0e8" : "#0a0e1c" }}>
        {!ready && (
          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:8 }}>
            <div style={{ fontSize:12, color:t.textSecond, letterSpacing:2 }}>COMPUTING CLUSTERS…</div>
            <div style={{ fontSize:10, color:t.textMuted }}>running {recipes.length} × {recipes.length} similarity matrix</div>
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: ready ? "block" : "none", width:"100%", height:"100%" }} />

        {/* Tooltip */}
        {tooltip && (
          <div style={{
            position:"fixed", left: tooltip.x+16, top: tooltip.y-12, pointerEvents:"none", zIndex:9999,
            background: lightMode ? "rgba(255,252,244,0.97)" : "rgba(18,22,40,0.97)",
            border:`1px solid ${t.cardBorder}`, borderRadius:10, padding:"10px 14px",
            maxWidth:220, boxShadow:"0 8px 32px rgba(0,0,0,0.3)",
          }}>
            <div style={{ fontSize:13, fontWeight:600, color:t.textPrimary, fontFamily:"'DM Serif Display',serif", marginBottom:4 }}>{tooltip.recipe.name}</div>
            <div style={{ fontSize:10, color:t.textSecond, marginBottom:5 }}>{(tooltip.recipe.tags||[]).join(" · ")}</div>
            <div style={{ fontSize:10, color:t.accent }}>{tooltip.connections} connections</div>
            <div style={{ fontSize:10, color:t.textMuted, marginTop:4, lineHeight:1.6 }}>{tooltip.ingredients}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function IngAmtInput({ ingItem, onCommit, t }) {
  const [draft, setDraft] = useState(null);
  const displayed = ingItem.oz !== null ? String(ingItem.oz) : (ingItem.displayAmt || "");
  const value = draft !== null ? draft : displayed;
  return (
    <input
      value={value}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { onCommit(draft); setDraft(null); } }}
      onKeyDown={e => { if (e.key === "Enter" || e.key === "Tab") { e.target.blur(); } if (e.key === "Escape") { setDraft(null); } }}
      placeholder="amt"
      style={{
        width:70, padding:"3px 7px", borderRadius:6, border:"1px solid "+t.inputBorder,
        background:t.sectionBg, color:t.accent, fontSize:12, fontFamily:"inherit", outline:"none", textAlign:"center",
      }}
    />
  );
}

export default function CocktailGuide() {
  const {
    recipes, setRecipes,
    allMixers, setAllMixers,
    mixerCategories, setMixerCategories,
    selectedMixers, setSelectedMixers,
    lightMode, setLightMode,
    filterMode, setFilterMode,
    sortOrder, setSortOrder,
    createRecipe, updateRecipe, deleteRecipe: deleteRecipeDB,
    addMixer,
    resetAll,
    loading, error: dbError,
  } = useSupabase();

  // Globally deduplicated mixer categories — prevents duplicate React keys
  const dedupedMixerCategories = useMemo(() => {
    const seen = new Set();
    const result = {};
    for (const [cat, items] of Object.entries(mixerCategories)) {
      result[cat] = items.filter(m => {
        if (seen.has(m)) return false;
        seen.add(m);
        return true;
      });
    }
    return result;
  }, [mixerCategories]);

  const [zoom, setZoom] = useState(1.2);
  const cardGridRef = useRef(null);
  const [cardGridW, setCardGridW] = useState(0);
  const [allTags, setAllTags] = useState(ALL_TAGS);
  const [view, setView] = useState("browse");
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [showVerifiedOnly, setShowVerifiedOnly] = useState(false);
  const [showWantToTryOnly, setShowWantToTryOnly] = useState(false);
  const [barFilterActive, setBarFilterActive] = useState(true);
  const [search, setSearch] = useState("");
  const [ingFilter, setIngFilter] = useState(null);
  const [tagFilters, setTagFilters] = useState(new Set());
  const [editForm, setEditForm] = useState(null);
  const [newIngName, setNewIngName] = useState("");
  const [newIngAmt, setNewIngAmt] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [expandedCats, setExpandedCats] = useState(new Set(["Spirits","Juices & Purées","Carbonated"]));
  const [unit, setUnit] = useState("oz");
  const [servings, setServings] = useState(1);
  const [newIngPrompt, setNewIngPrompt] = useState(null);
  const [newIngPromptCat, setNewIngPromptCat] = useState("Garnishes & Other");
  const [importError, setImportError] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showShoppingList, setShowShoppingList] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [customVisuals, setCustomVisuals] = useState({});
  const [editVis, setEditVis] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [sessionMixers, setSessionMixers] = useState(new Set());

  // ── Theme ──
  const t = lightMode ? {
    bg:           "linear-gradient(135deg, #f5f0e8 0%, #ede4d4 40%, #e0d5c0 100%)",
    headerBg:     "rgba(255,255,255,0.92)",
    headerBorder: "rgba(120,80,30,0.25)",
    cardBg:       "#faf6f0",
    cardBorder:   "rgba(120,80,30,0.12)",
    panelBg:      "rgba(255,255,255,0.75)",
    panelBorder:  "rgba(120,80,30,0.2)",
    inputBg:      "rgba(255,255,255,0.9)",
    inputBorder:  "rgba(120,80,30,0.35)",
    inputColor:   "#2a1a05",
    selectBg:     "#f5ede0",
    textPrimary:  "#2a1a05",
    textSecond:   "#5a3a10",
    textMuted:    "#7a5828",
    accent:       "#8b4e00",
    accentBg:     "rgba(139,78,0,0.12)",
    accentBorder: "rgba(139,78,0,0.45)",
    btnBorder:    "rgba(120,80,30,0.35)",
    rowBg:        "rgba(139,78,0,0.07)",
    sectionBg:    "rgba(255,255,255,0.6)",
    dangerColor:  "#a82020",
    dangerBorder: "rgba(168,32,32,0.45)",
    variantColor: "#1055a0",
    variantBg:    "rgba(16,85,160,0.08)",
    variantBorder:"rgba(16,85,160,0.35)",
    overlayBg:    "rgba(0,0,0,0.35)",
    resetColor:   "rgba(160,40,40,0.8)",
    hlBg:         "rgba(139,78,0,0.1)",
    infoColor:    "#1055a0",
    infoMuted:    "#3a6080",
    disabledColor:"rgba(120,80,30,0.25)",
  } : {
    bg:           "linear-gradient(135deg, #1a0a2e 0%, #16213e 40%, #0f3460 100%)",
    headerBg:     "rgba(0,0,0,0.3)",
    headerBorder: "rgba(255,200,100,0.2)",
    cardBg:       "rgba(255,255,255,0.04)",
    cardBorder:   "rgba(255,200,100,0.2)",
    panelBg:      "rgba(255,255,255,0.04)",
    panelBorder:  "rgba(255,200,100,0.2)",
    inputBg:      "rgba(255,255,255,0.05)",
    inputBorder:  "rgba(255,200,100,0.3)",
    inputColor:   "#f0e6d3",
    selectBg:     "rgba(20,10,40,0.95)",
    textPrimary:  "#f0e6d3",
    textSecond:   "#c9a96e",
    textMuted:    "#a09080",
    accent:       "#ffd700",
    accentBg:     "rgba(255,215,0,0.15)",
    accentBorder: "rgba(255,200,100,0.4)",
    btnBorder:    "rgba(255,200,100,0.3)",
    rowBg:        "rgba(255,215,0,0.07)",
    sectionBg:    "rgba(0,0,0,0.25)",
    dangerColor:  "#ff8080",
    dangerBorder: "rgba(255,100,100,0.4)",
    variantColor: "#80d0ff",
    variantBg:    "rgba(100,200,255,0.07)",
    variantBorder:"rgba(100,200,255,0.25)",
    overlayBg:    "rgba(0,0,0,0.6)",
    resetColor:   "rgba(255,130,130,0.6)",
    hlBg:         "rgba(255,215,0,0.08)",
    infoColor:    "#80d0ff",
    infoMuted:    "#80b0d0",
    disabledColor:"rgba(255,200,100,0.2)",
  };
  const importRef = useRef(null);

  // Export full library as JSON file
  const handleExport = () => {
    const data = { recipes, allMixers, mixerCategories, exportedAt: new Date().toISOString() };
    const json = JSON.stringify(data, null, 2);
    const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(json);
    const a = document.createElement("a");
    a.href = dataUri;
    a.download = `cabinet-cocktails-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Import from JSON file
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.recipes)) throw new Error("Invalid file format");
        setRecipes(data.recipes);
        if (data.allMixers) setAllMixers(data.allMixers);
        if (data.mixerCategories) setMixerCategories(data.mixerCategories);
        setImportError(null);
        setView("browse");
      } catch(err) {
        setImportError("Couldn't read that file. Make sure it's a Cabinet export JSON.");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-imported
  };

  // Reset to factory defaults
  const handleReset = () => { setShowResetConfirm(true); };
  const confirmReset = async () => { await resetAll(); setShowResetConfirm(false); };

  const toggleMixer = (m) => setSelectedMixers(prev => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n; });
  const toggleCat = (cat) => setExpandedCats(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  // The active mixer set: sidebar session when sidebar open, otherwise My Bar (if filter active)
  const activeMixers = showSidebar ? sessionMixers : (barFilterActive ? selectedMixers : new Set());

  const filteredRecipes = useMemo(() => {
    return recipes.filter(r => {
      if (showFavOnly && !r.favorite) return false;
      if (showVerifiedOnly && !r.verified) return false;
      if (showWantToTryOnly && !r.wantToTry) return false;
      if (ingFilter && !r.ingredients.some(i => i.name === ingFilter)) return false;
      if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (tagFilters.size > 0 && !r.tags?.some(tag => tagFilters.has(tag))) return false;
      if (activeMixers.size === 0) return true;
      const names = r.ingredients.map(i => i.name);
      if (filterMode === "all") return [...activeMixers].every(m => names.includes(m));
      return true; // "any" mode: show all, faded if no match
    });
  }, [recipes, activeMixers, filterMode, showFavOnly, showVerifiedOnly, showWantToTryOnly, ingFilter, search, tagFilters, barFilterActive]);

  // Close tag dropdown on outside click
  useEffect(() => {
    if (!showTagDropdown) return;
    const handler = (e) => {
      if (!e.target.closest("[data-tag-dropdown]")) setShowTagDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTagDropdown]);

  // Track card grid width for chip fitting
  useEffect(() => {
    const el = cardGridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setCardGridW(entries[0].contentRect.width));
    ro.observe(el);
    setCardGridW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Persistence handled by useSupabase hook

  const toggleFavorite = (id) => {
    setRecipes(prev => prev.map(r => r.id === id ? {...r, favorite: !r.favorite} : r));
    if (activeRecipe?.id === id) setActiveRecipe(prev => ({...prev, favorite: !prev.favorite}));
  };
  const toggleVerified = (id) => {
    setRecipes(prev => prev.map(r => r.id === id ? {...r, verified: !r.verified} : r));
    if (activeRecipe?.id === id) setActiveRecipe(prev => ({...prev, verified: !prev.verified}));
  };
  const toggleWantToTry = (id) => {
    setRecipes(prev => prev.map(r => r.id === id ? {...r, wantToTry: !r.wantToTry} : r));
    if (activeRecipe?.id === id) setActiveRecipe(prev => ({...prev, wantToTry: !prev.wantToTry}));
  };

  const saveNotes = () => {
    setRecipes(prev => prev.map(r => r.id === activeRecipe.id ? {...r, notes: notesDraft} : r));
    setActiveRecipe(prev => ({...prev, notes: notesDraft}));
  };

  const updateIngredientAmt = (ingName, newOz, newDisplayAmt) => {
    const updater = r => ({
      ...r,
      ingredients: r.ingredients.map(i =>
        i.name === ingName ? {...i, oz: newOz, displayAmt: newDisplayAmt} : i
      )
    });
    setRecipes(prev => prev.map(r => r.id === activeRecipe.id ? updater(r) : r));
    setActiveRecipe(prev => updater(prev));
  };

  const openDetail = (r) => { setActiveRecipe(r); setNotesDraft(r.notes); setView("detail"); };
  const defaultVis = (glass, color) => {
    const gl = (glass||"").toLowerCase();
    return {
      glass: gl.includes("high")||gl.includes("collins") ? "highball" :
             gl.includes("mart") ? "martini" :
             gl.includes("flute") ? "flute" :
             gl.includes("wine") ? "wine" :
             gl.includes("coupe") ? "coupe" :
             gl.includes("mule")||gl.includes("mug") ? "mule" :
             gl.includes("hurr") ? "hurricane" :
             gl.includes("shot")||gl.includes("shooter") ? "shot" :
             gl.includes("snif")||gl.includes("brandy")||gl.includes("cognac") ? "snifter" :
             gl.includes("nick")||gl.includes("nora") ? "nick" :
             gl.includes("tiki") ? "tiki" :
             "rocks",
      liquid: color || "#a0c8f0",
      foam: false, garnish: null, ice: false, bubbles: false,
      crushed: false, layered: false, salt: false, sugar: false,
    };
  };
  const openEdit = (r) => {
    setEditForm({...r, ingredients: r.ingredients.map(i => ({...i}))});
    const existing = customVisuals[r.id] || DRINK_VISUALS[r.name] || defaultVis(r.glass, r.color);
    setEditVis({...existing});
    setView("edit");
  };

  const openCreate = () => {
    const form = { id: Date.now(), name: "", favorite: false, verified: false, notes: "", tags: ["Classic"],
      ingredients: [], instructions: "", garnish: "", glass: "Rocks", color: "#e8eaf6" };
    setEditForm(form);
    setEditVis(defaultVis("Rocks", "#e8eaf6"));
    setNewIngName(""); setNewIngAmt("");
    setView("create");
  };

  const openVariant = (r) => {
    const rootId = r.variantOf || r.id;
    const newId = Date.now();
    const form = { ...r, ingredients: r.ingredients.map(i => ({...i})),
      id: newId, name: r.name + " (Variant)", favorite: false, verified: false, notes: "",
      variantOf: rootId, variantName: "" };
    setEditForm(form);
    const existingVis = customVisuals[r.id] || DRINK_VISUALS[r.name] || defaultVis(r.glass, r.color);
    setEditVis({...existingVis});
    setNewIngName(""); setNewIngAmt("");
    setView("create");
  };

  const saveRecipe = async () => {
    if (!editForm.name.trim()) return;
    if (editVis) setCustomVisuals(prev => ({...prev, [editForm.id]: editVis}));
    const {_variantSearch, ...cleanForm} = editForm;
    if (view === "create") {
      await createRecipe(cleanForm);
      setRecipes(prev => [...prev, cleanForm]);
    } else {
      await updateRecipe(cleanForm);
      setRecipes(prev => prev.map(r => r.id === cleanForm.id ? cleanForm : r));
      setActiveRecipe(cleanForm);
    }
    setView(view === "create" ? "browse" : "detail");
  };

  const deleteRecipe = async (id) => { await deleteRecipeDB(id); setRecipes(prev => prev.filter(r => r.id !== id)); setView("browse"); };

  // Returns all recipes in the same variant family as r (excluding r itself)
  const getVariants = (r) => {
    const rootId = r.variantOf || r.id;
    return recipes.filter(x => x.id !== r.id && (x.id === rootId || x.variantOf === rootId));
  };

  const addIngredientToForm = () => {
    const trimmed = newIngName.trim();
    if (!trimmed) return;
    const parsedOz = parseOz(newIngAmt);
    const ingObj = { name: trimmed, oz: parsedOz, displayAmt: parsedOz === null ? newIngAmt.trim() || null : null };
    // Check if it already exists in the bar list (case-insensitive)
    const alreadyKnown = allMixers.some(m => m.toLowerCase() === trimmed.toLowerCase());
    if (!alreadyKnown) {
      // Stash the ingredient and prompt for category before adding
      setNewIngPrompt(ingObj);
      // Auto-pick a sensible default category based on name heuristics
      const lc = trimmed.toLowerCase();
      const autoCat =
        /whiskey|whisky|bourbon|scotch|vodka|gin|rum|tequila|mezcal|brandy|cognac|pisco|absinthe|schnapps/.test(lc) ? "Spirits" :
        /syrup|grenadine|agave|honey|orgeat/.test(lc) ? "Syrups" :
        /juice|purée|puree|espresso/.test(lc) ? "Juices & Purées" :
        /bitters/.test(lc) ? "Bitters" :
        /cream|milk|egg/.test(lc) ? "Dairy & Eggs" :
        /soda|tonic|ginger beer|ginger ale|prosecco|champagne|beer|cider|cola|lemonade|tea/.test(lc) ? "Carbonated" :
        /triple sec|campari|aperol|vermouth|liqueur|kahlua|kahlúa|amaretto|chartreuse|crème|creme|cynar|amaro|benedictine|galliano|schnapps/.test(lc) ? "Liqueurs" :
        "Garnishes & Other";
      setNewIngPromptCat(autoCat);
      return; // Don't add yet — wait for user to confirm category
    }
    // Already known — add immediately
    setEditForm(prev => ({ ...prev, ingredients: [...prev.ingredients, ingObj] }));
    setNewIngName(""); setNewIngAmt("");
  };

  const confirmNewIngredient = async () => {
    if (!newIngPrompt) return;
    // Add to recipe
    setEditForm(prev => ({ ...prev, ingredients: [...prev.ingredients, newIngPrompt] }));
    // Persist to Supabase + local state
    await addMixer(newIngPrompt.name, newIngPromptCat);
    // Auto-expand that category in sidebar
    setExpandedCats(prev => { const n = new Set(prev); n.add(newIngPromptCat); return n; });
    setNewIngPrompt(null);
    setNewIngName(""); setNewIngAmt("");
  };

  const dismissNewIngPrompt = () => {
    // Add to recipe but NOT to the bar list
    if (!newIngPrompt) return;
    setEditForm(prev => ({ ...prev, ingredients: [...prev.ingredients, newIngPrompt] }));
    setNewIngPrompt(null);
    setNewIngName(""); setNewIngAmt("");
  };

  const updateFormIngAmt = (idx, rawAmt) => {
    const parsedOz = parseOz(rawAmt);
    setEditForm(prev => ({
      ...prev,
      ingredients: prev.ingredients.map((ing, i) =>
        i === idx ? { ...ing, oz: parsedOz, displayAmt: parsedOz === null ? rawAmt.trim() || null : null } : ing
      )
    }));
  };

  const removeIngredientFromForm = (i) => setEditForm(prev => ({...prev, ingredients: prev.ingredients.filter((_, idx) => idx !== i)}));
  const moveIngredient = (i, dir) => setEditForm(prev => {
    const ings = [...prev.ingredients];
    const j = i + dir;
    if (j < 0 || j >= ings.length) return prev;
    [ings[i], ings[j]] = [ings[j], ings[i]];
    return {...prev, ingredients: ings};
  });
  const ingUsage = useMemo(() => {
    const map = {};
    recipes.forEach(r => r.ingredients.forEach(i => { map[i.name] = (map[i.name] || 0) + 1; }));
    return map;
  }, [recipes]);

  // Shopping list: missing ingredients across all want-to-try recipes
  const shoppingList = useMemo(() => {
    const wantRecipes = recipes.filter(r => r.wantToTry);
    if (wantRecipes.length === 0) return [];
    const missing = {}; // name → { recipes: Set, oz: number, unit: string }
    wantRecipes.forEach(r => {
      r.ingredients.forEach(i => {
        if (!selectedMixers.has(i.name)) {
          if (!missing[i.name]) missing[i.name] = { recipes: new Set() };
          missing[i.name].recipes.add(r.name);
        }
      });
    });
    return Object.entries(missing)
      .map(([name, { recipes: usedIn }]) => ({ name, recipes: [...usedIn] }))
      .sort((a, b) => b.recipes.length - a.recipes.length || a.name.localeCompare(b.name));
  }, [recipes, selectedMixers]);

  const matchScore = (r) => {
    if (activeMixers.size === 0) return 0;
    const total = r.ingredients.filter(i => i.oz !== null || i.displayAmt !== "garnish").length || r.ingredients.length;
    const have = r.ingredients.filter(i => activeMixers.has(i.name)).length;
    return total === 0 ? 0 : have / total;
  };

  const COLORS = ["#ffb3ba","#ffdfba","#ffffba","#baffc9","#bae1ff","#e8baff","#ffd6ff","#b5ead7","#c7ceea","#ffdac1","#d7ccc8","#a5d6a7"];

  // Unit toggle + servings controls (shown in detail view)
  const VolumeControls = () => (
    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:14,
      padding:"9px 14px",borderRadius:10,background:t.sectionBg,border:"1px solid rgba(255,200,100,0.15)"}}>
      {/* Unit toggle */}
      <div style={{display:"flex",borderRadius:8,overflow:"hidden",border:"1px solid "+t.inputBorder}}>
        {["oz","ml"].map(u => (
          <button key={u} onClick={() => setUnit(u)} style={{
            padding:"5px 14px", border:"none",
            background: unit===u ? t.accentBg : "transparent",
            color: unit===u ? t.accent : t.textSecond,
            cursor:"pointer", fontSize:12, fontFamily:"inherit", fontWeight: unit===u ? "bold" : "normal",
            letterSpacing:1,
          }}>{u.toUpperCase()}</button>
        ))}
      </div>
      {/* Servings */}
      <div style={{display:"flex",alignItems:"center",gap:7}}>
        <span style={{fontSize:10,color:t.textSecond,letterSpacing:2,textTransform:"uppercase"}}>Servings</span>
        <button onClick={() => setServings(s => Math.max(1, s-1))} style={{
          width:24,height:24,borderRadius:"50%",border:"1px solid "+t.inputBorder,
          background:t.inputBg,color:t.accent,cursor:"pointer",fontSize:16,fontFamily:"inherit",lineHeight:1,
        }}>−</button>
        <span style={{minWidth:24,textAlign:"center",fontSize:16,fontWeight:"bold",color:t.accent}}>{servings}</span>
        <button onClick={() => setServings(s => Math.min(50, s+1))} style={{
          width:24,height:24,borderRadius:"50%",border:"1px solid "+t.inputBorder,
          background:t.inputBg,color:t.accent,cursor:"pointer",fontSize:16,fontFamily:"inherit",lineHeight:1,
        }}>+</button>
        {servings > 1 && (
          <span style={{fontSize:10,color:t.textSecond,fontStyle:"italic"}}>
            · Batch for {servings} drinks
          </span>
        )}
      </div>
      {servings > 1 && (
        <button onClick={() => setServings(1)} style={{
          fontSize:10,color:t.dangerColor,background:"none",border:"none",cursor:"pointer",
          fontFamily:"inherit",marginLeft:"auto",
        }}>Reset ×</button>
      )}
    </div>
  );
  useEffect(() => {
    const id = "cabinet-fonts";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  const fontDisplay = "'DM Serif Display', Georgia, serif";
  const fontBody    = "'DM Sans', system-ui, sans-serif";

  if (loading) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0d1117",fontFamily:"'DM Sans', system-ui, sans-serif"}}>
      <div style={{textAlign:"center",color:"#c9a96e"}}>
        <div style={{fontSize:48,marginBottom:16}}>🍸</div>
        <div style={{fontSize:16,letterSpacing:2}}>LOADING THE CABINET…</div>
        {dbError && <div style={{fontSize:12,color:"#ff8080",marginTop:12}}>{dbError}</div>}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:t.bg,
      fontFamily:fontBody, color:t.textPrimary, display:"flex", flexDirection:"column",
      transition:"background 0.25s ease, color 0.25s ease" }}>

      {/* Header */}
      <header style={{ padding:"14px 24px 10px", borderBottom:"1px solid "+t.headerBorder,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        background:t.headerBg, backdropFilter:"blur(10px)", position:"sticky", top:0, zIndex:100 }}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:28}}>🍸</span>
          <div>
            <div style={{fontSize:19,fontWeight:"bold",color:t.accent,letterSpacing:2,fontFamily:fontDisplay}}>The Cabinet</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{fontSize:9,color:t.textSecond,letterSpacing:4,textTransform:"uppercase"}}>Cocktail Companion · {recipes.length} Recipes</div>
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          {[["browse","Recipes"],["mixers","My Bar"],["cluster","Map"]].map(([v,label]) => (
            <button key={v} onClick={() => setView(v)} style={{
              padding:"6px 13px", borderRadius:16, border:"1px solid",
              borderColor: view===v ? t.accent : t.btnBorder,
              background: view===v ? t.accentBg : "transparent",
              color: view===v ? t.accent : t.textSecond,
              cursor:"pointer", fontSize:11, letterSpacing:1, textTransform:"uppercase", fontFamily:"inherit",
            }}>{label}</button>
          ))}
          <button onClick={openCreate} style={{
            padding:"6px 13px", borderRadius:16, border:"1px solid "+t.accent,
            background:t.accentBg, color:t.accent,
            cursor:"pointer", fontSize:11, letterSpacing:1, fontFamily:"inherit",
          }}>+ New</button>
          {/* Divider */}
          <div style={{width:1,height:20,background:t.btnBorder,margin:"0 2px"}}/>
          {/* Zoom slider */}
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:10,color:t.textMuted,userSelect:"none"}}>🔍</span>
            <input type="range" min="0.7" max="1.4" step="0.05" value={zoom}
              onChange={e => setZoom(parseFloat(e.target.value))}
              title={"Zoom: " + Math.round(zoom*100) + "%"}
              style={{width:72, cursor:"pointer", accentColor:t.accent}}
            />
            <span style={{fontSize:9,color:t.textMuted,width:28,textAlign:"left",userSelect:"none"}}>{Math.round(zoom*100)}%</span>
          </div>
          {/* Divider */}
          <div style={{width:1,height:20,background:t.btnBorder,margin:"0 2px"}}/>
          <button onClick={handleExport} title="Download your library as a JSON file" style={{
            padding:"6px 11px", borderRadius:16, border:"1px solid "+t.inputBorder,
            background:"transparent", color:t.textSecond,
            cursor:"pointer", fontSize:11, fontFamily:"inherit",
          }}>⬇ Export</button>
          {/* Import */}
          <button onClick={() => importRef.current?.click()} title="Load a previously exported JSON file" style={{
            padding:"6px 11px", borderRadius:16, border:"1px solid "+t.inputBorder,
            background:"transparent", color:t.textSecond,
            cursor:"pointer", fontSize:11, fontFamily:"inherit",
          }}>⬆ Import</button>
          <input ref={importRef} type="file" accept=".json" onChange={handleImportFile}
            style={{display:"none"}} />
          {/* Light/Dark toggle */}
          <button onClick={() => setLightMode(!lightMode)} title={lightMode ? "Switch to dark mode" : "Switch to light mode"} style={{
            padding:"6px 10px", borderRadius:16, border:"1px solid "+t.btnBorder,
            background: lightMode ? t.accentBg : "transparent",
            color:t.textSecond, cursor:"pointer", fontSize:13, fontFamily:"inherit",
          }}>{lightMode ? "🌙" : "☀️"}</button>
          {/* Reset */}
          <button onClick={handleReset} title="Reset to factory defaults" style={{
            padding:"6px 8px", borderRadius:16, border:"1px solid rgba(255,100,100,0.25)",
            background:"transparent", color:t.resetColor,
            cursor:"pointer", fontSize:11, fontFamily:"inherit",
          }}>↺</button>
        </div>
      </header>

      {/* Zoom wrapper — CSS zoom affects layout unlike transform:scale */}
      <div style={{ flex:1, overflow:"auto" }}>
      <div style={{ zoom: zoom }}>
      {/* Import error banner */}
      {importError && (
        <div style={{
          background:"rgba(200,50,50,0.15)", borderBottom:"1px solid rgba(200,80,80,0.3)",
          padding:"8px 24px", display:"flex", justifyContent:"space-between", alignItems:"center",
          fontSize:12, color:t.dangerColor,
        }}>
          ⚠ {importError}
          <button onClick={() => setImportError(null)} style={{background:"none",border:"none",color:t.dangerColor,cursor:"pointer",fontSize:14}}>×</button>
        </div>
      )}

      <div style={{display:"flex",flex:1,minHeight:"calc(100vh - 69px)"}}>

        {/* Main — full width, no sidebar */}
        <main style={{flex:1, padding:18}}>

          {/* RECIPES */}
          {view === "browse" && (<>
            <div style={{display:"flex",gap:0,alignItems:"flex-start"}}>
            {/* ── Ingredient Sidebar ── */}
            {showSidebar && (
              <div style={{
                width:210, flexShrink:0, marginRight:14,
                background:t.cardBg, border:"1px solid "+t.cardBorder,
                borderRadius:12, padding:"12px 10px",
                alignSelf:"flex-start",
              }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <span style={{fontSize:10,letterSpacing:2,color:t.accent,textTransform:"uppercase",fontWeight:"bold"}}>Filter Ingredients</span>
                  <button onClick={() => setSessionMixers(new Set())} style={{
                    background:"none",border:"none",cursor:"pointer",color:t.textMuted,fontSize:10,fontFamily:"inherit",padding:0,
                  }}>Clear</button>
                </div>
                {sessionMixers.size > 0 && (
                  <div style={{marginBottom:8,padding:"5px 8px",borderRadius:8,background:t.accentBg,border:"1px solid "+t.accentBorder}}>
                    <span style={{fontSize:10,color:t.accent}}>{sessionMixers.size} selected — not saved to My Bar</span>
                  </div>
                )}
                {Object.entries(dedupedMixerCategories).map(([cat, items]) => (
                  <div key={cat} style={{marginBottom:12}}>
                    <div style={{fontSize:9,letterSpacing:2,color:t.textMuted,textTransform:"uppercase",marginBottom:5,paddingBottom:3,borderBottom:"1px solid "+t.panelBorder}}>{cat}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      {[...new Set(items)].sort((a,b)=>a.localeCompare(b)).map(m => {
                        const on = sessionMixers.has(m);
                        return (
                          <button key={m} onClick={() => setSessionMixers(prev => { const n = new Set(prev); n.has(m)?n.delete(m):n.add(m); return n; })} style={{
                            display:"flex",alignItems:"center",gap:6,
                            padding:"4px 8px",borderRadius:6,border:"1px solid",
                            borderColor: on ? t.accentBorder : "transparent",
                            background: on ? t.accentBg : "transparent",
                            color: on ? t.accent : t.textPrimary,
                            cursor:"pointer",fontSize:11,fontFamily:"inherit",textAlign:"left",
                            transition:"all 0.12s",
                          }}>
                            <span style={{fontSize:9,minWidth:10,color:on?t.accent:t.textMuted}}>{on?"✓":"·"}</span>
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{flex:1,minWidth:0}}>
            {/* Filter bar — two fixed rows */}
            <div style={{marginBottom:14}}>
              {/* Single filter row */}
              <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                {/* Sidebar toggle */}
                <button onClick={() => setShowSidebar(s => !s)} style={{
                  padding:"7px 11px", borderRadius:16, border:"1px solid",
                  borderColor: showSidebar ? t.accentBorder : t.btnBorder,
                  background: showSidebar ? t.accentBg : "transparent",
                  color: showSidebar ? t.accent : t.textSecond,
                  cursor:"pointer", fontSize:11, fontFamily:"inherit", letterSpacing:0.5,
                }} title="Filter by ingredients without saving to My Bar">🧪 Filter</button>
                <input placeholder="Search cocktails..." value={search} onChange={e => { setSearch(e.target.value); setIngFilter(null); }} style={{
                  padding:"7px 12px", borderRadius:16, border:"1px solid "+t.inputBorder,
                  background:t.inputBg, color:t.textPrimary, fontSize:12, fontFamily:"inherit", outline:"none", width:160,
                }}/>
                {/* Cocktail Type dropdown button */}
                <div data-tag-dropdown style={{position:"relative"}}>
                  <button onClick={() => setShowTagDropdown(p => !p)} style={{
                    padding:"4px 12px", borderRadius:14, border:"1px solid",
                    borderColor: tagFilters.size > 0 ? t.accent : t.btnBorder,
                    background: tagFilters.size > 0 ? t.accentBg : "transparent",
                    color: tagFilters.size > 0 ? t.accent : t.textSecond,
                    cursor:"pointer", fontSize:10, fontFamily:"inherit", whiteSpace:"nowrap",
                    display:"flex", alignItems:"center", gap:5,
                  }}>
                    <span>Cocktail Type{tagFilters.size > 0 ? ` (${tagFilters.size})` : ""}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {showTagDropdown ? <polyline points="18,15 12,9 6,15"/> : <polyline points="6,9 12,15 18,9"/>}
                    </svg>
                  </button>
                  {showTagDropdown && (
                    <div style={{
                      position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:200,
                      background: lightMode ? "#fffdf7" : "#1a1f35",
                      border:"1px solid "+t.cardBorder, borderRadius:12,
                      padding:"10px 8px", minWidth:200,
                      boxShadow:"0 8px 32px rgba(0,0,0,0.25)",
                      display:"flex", flexDirection:"column", gap:2,
                    }}>
                      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", padding:"2px 6px 8px", borderBottom:"1px solid "+t.cardBorder, marginBottom:4}}>
                        <span style={{fontSize:9, letterSpacing:2, color:t.textMuted, textTransform:"uppercase"}}>Cocktail Type</span>
                        {tagFilters.size > 0 && (
                          <button onClick={() => setTagFilters(new Set())} style={{fontSize:9, color:t.accent, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", padding:0}}>Clear</button>
                        )}
                      </div>
                      {[...allTags].sort((a,b) => a.localeCompare(b)).map(tag => {
                        const active = tagFilters.has(tag);
                        return (
                          <button key={tag} onClick={() => setTagFilters(prev => {
                            const next = new Set(prev); if (next.has(tag)) next.delete(tag); else next.add(tag); return next;
                          })} style={{
                            display:"flex", alignItems:"center", gap:8,
                            padding:"6px 8px", borderRadius:8, border:"none",
                            background: active ? t.accentBg : "transparent",
                            color: active ? t.accent : t.textSecond,
                            cursor:"pointer", fontSize:11, fontFamily:"inherit", textAlign:"left",
                            width:"100%",
                          }}>
                            <span style={{
                              width:8, height:8, borderRadius:"50%", flexShrink:0,
                              background: active ? t.accent : t.btnBorder,
                              border: active ? "none" : "1px solid "+t.btnBorder,
                            }}/>
                            {tag}
                            {active && <svg style={{marginLeft:"auto"}} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* Right: shopping list button */}
                {recipes.some(r => r.wantToTry) && (
                  <button onClick={() => setShowShoppingList(true)} title="Shopping list" style={{
                    marginLeft:"auto", height:26, borderRadius:10, border:"1px solid "+t.cardBorder,
                    background:"transparent", color:t.textSecond, cursor:"pointer",
                    display:"flex", alignItems:"center", gap:5, padding:"0 9px",
                    fontSize:11, fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                    {shoppingList.length > 0 ? `${shoppingList.length} to buy` : "all stocked"}
                  </button>
                )}
                {/* Bar items + match any/all + ingredient filter + sort + toggles + count */}
                <div style={{display:"flex",gap:4,alignItems:"center",marginLeft:4}}>
                  {selectedMixers.size > 0 && !showSidebar ? (
                    <div style={{display:"flex",alignItems:"center",gap:0,borderRadius:12,border:"1px solid",
                      borderColor: barFilterActive ? t.accentBorder : (lightMode?"rgba(0,0,0,0.2)":"rgba(255,255,255,0.2)"),
                      background: barFilterActive ? t.accentBg : "transparent",
                      overflow:"hidden",
                    }}>
                      <button onClick={() => setBarFilterActive(v => !v)} style={{
                        background:"none",border:"none",cursor:"pointer",
                        padding:"4px 10px",
                        fontSize:10, fontFamily:"inherit",
                        color: barFilterActive ? t.accent : (lightMode?"#666":"#aaa"),
                        fontWeight: barFilterActive ? "600" : "400",
                      }}>🍶 {selectedMixers.size} bar items</button>
                      <button onClick={() => { setSelectedMixers(new Set()); setBarFilterActive(true); }} style={{
                        background:"none",border:"none",borderLeft:"1px solid",
                        borderColor: barFilterActive ? t.accentBorder : (lightMode?"rgba(0,0,0,0.15)":"rgba(255,255,255,0.15)"),
                        color:t.dangerColor,cursor:"pointer",fontSize:12,padding:"4px 7px",lineHeight:1
                      }}>×</button>
                    </div>
                  ) : null}
                  {selectedMixers.size > 0 && !showSidebar && barFilterActive && (
                    <div style={{display:"flex",gap:4}}>
                      {["any","all"].map(m => (
                        <button key={m} onClick={() => setFilterMode(m)} style={{
                          padding:"5px 10px", borderRadius:12, border:"1px solid",
                          borderColor: filterMode===m ? t.accent : (lightMode ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.2)"),
                          background: filterMode===m ? t.accentBg : "transparent",
                          color: filterMode===m ? t.accent : (lightMode ? "#666" : "#aaa"),
                          cursor:"pointer", fontSize:10, fontFamily:"inherit",
                          fontWeight: filterMode===m ? "600" : "400",
                        }}>Match {m}</button>
                      ))}
                    </div>
                  )}
                  {ingFilter && (
                    <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:12,
                      background:lightMode?"rgba(80,120,220,0.1)":"rgba(100,140,255,0.15)",
                      border:"1px solid "+(lightMode?"rgba(80,120,220,0.35)":"rgba(100,140,255,0.4)")}}>
                      <span style={{fontSize:10,color:lightMode?"#3050c0":"#a0b8ff"}}>🧪 {ingFilter}</span>
                      <button onClick={() => setIngFilter(null)} style={{background:"none",border:"none",color:t.dangerColor,cursor:"pointer",fontSize:12,padding:0,lineHeight:1}}>×</button>
                    </div>
                  )}
                  <div style={{display:"flex",gap:4}}>
                    {[["match","Best match"],["az","A–Z"]].map(([val,label]) => (
                      <button key={val} onClick={() => setSortOrder(val)} style={{
                        padding:"5px 10px", borderRadius:12, border:"1px solid",
                        borderColor: sortOrder===val ? t.accent : (lightMode ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.2)"),
                        background: sortOrder===val ? t.accentBg : "transparent",
                        color: sortOrder===val ? t.accent : (lightMode ? "#666" : "#aaa"),
                        cursor:"pointer", fontSize:10, fontFamily:"inherit",
                        fontWeight: sortOrder===val ? "600" : "400",
                      }}>{label}</button>
                    ))}
                  </div>
                  <button onClick={() => setShowWantToTryOnly(v => !v)} title="Want to try" style={{
                    width:28, height:28, borderRadius:10, border:"1px solid",
                    borderColor: showWantToTryOnly ? t.textSecond : "transparent",
                    background: "transparent",
                    cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0,
                    opacity: showWantToTryOnly ? 1 : 0.35,
                  }}><svg width="14" height="14" viewBox="0 0 24 24" fill={showWantToTryOnly?t.textSecond:"none"} stroke={t.textSecond} strokeWidth="2" strokeLinejoin="round"><path d="M12 2 L13.8 9.2 L21 12 L13.8 14.8 L12 22 L10.2 14.8 L3 12 L10.2 9.2 Z"/></svg></button>
                  <button onClick={() => setShowVerifiedOnly(v => !v)} title="Verified only" style={{
                    width:28, height:28, borderRadius:10, border:"1px solid",
                    borderColor: showVerifiedOnly ? t.textSecond : "transparent",
                    background: "transparent",
                    cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0,
                    opacity: showVerifiedOnly ? 1 : 0.35,
                  }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.textSecond} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:showVerifiedOnly?1:1}}><polyline points="20,6 9,17 4,12"/></svg></button>
                  <button onClick={() => setShowFavOnly(!showFavOnly)} title="Favourites only" style={{
                    width:28, height:28, borderRadius:10, border:"1px solid",
                    borderColor: showFavOnly ? t.textSecond : "transparent",
                    background: "transparent",
                    cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0,
                    opacity: showFavOnly ? 1 : 0.35,
                  }}><svg width="15" height="15" viewBox="0 0 24 24" fill={showFavOnly?t.textSecond:"none"} stroke={t.textSecond} strokeWidth="2" strokeLinejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg></button>
                </div>
                <div style={{color:t.textSecond,fontSize:11,marginLeft:"auto",whiteSpace:"nowrap"}}>{(() => { if (activeMixers.size > 0 && filterMode === "any") { const matching = filteredRecipes.filter(r => r.ingredients.some(i => activeMixers.has(i.name))).length; return `${matching} match · ${filteredRecipes.length - matching} others`; } return filteredRecipes.length + " cocktails"; })()}</div>
              </div>
            </div>

            {filteredRecipes.length === 0 ? (
              <div style={{textAlign:"center",padding:"60px 20px",color:t.textSecond}}>
                <div style={{fontSize:48,marginBottom:12}}>🍹</div>
                <div style={{fontSize:16}}>No cocktails match your selection.</div>
              </div>
            ) : (
              <div ref={cardGridRef} style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
                {[...filteredRecipes].sort((a,b) => {
                    if (sortOrder === "az") return a.name.localeCompare(b.name);
                    const aHave = activeMixers.size === 0 ? 1 : a.ingredients.filter(i => activeMixers.has(i.name)).length;
                    const bHave = activeMixers.size === 0 ? 1 : b.ingredients.filter(i => activeMixers.has(i.name)).length;
                    if (filterMode === "any" && activeMixers.size > 0) {
                      if (aHave === 0 && bHave > 0) return 1;
                      if (bHave === 0 && aHave > 0) return -1;
                    }
                    return matchScore(b) - matchScore(a);
                  }).map(r => {
                  const score = matchScore(r);
                  const total = r.ingredients.length;
                  const have = activeMixers.size === 0 ? 0 : r.ingredients.filter(i => activeMixers.has(i.name)).length;
                  const noMatch = activeMixers.size > 0 && filterMode === "any" && have === 0;
                  return (
                    <div key={r.id} onClick={() => openDetail(r)} style={{
                      background:t.cardBg,
                      border:"1px solid "+t.cardBorder, borderRadius:12, padding:14, cursor:"pointer",
                      transition:"transform 0.2s, opacity 0.2s", boxShadow: lightMode ? "0 3px 15px rgba(0,0,0,0.1)" : "0 3px 15px rgba(0,0,0,0.3)",
                      display:"flex", gap:10, alignItems:"flex-start",
                      minHeight: 128,
                      opacity: noMatch ? 0.35 : 1,
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform="translateY(-2px)"}
                    onMouseLeave={e => e.currentTarget.style.transform="translateY(0)"}>
                      <div style={{flexShrink:0,marginTop:2}}>
                        <CocktailIllustration name={r.name} glass={r.glass} color={r.color} size={54} visOverride={customVisuals[r.id]||null} lightMode={lightMode}/>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:3}}>
                          <div style={{fontSize:14,fontWeight:"400",color:t.textPrimary,lineHeight:1.2,fontFamily:fontDisplay}}>{r.name}</div>
                          <div style={{display:"flex",gap:1,alignItems:"center",flexShrink:0}}>
                            <button onClick={e=>{e.stopPropagation();toggleWantToTry(r.id);}} title="Want to try" style={{background:"none",border:"none",cursor:"pointer",padding:"1px 2px",display:"flex",alignItems:"center",flexShrink:0}}><svg width="13" height="13" viewBox="0 0 24 24" fill={r.wantToTry?t.textSecond:"none"} stroke={t.textSecond} strokeWidth="2" strokeLinejoin="round" style={{opacity:r.wantToTry?1:0.3}}><path d="M12 2 L13.8 9.2 L21 12 L13.8 14.8 L12 22 L10.2 14.8 L3 12 L10.2 9.2 Z"/></svg></button>
                            <button onClick={e=>{e.stopPropagation();toggleVerified(r.id);}} title="Verified ingredients" style={{background:"none",border:"none",cursor:"pointer",padding:"1px 2px",display:"flex",alignItems:"center",flexShrink:0}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.textSecond} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:r.verified?1:0.3}}><polyline points="20,6 9,17 4,12"/></svg></button>
                            <button onClick={e=>{e.stopPropagation();toggleFavorite(r.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:"1px 2px",display:"flex",alignItems:"center",flexShrink:0}} title="Favourite"><svg width="14" height="14" viewBox="0 0 24 24" fill={r.favorite?t.textSecond:"none"} stroke={t.textSecond} strokeWidth="2" strokeLinejoin="round" style={{opacity:r.favorite?1:0.3}}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg></button>
                          </div>
                        </div>
                        <div style={{fontSize:10,color:t.textSecond,marginBottom:6,fontStyle:"italic",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                          {(() => {
                            const tags = r.tags || [];
                            const ERA = ["Classic","Modern Classic"];
                            const primary = tags.filter(t => !ERA.includes(t));
                            const era = tags.filter(t => ERA.includes(t));
                            return [...primary, ...era].join(" · ");
                          })()}
                        </div>
                        {(() => {
                          // Compute column width → chip area width (card padding 14×2, illustration 54, gap 10)
                          const cols = cardGridW > 0 ? Math.max(1, Math.floor((cardGridW + 12) / (220 + 12))) : 1;
                          const colW = cardGridW > 0 ? (cardGridW - (cols - 1) * 12) / cols : 220;
                          const chipAreaW = colW - 28 - 54 - 14; // right col width minus some padding
                          const names = r.ingredients.map(i => i.name);
                          const { visible, extra } = fitChips(names, chipAreaW, 3);
                          return (
                            <div style={{
                              display:"flex", flexWrap:"wrap", gap:3, alignContent:"flex-start",
                              height:66, overflow:"hidden",
                            }}>
                              {visible.map(name => {
                                const isFiltered = ingFilter === name;
                                const isInBar = activeMixers.has(name);
                                let borderColor;
                                if (isFiltered) borderColor = lightMode ? "rgba(80,120,220,0.4)" : "rgba(120,160,255,0.5)";
                                else if (isInBar) {
                                  const h = r.color.replace('#','');
                                  const rv = parseInt(h.slice(0,2),16), gv = parseInt(h.slice(2,4),16), bv = parseInt(h.slice(4,6),16);
                                  borderColor = `rgb(${Math.round(rv*0.55)},${Math.round(gv*0.55)},${Math.round(bv*0.55)})`;
                                } else borderColor = lightMode ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.2)";
                                return (
                                  <span key={name} onClick={e=>{e.stopPropagation();setIngFilter(f=>f===name?null:name);setView("browse");}} style={{
                                    padding:"2px 5px", borderRadius:6, fontSize:9, height:20,
                                    display:"inline-flex", alignItems:"center",
                                    background: isFiltered ? (lightMode?"rgba(80,120,220,0.1)":"rgba(120,160,255,0.2)") : isInBar ? r.color+"55" : "transparent",
                                    border:"1px solid " + borderColor,
                                    color: isFiltered ? (lightMode?"#3050c0":"#a0b8ff") : isInBar ? (lightMode ? "#2a1a05" : "#f0e6d3") : (lightMode?"#6a5040":"#a09080"),
                                    whiteSpace:"nowrap", cursor:"pointer",
                                  }}>{name}</span>
                                );
                              })}
                              {extra > 0 && (
                                <span title={r.ingredients.slice(visible.length).map(i=>i.name).join(", ")} style={{
                                  display:"inline-flex", alignItems:"center", height:20,
                                  padding:"2px 6px", borderRadius:6, fontSize:9,
                                  background: lightMode ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.09)",
                                  border:"1px solid "+t.btnBorder, color:t.textMuted,
                                  whiteSpace:"nowrap", cursor:"default",
                                }}>+{extra}</span>
                              )}
                            </div>
                          );
                        })()}
                        {r.notes && <div style={{marginTop:4,fontSize:9,color:t.textMuted,fontStyle:"italic"}}>📝 Has notes</div>}
                      </div>{/* end right col */}
                    </div>
                  );
                })}
              </div>
            )}
            </div>{/* end inner content */}
            </div>{/* end sidebar flex row */}
          </>)}

          {/* MY BAR */}
          {view === "mixers" && (
            <div style={{maxWidth:860,margin:"0 auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <div>
                  <h2 style={{margin:0,fontSize:18,color:t.accent,letterSpacing:1}}>My Bar</h2>
                  <div style={{fontSize:11,color:t.textSecond,marginTop:3}}>
                    Check off what you have — recipes will be filtered and scored on the Recipes tab.
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:11,color:t.accent}}>{selectedMixers.size} selected</span>
                  {selectedMixers.size > 0 && (
                    <button onClick={() => setSelectedMixers(new Set())} style={{
                      padding:"5px 12px",borderRadius:10,border:"1px solid "+t.dangerBorder,
                      background:"rgba(200,50,50,0.1)",color:t.dangerColor,cursor:"pointer",fontSize:11,fontFamily:"inherit",
                    }}>Clear all ×</button>
                  )}
                </div>
              </div>
              {Object.entries(dedupedMixerCategories).map(([cat, items]) => (
                <div key={cat} style={{marginBottom:20}}>
                  <div style={{
                    fontSize:10,letterSpacing:3,color:t.accent,textTransform:"uppercase",
                    marginBottom:8,paddingBottom:6,borderBottom:"1px solid "+t.btnBorder,
                    display:"flex",justifyContent:"space-between",alignItems:"center",
                  }}>
                    <span>{cat}</span>
                    <span style={{fontSize:9,color:t.textSecond,letterSpacing:1}}>
                      {items.filter(m => selectedMixers.has(m)).length}/{items.length}
                    </span>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                    {[...new Set(items)].sort((a,b)=>a.localeCompare(b)).map(m => {
                      const on = selectedMixers.has(m);
                      return (
                        <button key={m} onClick={() => toggleMixer(m)} style={{
                          padding:"7px 13px", borderRadius:20, border:"1px solid",
                          borderColor: on ? t.accentBorder : (lightMode ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)"),
                          background: on ? t.accentBg : "transparent",
                          color: on ? t.accent : (lightMode ? "#6a5040" : "#a09080"),
                          cursor:"pointer", fontSize:12, fontFamily:"inherit",
                          display:"flex",alignItems:"center",gap:6,
                          fontWeight: on ? "600" : "400",
                          transition:"all 0.15s",
                        }}>
                          <span style={{fontSize:10,opacity: on ? 1 : 0.4}}>{on ? "✓" : "+"}</span>
                          {m}
                          {ingUsage[m] ? <span style={{fontSize:9,opacity:0.55,fontWeight:400,marginLeft:1}}>{ingUsage[m]}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CLUSTER MAP */}
          {view === "cluster" && (
            <ClusterMap
              recipes={recipes}
              lightMode={lightMode}
              onSelectRecipe={(r) => openDetail(r)}
              t={t}
            />
          )}

          {/* DETAIL */}
          {view === "detail" && activeRecipe && (
            <div style={{maxWidth:620,margin:"0 auto"}}>
              <button onClick={() => setView("browse")} style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:t.cardBg, border:"1px solid "+t.cardBorder,
                color:t.textSecond, cursor:"pointer", fontSize:12,
                fontFamily:"inherit", marginBottom:18, padding:"7px 14px",
                borderRadius:20, transition:"background 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background=t.accentBg; e.currentTarget.style.color=t.accent; e.currentTarget.style.borderColor=t.accentBorder; }}
              onMouseLeave={e => { e.currentTarget.style.background=t.cardBg; e.currentTarget.style.color=t.textSecond; e.currentTarget.style.borderColor=t.cardBorder; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6"/></svg>
                Back to recipes
              </button>
              <div style={{
                background:`linear-gradient(135deg, ${activeRecipe.color}20, ${activeRecipe.color}08)`,
                border:`1px solid ${activeRecipe.color}50`, borderRadius:16, padding:24,
                boxShadow: lightMode ? "0 8px 40px rgba(0,0,0,0.12)" : "0 8px 40px rgba(0,0,0,0.4)",
              }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:3}}>
                  <div style={{display:"flex",alignItems:"center",gap:16}}>
                    <CocktailIllustration name={activeRecipe.name} glass={activeRecipe.glass} color={activeRecipe.color} size={80} visOverride={customVisuals[activeRecipe.id]||null} lightMode={lightMode}/>
                    <div>
                      <h1 style={{margin:0,fontSize:26,color:t.textPrimary,fontFamily:fontDisplay,fontWeight:"400"}}>{activeRecipe.name}</h1>
                      <div style={{fontSize:14,color:t.textSecond,fontStyle:"italic",marginTop:4,fontFamily:fontDisplay}}>
                        {activeRecipe.glass} glass{activeRecipe.garnish ? " · " + activeRecipe.garnish : ""}
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                        {(activeRecipe.tags||[]).map(tag => (
                          <span key={tag} style={{
                            padding:"2px 8px", borderRadius:10, fontSize:9,
                            background: lightMode ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.09)",
                            border:"1px solid "+t.btnBorder, color:t.textSecond,
                            letterSpacing:1, textTransform:"uppercase",
                          }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:7,alignItems:"center"}}>
                    <button onClick={() => toggleWantToTry(activeRecipe.id)} title="Want to try" style={{background:"none",border:"none",cursor:"pointer",padding:"1px 2px",display:"flex",alignItems:"center"}}><svg width="22" height="22" viewBox="0 0 24 24" fill={activeRecipe.wantToTry?t.textSecond:"none"} stroke={t.textSecond} strokeWidth="2" strokeLinejoin="round" style={{opacity:activeRecipe.wantToTry?1:0.3}}><path d="M12 2 L13.8 9.2 L21 12 L13.8 14.8 L12 22 L10.2 14.8 L3 12 L10.2 9.2 Z"/></svg></button>
                    <button onClick={() => toggleVerified(activeRecipe.id)} title="Mark ingredients as verified" style={{background:"none",border:"none",cursor:"pointer",padding:"1px 2px",display:"flex",alignItems:"center"}}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={t.textSecond} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:activeRecipe.verified?1:0.3}}><polyline points="20,6 9,17 4,12"/></svg></button>
                    <button onClick={() => toggleFavorite(activeRecipe.id)} style={{background:"none",border:"none",cursor:"pointer",padding:"1px 2px",display:"flex",alignItems:"center"}} title="Favourite"><svg width="22" height="22" viewBox="0 0 24 24" fill={activeRecipe.favorite?t.textSecond:"none"} stroke={t.textSecond} strokeWidth="2" strokeLinejoin="round" style={{opacity:activeRecipe.favorite?1:0.3}}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg></button>
                    <button onClick={() => openVariant(activeRecipe)} style={{padding:"0 11px",height:26,borderRadius:10,border:"1px solid rgba(100,200,255,0.4)",background:"rgba(100,200,255,0.08)",color:t.variantColor,cursor:"pointer",fontSize:11,fontFamily:"inherit",whiteSpace:"nowrap",lineHeight:"normal"}}>Variant</button>
                    <button onClick={() => openEdit(activeRecipe)} style={{padding:"0 11px",height:26,borderRadius:10,border:"1px solid rgba(255,200,100,0.4)",background:"rgba(255,215,0,0.1)",color:t.accent,cursor:"pointer",fontSize:11,fontFamily:"inherit",whiteSpace:"nowrap"}}>Edit</button>
                    <button onClick={() => deleteRecipe(activeRecipe.id)} style={{padding:"0 11px",height:26,borderRadius:10,border:"1px solid "+t.dangerBorder,background:"rgba(255,80,80,0.1)",color:t.dangerColor,cursor:"pointer",fontSize:11,fontFamily:"inherit",whiteSpace:"nowrap"}}>Delete</button>
                  </div>
                </div>

                {/* Volume Controls */}
                <VolumeControls />

                {/* Ingredients */}
                <div style={{marginBottom:18}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:9,letterSpacing:3,color:t.textSecond,textTransform:"uppercase"}}>Ingredients</div>
                    {servings > 1 && (
                      <div style={{fontSize:10,color:t.accent,fontStyle:"italic",opacity:0.8}}>
                        Scaled × {servings} ({servings} servings)
                      </div>
                    )}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {activeRecipe.ingredients.map(ingItem => {
                      const inBar = selectedMixers.has(ingItem.name);
                      return <div key={ingItem.name} style={{
                        display:"flex",justifyContent:"space-between",alignItems:"center",
                        padding:"7px 12px", borderRadius:9,
                        background: inBar ? `${activeRecipe.color}28` : t.panelBg,
                        border:`1px solid ${inBar ? activeRecipe.color+"55" : t.panelBorder}`,
                      }}>
                        <span style={{display:"flex",alignItems:"center",gap:6,color: inBar ? (lightMode ? "#2a1a05" : "#f0e6d3") : t.textPrimary,fontSize:13}}>
                          {inBar && <span style={{fontSize:9,color:t.accent}}>✓</span>}
                          {ingItem.name}
                        </span>
                        <AmountEditor
                          oz={ingItem.oz}
                          displayAmt={ingItem.displayAmt}
                          unit={unit}
                          servings={servings}
                          onChange={({oz, displayAmt}) => updateIngredientAmt(ingItem.name, oz, displayAmt)}
                          t={t}
                        />
                      </div>;
                    })}
                  </div>
                  <div style={{marginTop:8,fontSize:10,color:t.textSecond,fontStyle:"italic"}}>
                    ✏ Click any amount to edit it in-place
                  </div>
                </div>

                {/* Instructions */}
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:9,letterSpacing:3,color:t.textSecond,textTransform:"uppercase",marginBottom:8}}>Instructions</div>
                  <div style={{fontSize:13,lineHeight:1.8,color:t.textPrimary,background:t.inputBg,borderRadius:9,padding:13}}>
                    {activeRecipe.instructions}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <div style={{fontSize:9,letterSpacing:3,color:t.textSecond,textTransform:"uppercase",marginBottom:7}}>My Notes</div>
                  <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
                    placeholder="Personal notes, tweaks, substitutions..." rows={3}
                    style={{width:"100%",background:t.sectionBg,border:"1px solid "+t.panelBorder,
                      borderRadius:9,padding:10,color:t.textPrimary,fontSize:13,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
                  <button onClick={saveNotes} style={{marginTop:6,padding:"6px 16px",borderRadius:12,border:"1px solid rgba(255,200,100,0.4)",background:t.accentBg,color:t.accent,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                    Save Notes
                  </button>
                </div>

                {/* Variants */}
                {(() => {
                  const siblings = getVariants(activeRecipe);
                  if (siblings.length === 0) return null;
                  return (
                    <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid "+t.panelBorder}}>
                      <div style={{fontSize:9,letterSpacing:3,color:t.variantColor,textTransform:"uppercase",marginBottom:10}}>⎇ Variants</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {siblings.map(v => (
                          <button key={v.id} onClick={() => openDetail(v)} style={{
                            display:"flex", alignItems:"center", gap:8,
                            padding:"8px 12px", borderRadius:12,
                            border:"1px solid "+t.variantBorder,
                            background:t.variantBg,
                            cursor:"pointer", fontFamily:"inherit", textAlign:"left",
                          }}>
                            <CocktailIllustration name={v.name} glass={v.glass} color={v.color} size={36} visOverride={customVisuals[v.id]||null} lightMode={lightMode}/>
                            <div>
                              <div style={{fontSize:12,color:t.textPrimary,fontWeight:"600"}}>{v.name}</div>
                              {v.variantName && <div style={{fontSize:10,color:t.infoMuted,fontStyle:"italic"}}>{v.variantName}</div>}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* CREATE / EDIT */}
          {(view === "create" || view === "edit") && editForm && (
            <div style={{maxWidth:560,margin:"0 auto"}}>
              <button onClick={() => setView(view==="create"?"browse":"detail")} style={{background:"none",border:"none",color:t.textSecond,cursor:"pointer",fontSize:12,fontFamily:"inherit",marginBottom:14}}>← Cancel</button>
              <div style={{background:t.panelBg,border:"1px solid "+t.panelBorder,borderRadius:16,padding:24}}>
                <h2 style={{margin:"0 0 18px",fontSize:18,color:t.accent}}>{view==="create"?"New Recipe":"Edit Recipe"}</h2>

                {/* Name + Category text fields */}
                {/* Cocktail Name */}
                <div style={{marginBottom:12}}>
                  <label style={{fontSize:9,letterSpacing:2,color:t.textSecond,textTransform:"uppercase",display:"block",marginBottom:4}}>Cocktail Name</label>
                  <input value={editForm.name} onChange={e => setEditForm(prev => ({...prev,name:e.target.value}))} style={{
                    width:"100%",padding:"8px 11px",borderRadius:8,border:"1px solid "+t.inputBorder,
                    background:t.inputBg,color:t.textPrimary,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box",
                  }}/>
                </div>
                {/* Tags picker */}
                <div style={{marginBottom:12}}>
                  <label style={{fontSize:9,letterSpacing:2,color:t.textSecond,textTransform:"uppercase",display:"block",marginBottom:6}}>Tags</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {allTags.map(tag => {
                      const active = (editForm.tags||[]).includes(tag);
                      return (
                        <button key={tag} type="button" onClick={() => setEditForm(prev => {
                          const tags = prev.tags||[];
                          return {...prev, tags: active ? tags.filter(t=>t!==tag) : [...tags, tag]};
                        })} style={{
                          padding:"4px 10px", borderRadius:14, border:"1px solid",
                          borderColor: active ? t.accent : t.btnBorder,
                          background: active ? t.accentBg : t.panelBg,
                          color: active ? t.accent : t.textSecond,
                          cursor:"pointer", fontSize:10, fontFamily:"inherit",
                        }}>{tag}</button>
                      );
                    })}
                  </div>
                  {(editForm.tags||[]).length === 0 && (
                    <div style={{fontSize:10,color:t.textMuted,marginTop:5,fontStyle:"italic"}}>Select at least one tag</div>
                  )}
                  {/* New tag input */}
                  <div style={{display:"flex",gap:6,marginTop:8,alignItems:"center"}}>
                    <input
                      id="new-tag-input"
                      placeholder="New tag…"
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const val = e.target.value.trim();
                          if (val && !allTags.includes(val)) {
                            setAllTags(prev => [...prev, val]);
                            setEditForm(prev => ({...prev, tags: [...(prev.tags||[]), val]}));
                          } else if (val && !editForm.tags?.includes(val)) {
                            setEditForm(prev => ({...prev, tags: [...(prev.tags||[]), val]}));
                          }
                          e.target.value = "";
                        }
                      }}
                      style={{
                        flex:1, padding:"4px 10px", borderRadius:14, fontSize:10,
                        border:"1px dashed "+t.inputBorder, background:t.inputBg,
                        color:t.textPrimary, fontFamily:"inherit", outline:"none",
                      }}
                    />
                    <button type="button" onClick={() => {
                      const input = document.getElementById("new-tag-input");
                      const val = input.value.trim();
                      if (val && !allTags.includes(val)) {
                        setAllTags(prev => [...prev, val]);
                        setEditForm(prev => ({...prev, tags: [...(prev.tags||[]), val]}));
                      } else if (val && !editForm.tags?.includes(val)) {
                        setEditForm(prev => ({...prev, tags: [...(prev.tags||[]), val]}));
                      }
                      input.value = "";
                    }} style={{
                      padding:"4px 12px", borderRadius:14, border:"1px solid "+t.accent,
                      background:t.accentBg, color:t.accent, cursor:"pointer",
                      fontSize:10, fontFamily:"inherit", whiteSpace:"nowrap",
                    }}>+ Add</button>
                  </div>
                </div>

                {/* Variant label — only shown for variants */}
                {/* ── Variant Linking ── */}
                {(() => {
                  const linkedRecipe = editForm.variantOf ? recipes.find(r => r.id === editForm.variantOf || (r.variantOf === editForm.variantOf && r.id !== editForm.id)) : null;
                  const rootRecipe = editForm.variantOf ? recipes.find(r => r.id === editForm.variantOf) : null;
                  return (
                    <div style={{marginBottom:12,padding:"12px 14px",borderRadius:9,background:t.variantBg,border:"1px solid rgba(100,200,255,0.2)"}}>
                      <div style={{fontSize:9,letterSpacing:2,color:t.variantColor,textTransform:"uppercase",marginBottom:10}}>⎇ Variant Link</div>

                      {editForm.variantOf && rootRecipe ? (
                        // Currently linked — show linked recipe + unlink + label
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"8px 10px",borderRadius:8,background:"rgba(100,200,255,0.08)",border:"1px solid "+t.variantBorder}}>
                            <CocktailIllustration name={rootRecipe.name} glass={rootRecipe.glass} color={rootRecipe.color} size={32} visOverride={customVisuals[rootRecipe.id]||null} lightMode={lightMode}/>
                            <div style={{flex:1}}>
                              <div style={{fontSize:11,color:t.textPrimary,fontWeight:"bold"}}>{rootRecipe.name}</div>
                              <div style={{fontSize:10,color:t.infoMuted}}>Linked as variant of this recipe</div>
                            </div>
                            <button onClick={() => setEditForm(prev => ({...prev, variantOf:null, variantName:""}))} style={{
                              padding:"4px 9px",borderRadius:8,border:"1px solid "+t.dangerBorder,
                              background:"rgba(200,50,50,0.08)",color:t.dangerColor,cursor:"pointer",fontSize:10,fontFamily:"inherit",
                            }}>Unlink ×</button>
                          </div>
                          <label style={{fontSize:9,letterSpacing:1,color:t.variantColor,textTransform:"uppercase",display:"block",marginBottom:4}}>Variant label <span style={{opacity:0.55,fontStyle:"italic",textTransform:"none",letterSpacing:0}}>(optional)</span></label>
                          <input value={editForm.variantName||""} onChange={e => setEditForm(prev => ({...prev,variantName:e.target.value}))}
                            placeholder='e.g. "Mezcal version", "Spicy riff"...' style={{
                              width:"100%",padding:"7px 11px",borderRadius:7,border:"1px solid "+t.variantBorder,
                              background:t.inputBg,color:t.textPrimary,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box",
                            }}/>
                        </div>
                      ) : (
                        // Not linked — show search picker
                        <div>
                          <div style={{fontSize:11,color:t.infoMuted,marginBottom:8}}>Link this recipe to an existing one to group them as variants.</div>
                          <input
                            placeholder="Search recipes to link..."
                            onChange={e => setEditForm(prev => ({...prev, _variantSearch: e.target.value}))}
                            value={editForm._variantSearch||""}
                            style={{
                              width:"100%",padding:"7px 11px",borderRadius:7,border:"1px solid "+t.variantBorder,
                              background:t.inputBg,color:t.textPrimary,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box",marginBottom:6,
                            }}/>
                          {editForm._variantSearch && (() => {
                            const q = (editForm._variantSearch||"").toLowerCase();
                            const results = recipes.filter(r => r.id !== editForm.id && r.name.toLowerCase().includes(q)).slice(0,6);
                            if (results.length === 0) return <div style={{fontSize:11,color:t.textMuted,fontStyle:"italic",padding:"4px 2px"}}>No matches</div>;
                            return (
                              <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:200,overflowY:"auto"}}>
                                {results.map(r => (
                                  <button key={r.id} onClick={() => setEditForm(prev => ({
                                    ...prev,
                                    variantOf: r.variantOf || r.id,
                                    variantName: prev.variantName || "",
                                    _variantSearch: "",
                                  }))} style={{
                                    display:"flex",alignItems:"center",gap:8,
                                    padding:"7px 10px",borderRadius:8,
                                    border:"1px solid "+t.variantBorder,
                                    background:t.variantBg,
                                    cursor:"pointer",fontFamily:"inherit",textAlign:"left",
                                  }}>
                                    <CocktailIllustration name={r.name} glass={r.glass} color={r.color} size={28} visOverride={customVisuals[r.id]||null} lightMode={lightMode}/>
                                    <div>
                                      <div style={{fontSize:12,color:t.textPrimary,fontWeight:"500"}}>{r.name}</div>
                                      <div style={{fontSize:10,color:t.infoMuted}}>{(r.tags||[]).join(" · ")} · {r.glass}</div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Garnish text field */}
                <div style={{marginBottom:16}}>
                  <label style={{fontSize:9,letterSpacing:2,color:t.textSecond,textTransform:"uppercase",display:"block",marginBottom:4}}>Garnish</label>
                  <input value={editForm.garnish} onChange={e => setEditForm(prev => ({...prev,garnish:e.target.value}))} style={{
                    width:"100%",padding:"8px 11px",borderRadius:8,border:"1px solid "+t.inputBorder,
                    background:t.inputBg,color:t.textPrimary,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box",
                  }}/>
                </div>

                {/* ── Visual Editor ── */}
                {editVis && (
                  <div style={{marginBottom:18,padding:16,borderRadius:12,background:"rgba(255,215,0,0.05)",border:"1px solid "+t.panelBorder}}>
                    <div style={{fontSize:9,letterSpacing:2,color:t.accent,textTransform:"uppercase",marginBottom:12}}>🍹 Illustration</div>

                    {/* Live preview */}
                    <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
                      <div style={{
                        padding:16, borderRadius:12,
                        background: editForm.color+"18",
                        border: "1px solid " + editForm.color + "50",
                      }}>
                        <CocktailIllustration name={editForm.name||"Preview"} glass={editVis.glass} color={editForm.color} size={90} visOverride={{...editVis, liquid: editForm.color}} lightMode={lightMode}/>
                      </div>
                    </div>

                    {/* Glass type picker */}
                    <div style={{marginBottom:12}}>
                      <label style={{fontSize:9,letterSpacing:2,color:t.textSecond,textTransform:"uppercase",display:"block",marginBottom:7}}>Glass Shape</label>
                      <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                        {[["coupe","Coupe"],["martini","Martini"],["nick","Nick & Nora"],["rocks","Rocks"],["highball","Highball"],["flute","Flute"],["wine","Wine"],["mule","Mule"],["hurricane","Hurricane"],["shot","Shot"],["snifter","Snifter"],["tiki","Tiki"]].map(([val,label]) => (
                          <button key={val} onClick={() => {
                            setEditVis(prev => ({...prev, glass:val}));
                            setEditForm(prev => ({...prev, glass: label}));
                          }} style={{
                            padding:"5px 11px", borderRadius:10, border:"1px solid",
                            borderColor: editVis.glass===val ? "#ffd700" : "rgba(255,200,100,0.25)",
                            background: editVis.glass===val ? t.accentBg : t.panelBg,
                            color: editVis.glass===val ? "#ffd700" : "#a09070",
                            cursor:"pointer", fontSize:11, fontFamily:"inherit",
                          }}>{label}</button>
                        ))}
                      </div>
                    </div>

                    {/* Liquid color */}
                    <div style={{marginBottom:12}}>
                      <label style={{fontSize:9,letterSpacing:2,color:t.textSecond,textTransform:"uppercase",display:"block",marginBottom:7}}>Liquid Color</label>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                        {COLORS.map(c => (
                          <button key={c} onClick={() => { setEditForm(prev => ({...prev,color:c})); setEditVis(prev => ({...prev,liquid:c})); }} style={{
                            width:26,height:26,borderRadius:"50%",background:c,border:"2px solid",
                            borderColor: editForm.color===c ? "#ffd700" : "transparent",cursor:"pointer",
                          }}/>
                        ))}
                        {/* Free-pick swatch */}
                        <div style={{position:"relative",width:26,height:26,flexShrink:0}} title="Custom color">
                          <div style={{
                            width:26,height:26,borderRadius:"50%",
                            background: COLORS.includes(editForm.color) ? "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" : editForm.color,
                            border:"2px solid",
                            borderColor: !COLORS.includes(editForm.color) ? "#ffd700" : "transparent",
                            cursor:"pointer", overflow:"hidden",
                            display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:11,
                          }}>
                            {COLORS.includes(editForm.color) && <span style={{color:"rgba(0,0,0,0.5)",fontWeight:"bold",fontSize:14,lineHeight:1}}>+</span>}
                          </div>
                          <input type="color" value={editForm.color} onChange={e => {
                            setEditForm(prev => ({...prev, color: e.target.value}));
                            setEditVis(prev => ({...prev, liquid: e.target.value}));
                          }} style={{
                            position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%",
                          }}/>
                        </div>
                      </div>
                    </div>

                    {/* Garnish type */}
                    <div style={{marginBottom:12}}>
                      <label style={{fontSize:9,letterSpacing:2,color:t.textSecond,textTransform:"uppercase",display:"block",marginBottom:7}}>Garnish Icon</label>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {[[null,"None"],["lemon","🍋"],["lime","🍈"],["orange","🍊"],["cherry","🍒"],["mint","🌿"],["olive","🫒"],["pineapple","🍍"],["berry","🫐"],["grapefruit","🍑"],["rosemary","🌾"],["cucumber","🥒"]].map(([val,label]) => (
                          <button key={String(val)} title={val||"None"} onClick={() => setEditVis(prev => ({...prev, garnish:val}))} style={{
                            padding:"4px 9px", borderRadius:10, border:"1px solid",
                            borderColor: editVis.garnish===val ? t.accent : t.btnBorder,
                            background: editVis.garnish===val ? t.accentBg : t.panelBg,
                            color: editVis.garnish===val ? t.accent : t.textSecond,
                            cursor:"pointer", fontSize:11, fontFamily:"inherit",
                          }}>{label}</button>
                        ))}
                        <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4}}>
                          <span style={{fontSize:10,color:t.textMuted}}>Custom:</span>
                          <input
                            value={typeof editVis.garnish === "string" && !["lemon","lime","orange","cherry","mint","olive","pineapple","berry","grapefruit","rosemary","cucumber"].includes(editVis.garnish) ? editVis.garnish : ""}
                            onChange={e => setEditVis(prev => ({...prev, garnish: e.target.value || null}))}
                            placeholder="e.g. twist, sprig..."
                            style={{
                              flex:1, padding:"3px 8px", borderRadius:7, border:"1px solid "+t.inputBorder,
                              background:t.inputBg, color:t.textPrimary, fontSize:11, fontFamily:"inherit", outline:"none",
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Toggles: foam, ice, crushed ice, bubbles, layered, salt rim, sugar rim */}
                    <div style={{marginBottom:8}}>
                      <label style={{fontSize:9,letterSpacing:2,color:t.textSecond,textTransform:"uppercase",display:"block",marginBottom:6}}>Effects</label>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {[["foam","🫧 Foam"],["ice","🧊 Ice"],["crushed","❄️ Crushed"],["bubbles","✨ Bubbles"],["layered","🎨 Layered"],["salt","🧂 Salt Rim"],["sugar","🍬 Sugar Rim"]].map(([key,label]) => (
                          <button key={key} onClick={() => setEditVis(prev => ({...prev,[key]:!prev[key]}))} style={{
                            padding:"5px 10px", borderRadius:10, border:"1px solid",
                            borderColor: editVis[key] ? t.accent : t.btnBorder,
                            background: editVis[key] ? t.accentBg : t.panelBg,
                            color: editVis[key] ? t.accent : t.textSecond,
                            cursor:"pointer", fontSize:11, fontFamily:"inherit",
                          }}>{label}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div style={{marginBottom:12}}>
                  <label style={{fontSize:9,letterSpacing:2,color:t.textSecond,textTransform:"uppercase",display:"block",marginBottom:4}}>Ingredients</label>
                  {/* Existing ingredients with editable amounts */}
                  <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:7}}>
                    {editForm.ingredients.map((ingItem, i) => (
                      <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",borderRadius:7,background:t.rowBg,border:"1px solid "+t.panelBorder}}>
                        {/* Reorder buttons */}
                        <div style={{display:"flex",flexDirection:"column",gap:1,flexShrink:0}}>
                          <button onClick={() => moveIngredient(i, -1)} disabled={i===0}
                            style={{background:"none",border:"none",cursor:i===0?"default":"pointer",color:i===0?t.disabledColor:t.textSecond,fontSize:9,padding:"0 2px",lineHeight:1}}>▲</button>
                          <button onClick={() => moveIngredient(i, 1)} disabled={i===editForm.ingredients.length-1}
                            style={{background:"none",border:"none",cursor:i===editForm.ingredients.length-1?"default":"pointer",color:i===editForm.ingredients.length-1?t.disabledColor:t.textSecond,fontSize:9,padding:"0 2px",lineHeight:1}}>▼</button>
                        </div>
                        <span style={{flex:1,fontSize:12,color:t.textPrimary}}>{ingItem.name}</span>
                        <IngAmtInput
                          ingItem={ingItem}
                          onCommit={raw => updateFormIngAmt(i, raw)}
                          t={t}
                        />
                        <span style={{fontSize:11,color:t.textSecond,minWidth:20}}>
                          {ingItem.oz !== null ? "oz" : ""}
                        </span>
                        <button onClick={() => removeIngredientFromForm(i)} style={{background:"none",border:"none",cursor:"pointer",color:t.dangerColor,fontSize:16,padding:0,lineHeight:1}}>×</button>
                      </div>
                    ))}
                  </div>
                  {/* Add new ingredient row OR new-ingredient category prompt */}
                  {newIngPrompt ? (
                    <div style={{
                      padding:"14px", borderRadius:10,
                      background:t.rowBg,
                      border:"1px solid rgba(255,215,0,0.35)",
                      marginTop:4,
                    }}>
                      <div style={{fontSize:11,color:t.accent,marginBottom:8,fontWeight:"bold"}}>
                        ✨ "{newIngPrompt.name}" isn't on your bar list yet.
                      </div>
                      <div style={{fontSize:11,color:t.textSecond,marginBottom:9}}>
                        Add it to My Bar under which tab?
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:11}}>
                        {Object.keys(dedupedMixerCategories).map(cat => (
                          <button key={cat} onClick={() => setNewIngPromptCat(cat)} style={{
                            padding:"5px 10px", borderRadius:10, border:"1px solid",
                            borderColor: newIngPromptCat===cat ? "#ffd700" : "rgba(255,200,100,0.3)",
                            background: newIngPromptCat===cat ? t.accentBg : t.panelBg,
                            color: newIngPromptCat===cat ? "#ffd700" : "#c9a96e",
                            cursor:"pointer", fontSize:11, fontFamily:"inherit",
                          }}>{cat}</button>
                        ))}
                      </div>
                      <div style={{display:"flex",gap:7}}>
                        <button onClick={confirmNewIngredient} style={{
                          flex:1, padding:"7px", borderRadius:8,
                          border:"1px solid #ffd700",
                          background:t.accentBg, color:t.accent,
                          cursor:"pointer", fontSize:12, fontFamily:"inherit",
                        }}>✓ Add to "{newIngPromptCat}"</button>
                        <button onClick={dismissNewIngPrompt} title="Add to recipe only, skip the bar list" style={{
                          padding:"7px 12px", borderRadius:8,
                          border:"1px solid "+t.inputBorder,
                          background:"transparent", color:t.textSecond,
                          cursor:"pointer", fontSize:12, fontFamily:"inherit",
                        }}>Skip</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{display:"flex",gap:5}}>
                      <input list="mixer-opts" value={newIngName} onChange={e => setNewIngName(e.target.value)}
                        onKeyDown={e => e.key==="Enter" && addIngredientToForm()}
                        placeholder="Ingredient name..." style={{
                          flex:2,padding:"7px 9px",borderRadius:7,border:"1px solid "+t.inputBorder,
                          background:t.inputBg,color:t.textPrimary,fontSize:11,fontFamily:"inherit",outline:"none",
                        }}/>
                      <datalist id="mixer-opts">{allMixers.map(m => <option key={m} value={m}/>)}</datalist>
                      <input value={newIngAmt} onChange={e => setNewIngAmt(e.target.value)}
                        onKeyDown={e => e.key==="Enter" && addIngredientToForm()}
                        placeholder="1.5 / 3/4 / 1 1/2" style={{
                          flex:1,padding:"7px 9px",borderRadius:7,border:"1px solid "+t.inputBorder,
                          background:t.inputBg,color:t.textPrimary,fontSize:11,fontFamily:"inherit",outline:"none",
                        }}/>
                      <button onClick={addIngredientToForm} style={{padding:"7px 12px",borderRadius:7,border:"1px solid rgba(255,200,100,0.4)",background:t.accentBg,color:t.accent,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>Add</button>
                    </div>
                  )}
                </div>

                <div style={{marginBottom:18}}>
                  <label style={{fontSize:9,letterSpacing:2,color:t.textSecond,textTransform:"uppercase",display:"block",marginBottom:4}}>Instructions</label>
                  <textarea value={editForm.instructions} onChange={e => setEditForm(prev => ({...prev,instructions:e.target.value}))} rows={5}
                    placeholder="How to make it..."
                    style={{width:"100%",padding:"8px 11px",borderRadius:8,border:"1px solid "+t.inputBorder,
                      background:t.inputBg,color:t.textPrimary,fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical",boxSizing:"border-box"}}/>
                </div>

                <button onClick={saveRecipe} disabled={!editForm.name.trim()} style={{
                  width:"100%",padding:"10px",borderRadius:11,border:"1px solid "+(editForm.name.trim()?t.accentBorder:t.btnBorder),
                  background:editForm.name.trim()?t.accentBg:t.hlBg,
                  color:editForm.name.trim()?t.accent:t.textMuted,
                  cursor:editForm.name.trim()?"pointer":"not-allowed",fontSize:13,fontFamily:"inherit",letterSpacing:1,
                }}>{view==="create"?"Create Recipe":"Save Changes"}</button>
              </div>
            </div>
          )}
        </main>
      </div>
      {/* Reset confirmation dialog */}
      {showShoppingList && (() => {
        const wantRecipes = recipes.filter(r => r.wantToTry);
        return (
          <div onClick={() => setShowShoppingList(false)} style={{position:"fixed",inset:0,background:t.overlayBg,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div onClick={e => e.stopPropagation()} style={{background:t.cardBg,border:"1px solid "+t.cardBorder,borderRadius:16,padding:28,width:"100%",maxWidth:440,maxHeight:"80vh",display:"flex",flexDirection:"column",gap:0}}>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
                <div>
                  <div style={{fontSize:18,fontWeight:400,color:t.textPrimary,fontFamily:fontDisplay}}>Shopping List</div>
                  <div style={{fontSize:11,color:t.textSecond,marginTop:2}}>{wantRecipes.length} want-to-try cocktail{wantRecipes.length!==1?"s":""}</div>
                </div>
                <button onClick={() => setShowShoppingList(false)} style={{background:"none",border:"none",cursor:"pointer",color:t.textSecond,fontSize:20,lineHeight:1,padding:4}}>×</button>
              </div>
              {shoppingList.length === 0 ? (
                <div style={{textAlign:"center",padding:"32px 0",color:t.textSecond,fontSize:13}}>
                  <div style={{fontSize:28,marginBottom:10}}>✓</div>
                  You already have everything you need!
                </div>
              ) : (
                <div style={{overflowY:"auto",flex:1}}>
                  {shoppingList.map(({ name, recipes: usedIn }) => (
                    <div key={name} style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,padding:"9px 0",borderBottom:"1px solid "+t.cardBorder}}>
                      <div style={{fontSize:13,color:t.textPrimary,fontWeight:400}}>{name}</div>
                      <div style={{fontSize:10,color:t.textSecond,textAlign:"right",flexShrink:0,maxWidth:"55%",lineHeight:1.4}}>
                        {usedIn.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {shoppingList.length > 0 && (
                <div style={{marginTop:18,display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={() => {
                    const lines = ["Shopping List", "============", ...shoppingList.map(i => `☐  ${i.name}  (${i.recipes.join(", ")})`), "", `${wantRecipes.length} cocktail${wantRecipes.length!==1?"s":""} planned`];
                    navigator.clipboard?.writeText(lines.join("\n")).catch(()=>{});
                  }} style={{padding:"7px 16px",borderRadius:10,border:"1px solid "+t.cardBorder,background:"transparent",color:t.textSecond,cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    Copy
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {showResetConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{
            background: lightMode ? "#fff" : "#1e1e2e",
            border: "1px solid " + (lightMode ? "rgba(180,40,40,0.35)" : "rgba(255,100,100,0.35)"),
            borderRadius:16, padding:32, maxWidth:340, width:"90%", textAlign:"center",
            boxShadow:"0 12px 48px rgba(0,0,0,0.35)",
          }}>
            <div style={{fontSize:28,marginBottom:12}}>⚠️</div>
            <div style={{fontSize:17,fontWeight:600,color: lightMode ? "#1a1a1a" : "#f0f0f0",marginBottom:8}}>Reset to defaults?</div>
            <div style={{fontSize:13,color: lightMode ? "#555" : "#aaa",marginBottom:24,lineHeight:1.5}}>Your custom recipes, edits, and notes will be permanently lost.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button onClick={() => setShowResetConfirm(false)} style={{
                padding:"9px 22px", borderRadius:10,
                border:"1px solid "+(lightMode?"rgba(0,0,0,0.2)":"rgba(255,255,255,0.15)"),
                background: lightMode?"#f0f0f0":"rgba(255,255,255,0.08)",
                color: lightMode?"#333":"#ccc",
                cursor:"pointer", fontSize:13, fontFamily:"inherit",
              }}>Cancel</button>
              <button onClick={confirmReset} style={{
                padding:"9px 22px", borderRadius:10,
                border:"1px solid rgba(200,50,50,0.6)",
                background:"rgba(200,50,50,0.15)",
                color: lightMode?"#b02020":"#ff7070",
                cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600,
              }}>Reset everything</button>
            </div>
          </div>
        </div>
      )}
      </div>{/* end zoom inner */}
      </div>{/* end zoom outer */}
    </div>
  );
}
