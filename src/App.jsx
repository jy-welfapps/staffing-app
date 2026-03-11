// ============================================================
//  児童・職員スケジュール管理 v8.0.8
//  縦軸 = 時間(8:00〜19:00)、横軸 = 人員
//  職員: 在所(下地)+送迎(斜線オーバーレイ, ルート番号)+休憩(ドット)
//  児童: 在所バー+お迎えピン📌、学校グループ別列
//  ルートオーバーレイ: 同一ルート番号の職員列を横断する帯
// ============================================================
import { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from "react";

// ─── 定数 ────────────────────────────────────────────────────
const H_START_DEF = 7, H_END_DEF = 20;
const CH_DEF = 52;
const GC = createContext({hStart:H_START_DEF, hEnd:H_END_DEF, hTotal:H_END_DEF-H_START_DEF, ch:CH_DEF, totalH:(H_END_DEF-H_START_DEF)*CH_DEF});
const useG = () => useContext(GC);
let H_START = H_START_DEF, H_END = H_END_DEF, H_TOTAL = H_END - H_START;
let CH = CH_DEF;
const CW_STAFF = 88;  // 職員列幅（通常）
const CW_CHILD = 72;  // 児童列幅（通常）
const CW_STAFF_SM = 44; // 職員列幅（コンパクト）
const CW_CHILD_SM = 36; // 児童列幅（コンパクト）
const TW = 44;        // 時間軸ラベル幅
const HDR_H = 72;     // 人員ヘッダー高さ（名前が切れないよう拡大）
const SNAP = 0.25;
const MIN_DUR = 0.25;
let TOTAL_H = H_TOTAL * CH; // グリッド全高

const BS=(bg,c)=>({background:bg,color:c,border:"none",borderRadius:6,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer"});
const DAYS_JP = ["日","月","火","水","木","金","土"];
const DAYS_EN = ["sun","mon","tue","wed","thu","fri","sat"];
const PERF_WARN_DAYS = 90;

let STAFF_TYPES = {
  fulltime: { label:"常勤",    color:"#3b82f6" },
  part:     { label:"パート",  color:"#10b981" },
  timee:    { label:"タイミー",color:"#f59e0b" },
  help:     { label:"ヘルプ",  color:"#a855f7" },
};
const DEFAULT_STAFF_TYPES = {
  fulltime: { label:"常勤",    color:"#3b82f6" },
  part:     { label:"パート",  color:"#10b981" },
  timee:    { label:"タイミー",color:"#f59e0b" },
  help:     { label:"ヘルプ",  color:"#a855f7" },
};
let SCHOOL_GROUPS = {
  nursery:    { label:"保育園・幼稚園", color:"#f97316" },
  elementary: { label:"小学校",        color:"#06b6d4" },
  junior:     { label:"中学校",        color:"#ec4899" },
  high:       { label:"高校",          color:"#8b5cf6" },
  other:      { label:"その他",        color:"#64748b" },
};
const DEFAULT_SCHOOL_GROUPS = {
  nursery:    { label:"保育園・幼稚園", color:"#f97316" },
  elementary: { label:"小学校",        color:"#06b6d4" },
  junior:     { label:"中学校",        color:"#ec4899" },
  high:       { label:"高校",          color:"#8b5cf6" },
  other:      { label:"その他",        color:"#64748b" },
};
const ROUTE_NUMS  = ["①","②","③","④","⑤","⑥","⑦","⑧"];
const BREAK_NUMS  = ["①","②"];
const ROUTE_COLORS = ["#f59e0b","#06b6d4","#10b981","#ec4899","#8b5cf6","#ef4444","#84cc16","#f97316"];
const rc = n => ROUTE_COLORS[((n||1)-1) % 8];

// ─── ユーティリティ ──────────────────────────────────────────
const sv    = v => Math.round(v / SNAP) * SNAP;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const toHM  = d => { const h=Math.floor(d), m=Math.round((d-h)*60); return h+":"+String(m).padStart(2,"0"); };
const frHM  = s => { if(!s)return null; const parts=s.split(":").map(Number); const h=parts[0],m=parts[1]; return isNaN(h)?null:h+(m||0)/60; };
const uid   = () => Math.random().toString(36).slice(2,9);
const deepc = v => JSON.parse(JSON.stringify(v));
const mkSeg = (s,e,t,n=null) => ({id:uid(),start:s,end:e,type:t,num:n});

// ─── ストレージ ─────────────────────────────────────────────
// window.storage(アーティファクト永続) → localStorage → インメモリ の順でフォールバック
const SK = "childcare_v8";
let _cache = null;

const _hasWS  = () => typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
const _hasLS  = () => { try{ localStorage.setItem("__t","1"); localStorage.removeItem("__t"); return true; }catch{ return false; } };

const loadS = () => _cache || {};

const saveS = d => {
  _cache = d;
  const json = JSON.stringify(d);
  if(_hasWS())  { window.storage.set(SK, json).catch(()=>{}); return; }
  if(_hasLS())  { try{ localStorage.setItem(SK, json); }catch{} return; }
};

const initS = async () => {
  // 1. window.storage を試みる
  if(_hasWS()) {
    try {
      const r = await window.storage.get(SK);
      if(r && r.value) { _cache = JSON.parse(r.value); return; }
    } catch{}
  }
  // 2. localStorage を試みる
  if(_hasLS()) {
    try {
      const v = localStorage.getItem(SK);
      if(v) { _cache = JSON.parse(v); return; }
    } catch{}
  }
  // 3. フォールバック：空データ
  _cache = {};
};

// ─── 初期データ ──────────────────────────────────────────────
const INIT_STAFF = [];
const INIT_CHILDREN = [];

// ─── マスターデータ初期値 ────────────────────────────────────
const INIT_MASTER_STAFF = [];
const INIT_MASTER_CHILDREN = [];

// 当日データの人員エントリをマスターから生成（segments空）
const mkDayStaff   = m => ({...m, segments:[]});
const mkDayChild   = m => ({...m, segments:[], pickupTime:null});

// INIT_STAFF/INIT_CHILDRENのセグメントから全曜日デフォルトを生成
const INIT_DEFAULTS = (()=>{
  const d = {};
  // 職員：在所(work)の最初のセグメントを出退勤として登録
  INIT_STAFF.forEach(s=>{
    const work = s.segments.find(g=>g.type==="work");
    if(!work) return;
    d[s.id] = {};
    DAYS_EN.forEach(day=>{
      // 日曜は休みにしておく
      const active = day !== "sun";
      d[s.id][day] = { active:true, workStart: toHM(work.start), workEnd: toHM(work.end) };
    });
  });
  // 児童：在所(work)とpickupTimeを登録
  INIT_CHILDREN.forEach(c=>{
    const work = c.segments.find(g=>g.type==="work");
    d[c.id] = {};
    DAYS_EN.forEach(day=>{
      const active = day !== "sun" && day !== "sat";
      d[c.id][day] = {
        active:true,
        pickupTime: c.pickupTime!=null ? toHM(c.pickupTime) : "",
        stayStart:  work ? toHM(work.start) : "",
        stayEnd:    work ? toHM(work.end)   : "",
      };
    });
  });
  return d;
})();

// ─── スタイル定数 ────────────────────────────────────────────
const ST0  = {position:"absolute",top:0,left:0,pointerEvents:"none"};
const ST1  = {position:"relative",flexShrink:0};
const ST2  = {display:"block",cursor:"crosshair"};
const ST3  = {position:"absolute",top:4,left:4,background:"rgba(2,6,20,0.92)",border:"1px solid #1e293b",borderRadius:6,padding:"3px 7px",display:"flex",gap:6,alignItems:"center",pointerEvents:"none",zIndex:10,fontSize:10,fontWeight:700};
const ST4  = {color:"#fbbf24"};
const ST5  = {color:"#06b6d4"};
const ST6  = {color:"#10b981"};
const ST7  = {color:"#ef4444"};
const ST8  = {display:"block",cursor:"crosshair",flexShrink:0};
const ST9  = {cursor:"grab"};
const ST10 = {cursor:"ns-resize"};
const ST11 = {cursor:"ns-resize"};
const ST12 = {cursor:"pointer",opacity:0.7};
const ST13 = {userSelect:"none",pointerEvents:"none"};
const ST14 = {opacity:0,transition:"opacity 0.15s"};
const ST15 = {pointerEvents:"none"};
const ST16 = {cursor:"ns-resize"};
const ST17 = {cursor:"ns-resize"};
const ST18 = {cursor:"grab"};
const ST19 = {pointerEvents:"none"};
const ST20 = {pointerEvents:"none"};
const ST21 = {cursor:"ns-resize"};
const ST22 = {cursor:"ns-resize"};
const ST23 = {userSelect:"none",pointerEvents:"none"};
const ST24 = {cursor:"ns-resize"};
const ST25 = {cursor:"ns-resize"};
const ST26 = {cursor:"grab"};
const ST27 = {pointerEvents:"none"};
const ST28 = {pointerEvents:"none"};
const ST29 = {cursor:"ns-resize"};
const ST30 = {cursor:"ns-resize"};
const ST31 = {userSelect:"none",pointerEvents:"none"};
const ST32 = {pointerEvents:"none"};
const ST33 = {display:"block",cursor:"crosshair",flexShrink:0};
const ST34 = {cursor:"grab"};
const ST35 = {cursor:"ns-resize"};
const ST36 = {cursor:"ns-resize"};
const ST37 = {userSelect:"none",pointerEvents:"none"};
const ST38 = {opacity:0,transition:"opacity 0.15s"};
const ST39 = {pointerEvents:"none"};
const ST40 = {cursor:"ns-resize"};
const ST41 = {pointerEvents:"none",userSelect:"none"};
const ST42 = {pointerEvents:"none",userSelect:"none"};
const ST43 = {pointerEvents:"none"};
const ST44 = {position:"absolute",top:0,left:0,pointerEvents:"none",zIndex:5};
const ST45 = {display:"block",pointerEvents:"none"};
const ST46 = {pointerEvents:"none",userSelect:"none"};
const ST47 = {display:"flex",flexDirection:"column",alignItems:"stretch",flexShrink:0,borderRight:"1px solid #334155"};
const ST48 = {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 6px",background:"#0a1628",borderBottom:"1px solid #1e293b",height:32,boxSizing:"border-box",flexShrink:0};
const ST49 = {fontSize:11,fontWeight:800,color:"#94a3b8"};
const ST50 = {fontSize:9,fontWeight:800,padding:"2px 6px",borderRadius:4,border:"none",cursor:"pointer",background:"#1e293b",color:"#64748b"};
const ST51 = {display:"block",cursor:"crosshair",overflow:"visible",opacity:1};
const ST52 = {cursor:"grab"};
const ST53 = {cursor:"ns-resize"};
const ST54 = {cursor:"ns-resize"};
const ST55 = {userSelect:"none",pointerEvents:"none"};
const ST56 = {pointerEvents:"none"};
const ST57 = {pointerEvents:"none"};
const ST58 = {cursor:"ns-resize"};
const ST59 = {cursor:"ns-resize"};
const ST60 = {cursor:"grab"};
const ST61 = {pointerEvents:"none"};
const ST62 = {pointerEvents:"none"};
const ST63 = {pointerEvents:"none",userSelect:"none"};
const ST64 = {pointerEvents:"none",userSelect:"none"};
const ST65 = {userSelect:"none",pointerEvents:"none"};
const ST66 = {cursor:"ns-resize"};
const ST67 = {pointerEvents:"none",userSelect:"none"};
const ST68 = {pointerEvents:"none",userSelect:"none"};
const ST69 = {pointerEvents:"none"};
const ST70 = {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,gap:8,flexWrap:"wrap"};
const ST71 = {display:"flex",gap:5};
const ST72 = {display:"flex",gap:5};
const ST73 = {display:"flex",flexWrap:"wrap",gap:6,marginBottom:16,padding:"10px",background:"#0a1628",borderRadius:8,border:"1px solid #1e293b"};
const ST74 = {display:"flex",alignItems:"center",gap:3};
const ST75 = {display:"flex",alignItems:"center",gap:6,background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"4px 9px",fontSize:11,fontWeight:700,color:"#94a3b8",cursor:"pointer"};
const ST76 = {display:"inline-block",width:7,height:7,borderRadius:"50%",background:"currentColor",flexShrink:0};
const ST77 = {background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#334155",padding:"2px 4px",transition:"color 0.15s"};
const ST78 = {overflowX:"auto",overflowY:"visible",borderRadius:8,border:"1px solid #1e293b"};
const ST79 = {display:"flex",alignItems:"flex-start",minWidth:"max-content"};
const ST80 = {flexShrink:0,display:"flex",flexDirection:"column"};
const ST81 = {height:32,boxSizing:"border-box",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#334155",fontWeight:600,background:"#0a1628",borderBottom:"1px solid #1e293b",paddingLeft:6};
const ST82 = {display:"flex",flexDirection:"column"};
const ST83 = {height:36,boxSizing:"border-box",display:"flex",alignItems:"flex-start",paddingTop:2,fontSize:10,color:"#334155",paddingLeft:4,borderTop:"1px solid #0f172a"};
const ST84 = {fontSize:9.5,color:"#334155",marginTop:6,textAlign:"center"};
const ST85 = {color:"#60a5fa"};

// グローバルに1回だけ挿入
function GlobalDefs() {
  return (
    <svg width={0} height={0} style={ST0}>
      <defs>
        {ROUTE_COLORS.map((col,i)=>(
          <pattern key={i} id={"tr"+(i+1)} width="8" height="8"
            patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="transparent"/>
            <line x1="0" y1="4" x2="8" y2="4" stroke={col} strokeWidth="3.5" strokeOpacity="0.9"/>
          </pattern>
        ))}
        {[0,1].map(i=>(
          <pattern key={i} id={"br"+(i+1)} width="7" height="7" patternUnits="userSpaceOnUse">
            <rect width="7" height="7" fill="transparent"/>
            <circle cx="3.5" cy="3.5" r="1.5" fill={i===0?"#94a3b8":"#e2e8f0"}/>
          </pattern>
        ))}
        <pattern id="ghost_tr" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="transparent"/>
          <line x1="0" y1="4" x2="8" y2="4" stroke="rgba(255,255,255,0.45)" strokeWidth="3.5"/>
        </pattern>
        <pattern id="ghost_br" width="7" height="7" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill="transparent"/>
          <circle cx="3.5" cy="3.5" r="1.5" fill="rgba(255,255,255,0.45)"/>
        </pattern>
      </defs>
    </svg>
  );
}

// ─── 時間 → Y座標変換 ────────────────────────────────────────
let tY = t => (t - H_START) * CH;              // 時間 → px（CH動的更新）
const Yt  = y => sv(clamp(y / CH + H_START, H_START, H_END)); // px → スナップ時間

// ─── 人員チェック（横帯グラフ） ─────────────────────────────
function StaffingBar({ staff, children, hoverT, onHover, colW }) {
  const {hStart:H_START,hEnd:H_END,hTotal:H_TOTAL,ch:CH,totalH:TOTAL_H} = useG();
  const tY = t => (t - H_START) * CH;
  const slots = useMemo(()=>{
    const s=[];
    for(let t=H_START;t<H_END;t+=0.25){
      const mid=t+0.125;
      const ci=children.filter(c=>c.segments.some(g=>g.type==="work"&&g.start<=mid&&g.end>mid)).length;
      const si=staff.filter(p=>p.segments.some(g=>g.type==="work"&&g.start<=mid&&g.end>mid)).length;
      const req=ci>0?Math.max(2,Math.ceil(ci/5)):0;
      s.push({t,ci,si,req,ok:si>=req});
    }
    return s;
  },[staff,children]);
  const maxC=Math.max(...slots.map(s=>s.ci),1);
  const BW=colW; // バーの最大幅

  return (
    <div style={ST1}>
      <svg width={BW} height={TOTAL_H} style={ST2}
        onMouseMove={e=>{
          const y=e.clientY-e.currentTarget.getBoundingClientRect().top;
          onHover(clamp(y/CH+H_START,H_START,H_END));
        }}
        onMouseLeave={()=>onHover(null)}>
        {slots.map((sl,i)=>{
          const y=tY(sl.t), sh=CH*0.25-0.5;
          const cW=(sl.ci/maxC)*BW*0.82, sW=(sl.si/8)*BW*0.82;
          return (
            <g key={i}>
              {!sl.ok&&sl.ci>0&&<rect x={0} y={y} width={BW} height={sh} fill="#ef4444" opacity={0.08}/>}
              <rect x={0}    y={y}        width={cW} height={sh*0.47} fill="#06b6d4" opacity={0.6} rx={1}/>
              <rect x={0}    y={y+sh*0.53} width={sW} height={sh*0.47} fill={sl.ok?"#10b981":"#ef4444"} opacity={0.85} rx={1}/>
            </g>
          );
        })}
        {hoverT!=null&&(
          <line x1={0} y1={tY(hoverT)} x2={BW} y2={tY(hoverT)} stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="3,2"/>
        )}
        <line x1={BW} y1={0} x2={BW} y2={TOTAL_H} stroke="#1e293b" strokeWidth={1}/>
      </svg>
      
      {hoverT!=null&&(()=>{
        const sl=slots.find(s=>s.t<=hoverT&&s.t+0.25>hoverT);
        if(!sl)return null;
        return (
          <div style={ST3}>
            <span style={ST4}>⏱{toHM(hoverT)}</span>
            <span style={ST5}>児{sl.ci}</span>
            <span style={ST6}>職{sl.si}</span>
            {sl.ci>0&&!sl.ok&&<span style={ST7}>⚠要{sl.req}人</span>}
          </div>
        );
      })()}
    </div>
  );
}

// ─── 職員セグメント（縦バー）────────────────────────────────
function StaffCol({ person, colW, onUpdate, onDelete, onAdd, hoverT }) {
  const {hStart:H_START,hEnd:H_END,hTotal:H_TOTAL,ch:CH,totalH:TOTAL_H} = useG();
  const tY = t => (t - H_START) * CH;
  const color = (STAFF_TYPES[person.stype]&&STAFF_TYPES[person.stype].color) || "#3b82f6";
  const BX = 4, BW = colW - 8; // バーのx・幅
  const dragRef = useRef(null);
  const [ghost, setGhost] = useState(null);
  const svgRef = useRef(null);

  const getT = useCallback(clientY => {
    const rect = svgRef.current&&svgRef.current.getBoundingClientRect();
    if (!rect) return H_START;
    return Yt(clientY - rect.top);
  }, []);

  // 既存セグメントのドラッグ（clientYを直接受け取る）
  const startSegDrag = (e, seg, mode, overrideY) => {
    e.stopPropagation(); e.preventDefault();
    const startClientY = overrideY || e.clientY;
    const t0 = getT(startClientY);
    dragRef.current = { mode, t0, s0: seg.start, e0: seg.end, seg };
    const dur = seg.end - seg.start;
    const mm = ev => {
      if (!dragRef.current) return;
      const dt = getT(ev.clientY) - dragRef.current.t0;
      const { mode, s0, e0, seg } = dragRef.current;
      if (mode === "move") {
        const ns = sv(clamp(s0+dt, H_START, H_END-dur));
        onUpdate({...seg, start:ns, end:ns+dur});
      } else if (mode === "top") {
        const ns = sv(clamp(s0+dt, H_START, e0-MIN_DUR));
        onUpdate({...seg, start:ns});
      } else {
        const ne = sv(clamp(e0+dt, s0+MIN_DUR, H_END));
        onUpdate({...seg, end:ne});
      }
    };
    const mu = () => { dragRef.current=null; window.removeEventListener("mousemove",mm); window.removeEventListener("mouseup",mu); };
    window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu);
  };

  // 空白ドラッグで新セグ追加（Ctrl/Shift/Alt押下時はバー上からも呼ばれる）
  const handleSvgDown = e => {
    const isTransfer = e.shiftKey, isBreak = e.ctrlKey || e.metaKey;
    const onBackground = e.target === svgRef.current || e.target.tagName === "line";
    if (!onBackground && !isTransfer && !isBreak) return;
    if (!isTransfer && !isBreak && !onBackground) return;
    const segType = isTransfer ? "transfer" : isBreak ? "break" : "work";
    const t0 = getT(e.clientY);
    let moved = false;
    setGhost({ start:t0, end:Math.min(t0+1,H_END), segType });

    const mm = ev => {
      moved = true;
      const t1 = getT(ev.clientY);
      setGhost({ start:Math.min(t0,t1), end:Math.max(t0,t1), segType });
    };
    const mu = ev => {
      window.removeEventListener("mousemove",mm); window.removeEventListener("mouseup",mu);
      if (!moved) {
        setGhost(null);
        if (!isTransfer && !isBreak) {
          const end = Math.min(t0+1, H_END);
          if (!person.segments.some(s=>s.type==="work"&&t0<s.end&&end>s.start))
            onAdd(mkSeg(t0, end, "work"));
        } else if (isBreak) {
          // Ctrl+クリック → クリック位置を起点に1時間の休憩を即追加
          const end = Math.min(t0+1, H_END);
          onAdd(mkSeg(t0, end, "break", 1));
        }
        // Shift+クリック（送迎）はドラッグで範囲指定を促す
        return;
      }
      setGhost(null);
      const t1 = getT(ev.clientY);
      const start = sv(Math.min(t0,t1)), end = sv(Math.max(t0,t1));
      if (end - start < MIN_DUR) return;
      // work同士のみ重複禁止。送迎・休憩は在所の上に重ねてOK
      if (!isTransfer && !isBreak && person.segments.some(s=>s.type==="work"&&start<s.end&&end>s.start)) return;
      onAdd(mkSeg(start, end, segType, isTransfer||isBreak?1:null));
    };
    window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu);
  };

  const works    = person.segments.filter(s=>s.type==="work");
  const transfers = person.segments.filter(s=>s.type==="transfer");
  const breaks   = person.segments.filter(s=>s.type==="break");

  const workLabels = works.map(seg=>({
    y: tY(seg.start) + Math.max((seg.end-seg.start)*CH-2,4) + 4,
    label: toHM(seg.start)+"〜"+toHM(seg.end),
    color: color,
  }));

  return (
    <div style={{position:"relative",width:colW,flexShrink:0}}>
    <svg ref={svgRef} width={colW} height={TOTAL_H}
      style={ST8}
      onMouseDown={handleSvgDown}>
      
      {Array.from({length:H_TOTAL+1},(_,i)=>(
        <line key={i} x1={0} y1={i*CH} x2={colW} y2={i*CH} stroke="#1e293b" strokeWidth={i%2===0?1:0.4}/>
      ))}
      <line x1={colW-1} y1={0} x2={colW-1} y2={TOTAL_H} stroke="#334155" strokeWidth={1}/>
      
      {Array.from({length:H_TOTAL*2},(_,i)=>(
        i%2!==0&&<line key={"h"+i} x1={0} y1={i*CH/2} x2={colW} y2={i*CH/2} stroke="#131c2e" strokeWidth={0.5}/>
      ))}
      
      {hoverT!=null&&<line x1={0} y1={tY(hoverT)} x2={colW} y2={tY(hoverT)} stroke="#fbbf24" strokeWidth={1} opacity={0.3}/>}

      
      {works.map(seg=>{
        const y=tY(seg.start), h=Math.max((seg.end-seg.start)*CH-2,4);
        return (
          <g key={seg.id}>
            <rect x={BX} y={y+1} width={BW} height={h} rx={4} fill={color} opacity={0.82}
              style={ST9}
              onMouseDown={e=>{
                if(e.shiftKey||e.ctrlKey||e.metaKey){ handleSvgDown(e); return; }
                startSegDrag(e,seg,"move");
              }}/>
            
            <rect x={BX} y={y+1} width={BW} height={7} rx={3} fill="rgba(255,255,255,0.2)"
              style={ST10} onMouseDown={e=>startSegDrag(e,seg,"top")}/>
            
            <rect x={BX} y={y+h-6} width={BW} height={7} rx={3} fill="rgba(255,255,255,0.2)"
              style={ST11} onMouseDown={e=>startSegDrag(e,seg,"bottom")}/>
            
            <g style={ST12} onMouseDown={e=>e.stopPropagation()} onClick={()=>onDelete(seg.id)}>
              <circle cx={BX+BW-5} cy={y+8} r={6} fill="#0a0f1a" opacity={0.85}/>
              <text x={BX+BW-5} y={y+12} textAnchor="middle" fontSize={9} fill="#64748b" style={ST13}>×</text>
            </g>
            
            {(()=>{
              const labelY = y + h + 3;
              const label = toHM(seg.start)+"〜"+toHM(seg.end);
              const labelW = 66, labelH = 14;
              const lx = BX + BW/2 - labelW/2;
              return (
                <g style={ST14}>
                  <rect x={lx} y={labelY} width={labelW} height={labelH} rx={3}
                    fill={color} opacity={0.45}/>
                  <text x={BX+BW/2} y={labelY+10} textAnchor="middle" fontSize={9.5}
                    fill="rgba(255,255,255,0.95)" fontWeight="700"
                    style={ST15}>{label}</text>
                </g>
              );
            })()}
          </g>
        );
      })}

      
      {transfers.map(seg=>{
        const y=tY(seg.start), h=Math.max((seg.end-seg.start)*CH-2,4);
        const num=seg.num||1, col=rc(num);
        return (
          <g key={seg.id}>
            
            <rect x={BX} y={y+1} width={BW} height={8} rx={3} fill="rgba(255,255,255,0.15)"
              style={ST16}
              onMouseDown={e=>{e.stopPropagation();startSegDrag(e,seg,"top");}}/>
            
            <rect x={BX} y={y+h-7} width={BW} height={8} rx={3} fill="rgba(255,255,255,0.15)"
              style={ST17}
              onMouseDown={e=>{e.stopPropagation();startSegDrag(e,seg,"bottom");}}/>
            
            <rect x={BX} y={y+9} width={BW} height={Math.max(h-16,2)} rx={2}
              fill="transparent" style={ST18}
              onMouseDown={e=>{
                e.stopPropagation();
                const startY=e.clientY;
                let dragging=false;
                const mmCheck=ev=>{
                  if(!dragging&&Math.abs(ev.clientY-startY)>4){
                    dragging=true;
                    window.removeEventListener("mousemove",mmCheck);
                    startSegDrag(e,seg,"move",ev.clientY);
                  }
                };
                const muCheck=ev=>{
                  window.removeEventListener("mousemove",mmCheck);
                  window.removeEventListener("mouseup",muCheck);
                  if(!dragging) onUpdate({...seg,num:(num%8)+1});
                };
                window.addEventListener("mousemove",mmCheck);
                window.addEventListener("mouseup",muCheck);
              }}/>
            
            <rect x={BX} y={y+1} width={BW} height={h} rx={4} fill={"url(#tr"+num+")"} opacity={0.88} style={ST19}/>
            <rect x={BX} y={y+1} width={BW} height={h} rx={4} fill="none" stroke={col} strokeWidth={2} opacity={0.9} style={ST20}/>
            
            <text x={BX+BW/2} y={y+h/2} textAnchor="middle" fontSize={10} fontWeight="900" fill="white"
              style={ST21}
            >送{ROUTE_NUMS[num-1]}</text>
            {h>28&&<text x={BX+BW/2} y={y+h/2+13} textAnchor="middle" fontSize={9.5} fontWeight="700" fill="rgba(255,255,255,0.93)"
              style={ST22}
            >{toHM(seg.start)}〜{toHM(seg.end)}</text>}
            
            <g onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(seg.id);}}>
              <circle cx={BX+BW-5} cy={y+8} r={6} fill="#0a0f1a" opacity={0.85}/>
              <text x={BX+BW-5} y={y+12} textAnchor="middle" fontSize={9} fill="#64748b" style={ST23}>×</text>
            </g>
          </g>
        );
      })}

      
      {breaks.map(seg=>{
        const y=tY(seg.start), h=Math.max((seg.end-seg.start)*CH-2,4);
        const num=seg.num||1;
        return (
          <g key={seg.id}>
            
            <rect x={BX} y={y+1} width={BW} height={8} rx={3} fill="rgba(255,255,255,0.15)"
              style={ST24}
              onMouseDown={e=>{e.stopPropagation();startSegDrag(e,seg,"top");}}/>
            
            <rect x={BX} y={y+h-7} width={BW} height={8} rx={3} fill="rgba(255,255,255,0.15)"
              style={ST25}
              onMouseDown={e=>{e.stopPropagation();startSegDrag(e,seg,"bottom");}}/>
            
            <rect x={BX} y={y+9} width={BW} height={Math.max(h-16,2)} rx={2}
              fill="transparent" style={ST26}
              onMouseDown={e=>{
                e.stopPropagation();
                const startY=e.clientY;
                let dragging=false;
                const mmCheck=ev=>{
                  if(!dragging&&Math.abs(ev.clientY-startY)>4){
                    dragging=true;
                    window.removeEventListener("mousemove",mmCheck);
                    startSegDrag(e,seg,"move",ev.clientY);
                  }
                };
                const muCheck=ev=>{
                  window.removeEventListener("mousemove",mmCheck);
                  window.removeEventListener("mouseup",muCheck);
                  if(!dragging) onUpdate({...seg,num:(num%2)+1});
                };
                window.addEventListener("mousemove",mmCheck);
                window.addEventListener("mouseup",muCheck);
              }}/>
            
            <rect x={BX} y={y+1} width={BW} height={h} rx={4} fill={"url(#br"+num+")"} opacity={0.92} style={ST27}/>
            <rect x={BX} y={y+1} width={BW} height={h} rx={4} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4,2" opacity={0.7} style={ST28}/>
            
            <text x={BX+BW/2} y={y+h/2} textAnchor="middle" fontSize={10} fontWeight="900" fill="white"
              style={ST29}
            >休{BREAK_NUMS[num-1]}</text>
            {h>28&&<text x={BX+BW/2} y={y+h/2+13} textAnchor="middle" fontSize={9.5} fontWeight="700" fill="rgba(255,255,255,0.93)"
              style={ST30}
            >{toHM(seg.start)}〜{toHM(seg.end)}</text>}
            
            <g onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(seg.id);}}>
              <circle cx={BX+BW-5} cy={y+8} r={6} fill="#0a0f1a" opacity={0.85}/>
              <text x={BX+BW-5} y={y+12} textAnchor="middle" fontSize={9} fill="#64748b" style={ST31}>×</text>
            </g>
          </g>
        );
      })}

      
      {ghost&&(()=>{
        const gy=tY(ghost.start), gh=Math.max((ghost.end-ghost.start)*CH-2,4);
        const gc=ghost.segType==="transfer"?rc(1):ghost.segType==="break"?"#94a3b8":"#10b981";
        const gp=ghost.segType==="transfer"?"ghost_tr":ghost.segType==="break"?"ghost_br":null;
        return (
          <g style={ST32}>
            <rect x={BX} y={gy+1} width={BW} height={gh} rx={4} fill={gc} opacity={0.25}/>
            {gp&&<rect x={BX} y={gy+1} width={BW} height={gh} rx={4} fill={"url(#"+gp+")"} opacity={0.6}/>}
            <rect x={BX} y={gy+1} width={BW} height={gh} rx={4} fill="none" stroke={gc} strokeWidth={1.5} strokeDasharray="4,2" opacity={0.9}/>
          </g>
        );
      })()}
    </svg>
    {workLabels.map((lb,i)=>(
      <div key={i} style={{position:"absolute",top:lb.y,left:0,width:colW,
        display:"flex",justifyContent:"center",pointerEvents:"none",zIndex:10}}>
        <div style={{background:lb.color,borderRadius:3,padding:"1px 5px",
          fontSize:9,fontWeight:700,color:"#fff",whiteSpace:"nowrap",opacity:0.9}}>
          {lb.label}
        </div>
      </div>
    ))}
    </div>
  );
}

