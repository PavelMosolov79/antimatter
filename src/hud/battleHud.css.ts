/** The battle screen's styles; made from the design in the player-screen artifact (cinema/hud-artifact.html), every size N × --u. */
export const BATTLE_CSS = `
#bh { position: fixed; inset: 0; pointer-events: none; z-index: 3; --bg: #05070d;   --panel: rgba(8, 12, 22, .86);   --panel-solid: #0a0f1c;   --line: #2c3d63;   --line-soft: #1c2742;   --fg: #cfe0ff;   --dim: #7f95bf;   --faint: #4d5f86;   --cyan: #59e6ff;   --violet: #b06bff;   --magenta: #ff5fd8;   --amber: #ffd24a;   --red: #ff6a5a;   --green: #63e07a;   --hull: #4fd16a;   --shield: #3f8bf0;   --energy: #e0a030;   --display: 'Unbounded', 'Arial Black', system-ui, sans-serif;   --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;    --u: 1vw; font: 400 13px/1.55 var(--mono); color: var(--fg); }
#bh.desk { --u: clamp(3.4px, min(.35vw, .6vh), 5px); }
#bh[hidden] { display: none; }
#bh * { box-sizing: border-box; }
#bh .left, #bh .disp-head, #bh .msg, #bh .dock, #bh .log, #bh .rooms.show, #bh .mk .core, #bh .devbtn { pointer-events: auto; }
#bh button {font-family: inherit;}
#bh button:focus-visible { outline: 2px solid var(--violet); outline-offset: 2px; }
#bh .left {position: absolute; left: calc(3 * var(--u)); top: calc(3 * var(--u)); right: calc(3 * var(--u)); display: flex; flex-direction: column; gap: calc(2 * var(--u));}
#bh.desk .left {right: auto; left: calc(3 * var(--u)); top: calc(3 * var(--u)); width: calc(66 * var(--u));}
#bh .bars {display: grid; grid-template-columns: 1fr 1fr 1fr; gap: calc(1.6 * var(--u));}
#bh.desk .bars {grid-template-columns: 1fr; gap: calc(1.2 * var(--u)); padding: calc(2 * var(--u)); background: var(--panel); border: 1px solid var(--line); border-radius: calc(2.4 * var(--u));}
#bh .bar {position: relative; height: calc(8.4 * var(--u)); background: var(--panel); border: 1px solid var(--line); border-radius: calc(2 * var(--u)); overflow: hidden;}
#bh.desk .bar {height: calc(6.2 * var(--u)); background: rgba(5, 8, 16, .7); border-radius: calc(1.4 * var(--u));}
#bh .bar i {position: absolute; inset: 0 auto 0 0; width: 100%; transition: width .35s ease; opacity: .9;}
#bh .bar::after {content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(5, 7, 13, .55) calc(10% - 1px) 10%);}
#bh .bar span {position: absolute; inset: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 0 calc(2.2 * var(--u)); font: 700 calc(2.9 * var(--u))/1 var(--mono); text-shadow: 0 1px 3px #000;}
#bh.desk .bar span {font-size: calc(3.1 * var(--u));}
#bh .bar span b {font: 600 calc(2.1 * var(--u))/1 var(--mono); letter-spacing: .14em; color: #dff3ff; opacity: .85;}
#bh.desk .bar span b {font-size: calc(2.4 * var(--u));}
#bh .bar.hull i {background: linear-gradient(90deg, #2f9b4a, var(--hull));}
#bh .bar.shield i {background: linear-gradient(90deg, #2a63c4, var(--shield));}
#bh .bar.energy i {background: linear-gradient(90deg, #b5791a, var(--energy));}
#bh .bar.low {border-color: var(--red); animation: pulse .8s infinite alternate;}
@keyframes pulse { to { box-shadow: 0 0 calc(2.4 * var(--u)) rgba(255, 106, 90, .7); } }
#bh .rooms {display: none;}
#bh .rooms.show {display: flex;}
#bh .rooms {flex-direction: column; gap: calc(1.4 * var(--u)); padding: calc(2 * var(--u)); background: var(--panel); border: 1px solid var(--line); border-radius: calc(2.4 * var(--u));}
#bh .rooms h4 {margin: 0; display: flex; flex-wrap: wrap; gap: calc(1 * var(--u)) calc(2 * var(--u)); justify-content: space-between; font: 700 calc(2.5 * var(--u))/1 var(--mono); letter-spacing: .16em; color: var(--cyan);}
#bh .rooms h4 em {font-style: normal; color: var(--dim); letter-spacing: .04em;}
#bh .rrow {display: grid; grid-template-columns: 1fr calc(14 * var(--u)) calc(7.5 * var(--u)); gap: calc(1.6 * var(--u)); align-items: center; padding: calc(1 * var(--u)) calc(1.4 * var(--u)); border-radius: calc(1.2 * var(--u)); font: 600 calc(2.7 * var(--u))/1.2 var(--mono); cursor: pointer; border: 1px solid transparent;}
#bh .rrow:hover, #bh .rrow.hi {border-color: var(--cyan); background: rgba(89, 230, 255, .06);}
#bh .rrow .nm {overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; gap: calc(1 * var(--u)); align-items: center;}
#bh .rrow .pb {height: calc(1.6 * var(--u)); background: rgba(255, 255, 255, .08); border-radius: calc(1 * var(--u)); overflow: hidden;}
#bh .rrow .pb i {display: block; height: 100%; background: var(--c);}
#bh .rrow .pc {text-align: right; color: var(--c); font-variant-numeric: tabular-nums;}
#bh .rrow svg {width: calc(3.2 * var(--u)); height: calc(3.2 * var(--u)); stroke: currentColor; fill: none; stroke-width: 2; flex: none;}
#bh .rrow .fi {color: var(--amber);}
#bh .rrow .bi {color: var(--red);}
#bh .rleg {display: flex; gap: calc(2.4 * var(--u)); font: 400 calc(2.2 * var(--u))/1 var(--mono); color: var(--dim); flex-wrap: wrap;}
#bh .rleg i {display: inline-block; width: calc(2.2 * var(--u)); height: calc(2.2 * var(--u)); border-radius: calc(.6 * var(--u)); margin-right: calc(.8 * var(--u)); vertical-align: calc(-.2 * var(--u));}
#bh .rnote {font: 400 calc(2.5 * var(--u))/1.3 var(--mono); color: var(--dim);}
#bh.mob .rooms {position: absolute; left: calc(3 * var(--u)); right: calc(3 * var(--u)); bottom: 0;}
#bh.mob .rrow {grid-template-columns: 1fr calc(12 * var(--u)) calc(7 * var(--u));}
#bh .disp {position: absolute; left: calc(3 * var(--u)); top: calc(14.6 * var(--u)); width: calc(78 * var(--u)); display: flex; flex-direction: column; gap: calc(1.4 * var(--u)); z-index: 5;}
#bh.desk .disp {left: auto; right: calc(3 * var(--u)); top: calc(3 * var(--u)); width: calc(92 * var(--u)); align-items: stretch;}
#bh .disp-head {display: flex; align-items: center; gap: calc(2 * var(--u)); align-self: flex-start; padding: calc(1.4 * var(--u)) calc(2.6 * var(--u)) calc(1.4 * var(--u)) calc(2 * var(--u)); font: 700 calc(2.3 * var(--u))/1 var(--mono); letter-spacing: .2em; color: var(--cyan); background: var(--panel); border: 1px solid var(--line); border-radius: calc(1.6 * var(--u)); cursor: pointer;}
#bh.desk .disp-head {align-self: flex-end; font-size: calc(2.5 * var(--u));}
#bh .disp-head .dot {width: calc(1.8 * var(--u)); height: calc(1.8 * var(--u)); border-radius: 50%; background: var(--cyan); box-shadow: 0 0 calc(1.6 * var(--u)) var(--cyan);}
#bh .disp-head em {font-style: normal; color: var(--dim); letter-spacing: .06em;}
#bh .msg {position: relative; display: grid; grid-template-columns: calc(7.4 * var(--u)) 1fr auto; gap: calc(2.4 * var(--u)); align-items: center; padding: calc(2.1 * var(--u)) calc(2.6 * var(--u)) calc(2.1 * var(--u)) calc(2.2 * var(--u)); background: var(--panel); border: 1px solid var(--line); border-left: calc(1.1 * var(--u)) solid var(--sev); border-radius: calc(1.8 * var(--u)); backdrop-filter: blur(3px); animation: msgin .32s cubic-bezier(.2, .9, .3, 1.2); transition: opacity .6s, transform .6s;}
#bh.desk .msg {grid-template-columns: calc(6.4 * var(--u)) 1fr auto; padding: calc(1.8 * var(--u)) calc(2.4 * var(--u)) calc(1.8 * var(--u)) calc(2 * var(--u));}
#bh .msg.out {opacity: 0; transform: translateX(calc(-4 * var(--u)));}
#bh.desk .msg.out {transform: translateX(calc(4 * var(--u)));}
#bh .msg .ic {width: calc(7.4 * var(--u)); height: calc(7.4 * var(--u)); display: grid; place-items: center; border-radius: calc(1.6 * var(--u)); background: color-mix(in srgb, var(--sev) 18%, transparent); color: var(--sev);}
#bh.desk .msg .ic {width: calc(6.4 * var(--u)); height: calc(6.4 * var(--u));}
#bh .msg .ic svg {width: calc(4.6 * var(--u)); height: calc(4.6 * var(--u)); stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;}
#bh .msg .t {font: 700 calc(3.2 * var(--u))/1.2 var(--mono); color: #eef5ff;}
#bh.desk .msg .t {font-size: calc(3.1 * var(--u));}
#bh .msg .s {margin-top: calc(.5 * var(--u)); font: 400 calc(2.6 * var(--u))/1.3 var(--mono); color: var(--dim);}
#bh.desk .msg .s {font-size: calc(2.6 * var(--u));}
#bh .msg .tm {font: 600 calc(2.2 * var(--u))/1 var(--mono); color: var(--faint); align-self: start; font-variant-numeric: tabular-nums;}
#bh .msg .x {color: var(--sev); font-weight: 700;}
#bh .msg.crit {box-shadow: 0 0 calc(3 * var(--u)) calc(-1 * var(--u)) var(--red);}
@keyframes msgin { from { opacity: 0; transform: translateX(calc(-6 * var(--u))) scale(.96); } }
#bh .log {position: absolute; left: calc(3 * var(--u)); right: calc(3 * var(--u)); top: calc(14.6 * var(--u)); bottom: calc(3 * var(--u)); z-index: 8; display: flex; flex-direction: column; background: rgba(5, 8, 16, .96); border: 1px solid var(--line); border-radius: calc(2.4 * var(--u)); padding: calc(3 * var(--u)); gap: calc(2 * var(--u)); backdrop-filter: blur(6px);}
#bh.desk .log {left: auto; width: calc(100 * var(--u)); top: calc(3 * var(--u));}
#bh .log[hidden] {display: none;}
#bh .log h3 {margin: 0; display: flex; justify-content: space-between; align-items: center; font: 700 calc(2.8 * var(--u))/1 var(--display); letter-spacing: .12em; text-transform: uppercase; color: #fff;}
#bh .log h3 button {background: none; border: 1px solid var(--line); color: var(--dim); border-radius: calc(1.2 * var(--u)); font: 600 calc(2.4 * var(--u))/1 var(--mono); padding: calc(1.4 * var(--u)) calc(2.2 * var(--u)); cursor: pointer;}
#bh .log-list {overflow-y: auto; display: flex; flex-direction: column; gap: calc(1.2 * var(--u)); scrollbar-width: thin; scrollbar-color: var(--line) transparent;}
#bh .log-list .msg {animation: none; backdrop-filter: none; background: rgba(12, 18, 32, .9);}
#bh .log-chips {display: flex; gap: calc(1.4 * var(--u)); flex-wrap: wrap;}
#bh .chip {background: transparent; border: 1px solid var(--line); color: var(--dim); font: 600 calc(2.3 * var(--u))/1 var(--mono); letter-spacing: .08em; padding: calc(1.4 * var(--u)) calc(2.2 * var(--u)); border-radius: calc(1.2 * var(--u)); cursor: pointer;}
#bh .chip.on {color: #04202a; background: var(--cyan); border-color: var(--cyan);}
#bh .mk {position: absolute; left: 0; top: 0; width: 0; height: 0; transition: opacity .25s;}
#bh .mk .core {position: absolute; left: calc(-4.6 * var(--u)); top: calc(-4.6 * var(--u)); width: calc(9.2 * var(--u)); height: calc(9.2 * var(--u)); display: grid; place-items: center; border-radius: 50%; background: rgba(5, 8, 16, .82); border: 1.5px solid var(--c); color: var(--c); box-shadow: 0 0 calc(2.4 * var(--u)) calc(-.4 * var(--u)) var(--c); cursor: pointer;}
#bh.desk .mk .core {left: calc(-4 * var(--u)); top: calc(-4 * var(--u)); width: calc(8 * var(--u)); height: calc(8 * var(--u));}
#bh .mk .core svg {width: calc(5.4 * var(--u)); height: calc(5.4 * var(--u)); stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;}
#bh.desk .mk .core svg {width: calc(4.6 * var(--u)); height: calc(4.6 * var(--u));}
#bh .mk .arr {position: absolute; left: 0; top: 0; width: 0; height: 0;}
#bh .mk .arr i {position: absolute; left: calc(5.2 * var(--u)); top: calc(-1.9 * var(--u)); width: calc(2.6 * var(--u)); height: calc(3.8 * var(--u)); background: var(--c); clip-path: polygon(0 0, 100% 50%, 0 100%, 25% 50%); filter: drop-shadow(0 0 calc(.8 * var(--u)) var(--c));}
#bh.desk .mk .arr i {left: calc(4.6 * var(--u));}
#bh .mk .d {position: absolute; left: 0; width: calc(18 * var(--u)); margin-left: calc(-9 * var(--u)); text-align: center; font: 700 calc(2.4 * var(--u))/1 var(--mono); color: var(--c); text-shadow: 0 1px 3px #000, 0 0 calc(2 * var(--u)) #000; font-variant-numeric: tabular-nums; pointer-events: none;}
#bh .mk.foe {--c: var(--red);}
#bh .mk.foe .core {animation: foe 1s infinite alternate;}
@keyframes foe { to { box-shadow: 0 0 calc(3.4 * var(--u)) calc(.2 * var(--u)) var(--red); } }
#bh .mk.big {--c: var(--violet);}
#bh .mk.hole {--c: #ff9a2a;}
#bh .mk.wreck {--c: var(--amber);}
#bh .mk.gate {--c: var(--cyan);}
#bh .mk.rocks {--c: #b9ad9e;}
#bh .mk.comet {--c: #8af0ff;}
#bh .pill {position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); padding: calc(.7 * var(--u)) calc(1.4 * var(--u)); font: 700 calc(2.3 * var(--u))/1 var(--mono); border-radius: calc(1 * var(--u)); background: rgba(5, 8, 16, .88); border: 1px solid var(--c); color: var(--c); white-space: nowrap; display: none; pointer-events: none !important; font-variant-numeric: tabular-nums;}
#bh .pill svg {width: calc(2.6 * var(--u)); height: calc(2.6 * var(--u)); stroke: currentColor; fill: none; stroke-width: 2; vertical-align: calc(-.5 * var(--u)); margin-right: calc(.5 * var(--u));}
#bh .dock {position: absolute; left: calc(2.4 * var(--u)); right: calc(2.4 * var(--u)); bottom: calc(2.4 * var(--u)); display: flex; flex-wrap: wrap; gap: calc(2 * var(--u)) calc(2.4 * var(--u)); padding: calc(2.2 * var(--u)); background: var(--panel); border: 1px solid var(--line); border-radius: calc(3 * var(--u)); backdrop-filter: blur(4px);}
#bh.desk .dock {left: 50%; right: auto; transform: translateX(-50%); width: calc(168 * var(--u)); bottom: calc(3 * var(--u)); gap: calc(2.2 * var(--u)) calc(3 * var(--u)); border-radius: calc(2.6 * var(--u));}
#bh .grp {display: flex; flex-direction: column; gap: calc(1.2 * var(--u)); min-width: 0;}
#bh .gh {display: flex; align-items: center; gap: calc(1.4 * var(--u)); font: 700 calc(2.1 * var(--u))/1 var(--mono); letter-spacing: .22em; text-transform: uppercase; color: var(--faint);}
#bh .gh::after {content: ''; flex: 1; height: 1px; background: var(--line-soft);}
#bh .gh b {color: var(--cyan); font-weight: 700;}
#bh .grow {display: flex; gap: calc(1.4 * var(--u));}
#bh .g-fly {flex: 4 1 calc(58 * var(--u));}
#bh .g-time {flex: 2 1 calc(28 * var(--u));}
#bh .g-deck {flex: 1 1 100%;}
#bh .g-mod {flex: 1 1 100%;}
#bh.desk .g-fly {flex: 4 1 calc(70 * var(--u));}
#bh.desk .g-time {flex: 2 1 calc(34 * var(--u));}
#bh.desk .g-deck {flex: 1 1 calc(60 * var(--u));}
#bh.desk .g-mod {flex: 1 1 100%;}
#bh .btn {flex: 1; min-width: 0; height: calc(14.4 * var(--u)); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(1 * var(--u)); background: rgba(12, 18, 34, .9); border: 1px solid var(--line); border-radius: calc(2.2 * var(--u)); color: var(--fg); cursor: pointer; padding: 0 calc(.4 * var(--u));}
#bh.desk .btn {height: calc(12.4 * var(--u));}
#bh .btn svg {width: calc(5.2 * var(--u)); height: calc(5.2 * var(--u)); stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round;}
#bh .btn span {font: 600 calc(2.05 * var(--u))/1 var(--mono); color: var(--dim); white-space: nowrap; letter-spacing: .02em;}
#bh.desk .btn span {font-size: calc(2.2 * var(--u));}
#bh .btn.on {color: var(--cyan); border-color: var(--cyan); background: rgba(89, 230, 255, .1); box-shadow: inset 0 0 calc(2 * var(--u)) rgba(89, 230, 255, .12);}
#bh .btn.on span {color: var(--cyan);}
#bh .btn.act {color: var(--amber); border-color: var(--amber); background: rgba(255, 210, 74, .1);}
#bh .btn.act span {color: var(--amber);}
#bh .deck {flex: 1; position: relative; height: calc(10.4 * var(--u)); background: rgba(12, 18, 34, .9); border: 1px solid var(--line-soft); border-radius: calc(1.8 * var(--u)); color: var(--dim); font: 700 calc(2.7 * var(--u))/1 var(--mono); cursor: pointer; padding: 0;}
#bh.desk .deck {height: calc(10.4 * var(--u));}
#bh .deck.on {color: #04202a; background: var(--cyan); border-color: var(--cyan);}
#bh .deck .al {position: absolute; right: calc(1 * var(--u)); top: calc(1 * var(--u)); width: calc(2.2 * var(--u)); height: calc(2.2 * var(--u)); border-radius: 50%; background: var(--c); box-shadow: 0 0 calc(1.4 * var(--u)) var(--c); display: none;}
#bh .deck.warn .al {--c: var(--amber); display: block;}
#bh .deck.crit .al {--c: var(--red); display: block; animation: pulse2 .7s infinite alternate;}
@keyframes pulse2 { to { transform: scale(1.5); } }
#bh .mods {display: flex; gap: calc(1.4 * var(--u)); overflow-x: auto; scrollbar-width: none;}
#bh .mods::-webkit-scrollbar {display: none;}
#bh .mod {flex: 0 0 auto; min-width: calc(21 * var(--u)); display: flex; flex-direction: column; gap: calc(.9 * var(--u)); padding: calc(1.4 * var(--u)) calc(1.8 * var(--u)); background: rgba(12, 18, 34, .9); border: 1px solid var(--line); border-radius: calc(1.8 * var(--u)); color: var(--fg); cursor: default; text-align: left;}
#bh.desk .mod {min-width: calc(19 * var(--u));}
#bh .mod .mt {display: flex; align-items: center; gap: calc(1.2 * var(--u)); font: 700 calc(2.3 * var(--u))/1 var(--mono);}
#bh .mod .mt svg {width: calc(3.6 * var(--u)); height: calc(3.6 * var(--u)); stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--c);}
#bh .mod .mn {font: 600 calc(2.05 * var(--u))/1 var(--mono); color: var(--dim); display: flex; justify-content: space-between; gap: calc(1.6 * var(--u));}
#bh .mod .mb {height: calc(1.2 * var(--u)); background: rgba(255, 255, 255, .08); border-radius: calc(1 * var(--u)); overflow: hidden;}
#bh .mod .mb i {display: block; height: 100%; background: var(--c); transition: width .4s;}
#bh .mod {--c: var(--green);}
#bh .mod.dmg {--c: var(--amber);}
#bh .mod.dead {--c: var(--red);}
#bh .mod.dead .mt span {text-decoration: line-through;}
#bh .mod.tog {cursor: pointer;}
#bh .mod.off {opacity: .55;}
#bh .bar span b {display: flex; align-items: center; opacity: 1;}
#bh .bar span b svg {width: calc(3.8 * var(--u)); height: calc(3.8 * var(--u)); stroke: #eaf6ff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 1px 2px #000);}
#bh.mob .bars {gap: calc(1.4 * var(--u));}
#bh.mob .bar {height: calc(6 * var(--u)); border-radius: calc(1.6 * var(--u));}
#bh.mob .bar span {padding: 0 calc(1.8 * var(--u)); font-size: calc(2.8 * var(--u));}
#bh.mob .bar span b svg {width: calc(3.4 * var(--u)); height: calc(3.4 * var(--u));}
#bh.mob .disp {top: calc(11 * var(--u)); width: calc(94 * var(--u)); gap: calc(1 * var(--u));}
#bh.mob .disp-head {padding: calc(1 * var(--u)) calc(2 * var(--u)) calc(1 * var(--u)) calc(1.6 * var(--u)); font-size: calc(1.9 * var(--u)); gap: calc(1.4 * var(--u));}
#bh.mob .disp-head .dot {width: calc(1.4 * var(--u)); height: calc(1.4 * var(--u));}
#bh.mob .msg {grid-template-columns: calc(5.8 * var(--u)) 1fr auto; gap: calc(2 * var(--u)); padding: calc(1.4 * var(--u)) calc(2 * var(--u)) calc(1.4 * var(--u)) calc(1.8 * var(--u)); border-left-width: calc(.9 * var(--u)); border-radius: calc(1.6 * var(--u));}
#bh.mob .msg .ic {width: calc(5.8 * var(--u)); height: calc(5.8 * var(--u)); border-radius: calc(1.3 * var(--u));}
#bh.mob .msg .ic svg {width: calc(3.6 * var(--u)); height: calc(3.6 * var(--u));}
#bh.mob .msg .t {font-size: calc(2.9 * var(--u));}
#bh.mob .msg .s {font-size: calc(2.3 * var(--u)); margin-top: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;}
#bh.mob .msg > div {min-width: 0;}
#bh.mob .msg .tm {font-size: calc(2 * var(--u));}
#bh.mob .dock {left: calc(2 * var(--u)); right: calc(2 * var(--u)); bottom: calc(2 * var(--u)); padding: calc(1.8 * var(--u)); gap: calc(1.2 * var(--u)) calc(1.8 * var(--u)); border-radius: calc(2.6 * var(--u));}
#bh.mob .grp {gap: calc(.9 * var(--u));}
#bh.mob .gh {font-size: calc(1.8 * var(--u)); gap: calc(1 * var(--u));}
#bh.mob .btn {height: calc(10.4 * var(--u)); gap: calc(.6 * var(--u)); border-radius: calc(1.8 * var(--u));}
#bh.mob .btn svg {width: calc(4.2 * var(--u)); height: calc(4.2 * var(--u));}
#bh.mob .btn span {font-size: calc(1.8 * var(--u));}
#bh.mob .deck {height: calc(7.4 * var(--u)); font-size: calc(2.4 * var(--u)); border-radius: calc(1.5 * var(--u));}
#bh.mob .mod {min-width: calc(18 * var(--u)); padding: calc(1 * var(--u)) calc(1.4 * var(--u)); gap: calc(.6 * var(--u)); border-radius: calc(1.5 * var(--u));}
#bh.mob .mod .mt {font-size: calc(2 * var(--u)); gap: calc(1 * var(--u));}
#bh.mob .mod .mt svg {width: calc(3 * var(--u)); height: calc(3 * var(--u));}
#bh.mob .mod .mn {font-size: calc(1.8 * var(--u));}
#bh.mob .mod .mb {height: calc(.9 * var(--u));}
#bh.mob .rooms {padding: calc(1.4 * var(--u)) calc(1.8 * var(--u)); gap: calc(.6 * var(--u)); border-radius: calc(2 * var(--u));}
#bh.mob .rooms h4 {font-size: calc(2 * var(--u));}
#bh.mob .rrow {font-size: calc(2.5 * var(--u)); padding: calc(.5 * var(--u)) calc(1 * var(--u));}
#bh.mob .rrow svg {width: calc(2.8 * var(--u)); height: calc(2.8 * var(--u));}
#bh.mob .rnote {font-size: calc(2.2 * var(--u));}
#bh.mob .course {font-size: calc(2.2 * var(--u)); padding: calc(1.2 * var(--u)) calc(2.6 * var(--u));}
#bh.desk .left {width: calc(42 * var(--u));}
#bh.desk .bars {padding: calc(1.6 * var(--u)); gap: calc(1 * var(--u));}
#bh.desk .bar {height: calc(5.4 * var(--u));}
#bh.desk .bar span {font-size: calc(2.8 * var(--u)); padding: 0 calc(1.8 * var(--u));}
#bh.desk .bar span b svg {width: calc(3.4 * var(--u)); height: calc(3.4 * var(--u));}
#bh.desk .rooms {padding: calc(1.6 * var(--u));}
#bh.desk .rrow {grid-template-columns: 1fr calc(7 * var(--u)) calc(6 * var(--u)); gap: calc(1.2 * var(--u)); font-size: calc(2.4 * var(--u));}
#bh.desk .rleg {gap: calc(1.4 * var(--u)) calc(2 * var(--u)); font-size: calc(2 * var(--u));}
#bh.desk .bar span {padding: 0 calc(1.4 * var(--u));}
#bh.desk .dock {display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 2fr) calc(21 * var(--u)); grid-template-areas: "fly time deck" "mod mod deck"; width: calc(170 * var(--u)); gap: calc(1.2 * var(--u)) calc(2.4 * var(--u)); padding: calc(1.8 * var(--u)) calc(2 * var(--u)); bottom: calc(2.4 * var(--u));}
#bh.desk .g-fly {grid-area: fly;}
#bh.desk .g-time {grid-area: time;}
#bh.desk .g-deck {grid-area: deck;}
#bh.desk .g-mod {grid-area: mod;}
#bh.desk .gh {font-size: calc(1.8 * var(--u));}
#bh.desk #deckNote {display: none;}
#bh.desk .grp {gap: calc(.9 * var(--u));}
#bh.desk .btn {flex-direction: row; height: calc(7.4 * var(--u)); gap: calc(1.2 * var(--u)); padding: 0 calc(1 * var(--u)); border-radius: calc(1.6 * var(--u));}
#bh.desk .btn svg {width: calc(3.8 * var(--u)); height: calc(3.8 * var(--u)); flex: none;}
#bh.desk .btn span {font-size: calc(2 * var(--u));}
#bh.desk .g-deck .grow {flex-direction: column; gap: calc(.9 * var(--u));}
#bh.desk .deck {flex: none; height: calc(5.4 * var(--u)); font-size: calc(2.4 * var(--u)); border-radius: calc(1.4 * var(--u));}
#bh.desk .mod {min-width: calc(17 * var(--u)); padding: calc(.9 * var(--u)) calc(1.3 * var(--u)); gap: calc(.5 * var(--u)); border-radius: calc(1.4 * var(--u));}
#bh.desk .mod .mt {font-size: calc(2 * var(--u)); gap: calc(1 * var(--u));}
#bh.desk .mod .mt svg {width: calc(3 * var(--u)); height: calc(3 * var(--u));}
#bh.desk .mod .mn {font-size: calc(1.8 * var(--u));}
#bh.desk .mod .mb {height: calc(.9 * var(--u));}
#bh.desk .msg {padding: calc(1.4 * var(--u)) calc(2 * var(--u)) calc(1.4 * var(--u)) calc(1.8 * var(--u)); grid-template-columns: calc(5.4 * var(--u)) 1fr auto;}
#bh.desk .msg .ic {width: calc(5.4 * var(--u)); height: calc(5.4 * var(--u));}
#bh.desk .msg .t {font-size: calc(2.7 * var(--u));}
#bh.desk .msg .s {font-size: calc(2.2 * var(--u)); margin-top: 0;}
#bh.desk .disp {width: calc(78 * var(--u));}
@media (prefers-reduced-motion: reduce) {#bh .msg, #bh .mk .core, #bh .bar.low, #bh .deck .al { animation: none !important; }}
`;