// ─── 児童セグメント（縦バー）────────────────────────────────
function ChildCol({ person, colW, onUpdate, onDelete, onAdd, onPickupChange, hoverT, schoolGroups: SG }) {
  const {hStart:H_START,hEnd:H_END,hTotal:H_TOTAL,ch:CH,totalH:TOTAL_H} = useG();
  const tY = t => (t - H_START) * CH;
  const SG2 = SG || SCHOOL_GROUPS;
  const color = (SG2[person.school]&&SG2[person.school].color) || "#64748b";
  const BX = 3, BW = colW - 6;
  const dragRef = useRef(null);
  const [ghost, setGhost] = useState(null);
  const svgRef = useRef(null);

  const getT = useCallback(clientY => {
    const rect = svgRef.current&&svgRef.current.getBoundingClientRect();
    if (!rect) return H_START;
    return Yt(clientY - rect.top);
  }, []);

  const startSegDrag = (e, seg, mode) => {
    e.stopPropagation(); e.preventDefault();
    const t0 = getT(e.clientY), dur = seg.end - seg.start;
    dragRef.current = { mode, t0, s0:seg.start, e0:seg.end, seg };
    const mm = ev => {
      if (!dragRef.current) return;
      const dt = getT(ev.clientY) - dragRef.current.t0;
      const { mode, s0, e0, seg } = dragRef.current;
      if (mode==="move") { const ns=sv(clamp(s0+dt,H_START,H_END-dur)); onUpdate({...seg,start:ns,end:ns+dur}); }
      else if (mode==="top") { onUpdate({...seg,start:sv(clamp(s0+dt,H_START,e0-MIN_DUR))}); }
      else { onUpdate({...seg,end:sv(clamp(e0+dt,s0+MIN_DUR,H_END))}); }
    };
    const mu = () => { dragRef.current=null; window.removeEventListener("mousemove",mm); window.removeEventListener("mouseup",mu); };
    window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu);
  };

  const handleSvgDown = e => {
    if (e.target !== svgRef.current && e.target.tagName !== "line") return;
    e.preventDefault();
    if(e.altKey){
      // Alt+クリック: お迎え時刻ピン設定
      onPickupChange(getT(e.clientY));
      return;
    }
    const t0 = getT(e.clientY); let moved = false;
    setGhost({start:t0, end:Math.min(t0+1,H_END)});
    const mm = ev => { moved=true; const t1=getT(ev.clientY); setGhost({start:Math.min(t0,t1),end:Math.max(t0,t1)}); };
    const mu = ev => {
      window.removeEventListener("mousemove",mm); window.removeEventListener("mouseup",mu);
      setGhost(null);
      if (!moved) {
        const end=Math.min(t0+1,H_END);
        if(!person.segments.some(s=>t0<s.end&&end>s.start)) onAdd(mkSeg(t0,end,"work"));
        return;
      }
      const t1=getT(ev.clientY), start=sv(Math.min(t0,t1)), end=sv(Math.max(t0,t1));
      if(end-start<MIN_DUR)return;
      if(!person.segments.some(s=>start<s.end&&end>s.start)) onAdd(mkSeg(start,end,"work"));
    };
    window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu);
  };

  // お迎えピンのドラッグ
  const startPinDrag = e => {
    e.stopPropagation(); e.preventDefault();
    const mm = ev => onPickupChange(getT(ev.clientY));
    const mu = () => { window.removeEventListener("mousemove",mm); window.removeEventListener("mouseup",mu); };
    window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu);
  };

  const pinY = person.pickupTime != null ? tY(person.pickupTime) : null;

  const workLabels = person.segments.filter(s=>s.type==="work").map(seg=>({
    y: tY(seg.start) + Math.max((seg.end-seg.start)*CH-2,4) + 4,
    label: toHM(seg.start)+"〜"+toHM(seg.end),
    color: color,
  }));

  return (
    <div style={{position:"relative",width:colW,flexShrink:0}}>
    <svg ref={svgRef} width={colW} height={TOTAL_H}
      style={ST33}
      onMouseDown={handleSvgDown}>
      {Array.from({length:H_TOTAL+1},(_,i)=>(
        <line key={i} x1={0} y1={i*CH} x2={colW} y2={i*CH} stroke="#1e293b" strokeWidth={i%2===0?0.8:0.3}/>
      ))}
      <line x1={colW-1} y1={0} x2={colW-1} y2={TOTAL_H} stroke="#1e3a5f" strokeWidth={1}/>
      {hoverT!=null&&<line x1={0} y1={tY(hoverT)} x2={colW} y2={tY(hoverT)} stroke="#fbbf24" strokeWidth={1} opacity={0.3}/>}

      
      {person.segments.map(seg=>{
        const y=tY(seg.start), h=Math.max((seg.end-seg.start)*CH-2,4);
        return (
          <g key={seg.id}>
            <rect x={BX} y={y+1} width={BW} height={h} rx={3} fill={color} opacity={0.75}
              style={ST34} onMouseDown={e=>startSegDrag(e,seg,"move")}/>
            <rect x={BX} y={y+1} width={BW} height={6} rx={2} fill="rgba(255,255,255,0.18)"
              style={ST35} onMouseDown={e=>startSegDrag(e,seg,"top")}/>
            <rect x={BX} y={y+h-5} width={BW} height={6} rx={2} fill="rgba(255,255,255,0.18)"
              style={ST36} onMouseDown={e=>startSegDrag(e,seg,"bottom")}/>
            <g onMouseDown={e=>e.stopPropagation()} onClick={()=>onDelete(seg.id)}>
              <circle cx={BX+BW-4} cy={y+7} r={5} fill="#0a0f1a" opacity={0.85}/>
              <text x={BX+BW-4} y={y+11} textAnchor="middle" fontSize={8} fill="#64748b" style={ST37}>×</text>
            </g>
            
            {(()=>{
              const labelY = y + h + 3;
              const label = toHM(seg.start)+"〜"+toHM(seg.end);
              const labelW = 62, labelH = 14;
              const lx = BX + BW/2 - labelW/2;
              return (
                <g style={ST38}>
                  <rect x={lx} y={labelY} width={labelW} height={labelH} rx={3}
                    fill={color} opacity={0.4}/>
                  <text x={BX+BW/2} y={labelY+10} textAnchor="middle" fontSize={9}
                    fill="rgba(255,255,255,0.95)" fontWeight="700"
                    style={ST39}>{label}</text>
                </g>
              );
            })()}
          </g>
        );
      })}

      
      {pinY!=null&&(
        <g style={ST40}
          onMouseDown={startPinDrag}
          onDoubleClick={e=>{e.stopPropagation();onPickupChange(null);}}>
          <line x1={0} y1={pinY} x2={colW} y2={pinY} stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="3,2"/>
          <rect x={0} y={pinY-18} width={colW} height={22} fill="transparent"/>
          <text x={BX+1} y={pinY-14} fontSize={11} fill="#fbbf24" style={ST41}>📌</text>
          <text x={BX+14} y={pinY-5} fontSize={10} fill="#fbbf24" fontWeight="800" style={ST42}>{toHM(person.pickupTime)}</text>
          {/* 削除ボタン */}
          <circle cx={colW-7} cy={pinY-9} r={6} fill="#0a0f1a" opacity={0.9}/>
          <text x={colW-7} y={pinY-5} textAnchor="middle" fontSize={9} fill="#ef4444" style={{cursor:"pointer",userSelect:"none"}}>×</text>
        </g>
      )}

      
      {ghost&&(()=>{
        const gy=tY(ghost.start), gh=Math.max((ghost.end-ghost.start)*CH-2,4);
        return (
          <g style={ST43}>
            <rect x={BX} y={gy+1} width={BW} height={gh} rx={3} fill={color} opacity={0.25}/>
            <rect x={BX} y={gy+1} width={BW} height={gh} rx={3} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="4,2" opacity={0.8}/>
          </g>
        );
      })()}
    </svg>
    {workLabels.map((lb,i)=>(
      <div key={i} style={{position:"absolute",top:lb.y,left:0,width:colW,
        display:"flex",justifyContent:"center",pointerEvents:"none",zIndex:10}}>
        <div style={{background:lb.color,borderRadius:3,padding:"1px 5px",
          fontSize:9,fontWeight:700,color:"#fff",whiteSpace:"nowrap",opacity:0.9}}>
          {lb.label}
        </div>
      </div>
    ))}
    </div>
  );
}

// ─── ルート横帯オーバーレイ（職員列をまたぐ）───────────────
// 同じルート番号の職員列を、送迎時間帯の範囲でルート色の破線ボックスで囲む
// colMeta: [{ id, x, w }]  職員の表示順・列X・列幅
function RouteOverlay({ staff, colMeta }) {
  const {hStart:H_START,hEnd:H_END,hTotal:H_TOTAL,ch:CH,totalH:TOTAL_H} = useG();
  const tY = t => (t - H_START) * CH;
  // ルートごとに時間帯union
  const routeSpans = useMemo(()=>{
    const map = {};
    staff.forEach(p=>{
      p.segments.filter(s=>s.type==="transfer").forEach(s=>{
        const n=s.num||1;
        if(!map[n])map[n]=[];
        let merged=false;
        map[n]=map[n].map(sp=>{
          if(s.start<=sp.end+0.01&&s.end>=sp.start-0.01){merged=true;return{start:Math.min(sp.start,s.start),end:Math.max(sp.end,s.end)};}
          return sp;
        });
        if(!merged)map[n].push({start:s.start,end:s.end});
      });
    });
    return map;
  },[staff]);

  // ルートに参加している列のX範囲
  const getRouteCols = num => {
    const cols=[];
    staff.forEach(p=>{
      if(!p.segments.some(s=>s.type==="transfer"&&(s.num||1)===num))return;
      const cm=colMeta.find(c=>c.id===p.id);
      if(cm)cols.push(cm);
    });
    return cols;
  };

  const totalW = colMeta.reduce((s,c)=>Math.max(s,c.x+c.w),0);
  if(!totalW)return null;

  return (
    <div style={ST44}>
      <svg width={totalW} height={TOTAL_H} style={ST45}>
        {Object.keys(routeSpans).map((ns)=>{ var spans=routeSpans[ns];
          const num=Number(ns), col=rc(num), cols=getRouteCols(num);
          if(!cols.length)return null;
          const xL=Math.min(...cols.map(c=>c.x));
          const xR=Math.max(...cols.map(c=>c.x+c.w));
          return spans.map((sp,si)=>{
            const y1=tY(sp.start)+2, y2=tY(sp.end)-2, bh=y2-y1;
            if(bh<2)return null;
            return (
              <g key={num+"-"+si}>
                <rect x={xL} y={y1} width={xR-xL} height={bh} fill={col} opacity={0.07} rx={3}/>
                <rect x={xL} y={y1} width={xR-xL} height={bh} fill="none" stroke={col} strokeWidth={2} strokeDasharray="5,3" opacity={0.82} rx={3}/>
                
                <rect x={xL+2} y={y1-8} width={20} height={15} fill={col} rx={3} opacity={0.95}/>
                <text x={xL+12} y={y1+4} textAnchor="middle" fontSize={9.5} fontWeight="900" fill="white" style={ST46}>{ROUTE_NUMS[num-1]}</text>
              </g>
            );
          });
        })}
      </svg>
    </div>
  );
}

// ─── デフォルト管理画面（ガントチャート形式）────────────────
// 曜日を横軸、時間を縦軸にした週間ビュー
// DH = 1時間の高さ（デフォルト画面用、日々管理より小さめ）
const DH = 36;
let D_TOTAL = H_TOTAL * DH;
const D_TW = 38; // 時間軸幅
const D_CW = 72; // 1曜日の幅

function DefaultDayCol({ day, dayLabel, dayColor, person, isStaff, defDay, onDefChange, colW, onCopyDragStart }) {
  const {hStart:H_START,hEnd:H_END,hTotal:H_TOTAL,ch:CH,totalH:TOTAL_H} = useG();
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [ghost, setGhost] = useState(null);
  const color = isStaff
    ? ((STAFF_TYPES[person.stype]&&STAFF_TYPES[person.stype].color) || "#3b82f6")
    : ((SCHOOL_GROUPS[person.school]&&SCHOOL_GROUPS[person.school].color) || "#64748b"); // グローバルは都度更新済
  const BX=3, BW=colW-6;

  const getT = clientY => {
    const rect = svgRef.current&&svgRef.current.getBoundingClientRect();
    if(!rect) return H_START;
    return sv(clamp((clientY-rect.top)/DH+H_START, H_START, H_END));
  };

  // 在所セグメント
  const workSeg = (() => {
    if(isStaff) {
      const ws=frHM(defDay&&defDay.workStart), we=frHM(defDay&&defDay.workEnd);
      return ws!=null&&we!=null ? {id:"work",start:ws,end:we,type:"work"} : null;
    } else {
      const ss=frHM(defDay&&defDay.stayStart), se=frHM(defDay&&defDay.stayEnd);
      return ss!=null&&se!=null ? {id:"work",start:ss,end:se,type:"work"} : null;
    }
  })();

  // 休憩セグメント（defDay.breaks = [{id,start,end}]）
  const breaks = (defDay&&defDay.breaks) ? defDay.breaks : [];

  const pickupT = !isStaff ? frHM(defDay&&defDay.pickupTime) : null;

  // 在所バーのドラッグ
  const startWorkDrag = (e, seg, dragMode) => {
    e.stopPropagation(); e.preventDefault();
    const t0=getT(e.clientY), dur=seg.end-seg.start;
    dragRef.current={mode:dragMode,t0,s0:seg.start,e0:seg.end};
    let copyMode = false;
    const mm=ev=>{
      if(!dragRef.current)return;
      if(dragMode==="move" && (ev.ctrlKey||ev.metaKey) && onCopyDragStart && !copyMode){
        copyMode=true;
        dragRef.current=null;
        window.removeEventListener("mousemove",mm);
        window.removeEventListener("mouseup",mu);
        onCopyDragStart(ev, {type:"work", seg});
        return;
      }
      const dt=getT(ev.clientY)-dragRef.current.t0;
      const{mode,s0,e0}=dragRef.current;
      if(mode==="move"){
        const ns=sv(clamp(s0+dt,H_START,H_END-dur));
        isStaff ? onDefChange({...defDay,workStart:toHM(ns),workEnd:toHM(ns+dur)})
                : onDefChange({...defDay,stayStart:toHM(ns),stayEnd:toHM(ns+dur)});
      } else if(mode==="top"){
        const ns=sv(clamp(s0+dt,H_START,e0-MIN_DUR));
        isStaff ? onDefChange({...defDay,workStart:toHM(ns)}) : onDefChange({...defDay,stayStart:toHM(ns)});
      } else {
        const ne=sv(clamp(e0+dt,s0+MIN_DUR,H_END));
        isStaff ? onDefChange({...defDay,workEnd:toHM(ne)}) : onDefChange({...defDay,stayEnd:toHM(ne)});
      }
    };
    const mu=()=>{dragRef.current=null;window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);};
    window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu);
  };

  // 休憩バーのドラッグ
  const startBreakDrag = (e, brk, dragMode, overrideY) => {
    e.stopPropagation(); e.preventDefault();
    const startY = overrideY || e.clientY;
    const t0=getT(startY), dur=brk.end-brk.start;
    dragRef.current={mode:dragMode,t0,s0:brk.start,e0:brk.end};
    let copyMode = false;
    const upd = patch => onDefChange({...defDay, breaks: breaks.map(b=>b.id===brk.id?{...b,...patch}:b)});
    const mm=ev=>{
      if(!dragRef.current)return;
      if(dragMode==="move" && (ev.ctrlKey||ev.metaKey) && onCopyDragStart && !copyMode){
        copyMode=true;
        dragRef.current=null;
        window.removeEventListener("mousemove",mm);
        window.removeEventListener("mouseup",mu);
        onCopyDragStart(ev, {type:"break", brk});
        return;
      }
      const dt=getT(ev.clientY)-dragRef.current.t0;
      const{mode,s0,e0}=dragRef.current;
      if(mode==="move") upd({start:sv(clamp(s0+dt,H_START,H_END-dur)),end:sv(clamp(s0+dt+dur,H_START+dur,H_END))});
      else if(mode==="top") upd({start:sv(clamp(s0+dt,H_START,e0-MIN_DUR))});
      else upd({end:sv(clamp(e0+dt,s0+MIN_DUR,H_END))});
    };
    const mu=()=>{dragRef.current=null;window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);};
    window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu);
  };

  // ピンのドラッグ
  const startPinDrag = e => {
    e.stopPropagation(); e.preventDefault();
    const mm=ev=>onDefChange({...defDay,pickupTime:toHM(getT(ev.clientY))});
    const mu=()=>{window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);};
    window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu);
  };

  // 空白クリック・ドラッグ
  const handleDown = e => {
    const isBreak = e.altKey && isStaff;
    const isPin   = e.altKey && !isStaff;
    if(e.target!==svgRef.current&&e.target.tagName!=="line"&&!isBreak&&!isPin)return;
    e.preventDefault();
    if(isPin){
      const t = getT(e.clientY);
      onDefChange({...defDay, pickupTime:toHM(t)});
      return;
    }
    const t0=getT(e.clientY); let moved=false;
    setGhost({start:t0, end:Math.min(t0+1,H_END), isBreak});

    const mm=ev=>{
      moved=true;
      const t1=getT(ev.clientY);
      setGhost({start:Math.min(t0,t1),end:Math.max(t0,t1),isBreak});
    };
    const mu=ev=>{
      window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);
      setGhost(null);
      const t1=getT(ev.clientY);
      const start=sv(Math.min(t0,moved?t1:t0));
      const end=sv(Math.max(t0,moved?t1:Math.min(t0+1,H_END)));
      if(end-start<MIN_DUR)return;
      if(isBreak) {
        // 休憩追加（職員のみ・isBreak=altKey&&isStaffで既に保証）
        onDefChange({...defDay, active:true, breaks:[...breaks, {id:uid(),start,end}]});
      } else {
        // 在所追加
        isStaff ? onDefChange({...defDay,active:true,workStart:toHM(start),workEnd:toHM(end)})
                : onDefChange({...defDay,active:true,stayStart:toHM(start),stayEnd:toHM(end)});
      }
    };
    window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu);
  };

  const tDY = t => (t-H_START)*DH;
  const active = true;
  const pinY = pickupT!=null ? tDY(pickupT) : null;

  return (
    <div style={ST47}>
      
      <div style={ST48}>
        <div style={ST49}>{dayLabel}</div>
      </div>
      
      <svg ref={svgRef} width={colW} height={D_TOTAL}
        style={ST51}
        onMouseDown={active?handleDown:undefined}>
        {Array.from({length:H_TOTAL+1},(_,i)=>(
          <line key={i} x1={0} y1={i*DH} x2={colW} y2={i*DH}
            stroke="#1e293b" strokeWidth={i%2===0?0.8:0.3}/>
        ))}
        <line x1={colW-1} y1={0} x2={colW-1} y2={D_TOTAL} stroke="#334155" strokeWidth={1}/>

        
        {workSeg&&(()=>{
          const seg=workSeg;
          const y=tDY(seg.start), h=Math.max((seg.end-seg.start)*DH-1,4);
          return (
            <g key="work">
              <rect x={BX} y={y+1} width={BW} height={h} rx={3} fill={color} opacity={0.8}
                style={ST52} onMouseDown={e=>{ if(e.altKey){ handleDown(e); return; } startWorkDrag(e,seg,"move"); }}/>
              <rect x={BX} y={y+1} width={BW} height={6} rx={2} fill="rgba(255,255,255,0.2)"
                style={ST53} onMouseDown={e=>startWorkDrag(e,seg,"top")}/>
              <rect x={BX} y={y+h-5} width={BW} height={6} rx={2} fill="rgba(255,255,255,0.2)"
                style={ST54} onMouseDown={e=>startWorkDrag(e,seg,"bottom")}/>
              <g onMouseDown={e=>e.stopPropagation()} onClick={()=>
                isStaff ? onDefChange({...defDay,workStart:"",workEnd:""})
                        : onDefChange({...defDay,stayStart:"",stayEnd:""})}>
                <circle cx={BX+BW-4} cy={y+7} r={5} fill="#0a0f1a" opacity={0.85}/>
                <text x={BX+BW-4} y={y+11} textAnchor="middle" fontSize={8} fill="#64748b" style={ST55}>×</text>
              </g>
              {(()=>{
                const lY=y+h+3, lbl=toHM(seg.start)+"〜"+toHM(seg.end);
                return (
                  <g style={ST56}>
                    <rect x={BX+BW/2-30} y={lY} width={60} height={13} rx={2} fill={color} opacity={0.4}/>
                    <text x={BX+BW/2} y={lY+9} textAnchor="middle" fontSize={8.5} fontWeight="700"
                      fill="rgba(255,255,255,0.95)" style={ST57}>{lbl}</text>
                  </g>
                );
              })()}
            </g>
          );
        })()}

        
        {breaks.map(brk=>{
          const y=tDY(brk.start), h=Math.max((brk.end-brk.start)*DH-1,4);
          return (
            <g key={brk.id}>
              
              <rect x={BX} y={y+1} width={BW} height={7} rx={2} fill="rgba(255,255,255,0.15)"
                style={ST58} onMouseDown={e=>{e.stopPropagation();startBreakDrag(e,brk,"top");}}/>
              
              <rect x={BX} y={y+h-6} width={BW} height={7} rx={2} fill="rgba(255,255,255,0.15)"
                style={ST59} onMouseDown={e=>{e.stopPropagation();startBreakDrag(e,brk,"bottom");}}/>
              
              <rect x={BX} y={y+8} width={BW} height={Math.max(h-14,2)} rx={2}
                fill="transparent" style={ST60}
                onMouseDown={e=>{
                  e.stopPropagation();
                  const sy=e.clientY; let dragging=false;
                  const mc=ev=>{if(!dragging&&Math.abs(ev.clientY-sy)>4){dragging=true;window.removeEventListener("mousemove",mc);startBreakDrag(e,brk,"move",ev.clientY);}};
                  const mu=()=>{window.removeEventListener("mousemove",mc);window.removeEventListener("mouseup",mu);};
                  window.addEventListener("mousemove",mc); window.addEventListener("mouseup",mu);
                }}/>
              <rect x={BX} y={y+1} width={BW} height={h} rx={3} fill={"url(#br1)"} opacity={0.9} style={ST61}/>
              <rect x={BX} y={y+1} width={BW} height={h} rx={3} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4,2" opacity={0.7} style={ST62}/>
              
              <text x={BX+BW/2} y={y+h/2} textAnchor="middle" fontSize={9} fontWeight="900" fill="white"
                style={ST63}>休</text>
              {h>22&&<text x={BX+BW/2} y={y+h/2+11} textAnchor="middle" fontSize={8} fontWeight="700" fill="rgba(255,255,255,0.9)"
                style={ST64}>{toHM(brk.start)}〜{toHM(brk.end)}</text>}
              
              <g onMouseDown={e=>e.stopPropagation()}
                onClick={()=>onDefChange({...defDay,breaks:breaks.filter(b=>b.id!==brk.id)})}>
                <circle cx={BX+BW-4} cy={y+7} r={5} fill="#0a0f1a" opacity={0.85}/>
                <text x={BX+BW-4} y={y+11} textAnchor="middle" fontSize={8} fill="#64748b" style={ST65}>×</text>
              </g>
            </g>
          );
        })}

        
        {pinY!=null&&(
          <g style={ST66}
            onMouseDown={startPinDrag}
            onDoubleClick={e=>{e.stopPropagation();onDefChange({...defDay,pickupTime:""});}}>
            <line x1={0} y1={pinY} x2={colW} y2={pinY} stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="3,2"/>
            <rect x={0} y={pinY-14} width={colW} height={18} fill="transparent"/>
            <text x={BX+1} y={pinY-8} fontSize={9} fill="#fbbf24" style={ST67}>📌</text>
            <text x={BX+12} y={pinY-1} fontSize={7.5} fill="#fbbf24" fontWeight="800" style={ST68}>{toHM(pickupT)}</text>
            <circle cx={colW-6} cy={pinY-7} r={5} fill="#0a0f1a" opacity={0.9}/>
            <text x={colW-6} y={pinY-3} textAnchor="middle" fontSize={8} fill="#ef4444" style={{cursor:"pointer",userSelect:"none"}}>×</text>
          </g>
        )}
        
        {ghost&&(
          <g style={ST69}>
            <rect x={BX} y={tDY(ghost.start)+1} width={BW} height={Math.max((ghost.end-ghost.start)*DH-2,4)}
              rx={3} fill={ghost.isBreak?"#94a3b8":color} opacity={0.25}/>
            <rect x={BX} y={tDY(ghost.start)+1} width={BW} height={Math.max((ghost.end-ghost.start)*DH-2,4)}
              rx={3} fill="none" stroke={ghost.isBreak?"#94a3b8":color} strokeWidth={1.5} strokeDasharray="4,2" opacity={0.8}/>
          </g>
        )}
      </svg>
    </div>
  );
}


const COLOR_PRESETS = ["#3b82f6","#10b981","#f59e0b","#a855f7","#ef4444","#06b6d4","#ec4899","#f97316","#84cc16","#64748b","#8b5cf6","#14b8a6"];

function CategoriesScreen({ staffTypes, setStaffTypes, schoolGroups, setSchoolGroups }) {
  const [mode, setMode] = useState("staff");
  const types = mode==="staff" ? staffTypes : schoolGroups;
  const setTypes = mode==="staff" ? setStaffTypes : setSchoolGroups;
  const [editKey, setEditKey] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [err, setErr] = useState("");

  const startEdit = (k) => { setEditKey(k); setEditLabel(types[k].label); setEditColor(types[k].color); setErr(""); };
  const saveEdit = () => {
    if(!editLabel.trim()){setErr("ラベルを入力してください");return;}
    setTypes({...types, [editKey]:{...types[editKey], label:editLabel.trim(), color:editColor}});
    setEditKey(null);
  };
  const addNew = () => {
    const k = newKey.trim();
    if(!k){setErr("キーを入力してください");return;}
    if(types[k]){setErr("そのキーは既に存在します");return;}
    if(!newLabel.trim()){setErr("ラベルを入力してください");return;}
    setTypes({...types, [k]:{label:newLabel.trim(), color:newColor}});
    setNewKey(""); setNewLabel(""); setNewColor("#3b82f6"); setErr("");
  };
  const del = (k) => {
    const next = {...types}; delete next[k]; setTypes(next);
  };

  return (
    <div style={{maxWidth:520}}>
      <div style={{display:"flex",gap:6,marginBottom:18}}>
        {[{k:"staff",lbl:"職員区分"},{k:"child",lbl:"児童区分"}].map(item=>(
          <button key={item.k} onClick={()=>{setMode(item.k);setEditKey(null);setErr("");}}
            style={BS(mode===item.k?"#2563eb":"#1e293b",mode===item.k?"#fff":"#64748b")}>{item.lbl}</button>
        ))}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
        {Object.keys(types).map(k=>{
          const v=types[k];
          return (
            <div key={k} style={{display:"flex",alignItems:"center",gap:8,background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"8px 12px"}}>
              <div style={{width:12,height:12,borderRadius:"50%",background:v.color,flexShrink:0}}/>
              {editKey===k ? (
                <>
                  <input value={editLabel} onChange={e=>setEditLabel(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter")saveEdit();if(e.key==="Escape")setEditKey(null);}}
                    style={{...IS,width:120,padding:"3px 8px"}} autoFocus/>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                    {COLOR_PRESETS.map(c=>(
                      <div key={c} onClick={()=>setEditColor(c)}
                        style={{width:16,height:16,borderRadius:"50%",background:c,cursor:"pointer",border:editColor===c?"2px solid #fff":"2px solid transparent"}}/>
                    ))}
                  </div>
                  <button onClick={saveEdit} style={{...BS("#2563eb","#fff"),padding:"3px 10px",fontSize:10}}>✓</button>
                  <button onClick={()=>setEditKey(null)} style={{...BS("#1e293b","#64748b"),padding:"3px 10px",fontSize:10}}>✕</button>
                </>
              ) : (
                <>
                  <span style={{fontSize:11,color:"#94a3b8",minWidth:60}}>{k}</span>
                  <span style={{fontSize:12,fontWeight:700,color:v.color,flex:1}}>{v.label}</span>
                  <button onClick={()=>startEdit(k)} style={{...BS("#1e293b","#60a5fa"),padding:"3px 10px",fontSize:10}}>編集</button>
                  <button onClick={()=>del(k)}
                    style={{...BS("#1e293b","#334155"),padding:"3px 10px",fontSize:10}}
                    onMouseEnter={e=>{e.currentTarget.style.color="#ef4444";}}
                    onMouseLeave={e=>{e.currentTarget.style.color="#334155";}}>🗑</button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div style={{background:"#070d18",border:"1px solid #1e3a5f",borderRadius:10,padding:"14px 16px"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#60a5fa",marginBottom:10}}>＋ 新しい区分を追加</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
          <FF label="キー（英数字）">
            <input value={newKey} onChange={e=>setNewKey(e.target.value.replace(/[^a-zA-Z0-9_]/g,""))}
              style={{...IS,width:100}} placeholder="例: contract"/>
          </FF>
          <FF label="表示名">
            <input value={newLabel} onChange={e=>setNewLabel(e.target.value)}
              style={{...IS,width:120}} placeholder="例: 契約社員"/>
          </FF>
          <FF label="色">
            <div style={{display:"flex",gap:3,flexWrap:"wrap",maxWidth:160}}>
              {COLOR_PRESETS.map(c=>(
                <div key={c} onClick={()=>setNewColor(c)}
                  style={{width:18,height:18,borderRadius:"50%",background:c,cursor:"pointer",border:newColor===c?"2px solid #fff":"2px solid transparent"}}/>
              ))}
            </div>
          </FF>
          <button onClick={addNew} style={{...BS("#2563eb","#fff"),marginBottom:10}}>追加</button>
        </div>
        {err&&<div style={{color:"#ef4444",fontSize:11,marginTop:4}}>{err}</div>}
      </div>
      <p style={{fontSize:10,color:"#475569",marginTop:10}}>
        ※ キーは変更できません。既存の職員・児童に割り当てられた区分キーを削除しても、その人のデータには残ります。
      </p>
    </div>
  );
}

function DefaultsScreen({ staff, children, master, defaults, setDefaults, onExport, onImportClick, onAddStaff, onAddChild, onDelMaster, onRename, onCopy }) {
  const [mode, setMode] = useState("staff");
  const [selId, setSelId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [editingSubtype, setEditingSubtype] = useState("");
  const persons = mode==="staff" ? staff : children;
  const sel = persons.length>0 ? (persons.find(p=>p.id===selId) || persons[0]) : null;
  const selIdEff = sel ? sel.id : null;

  const getDay = day => (defaults[selIdEff]&&defaults[selIdEff][day]) || {active:false};
  const setDay = (day,patch) => setDefaults(prev=>({
    ...prev,[selIdEff]:{...(prev[selIdEff]||{}),[day]:{...getDay(day),...patch}}
  }));

  const timeLabels = Array.from({length:H_TOTAL+1},(_,i)=>H_START+i);
  const chartRef = useRef(null);
  const [copyGhost, setCopyGhost] = useState(null); // {dayIdx, type, seg/brk, srcDay}

  const onCopyDragStart = (e, payload, srcDay) => {
    e.stopPropagation(); e.preventDefault();
    const getDayIdx = clientX => {
      if(!chartRef.current) return -1;
      const rect = chartRef.current.getBoundingClientRect();
      const x = clientX - rect.left - D_TW; // 時間軸ラベル列分を引く
      const idx = Math.floor(x / D_CW);
      return Math.max(0, Math.min(6, idx));
    };
    let curIdx = getDayIdx(e.clientX);
    setCopyGhost({dayIdx:curIdx, ...payload, srcDay});
    const mm = ev => {
      const idx = getDayIdx(ev.clientX);
      if(idx !== curIdx){ curIdx = idx; setCopyGhost(g=>g?{...g,dayIdx:idx}:null); }
    };
    const mu = ev => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      const idx = getDayIdx(ev.clientX);
      const destDay = DAYS_EN[idx];
      if(destDay && destDay !== srcDay) {
        const destDef = getDay(destDay);
        if(payload.type==="work") {
          const {seg} = payload;
          mode==="staff"
            ? setDay(destDay, {...destDef, workStart:toHM(seg.start), workEnd:toHM(seg.end)})
            : setDay(destDay, {...destDef, stayStart:toHM(seg.start), stayEnd:toHM(seg.end)});
        } else {
          const {brk} = payload;
          const destBreaks = (destDef.breaks||[]);
          setDay(destDay, {...destDef, breaks:[...destBreaks, {id:uid(), start:brk.start, end:brk.end}]});
        }
      }
      setCopyGhost(null);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  };

  return (
    <div>
      
      <div style={ST70}>
        <div style={ST71}>
          {[{k:"staff",lbl:"職員"},{k:"child",lbl:"児童・生徒"}].map((item)=>(
            <button key={item.k} onClick={()=>{setMode(item.k);setSelId(null);}}
              style={BS(mode===item.k?"#2563eb":"#1e293b",mode===item.k?"#fff":"#64748b")}>{item.lbl}</button>
          ))}
        </div>
        <div style={ST72}>
          <button onClick={mode==="staff"?onAddStaff:onAddChild}
            style={mode==="staff"?BS("#0c2a4a","#60a5fa"):BS("#062a18","#34d399")}>
            ＋ {mode==="staff"?"職員":"児童"}を登録
          </button>
          <button onClick={onExport} style={BS("#1e293b","#94a3b8")}>⬇ CSV</button>
          <button onClick={onImportClick} style={BS("#1e293b","#94a3b8")}>⬆ CSV取込</button>
        </div>
      </div>

      
      <div style={ST73}>
        {persons.map(p=>{
          const c=mode==="staff"?((STAFF_TYPES[p.stype]&&STAFF_TYPES[p.stype].color)||"#888"):((SCHOOL_GROUPS[p.school]&&SCHOOL_GROUPS[p.school].color)||"#888");
          const act=p.id===selIdEff;
          return (
            <div key={p.id} style={ST74}>
              {editingId===p.id ? (
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <input autoFocus value={editingName}
                    onChange={e=>setEditingName(e.target.value)}
                    onKeyDown={e=>{
                      if(e.key==="Enter"){onRename(p.id,mode==="staff"?"staff":"child",editingName,editingSubtype);setEditingId(null);}
                      if(e.key==="Escape"){setEditingId(null);}
                    }}
                    style={{background:"#0f172a",border:"1px solid "+c,borderRadius:6,padding:"4px 8px",fontSize:11,fontWeight:700,color:c,width:90}}/>
                  <select value={editingSubtype} onChange={e=>setEditingSubtype(e.target.value)}
                    style={{background:"#0f172a",border:"1px solid #334155",borderRadius:6,padding:"4px 6px",fontSize:10,color:"#94a3b8",cursor:"pointer"}}>
                    {mode==="staff"
                      ? Object.keys(STAFF_TYPES).map(k=><option key={k} value={k}>{STAFF_TYPES[k].label}</option>)
                      : Object.keys(SCHOOL_GROUPS).map(k=><option key={k} value={k}>{SCHOOL_GROUPS[k].label}</option>)
                    }
                  </select>
                  <button onClick={()=>{onRename(p.id,mode==="staff"?"staff":"child",editingName,editingSubtype);setEditingId(null);}}
                    style={{...BS("#2563eb","#fff"),padding:"3px 8px",fontSize:10}}>✓</button>
                  <button onClick={()=>setEditingId(null)}
                    style={{...BS("#1e293b","#64748b"),padding:"3px 8px",fontSize:10}}>✕</button>
                </div>
              ) : (
                <button onClick={()=>setSelId(p.id)} onDoubleClick={()=>{setEditingId(p.id);setEditingName(p.name);setEditingSubtype(mode==="staff"?p.stype:p.school);}}
                  style={{display:"flex",alignItems:"center",gap:6,
                    background:act?"#1e3a5f":"#0f172a",
                    border:"1px solid "+(act?c:"#1e293b"),
                    borderRadius:6,padding:"4px 9px",fontSize:11,fontWeight:700,
                    color:act?c:"#94a3b8",cursor:"pointer",
                    boxShadow:act?"0 0 0 2px "+c+"44":"none"}}>
                  <span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:c,flexShrink:0}}/>
                  {p.name}
                </button>
              )}
              <button onClick={()=>onDelMaster(p.id, mode==="staff"?"staff":"child")}
                style={ST77}
                onMouseEnter={e=>{e.currentTarget.style.color="#ef4444";}}
                onMouseLeave={e=>{e.currentTarget.style.color="#334155";}}>🗑</button>
            </div>
          );
        })}
      </div>

      
      {sel&&(
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
          <button onClick={()=>onCopy(sel.id, mode==="staff"?"staff":"child")}
            style={{...BS("#1e293b","#94a3b8"),border:"1px solid #334155",fontSize:11}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#60a5fa";e.currentTarget.style.color="#60a5fa";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#334155";e.currentTarget.style.color="#94a3b8";}}>
            📋 この{mode==="staff"?"職員":"児童"}をコピー
          </button>
        </div>
      )}
      {sel&&(
        <div style={ST78}>
          <div style={{...ST79, position:"relative"}} ref={chartRef}>
            {copyGhost&&(
              <div style={{position:"absolute",top:0,left:D_TW+copyGhost.dayIdx*D_CW,width:D_CW,height:"100%",
                background:"rgba(96,165,250,0.12)",border:"2px solid #60a5fa",borderRadius:4,
                pointerEvents:"none",zIndex:20,boxSizing:"border-box"}}/>
            )}
            <div style={ST80}>
              <div style={ST81}>時間</div>
              <div style={ST82}>
                {timeLabels.map(h=>(
                  <div key={h} style={ST83}>{h}:00</div>
                ))}
              </div>
            </div>
            
            {DAYS_EN.map((day,di)=>{
              const dc=di===0?"#ef4444":di===6?"#3b82f6":"#94a3b8";
              return (
                <DefaultDayCol key={day}
                  day={day} dayLabel={DAYS_JP[di]} dayColor={dc}
                  person={sel} isStaff={mode==="staff"}
                  defDay={getDay(day)}
                  onDefChange={patch=>setDay(day,patch)}
                  colW={D_CW}
                  onCopyDragStart={(e,payload)=>onCopyDragStart(e,payload,day)}/>
              );
            })}
          </div>
        </div>
      )}
      {sel&&(
        <p style={ST84}>
          ドラッグで在所時間を追加 ／ <span style={ST85}>Alt+クリックで休憩(職員) or お迎えピン(児童)追加</span> ／ バー端で時間調整 ／ バー中央で移動 ／ 📌ドラッグでお迎え時刻変更
        </p>
      )}
    </div>
  );
}

// ─── CSV ────────────────────────────────────────────────────
function buildScheduleCSV(staff,children,date) {
  const hdr=["種別","名前","分類","開始","終了","タイプ","番号"];
  const rows=[
    ...staff.flatMap(p=>p.segments.map(s=>["職員",p.name,(STAFF_TYPES[p.stype]&&STAFF_TYPES[p.stype].label)||p.stype,toHM(s.start),toHM(s.end),s.type==="work"?"在所":s.type==="transfer"?"送迎":"休憩",s.num||""])),
    ...children.flatMap(p=>[
      ...(p.pickupTime!=null?[["児童",p.name,(SCHOOL_GROUPS[p.school]&&SCHOOL_GROUPS[p.school].label)||p.school,toHM(p.pickupTime),toHM(p.pickupTime),"お迎え",""]]:[] ),
      ...p.segments.map(s=>["児童",p.name,(SCHOOL_GROUPS[p.school]&&SCHOOL_GROUPS[p.school].label)||p.school,toHM(s.start),toHM(s.end),"在所",""])
    ])
  ];
  return [hdr,...rows].map(r=>r.map(c=>'"'+c+'"').join(",")).join("\n");
}
function buildDefaultCSV(defaults,staff,children) {
  const hdr=["種別","名前","曜日","有効","お迎え/出勤","在所開始/退勤","在所終了"];
  const rows=[
    ...children.flatMap(c=>DAYS_EN.map((d,di)=>{const v=(defaults[c.id]&&defaults[c.id][d])||{};return["児童",c.name,DAYS_JP[di],v.active?"○":"×",v.pickupTime||"",v.stayStart||"",v.stayEnd||""];})),
    ...staff.flatMap(s=>DAYS_EN.map((d,di)=>{const v=(defaults[s.id]&&defaults[s.id][d])||{};return["職員",s.name,DAYS_JP[di],v.active?"○":"×",v.workStart||"",v.workEnd||"",""];})),
  ];
  return [hdr,...rows].map(r=>r.map(c=>'"'+c+'"').join(",")).join("\n");
}
function dlCSV(content,fn){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+content],{type:"text/csv;charset=utf-8"}));a.download=fn;a.click();}

// ─── メインアプリ ────────────────────────────────────────────
function AppInner() {
  const todayStr = new Date().toISOString().slice(0,10);
  const hdrScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const [hStart, setHStart] = useState(8);
  const [hEnd,   setHEnd]   = useState(19);
  const [winH,   setWinH]   = useState(window.innerHeight);
  useEffect(()=>{
    const onResize = () => setWinH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 表示は設定範囲±1時間、グローバル変数を更新
  const gHStart = hStart - 1;
  const gHEnd   = hEnd   + 1;
  const gHTotal = gHEnd - gHStart;
  const gCH     = Math.min(64, Math.max(24, Math.floor((winH - HDR_H - 160) / gHTotal)));
  const gTotalH = gHTotal * gCH;
  // グローバル変数も更新（tY等のグローバル関数のため）
  H_START = gHStart; H_END = gHEnd; H_TOTAL = gHTotal; CH = gCH; TOTAL_H = gTotalH;
  D_TOTAL = gHTotal * DH;
  const tY = t => (t - gHStart) * gCH; // AppInner内ローカルtY
  const gCtx = {hStart:gHStart, hEnd:gHEnd, hTotal:gHTotal, ch:gCH, totalH:gTotalH};

  // マスターデータ（全メンバー登録簿）
  // ── ストア初期化（1回のloadSで全データを整合させる）──
  const [_initStore] = useState(()=>{
    const s = loadS();
    let dirty = false;
    if (!s.master) {
      s.master = {staff:deepc(INIT_MASTER_STAFF), children:deepc(INIT_MASTER_CHILDREN)};
      dirty = true;
    }
    if (!s.defaults || Object.keys(s.defaults).length===0) {
      s.defaults = deepc(INIT_DEFAULTS);
      dirty = true;
    }
    if (!s.dates) s.dates = {};
    if (!s.dates[todayStr]) {
      // デフォルトを適用して当日データを生成
      const dow = DAYS_EN[new Date(todayStr).getDay()];
      s.dates[todayStr] = {
        staff: s.master.staff.map(m=>{
          const def=s.defaults[m.id]&&s.defaults[m.id][dow];
          if(!def||!def.active) return mkDayStaff(m);
          const ws=frHM(def.workStart), we=frHM(def.workEnd);
          const segs=ws!=null&&we!=null?[mkSeg(ws,we,"work")]:[];
          const brkSegs=(def.breaks||[]).map(b=>mkSeg(b.start,b.end,"break",1));
          return {...m, segments:[...segs,...brkSegs]};
        }),
        children: s.master.children.map(m=>{
          const def=s.defaults[m.id]&&s.defaults[m.id][dow];
          if(!def||!def.active) return mkDayChild(m);
          const pt=frHM(def.pickupTime), ss=frHM(def.stayStart), se=frHM(def.stayEnd);
          return {...m, segments: ss!=null&&se!=null?[mkSeg(ss,se,"work")]:[], pickupTime:pt||null};
        }),
      };
      dirty = true;
    }
    if (dirty) saveS(s);
    return s;
  });

  const [staffTypes, setStaffTypesRaw] = useState(()=>{ const v=loadS().staffTypes||DEFAULT_STAFF_TYPES; STAFF_TYPES=v; return v; });
  const setStaffTypes = next => { setStaffTypesRaw(next); STAFF_TYPES=next; const s=loadS(); s.staffTypes=next; saveS(s); };
  const [schoolGroups, setSchoolGroupsRaw] = useState(()=>{ const v=loadS().schoolGroups||DEFAULT_SCHOOL_GROUPS; SCHOOL_GROUPS=v; return v; });
  const setSchoolGroups = next => { setSchoolGroupsRaw(next); SCHOOL_GROUPS=next; const s=loadS(); s.schoolGroups=next; saveS(s); };
  const [master, setMasterRaw] = useState(()=>loadS().master);
  const setMaster = useCallback(fn=>{
    setMasterRaw(prev=>{
      const next=typeof fn==="function"?fn(prev):fn;
      const s=loadS(); s.master=next; saveS(s); return next;
    });
  },[]);

  const [dates, setDates] = useState(()=>loadS().dates||{});
  const [defaults, setDefaultsRaw] = useState(()=>loadS().defaults||{});
  const [date, setDate]     = useState(todayStr);
  const [screen, setScreen] = useState("daily");
  const [tab, setTab]       = useState("all");
  const [compact, setCompact] = useState(false);
  const [hoverT, setHoverT] = useState(null);
  const [modal, setModal]   = useState(null);
  const [newMember, setNewMember] = useState({name:"",stype:"fulltime",school:"elementary",kind:"staff",copyFromId:""});
  const [dragOver, setDragOver] = useState(null); // {id, isStaff}
  const [importTxt, setImportTxt] = useState("");
  const [importErr, setImportErr] = useState("");
  const [toast, setToastMsg]      = useState(null);
  const toastTimer = useRef(null);

  const data = dates[date] || {staff:master.staff.map(mkDayStaff),children:master.children.map(mkDayChild)};
  const { staff, children } = data;
  const savedDays = Object.keys(dates).length;
  const showPerfWarn = savedDays >= PERF_WARN_DAYS;

  const persistDates = useCallback(nd=>{setDates(nd);const s=loadS();s.dates=nd;saveS(s);},[]);
  const persistData  = useCallback(nd=>persistDates({...dates,[date]:nd}),[dates,date,persistDates]);
  const setDefaults  = useCallback(fn=>{
    setDefaultsRaw(prev=>{const next=typeof fn==="function"?fn(prev):fn;const s=loadS();s.defaults=next;saveS(s);return next;});
  },[]);
  const setToast = msg=>{setToastMsg(msg);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToastMsg(null),2600);};

  // セグメント操作
  const updSeg=(pid,seg,isSt)=>{const list=isSt?[...staff]:[...children];const i=list.findIndex(p=>p.id===pid);list[i]={...list[i],segments:list[i].segments.map(s=>s.id===seg.id?seg:s)};persistData(isSt?{...data,staff:list}:{...data,children:list});};
  const delSeg=(pid,sid,isSt)=>{const list=isSt?[...staff]:[...children];const i=list.findIndex(p=>p.id===pid);list[i]={...list[i],segments:list[i].segments.filter(s=>s.id!==sid)};persistData(isSt?{...data,staff:list}:{...data,children:list});};
  const addSeg=(pid,seg,isSt)=>{const list=isSt?[...staff]:[...children];const i=list.findIndex(p=>p.id===pid);list[i]={...list[i],segments:[...list[i].segments,seg]};persistData(isSt?{...data,staff:list}:{...data,children:list});};
  const changePickup=(pid,t)=>{const list=[...children];const i=list.findIndex(p=>p.id===pid);list[i]={...list[i],pickupTime:t};persistData({...data,children:list});};

  // 人物追加・削除
  // マスターから当日に追加（デフォルト時間を適用）
  const addFromMaster = (masterId, kind) => {
    const dow = DAYS_EN[new Date(date).getDay()];
    if (kind==="staff") {
      if (staff.length>=15) { setToast("職員は最大15名です"); return; }
      const m = master.staff.find(s=>s.id===masterId); if(!m) return;
      const def = (defaults[m.id]&&defaults[m.id][dow]);
      const ws = frHM(def&&def.workStart), we = frHM(def&&def.workEnd);
      const segs = ws!=null&&we!=null ? [mkSeg(ws,we,"work")] : [];
      const brkSegs = (def&&def.breaks||[]).map(b=>mkSeg(b.start,b.end,"break",1));
      persistData({...data, staff:[...staff, {...m, segments:[...segs,...brkSegs]}]});
    } else {
      if (children.length>=30) { setToast("児童は最大30名です"); return; }
      const m = master.children.find(c=>c.id===masterId); if(!m) return;
      const def = (defaults[m.id]&&defaults[m.id][dow]);
      const pt = frHM(def&&def.pickupTime), ss = frHM(def&&def.stayStart), se = frHM(def&&def.stayEnd);
      const segs = ss!=null&&se!=null ? [mkSeg(ss,se,"work")] : [];
      persistData({...data, children:[...children, {...m, segments:segs, pickupTime:pt||null}]});
    }
    setModal(null);
  };

  // 新規メンバーをマスターに登録（→ 当日にも追加）
  const registerNewMember = () => {
    if (!newMember.name.trim()) return;
    const id = uid();
    if (newMember.kind==="staff") {
      const m = {id, name:newMember.name.trim(), stype:newMember.stype};
      setMaster(prev=>({...prev, staff:[...prev.staff, m]}));
    } else {
      const m = {id, name:newMember.name.trim(), school:newMember.school};
      setMaster(prev=>({...prev, children:[...prev.children, m]}));
    }
    if (newMember.copyFromId && defaults[newMember.copyFromId]) {
      setDefaults(prev=>({...prev, [id]: deepc(defaults[newMember.copyFromId])}));
    }
    setModal(null);
    setNewMember({name:"",stype:"fulltime",school:"elementary",kind:"staff",copyFromId:""});
  };

  // 当日からのみ削除（マスターは残す）
  const delPerson = pid => {
    if (staff.some(s=>s.id===pid)) persistData({...data, staff:staff.filter(s=>s.id!==pid)});
    else persistData({...data, children:children.filter(c=>c.id!==pid)});
  };

  // 人の順番入れ替え
  const reorderPerson = (id, isStaff, toIdx) => {
    if (isStaff) {
      const arr=[...staff], fromIdx=arr.findIndex(s=>s.id===id);
      if(fromIdx<0||fromIdx===toIdx)return;
      const item=arr.splice(fromIdx,1)[0]; arr.splice(toIdx,0,item);
      persistData({...data,staff:arr});
    } else {
      const arr=[...children], fromIdx=arr.findIndex(c=>c.id===id);
      if(fromIdx<0||fromIdx===toIdx)return;
      const item=arr.splice(fromIdx,1)[0]; arr.splice(toIdx,0,item);
      persistData({...data,children:arr});
    }
  };

  // マスターから完全削除
  const delFromMaster = (id, kind) => {
    if (kind==="staff") setMaster(prev=>({...prev, staff:prev.staff.filter(s=>s.id!==id)}));
    else setMaster(prev=>({...prev, children:prev.children.filter(c=>c.id!==id)}));
  };

  const renameMaster = (id, kind, newName, subtype) => {
    if (!newName.trim()) return;
    if (kind==="staff") setMaster(prev=>({...prev, staff:prev.staff.map(s=>s.id===id?{...s,name:newName.trim(),...(subtype?{stype:subtype}:{})}:s)}));
    else setMaster(prev=>({...prev, children:prev.children.map(c=>c.id===id?{...c,name:newName.trim(),...(subtype?{school:subtype}:{})}:c)}));
  };

  const copyMaster = (id, kind) => {
    const list = kind==="staff" ? master.staff : master.children;
    const src = list.find(p=>p.id===id); if(!src) return;
    const baseName = src.name.replace(/\(\d+\)$/, "").trim();
    const existing = list.map(p=>p.name);
    let n=1; while(existing.includes(baseName+"("+n+")")) n++;
    const newId = uid();
    const newName = baseName+"("+n+")";
    if (kind==="staff") {
      const m = {id:newId, name:newName, stype:src.stype};
      setMaster(prev=>({...prev, staff:[...prev.staff, m]}));
    } else {
      const m = {id:newId, name:newName, school:src.school};
      setMaster(prev=>({...prev, children:[...prev.children, m]}));
    }
    if (defaults[id]) setDefaults(prev=>({...prev, [newId]: deepc(defaults[id])}));
  };

  // 日付切替（マスターベース）
  const switchDate = d => {
    if (!dates[d]) {
      const dow = DAYS_EN[new Date(d).getDay()];
      const base = {
        staff: master.staff.map(m => {
          const def = (defaults[m.id]&&defaults[m.id][dow]); if(!def&&def.active) return mkDayStaff(m);
          const ws=frHM(def.workStart), we=frHM(def.workEnd);
          const segs = ws!=null&&we!=null?[mkSeg(ws,we,"work")]:[];
          const brkSegs = (def.breaks||[]).map(b=>mkSeg(b.start,b.end,"break",1));
          return {...m, segments:[...segs,...brkSegs]};
        }),
        children: master.children.map(m => {
          const def = (defaults[m.id]&&defaults[m.id][dow]); if(!def&&def.active) return mkDayChild(m);
          const pt=frHM(def.pickupTime), ss=frHM(def.stayStart), se=frHM(def.stayEnd);
          return {...m, segments: ss!=null&&se!=null?[mkSeg(ss,se,"work")]:[], pickupTime:pt||null};
        }),
      };
      persistDates({...dates,[d]:base});
    }
    setDate(d);
  };

  const copyFromPrev=()=>{
    const p=new Date(date);p.setDate(p.getDate()-1);const pd=p.toISOString().slice(0,10);
    if(!dates[pd])return;
    const cp=deepc(dates[pd]);[...cp.staff,...cp.children].forEach(e=>e.segments.forEach(g=>{g.id=uid();}));
    persistDates({...dates,[date]:cp});setToast("前日のデータをコピーしました");
  };

  // 学校グループ別
  const groupedChildren = useMemo(()=>{
    const g={};children.forEach(c=>{if(!g[c.school])g[c.school]=[];g[c.school].push(c);});return g;
  },[children, schoolGroups]);

  const dateObj = new Date(date);
  const dayColor = dateObj.getDay()===0?"#ef4444":dateObj.getDay()===6?"#3b82f6":"#64748b";

  // 表示する列の構築（tab に応じて職員/児童を出し分け）
  const showStaff = tab==="all"||tab==="staff";
  const showChild = tab==="all"||tab==="child";

  // 列幅（コンパクトモード対応）
  const cwS = compact ? CW_STAFF_SM : CW_STAFF;
  const cwC = compact ? CW_CHILD_SM : CW_CHILD;

  // 職員列のX座標メタ（RouteOverlay用）
  const staffColMeta = useMemo(()=>{
    if(!showStaff) return [];
    let x=0;
    return staff.map(s=>{const m={id:s.id,x,w:cwS};x+=cwS;return m;});
  },[staff,showStaff,cwS]);

  // 人員チェックグラフの幅
  const chartColW = 52;

  // 時間軸ラベル
  const timeLabels = Array.from({length:H_TOTAL+1},(_,i)=>H_START+i);
  const chartRef = useRef(null);
  const [copyGhost, setCopyGhost] = useState(null); // {dayIdx, type, seg/brk, srcDay}

  const onCopyDragStart = (e, payload, srcDay) => {
    e.stopPropagation(); e.preventDefault();
    const getDayIdx = clientX => {
      if(!chartRef.current) return -1;
      const rect = chartRef.current.getBoundingClientRect();
      const x = clientX - rect.left - D_TW; // 時間軸ラベル列分を引く
      const idx = Math.floor(x / D_CW);
      return Math.max(0, Math.min(6, idx));
    };
    let curIdx = getDayIdx(e.clientX);
    setCopyGhost({dayIdx:curIdx, ...payload, srcDay});
    const mm = ev => {
      const idx = getDayIdx(ev.clientX);
      if(idx !== curIdx){ curIdx = idx; setCopyGhost(g=>g?{...g,dayIdx:idx}:null); }
    };
    const mu = ev => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      const idx = getDayIdx(ev.clientX);
      const destDay = DAYS_EN[idx];
      if(destDay && destDay !== srcDay) {
        const destDef = getDay(destDay);
        if(payload.type==="work") {
          const {seg} = payload;
          mode==="staff"
            ? setDay(destDay, {...destDef, workStart:toHM(seg.start), workEnd:toHM(seg.end)})
            : setDay(destDay, {...destDef, stayStart:toHM(seg.start), stayEnd:toHM(seg.end)});
        } else {
          const {brk} = payload;
          const destBreaks = (destDef.breaks||[]);
          setDay(destDay, {...destDef, breaks:[...destBreaks, {id:uid(), start:brk.start, end:brk.end}]});
        }
      }
      setCopyGhost(null);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  };

  const appStyle = {fontFamily:"Noto Sans JP,Hiragino Kaku Gothic ProN,sans-serif",background:"#04080e",minHeight:"100vh",color:"#f1f5f9",padding:"12px 12px 60px"};

  return (
    <GC.Provider value={gCtx}>
    <div style={appStyle}>
      <GlobalDefs/>

      
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div>
          <h1 style={{margin:0,fontSize:18,fontWeight:900,letterSpacing:-0.5,color:"#f8fafc"}}>児童・職員スケジュール管理</h1>
          <p style={{margin:0,fontSize:10,color:"#475569"}}>放課後等デイサービス ／ 児童発達支援</p>
        </div>
        <div style={{display:"flex",gap:0,background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,overflow:"hidden"}}>
          {[{k:"daily",lbl:"📅 日々の管理"},{k:"defaults",lbl:"⚙ デフォルト"},{k:"categories",lbl:"🏷 区分管理"}].map((item)=>(
            <button key={item.k} onClick={()=>setScreen(item.k)} style={{background:screen===item.k?"#2563eb":"transparent",color:screen===item.k?"#fff":"#64748b",border:"none",padding:"7px 16px",fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>{item.lbl}</button>
          ))}
        </div>
      </div>

      
      {showPerfWarn&&(
        <div style={{background:"#1c1508",border:"1px solid #92400e",borderRadius:8,padding:"8px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <span style={{fontSize:11,color:"#fbbf24"}}>⚠ 保存データが{savedDays}日分に達しています。CSV出力・削除を推奨します。</span>
          <button onClick={()=>dlCSV(buildScheduleCSV(staff,children,date),"バックアップ_"+date+".csv")} style={BS("#92400e","#fbbf24")}>今すぐCSV出力</button>
        </div>
      )}

      
      {screen==="daily"&&(
        <>
          
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <input type="date" value={date} onChange={e=>switchDate(e.target.value)}
                style={{background:"#1e293b",border:"1px solid #334155",borderRadius:6,color:"#f1f5f9",padding:"5px 9px",fontSize:13}}/>
              <span style={{fontSize:17,fontWeight:900,color:dayColor}}>({DAYS_JP[dateObj.getDay()]})</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:4,background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"2px 8px"}}>
              <span style={{fontSize:10,color:"#475569",fontWeight:700}}>時間</span>
              <select value={hStart} onChange={e=>setHStart(Number(e.target.value))}
                style={{background:"transparent",border:"none",color:"#94a3b8",fontSize:11,cursor:"pointer"}}>
                {Array.from({length:13},(_,i)=>i+6).map(h=><option key={h} value={h}>{h}:00</option>)}
              </select>
              <span style={{fontSize:10,color:"#475569"}}>〜</span>
              <select value={hEnd} onChange={e=>setHEnd(Number(e.target.value))}
                style={{background:"transparent",border:"none",color:"#94a3b8",fontSize:11,cursor:"pointer"}}>
                {Array.from({length:9},(_,i)=>i+16).map(h=><option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
            <button onClick={copyFromPrev} style={BS("#1e293b","#64748b")}>← 前日コピー</button>
            <div style={{marginLeft:"auto",display:"flex",gap:5}}>
              <button onClick={()=>dlCSV(buildScheduleCSV(staff,children,date),"配置_"+date+".csv")} style={BS("#1e293b","#94a3b8")}>⬇ CSV</button>
              <button onClick={()=>setModal("help")} style={BS("#1e293b","#475569")}>？</button>
            </div>
          </div>

          
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
            <div style={{display:"flex",gap:3}}>
              {[{k:"all",lbl:"全員"},{k:"staff",lbl:"職員("+staff.length+")"},{k:"child",lbl:"児童("+children.length+")"}].map((item)=>(
                <button key={item.k} onClick={()=>setTab(item.k)} style={BS(tab===item.k?"#2563eb":"#1e293b",tab===item.k?"#fff":"#64748b")}>{item.lbl}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>setCompact(c=>!c)} style={{...BS(compact?"#1e3a1a":"#1e293b",compact?"#4ade80":"#64748b"),border:"1px solid "+(compact?"#166534":"#334155")}}>
                {compact?"⊞ 通常幅":"⊟ コンパクト"}
              </button>
              <button onClick={()=>setModal("addStaff")} style={BS("#0c2a4a","#60a5fa")}>＋ 職員</button>
              <button onClick={()=>setModal("addChild")} style={BS("#062a18","#34d399")}>＋ 児童</button>
            </div>
          </div>

          
          <div style={{border:"1px solid #1e293b",borderRadius:10,background:"#070d18",overflow:"hidden"}}>
            {(()=>{
              /* ヘッダーとボディを分離してスクロール同期 */
              const onHdrScroll = e => { if(bodyScrollRef.current) bodyScrollRef.current.scrollLeft = e.currentTarget.scrollLeft; };
              const onBodyScroll = e => { if(hdrScrollRef.current) hdrScrollRef.current.scrollLeft = e.currentTarget.scrollLeft; };

              /* ── ヘッダー行 ── */
              const hdrRow = (
                <div ref={hdrScrollRef} onScroll={onHdrScroll}
                  style={{overflowX:"auto",overflowY:"hidden",height:HDR_H,
                    scrollbarWidth:"none",msOverflowStyle:"none"}}>
                  <style>{".no-sb::-webkit-scrollbar{display:none}"}</style>
                  <div className="no-sb" style={{display:"flex",minWidth:"max-content",height:HDR_H}}>
                    {/* 時間軸ヘッダー */}
                    <div style={{flexShrink:0,width:TW,height:HDR_H,position:"sticky",left:0,zIndex:30,
                      background:"#04080e",borderRight:"2px solid #334155",borderBottom:"2px solid #334155",
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#475569",fontWeight:700}}>時間</div>
                    {/* 人員ヘッダー */}
                    <div style={{flexShrink:0,width:chartColW,height:HDR_H,position:"sticky",left:TW,zIndex:29,
                      background:"#060c18",borderRight:"2px solid #334155",borderBottom:"2px solid #334155",
                      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1}}>
                      <div style={{fontSize:8,color:"#475569",fontWeight:700}}>人員</div>
                      <div style={{fontSize:7,color:"#334155"}}>青=児 緑/赤=職</div>
                    </div>
                    {/* 職員ヘッダー */}
                    {showStaff&&staff.map((s,si)=>{
                      const st=STAFF_TYPES[s.stype]||STAFF_TYPES.fulltime;
                      return (
                        <div key={s.id} draggable={true}
                          onDragStart={e=>{e.dataTransfer.setData("id",s.id);e.dataTransfer.setData("isStaff","1");}}
                          onDragOver={e=>{e.preventDefault();setDragOver({id:s.id,isStaff:true});}}
                          onDragLeave={()=>setDragOver(null)}
                          onDrop={e=>{e.preventDefault();setDragOver(null);const fromId=e.dataTransfer.getData("id");reorderPerson(fromId,true,si);}}
                          style={{width:cwS,flexShrink:0,height:HDR_H,borderRight:"1px solid #334155",borderBottom:"2px solid #334155",
                            padding:compact?"3px 2px":"4px 4px 4px 6px",display:"flex",flexDirection:"column",
                            justifyContent:"space-between",gap:2,overflow:"hidden",cursor:"grab",background:"#06101e",boxSizing:"border-box"}}>
                          {compact ? (
                            <div style={{display:"flex",flexDirection:"row",alignItems:"stretch",height:"100%",overflow:"hidden"}}>
                              <div style={{writingMode:"vertical-rl",fontSize:10,fontWeight:800,color:"#f1f5f9",lineHeight:1.2,flex:1,overflow:"hidden"}}>{s.name}</div>
                              {(()=>{const ws=s.segments.find(sg=>sg.type==="work");return ws?<div style={{writingMode:"vertical-rl",fontSize:8,color:"#60a5fa",fontWeight:700,lineHeight:1.2,flexShrink:0}}>{toHM(ws.start)}〜{toHM(ws.end)}</div>:null;})()}
                            </div>
                          ) : (
                            <>
                              <div style={{fontSize:13,fontWeight:800,color:"#f1f5f9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                              <div style={{display:"flex",alignItems:"center",gap:3,flexWrap:"wrap"}}>
                                <span style={{fontSize:8,color:st.color,background:st.color+"22",borderRadius:3,padding:"1px 4px",border:"1px solid "+st.color+"44",fontWeight:700}}>{st.label}</span>
                                {s.segments.filter(g=>g.type==="transfer").map(g=>(
                                  <span key={g.id} style={{fontSize:8,color:rc(g.num||1),fontWeight:700}}>送{ROUTE_NUMS[(g.num||1)-1]}</span>
                                ))}
                              </div>
                              <button onClick={()=>delPerson(s.id)} style={{fontSize:8,background:"transparent",border:"none",color:"#334155",cursor:"pointer",padding:0,textAlign:"left"}}
                                onMouseEnter={e=>{e.currentTarget.style.color="#ef4444";}}
                                onMouseLeave={e=>{e.currentTarget.style.color="#334155";}}>🗑 削除</button>
                            </>
                          )}
                        </div>
                      );
                    })}
                    {/* 児童ヘッダー */}
                    {showChild&&Object.keys(schoolGroups).map(sk=>{
                      const sg=schoolGroups[sk];
                      const group=groupedChildren[sk];
                      if(!group||!group.length) return null;
                      return group.map((c,ci)=>{
                        const globalIdx=children.findIndex(x=>x.id===c.id);
                        return (
                          <div key={c.id} draggable={true}
                            onDragStart={e=>{e.dataTransfer.setData("id",c.id);e.dataTransfer.setData("isStaff","0");}}
                            onDragOver={e=>{e.preventDefault();setDragOver({id:c.id,isStaff:false});}}
                            onDragLeave={()=>setDragOver(null)}
                            onDrop={e=>{e.preventDefault();setDragOver(null);const fromId=e.dataTransfer.getData("id");reorderPerson(fromId,false,globalIdx);}}
                            style={{width:cwC,flexShrink:0,height:HDR_H,borderRight:"1px solid #1e3a5f",borderBottom:"2px solid #334155",
                              padding:compact?"3px 2px":"4px 3px 3px 4px",display:"flex",flexDirection:"column",
                              justifyContent:"space-between",overflow:"hidden",cursor:"grab",background:"#04080e",boxSizing:"border-box"}}>
                            {compact ? (
                              <div style={{display:"flex",flexDirection:"row",alignItems:"stretch",height:"100%",overflow:"hidden"}}>
                                <div style={{writingMode:"vertical-rl",fontSize:10,fontWeight:800,color:"#e2e8f0",lineHeight:1.2,flex:1,overflow:"hidden"}}>{c.name}</div>
                                {(()=>{const ws=c.segments.find(sg=>sg.type==="work");const pt=c.pickupTime!=null?toHM(c.pickupTime):null;const ts=(ws?toHM(ws.start)+"〜"+toHM(ws.end):"")+(ws&&pt?" ":"")+(pt?"📌"+pt:"");return ts?<div style={{writingMode:"vertical-rl",fontSize:8,color:sg.color,fontWeight:700,lineHeight:1.2,flexShrink:0}}>{ts}</div>:null;})()}
                              </div>
                            ) : (
                              <>
                                <div style={{fontSize:12,fontWeight:800,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div>
                                <div style={{display:"flex",alignItems:"center",gap:2}}>
                                  <div style={{width:5,height:5,borderRadius:"50%",background:sg.color}}/>
                                  <span style={{fontSize:7.5,color:sg.color,fontWeight:600}}>{sg.label}</span>
                                </div>
                                {c.pickupTime!=null&&<div style={{fontSize:7.5,color:"#fbbf24"}}>📌{toHM(c.pickupTime)}</div>}
                                <button onClick={()=>delPerson(c.id)} style={{fontSize:7.5,background:"transparent",border:"none",color:"#334155",cursor:"pointer",padding:0,textAlign:"left"}}
                                  onMouseEnter={e=>{e.currentTarget.style.color="#ef4444";}}
                                  onMouseLeave={e=>{e.currentTarget.style.color="#334155";}}>🗑</button>
                              </>
                            )}
                          </div>
                        );
                      });
                    })}
                  </div>
                </div>
              );

              /* ── ボディ行 ── */
              const bodyRow = (
                <div ref={bodyScrollRef} onScroll={onBodyScroll}
                  style={{overflowX:"auto",overflowY:"hidden",height:TOTAL_H}}>
                  <div style={{display:"flex",minWidth:"max-content",height:TOTAL_H}}>
                    {/* 時間軸ボディ */}
                    <div style={{flexShrink:0,width:TW,height:TOTAL_H,position:"sticky",left:0,zIndex:30,background:"#04080e",borderRight:"2px solid #334155"}}>
                      <div style={{height:TOTAL_H,position:"relative"}}>
                        {timeLabels.map(h=>(
                          <div key={h} style={{position:"absolute",top:tY(h)-1,right:4,fontSize:12,color:"#94a3b8",fontWeight:700,lineHeight:1}}>{h}:00</div>
                        ))}
                        {Array.from({length:H_TOTAL*2},(_,i)=>{
                          if(i%2===0)return null;
                          return <div key={i} style={{position:"absolute",top:i*CH/2,right:4,fontSize:9,color:"#475569",lineHeight:1}}>{toHM(H_START+i*0.5)}</div>;
                        })}
                      </div>
                    </div>
                    {/* 人員チェックボディ */}
                    <div style={{flexShrink:0,width:chartColW,height:TOTAL_H,position:"sticky",left:TW,zIndex:29,background:"#060c18",borderRight:"2px solid #334155"}}>
                      <StaffingBar staff={staff} children={children} hoverT={hoverT} onHover={setHoverT} colW={chartColW}/>
                    </div>
                    {/* 職員ボディ */}
                    {showStaff&&(
                      <div style={{flexShrink:0,display:"flex",height:TOTAL_H,position:"relative",borderRight:"3px solid #1e3a5f"}}>
                        <RouteOverlay staff={staff} colMeta={staffColMeta}/>
                        {staff.map(s=>(
                          <div key={s.id} style={{width:cwS,flexShrink:0,position:"relative"}}>
                            <StaffCol person={s} colW={cwS}
                              onUpdate={seg=>updSeg(s.id,seg,true)}
                              onDelete={sid=>delSeg(s.id,sid,true)}
                              onAdd={seg=>addSeg(s.id,seg,true)}
                              hoverT={hoverT}/>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* 児童ボディ */}
                    {showChild&&Object.keys(schoolGroups).map(sk=>{
                      const sg=schoolGroups[sk];
                      const group=groupedChildren[sk];
                      if(!group||!group.length) return null;
                      return (
                        <div key={sk} style={{flexShrink:0,display:"flex",height:TOTAL_H,borderRight:"3px solid "+sg.color+"55"}}>
                          {group.map(c=>(
                            <div key={c.id} style={{width:cwC,flexShrink:0,position:"relative"}}>
                              <ChildCol person={c} colW={cwC}
                                onUpdate={seg=>updSeg(c.id,seg,false)}
                                onDelete={sid=>delSeg(c.id,sid,false)}
                                onAdd={seg=>addSeg(c.id,seg,false)}
                                onPickupChange={t=>changePickup(c.id,t)}
                                hoverT={hoverT}
                                schoolGroups={schoolGroups}/>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );

              return <>{hdrRow}{bodyRow}</>;
            })()}
          </div>

          
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8,alignItems:"center"}}>
            {Object.keys(STAFF_TYPES).map((k)=>{ var v=STAFF_TYPES[k]; return (
              <div key={k} style={{display:"flex",alignItems:"center",gap:3,fontSize:9.5}}>
                <div style={{width:7,height:7,background:v.color,borderRadius:2}}/>
                <span style={{color:"#64748b"}}>{v.label}</span>
              </div>
            );})}
            <span style={{color:"#334155",fontSize:9}}>|</span>
            {Object.keys(schoolGroups).map((k)=>{ var v=schoolGroups[k]; return (
              <div key={k} style={{display:"flex",alignItems:"center",gap:3,fontSize:9.5}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:v.color}}/>
                <span style={{color:"#64748b"}}>{v.label}</span>
              </div>
            );})}
            <span style={{color:"#334155",fontSize:9}}>|</span>
            {ROUTE_COLORS.map((c,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:2,fontSize:9}}>
                <div style={{width:9,height:9,background:c,borderRadius:2}}/>
                <span style={{color:"#475569"}}>ルート{ROUTE_NUMS[i]}</span>
              </div>
            ))}
            <span style={{fontSize:9,color:"#334155",marginLeft:4}}>クリック=追加(1h) ／ <span style={{color:"#f59e0b"}}>Shift+ドラッグ=送迎</span> ／ <span style={{color:"#8b9cb8"}}>Ctrl/Alt+ドラッグ=休憩(職員)</span> ／ <span style={{color:"#fbbf24"}}>Alt+クリック=お迎えピン(児童)</span> ／ 📌×=ピン削除</span>
          </div>
        </>
      )}

      
      {screen==="categories"&&(
        <CategoriesScreen
          staffTypes={staffTypes} setStaffTypes={setStaffTypes}
          schoolGroups={schoolGroups} setSchoolGroups={setSchoolGroups}/>
      )}
      {screen==="defaults"&&(
        <DefaultsScreen staff={master.staff} children={master.children}
          master={master} defaults={defaults} setDefaults={setDefaults}
          onExport={()=>dlCSV(buildDefaultCSV(defaults,master.staff,master.children),"デフォルトスケジュール.csv")}
          onImportClick={()=>{setImportTxt("");setImportErr("");setModal("importDef");}}
          onAddStaff={()=>setModal("newStaff")}
          onAddChild={()=>setModal("newChild")}
          onDelMaster={(id,kind)=>delFromMaster(id,kind)}
          onRename={(id,kind,name,subtype)=>renameMaster(id,kind,name,subtype)}
          onCopy={(id,kind)=>copyMaster(id,kind)}/>
      )}

      
      {(modal==="addStaff"||modal==="addChild")&&(()=>{
        const isStaff = modal==="addStaff";
        const kind = isStaff ? "staff" : "children";
        const masterList = isStaff ? master.staff : master.children;
        const activeIds = new Set((isStaff ? staff : children).map(p=>p.id));
        const available = masterList.filter(m=>!activeIds.has(m.id));
        const dow = DAYS_EN[new Date(date).getDay()];
        return (
          <Modal onClose={()=>setModal(null)} wide>
            <h3 style={MH3}>{isStaff?"職員を追加":"児童・生徒を追加"}</h3>
            {available.length===0 ? (
              <p style={{fontSize:12,color:"#64748b",margin:"0 0 14px"}}>
                登録済みメンバーは全員表示中です。
              </p>
            ) : (
              <>
                <p style={{fontSize:11,color:"#64748b",margin:"0 0 10px"}}>
                  クリックで当日に追加。デフォルト在所時間が自動適用されます。
                </p>
                <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:14,maxHeight:280,overflowY:"auto"}}>
                  {available.map(m=>{
                    const col = isStaff ? ((STAFF_TYPES[m.stype]&&STAFF_TYPES[m.stype].color)||"#3b82f6") : ((schoolGroups[m.school]&&schoolGroups[m.school].color)||"#64748b");
                    const def = (defaults[m.id]&&defaults[m.id][dow]);
                    const defLabel = isStaff
                      ? (def&&def.active&&def&&def.workStart ? def.workStart+"〜"+def.workEnd : "デフォルトなし")
                      : (def&&def.active&&def&&def.stayStart ? "在所 "+def.stayStart+"〜"+def.stayEnd+(def.pickupTime?" 📌"+def.pickupTime:"") : "デフォルトなし");
                    return (
                      <button key={m.id} onClick={()=>addFromMaster(m.id, isStaff?"staff":"child")}
                        style={{display:"flex",alignItems:"center",gap:10,background:"#0f172a",border:"1px solid "+col+"55",borderRadius:8,padding:"9px 14px",cursor:"pointer",textAlign:"left",transition:"border-color 0.15s"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=col;}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=col+"55";}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:col,flexShrink:0}}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:800,color:"#f1f5f9"}}>{m.name}</div>
                          <div style={{fontSize:10,color:"#475569",marginTop:1}}>
                            {isStaff ? (STAFF_TYPES[m.stype]&&STAFF_TYPES[m.stype].label) : (schoolGroups[m.school]&&schoolGroups[m.school].label)}
                            <span style={{marginLeft:8,color:def&&def.active?"#10b981":"#475569"}}>{defLabel}</span>
                          </div>
                        </div>
                        <span style={{fontSize:11,color:col,fontWeight:700}}>＋追加</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{borderTop:"1px solid #1e293b",paddingTop:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <button onClick={()=>setModal(isStaff?"newStaff":"newChild")}
                style={{...BS("#1e3a5f","#60a5fa"),border:"1px solid #1e3a5f"}}>
                ＋ 新しい{isStaff?"職員":"児童"}を登録
              </button>
              <button onClick={()=>setModal(null)} style={BS("#1e293b","#64748b")}>閉じる</button>
            </div>
          </Modal>
        );
      })()}

      
      {(modal==="newStaff"||modal==="newChild")&&(()=>{
        const isStaff = modal==="newStaff";
        return (
          <Modal onClose={()=>setModal(null)}>
            <h3 style={MH3}>{isStaff?"新しい職員を登録":"新しい児童・生徒を登録"}</h3>
            <FF label="氏名">
              <input autoFocus value={newMember.name}
                onChange={e=>setNewMember(p=>({...p,name:e.target.value,kind:isStaff?"staff":"child"}))}
                onKeyDown={e=>e.key==="Enter"&&registerNewMember()}
                style={IS} placeholder="例: 山田 花子"/>
            </FF>
            {isStaff
              ? <FF label="分類"><select value={newMember.stype} onChange={e=>setNewMember(p=>({...p,stype:e.target.value}))} style={IS}>{Object.keys(STAFF_TYPES).map((k)=><option key={k} value={k}>{STAFF_TYPES[k].label}</option>)}</select></FF>
              : <FF label="学校・園"><select value={newMember.school} onChange={e=>setNewMember(p=>({...p,school:e.target.value}))} style={IS}>{Object.keys(schoolGroups).map((k)=><option key={k} value={k}>{schoolGroups[k].label}</option>)}</select></FF>
            }
            <FF label="デフォルトをコピー（任意）">
              <select value={newMember.copyFromId} onChange={e=>setNewMember(p=>({...p,copyFromId:e.target.value}))} style={IS}>
                <option value="">コピーしない</option>
                {(isStaff ? master.staff : master.children).map(m=>(
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </FF>
            <p style={{fontSize:10,color:"#475569",margin:"8px 0 0"}}>
              登録後、マスター一覧に追加されます。
            </p>
            <div style={{display:"flex",gap:7,justifyContent:"flex-end",marginTop:16}}>
              <button onClick={()=>setModal(isStaff?"addStaff":"addChild")} style={BS("#1e293b","#64748b")}>← 戻る</button>
              <button onClick={()=>{setNewMember(p=>({...p,kind:isStaff?"staff":"child"}));registerNewMember();}} style={BS("#2563eb","#fff")}>登録して追加</button>
            </div>
          </Modal>
        );
      })()}

      {modal==="importDef"&&(
        <Modal onClose={()=>setModal(null)} wide>
          <h3 style={MH3}>⬆ デフォルトCSVインポート</h3>
          <p style={{fontSize:11,color:"#64748b",margin:"0 0 10px"}}>エクスポートしたCSVを貼り付けてください。</p>
          <textarea value={importTxt} onChange={e=>setImportTxt(e.target.value)}
            style={{...IS,height:140,resize:"vertical",fontFamily:"monospace",fontSize:10}}
            placeholder='"種別","名前","曜日","有効","お迎え/出勤","在所開始/退勤","在所終了"'/>
          {importErr&&<div style={{color:"#ef4444",fontSize:11,marginTop:5}}>{importErr}</div>}
          <div style={{display:"flex",gap:7,justifyContent:"flex-end",marginTop:12}}>
            <button onClick={()=>setModal(null)} style={BS("#1e293b","#64748b")}>キャンセル</button>
            <button onClick={()=>{
              try{
                const lines=importTxt.trim().split("\n").slice(1);const patch={};
                lines.forEach(line=>{
                  const cols=line.split(",").map(c=>c.replace(/^"|"$/g,"").trim());if(cols.length<5)return;
                  const[kind,name,dayJp,activeStr,...rest]=cols;const isChild=kind==="児童";
                  const persons=isChild?master.children:master.staff;const p=persons.find(x=>x.name===name);if(!p)return;
                  const di=DAYS_JP.indexOf(dayJp);if(di<0)return;const day=DAYS_EN[di];
                  if(!patch[p.id])patch[p.id]={};
                  patch[p.id][day]=isChild?{active:activeStr==="○",pickupTime:rest[0]||"",stayStart:rest[1]||"",stayEnd:rest[2]||""}:{active:activeStr==="○",workStart:rest[0]||"",workEnd:rest[1]||""};
                });
                setDefaults(prev=>({...prev,...patch}));setModal(null);setImportTxt("");setToast("✓ デフォルトを読み込みました");
              }catch(e){setImportErr("読み込み失敗: "+e.message);}
            }} style={BS("#2563eb","#fff")}>インポート実行</button>
          </div>
        </Modal>
      )}

      {modal==="help"&&(
        <Modal onClose={()=>setModal(null)} wide>
          <h3 style={MH3}>使い方ガイド</h3>
          {[
            ["レイアウト","縦軸=時間(8〜19時)、横軸=人員。横スクロールで全員を俯瞰できます"],
            ["＋職員 / ＋児童","マスター登録済みメンバーの一覧が出ます。クリックでデフォルト時間付きで当日に追加"],
            ["新しいメンバーを登録","追加モーダル下部から名前・分類を入力して新規登録できます"],
            ["空白クリック","タイムライン空白部分のクリックで「在所」バーを1時間追加"],
            ["Shift＋ドラッグ（職員）","送迎オーバーレイを追加（斜線パターン）"],
            ["Ctrl/⌘＋ドラッグ（職員）","休憩オーバーレイを追加（ドットパターン）"],
            ["送迎・休憩バー中央ドラッグ","上下に移動（4px以上で移動開始）"],
            ["送迎・休憩バー上下端ドラッグ","開始・終了時刻を変更（15分単位）"],
            ["送迎バーのクリック","ルート番号を①→②→…→⑧と切り替え"],
            ["📌ピンドラッグ（児童）","お迎え時刻の縦線を上下にドラッグして変更"],
          ].map((item)=>(
            <div key={item[0]} style={{marginBottom:8}}>
              <div style={{fontSize:11.5,fontWeight:700,color:"#60a5fa"}}>{item[0]}</div>
              <div style={{fontSize:10.5,color:"#94a3b8",marginTop:1}}>{item[1]}</div>
            </div>
          ))}
          <button onClick={()=>setModal(null)} style={{...BS("#2563eb","#fff"),marginTop:8}}>閉じる</button>
        </Modal>
      )}

      
      {toast&&<div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:"#14532d",border:"1px solid #166534",borderRadius:8,padding:"9px 18px",fontSize:12,fontWeight:700,color:"#86efac",zIndex:500,boxShadow:"0 4px 20px rgba(0,0,0,0.6)",pointerEvents:"none"}}>{toast}</div>}
    </div>
    </GC.Provider>
  );
}

function TI({val,dis,on}){return <input type="time" value={val||""} disabled={dis} onChange={e=>on(e.target.value)} style={{background:"#0f172
