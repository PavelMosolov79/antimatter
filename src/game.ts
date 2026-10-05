import type { GridBody } from './sim/body';
import { doorsOnDeck, ensureRooms, roomsOnDeck, setDoorOpen, type DoorInfo, type Room } from './sim/compartments';
import { isSolid } from './sim/gravity';
import { crewOnDeck, spawnCrew, type Crew } from './sim/crew';
import { shipEffects } from './sim/effects';
import type { EnergyPriority } from './sim/systems';
import { ENEMIES, SHIPS, buildFreighter, shipHoldCap } from './sim/ships';
import type { ShipGrid } from './sim/grid';
import { restAfterBattle } from './sim/run';
import { damageOf, quantaFor, quote, wreckOf, type Damage, type Quote } from './sim/repair';
import { QUANTA_PER_BOSS, QUANTA_PER_RUN, QUANTA_START, REPAIR, SPARE_SHIP } from './sim/repairConfig';
import { clearLayouts, savedLayout } from './sim/layoutStore';
import { CREW } from './sim/crewConfig';
import { ROLE_NAMES, abandonShip, emptyRoster, makeMember, ROLES, applyBattle, assign, autoFill, dutyOf, healPrice, healSpeedUpPrice, hire, hirePrice, inBarracks, loadRoster, postsOf, reconcile, refreshCandidates, release, settleHealing, startHeal, cure, staffShip, storeRoster, unassign, type DutyCrew, type ReportRow, type Roster } from './sim/roster';
import { entryOf, loadGarage, settle, speedUp, standing, storeGarage, type Garage, type RepairJob } from './sim/garage';
import { ENABLED, Road, encounterFor, type RoadPoint } from './sim/road';
import { addToHold, deposit, emptyCargo, previewAdd, rewardFor, type Cargo, type HoldResult } from './sim/cargo';
import { brokenModules, captureShip, loadRun, loadWallet, restoreShip, storeRun, storeWallet, type SavedRun, type SavedShip, type Wallet } from './sim/runSave';
import { mulberry32 } from './sim/rng';
import { SECTOR_IDS, buildArena, type SectorId } from './sim/space';
import { shipRef } from './sim/weapons';
import type { Module, TargetRef, WeaponState } from './sim/grid';
import { World, type WorldNote } from './sim/world';
import { Scene } from './render/scene';
import { OUTER_VIEW } from './render/shipView';

export type Tool = 'fly' | 'crater';
export type BattleState = 'playing' | 'won' | 'lost';
export type Mode = 'sandbox' | 'run';
export type RunPhase = 'dock' | 'roaddock' | 'map' | 'battle' | 'over';
export type RunOutcome = 'defeat';

/** The result of a won battle for the people: who got what, who was wounded, who died. */
export interface BattleReport {
  title: string;
  rows: ReportRow[];
}

/** A run in progress: the road, how far along it the player is, and the ship they carry between points. */
export interface RunSession {
  shipId: string;
  road: Road;
  /** Index of the last point cleared (0 is the start gate); the current mission is the next one. */
  cleared: number;
  outcome: RunOutcome | null;
  /** The player's ship as it left the last battle; null until the first fight builds it. */
  ship: GridBody | null;
  blueprint: ShipGrid;
  battlesWon: number;
  fighting: RoadPoint | null;
  note: string;
  /** What the hold carries: lost if the ship is, added to the player's resources at a dock. */
  cargo: Cargo;
  /** What the last dock took out of the hold, for the dock's animation. */
  deposited: Cargo | null;
  /** What was in the hold when the ship was lost, for the result screen. */
  lost: Cargo | null;
  /** The dock the player fell back to after losing the ship, for the result screen. */
  fellBackTo: number | null;
  /** What became of the crew when the ship was lost, for the result screen. */
  fate: string[];
  /** The named people who went into the battle in progress (who can be lost in it). */
  crewIds: number[];
  /** What the last battle did to the crew, shown once on the map. */
  report: BattleReport | null;
  /** The repair under way at the dock on the road, and the damage the ship came to it with. */
  job: RepairJob | null;
  diff: SavedShip | null;
}

/** What the dock shows of one ship's repair. */
export interface RepairState {
  shipId: string;
  where: 'home' | 'road';
  /** The damage right now, what a repair of it would cost, and the repair under way if there is one. */
  damage: Damage;
  quote: Quote;
  job: { p: number; left: number } | null;
  /** The damage the repair under way started with, as a difference from the blueprint, and when it started (its identity). */
  base: Damage | null;
  from: SavedShip | null;
  jobId: number;
}

export interface ShipStatus {
  kind: 'ready' | 'damaged' | 'repair' | 'wreck';
  /** Hull left (0..1) and, when a repair runs, the real seconds left. */
  hull: number;
  left: number;
}

export interface Scenario {
  id: string;
  label: string;
  enemies: string[];
}

export const SCENARIOS: Scenario[] = [
  { id: 'sandbox', label: 'Песочница', enemies: [] },
  { id: 'duel-raider', label: 'Дуэль: налётчик', enemies: ['raider'] },
  { id: 'duel-hunter', label: 'Дуэль: охотник', enemies: ['hunter'] },
  { id: 'three-scouts', label: '1 на 3: разведчики', enemies: ['scout', 'scout', 'scout'] },
  { id: 'squad', label: 'Отряд', enemies: ['raider', 'scout', 'hunter'] },
];

export const STEP = 1 / 60;

export interface WeaponRow {
  weapon: WeaponState;
  module: Module;
}

export class Game {
  world: World;
  readonly scene: Scene;
  tool: Tool = 'fly';
  crater = { radius: 5, damage: 60, pen: 0.6 };
  paused = false;
  slowMo = false;
  shipId = 'fighter';
  scenarioId = 'sandbox';
  state: BattleState = 'playing';
  mode: Mode = 'run';
  runPhase: RunPhase = 'dock';
  /** What's on screen: the title (loading screen and main menu) or the game itself. */
  screen: 'title' | 'game' = 'title';
  /** The player has been into the game since loading — the menu can offer "Continue". */
  hasSession = false;
  /** The sector the sandbox arena is in. */
  sandboxSector: SectorId = 'violet';
  run: RunSession | null = null;
  /** What the player owns outside any run (Кредиты, Металл): survives deaths and new runs. */
  wallet: Wallet = loadWallet();
  /** What the dock remembers of each ship: its damage and the repair under way. */
  garage: Garage = loadGarage();
  /** Every astronaut the player has: named people on ships and in the barracks, and the candidates the dock offers. */
  roster: Roster = loadRoster();
  /** Things the dock should say when it opens (a repair finished while the game was closed). */
  dockNotes: string[] = [];
  /** Short messages over the battle (what a wreck gave, what went off); each stays a few seconds. A `key` replaces the message with the same one. */
  toasts: Array<{ text: string; time: number; key?: string }> = [];
  private baseDamage = new WeakMap<RepairJob, Damage>();
  private bpCache = new Map<string, ShipGrid>();
  selectedWeapon: number | null = null;
  stepMs = 0;
  private acc = 0;
  private seed = 1;
  /** Called when a new game wipes everything (the screens forget the pictures they kept). */
  readonly onNewGame: Array<() => void> = [];

  constructor(scene: Scene) {
    this.scene = scene;
    this.ensureCrews();
    this.world = new World(this.seed);
    this.openDock();
  }

  get scenario(): Scenario {
    return SCENARIOS.find((s) => s.id === this.scenarioId) ?? SCENARIOS[0];
  }

  /** Sandbox: moves to another sector's arena (its sky, its planet), keeping the ship and the scenario. */
  setSector(id: SectorId): void {
    this.sandboxSector = id;
    if (this.mode === 'sandbox') this.reset();
  }

  reset(shipId = this.shipId, scenarioId = this.scenarioId): void {
    this.mode = 'sandbox';
    this.run = null;
    this.shipId = shipId;
    this.scenarioId = scenarioId;
    const spec = SHIPS.find((s) => s.id === shipId) ?? SHIPS[0];
    const lock = this.world ? this.world.lockFace : true;
    const autopilot = this.world ? this.world.autopilot : true;
    this.world = new World(this.seed++);
    this.world.lockFace = lock;
    this.world.autopilot = autopilot;
    // The sandbox arena is one sector's own: its planet, moon, star and (in the crimson one) black hole.
    const sectorSeed = this.seed * 977 + SECTOR_IDS.indexOf(this.sandboxSector);
    this.world.setCelestials(buildArena(mulberry32(sectorSeed), this.sandboxSector));
    this.world.sector = this.sandboxSector;
    this.world.skySeed = sectorSeed;
    this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true });
    const enemies = this.scenario.enemies;
    if (enemies.length === 0) {
      this.spawnTarget(150, -130, 0.5);
    } else {
      enemies.forEach((id, i) => {
        const es = ENEMIES.find((e) => e.id === id)!;
        const spread = enemies.length === 1 ? 0 : (i / (enemies.length - 1) - 0.5) * 1.5;
        const a = -Math.PI / 2 + spread;
        const ex = Math.cos(a) * 380;
        const ey = Math.sin(a) * 380;
        const heading = Math.atan2(-ex, ey);
        this.world.spawnShip(es.build(), ex, ey, heading, { name: es.label, team: 1, ai: es.ai });
      });
    }
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
  }

  // ---------------------------------------------------------------- run flow

  /**
   * The dock between runs (stand-in until MVP-4): pick a ship, then launch. Going back to it
   * from a run gives the run up, hold and all: only a dock on the road banks what the hold carries.
   */
  openDock(shipId = this.shipId): void {
    this.bankRunDamage();
    if (this.run) {
      this.run = null;
      storeRun(null);
    }
    this.mode = 'run';
    this.runPhase = 'dock';
    this.shipId = shipId;
    this.bpCache.clear();
    this.prepareCrew(shipId);
    this.tickRepairs(Date.now());
    this.buildDockWorld();
  }

  /** The ship at the home berth: whole, or as damaged (or as far repaired) as the garage remembers it. */
  private buildDockWorld(): void {
    const shipId = this.shipId;
    const spec = SHIPS.find((s) => s.id === shipId) ?? SHIPS[0];
    this.world = new World(this.seed++);
    const st = standing(entryOf(this.garage, shipId), this.blueprint(shipId), Date.now());
    if (st.diff) this.world.adoptPlayer(restoreShip(shipId, st.diff, this.duty(shipId)), 0, 0, 0);
    else this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true, duty: this.duty(spec.id) });
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
  }

  // ---------------------------------------------------------------- crew

  /** The named people on duty on a ship, for the simulation. */
  duty(shipId: string): DutyCrew[] {
    return dutyOf(this.roster, shipId);
  }

  /** A ship's first crew is given once; the people on a ship are put in order after its layout changed. */
  private ensureCrews(): void {
    let changed = false;
    const rng = mulberry32((Math.random() * 2 ** 31) >>> 0);
    for (const spec of SHIPS) {
      const grid = spec.build();
      if (!this.roster.staffed[spec.id]) {
        staffShip(this.roster, spec.id, grid, rng);
        this.roster.staffed[spec.id] = true;
        changed = true;
      } else reconcile(this.roster, spec.id, grid);
    }
    if (this.roster.candidates.length === 0) {
      refreshCandidates(this.roster);
      changed = true;
    }
    if (changed) storeRoster(this.roster);
  }

  /** The damage a ship has right now (at the berth, or the run's ship at a dock on the road), repairs under way counted. */
  private shipDiff(shipId: string, now = Date.now()): SavedShip | null {
    const bp = this.blueprint(shipId);
    const run = this.run;
    if (run && run.shipId === shipId && (this.runPhase === 'roaddock' || this.runPhase === 'map' || this.runPhase === 'battle')) {
      if (run.job) return standing({ damage: null, job: run.job }, bp, now).diff;
      if (this.runPhase === 'roaddock') return run.diff;
      return run.ship ? captureShip(run.ship, run.blueprint) : run.diff;
    }
    return standing(entryOf(this.garage, shipId), bp, now).diff;
  }

  /** The keys of the modules of a ship that are wrecked: nobody can be put on a post in one until the ship is mended. */
  brokenPosts(shipId: string): Set<number> {
    const diff = this.shipDiff(shipId);
    return diff ? brokenModules(this.blueprint(shipId), diff) : new Set();
  }

  /** Puts the people of a ship in order (nobody is added: the people are those the player has). */
  prepareCrew(shipId: string): void {
    reconcile(this.roster, shipId, this.blueprint(shipId));
    storeRoster(this.roster);
  }

  /**
   * The one exception to "no people from nowhere": a ship with nobody to fly it, no healthy pilot in the barracks and
   * almost no credits to hire one would never leave the dock, so the dock lends a trainee pilot. Returns his name.
   */
  private emergencyPilot(shipId: string): string | null {
    if (!this.noPilot(shipId)) return null;
    const r = this.roster;
    if (inBarracks(r).some((m) => m.role === 'pilot' && m.status === 'ok')) return null;
    if (this.wallet.credits >= CREW.emergencyCredits) return null;
    const broken = this.brokenPosts(shipId);
    const post = postsOf(this.blueprint(shipId)).find((p) => p.role === 'pilot' && !p.reserve && !broken.has(p.key));
    if (!post) return null;
    const m = makeMember(r, mulberry32((Math.random() * 2 ** 31) >>> 0), 'pilot', CREW.starterLevel, 1);
    m.ship = shipId;
    m.post = post.key;
    r.members.push(m);
    storeRoster(r);
    return m.name;
  }

  /** Is there somebody to fly the ship? Without a pilot on a post that stands (or a whole reserve helm) it cannot fly. */
  noPilot(shipId: string): boolean {
    const broken = this.brokenPosts(shipId);
    const grid = this.blueprint(shipId);
    const spareHelm = grid.modules.some((m) => m.kind === 'bridge' && !broken.has(m.key) && postsOf(grid).some((p) => p.key === m.key && p.reserve));
    return !this.duty(shipId).some((d) => d.role === 'pilot' && d.post !== null && (!broken.has(d.post) || spareHelm));
  }

  /** What stops the run's ship from setting off, in words; null when nothing does. */
  flightBlock(): string | null {
    const run = this.run;
    if (!run) return null;
    return this.noPilot(run.shipId) ? 'Нет пилота: без него корабль не взлетит. Поставьте пилота на пост в комнате «Экипаж» на доке (разрушенный мостик сначала чинят).' : null;
  }

  /**
   * After a won battle: the dead go to the memory and the wounded to the barracks. Nobody is replaced on the way:
   * a post that lost its man stays empty until the next dock, where the player hires and posts people. The ship's
   * crew is made again from the roster. Returns what to tell the player.
   */
  private crewAfterBattle(ship: GridBody, shipId: string, kind: string): ReportRow[] {
    const crew = ship.sys?.crew ?? [];
    const { rows } = applyBattle(
      this.roster,
      shipId,
      crew.map((c) => ({ memberId: c.memberId, dead: c.dead, hurt: c.hurt, deed: c.deed })),
      new Set(this.run?.crewIds ?? []),
      CREW.xpBattle[kind] ?? CREW.xpBattle.combat,
    );
    storeRoster(this.roster);
    if (ship.sys) ship.sys.crew = spawnCrew(ship.grid, this.duty(shipId));
    return rows;
  }

  /** The crew of the run's ship at a dock on the road was changed: the ship gets it. */
  syncRunCrew(): void {
    const run = this.run;
    if (!run?.ship?.sys) return;
    run.ship.sys.crew = spawnCrew(run.ship.grid, this.duty(run.shipId));
  }

  /** Pays for a wounded person's healing and starts the clock. */
  healMember(id: number): 'ok' | 'credits' | 'none' {
    const m = this.roster.members.find((x) => x.id === id);
    if (!m || m.status !== 'hurt' || m.healEnd) return 'none';
    if (!this.spendWallet({ credits: healPrice(m), metal: 0 })) return 'credits';
    startHeal(this.roster, id, Date.now());
    storeRoster(this.roster);
    return 'ok';
  }

  /** Finishes a healing at once for quanta. */
  speedUpHealing(id: number): 'ok' | 'quanta' | 'none' {
    const m = this.roster.members.find((x) => x.id === id);
    if (!m || m.status !== 'hurt' || !m.healEnd) return 'none';
    const price = healSpeedUpPrice(m, Date.now());
    if (this.wallet.quanta < price) return 'quanta';
    this.wallet.quanta -= price;
    storeWallet(this.wallet);
    cure(this.roster, id);
    storeRoster(this.roster);
    return 'ok';
  }

  /** Hires a candidate for credits into the barracks. */
  hireCandidate(id: number): 'ok' | 'credits' | 'full' | 'none' {
    const m = this.roster.candidates.find((x) => x.id === id);
    if (!m) return 'none';
    if (inBarracks(this.roster).length >= CREW.barracksMax) return 'full';
    if (!this.spendWallet({ credits: hirePrice(m), metal: 0 })) return 'credits';
    hire(this.roster, id);
    storeRoster(this.roster);
    return 'ok';
  }

  /** A new list of candidates for a few credits. */
  refreshCandidatesPaid(): boolean {
    if (!this.spendWallet({ credits: CREW.refreshPrice, metal: 0 })) return false;
    refreshCandidates(this.roster);
    storeRoster(this.roster);
    return true;
  }

  /** Posts a person on the ship at the berth (post null: an engineer). */
  postMember(id: number, shipId: string, post: number | null): boolean {
    if (post !== null && this.brokenPosts(shipId).has(post)) return false;
    const ok = assign(this.roster, id, shipId, post);
    if (ok) storeRoster(this.roster);
    return ok;
  }

  unpostMember(id: number): void {
    unassign(this.roster, id);
    storeRoster(this.roster);
  }

  releaseMember(id: number): void {
    release(this.roster, id);
    storeRoster(this.roster);
  }

  /** Puts the best people from the barracks on the empty posts and places of a ship. */
  autoPost(shipId: string): number {
    const n = autoFill(this.roster, shipId, this.blueprint(shipId), this.brokenPosts(shipId)).length;
    if (n) storeRoster(this.roster);
    return n;
  }

  /** The ship as built (with the player's layout), kept while the dock is open. */
  blueprint(shipId: string): ShipGrid {
    let g = this.bpCache.get(shipId);
    if (!g) {
      g = (SHIPS.find((s) => s.id === shipId) ?? SHIPS[0]).build();
      this.bpCache.set(shipId, g);
    }
    return g;
  }

  // ---------------------------------------------------------------- repair

  /** Where the repair of a ship stands now: the damage, what a repair costs, the one under way. */
  repairState(shipId = this.shipId, now = Date.now()): RepairState {
    const bp = this.blueprint(shipId);
    const run = this.run;
    const road = this.runPhase === 'roaddock' && !!run && run.shipId === shipId;
    let diff: SavedShip | null;
    let job: RepairJob | null = null;
    let p = 0;
    let left = 0;
    if (road && run) {
      if (run.job) {
        const st = standing({ damage: null, job: run.job }, bp, now);
        diff = st.diff;
        job = run.job;
        p = st.p;
        left = st.left;
      } else diff = run.diff;
    } else {
      const e = entryOf(this.garage, shipId);
      const st = standing(e, bp, now);
      diff = st.diff;
      if (e.job) {
        job = e.job;
        p = st.p;
        left = st.left;
      }
    }
    const damage = damageOf(diff, bp);
    const where = road ? 'road' : 'home';
    let base: Damage | null = null;
    if (job) {
      base = this.baseDamage.get(job) ?? null;
      if (!base) {
        base = damageOf(job.from, bp);
        this.baseDamage.set(job, base);
      }
    }
    return { shipId, where, damage, quote: quote(damage, shipId, where), job: job ? { p, left } : null, base, from: job ? job.from : null, jobId: job ? job.start : 0 };
  }

  /** The state of a ship for the fleet list. */
  shipStatus(shipId: string, now = Date.now()): ShipStatus {
    const st = this.repairState(shipId, now);
    if (st.job) return { kind: 'repair', hull: st.damage.hull, left: st.job.left };
    if (st.damage.wreck) return { kind: 'wreck', hull: st.damage.hull, left: 0 };
    return { kind: st.damage.any ? 'damaged' : 'ready', hull: st.damage.hull, left: 0 };
  }

  /** Starts the repair of the ship at the dock: pays the metal, begins the one timer. */
  startRepair(): 'ok' | 'metal' | 'none' {
    const st = this.repairState();
    if (st.job || !st.damage.any) return 'none';
    if (!this.spendWallet({ credits: 0, metal: st.quote.metal })) return 'metal';
    const bp = this.blueprint(st.shipId);
    const run = this.run;
    const from = st.where === 'road' && run ? run.diff : standing(entryOf(this.garage, st.shipId), bp, Date.now()).diff;
    // the clock starts when the repair drones have flown to the ship
    const job: RepairJob = { start: Date.now() + REPAIR.droneLead * 1000, total: st.quote.secs, from, where: st.where };
    if (st.where === 'road' && run) {
      run.job = job;
      this.saveRun();
    } else {
      const e = entryOf(this.garage, st.shipId);
      e.damage = from;
      e.job = job;
      storeGarage(this.garage);
    }
    return 'ok';
  }

  /** The premium price of speeding the repair up (half the time left, or all of it); null with no repair running. */
  speedUpPrice(mode: 'half' | 'full'): number | null {
    const st = this.repairState();
    if (!st.job) return null;
    return quantaFor(mode === 'half' ? st.job.left / 2 : st.job.left);
  }

  speedUpRepair(mode: 'half' | 'full'): boolean {
    const price = this.speedUpPrice(mode);
    const st = this.repairState();
    if (price === null || !st.job || this.wallet.quanta < price) return false;
    this.wallet.quanta -= price;
    storeWallet(this.wallet);
    const job = st.where === 'road' && this.run ? this.run.job : entryOf(this.garage, st.shipId).job;
    if (!job) return false;
    speedUp(job, Date.now(), mode);
    if (st.where === 'road') this.saveRun();
    else storeGarage(this.garage);
    this.tickRepairs(Date.now());
    return true;
  }

  /**
   * Called every frame at the dock: finishes the repairs whose time is up (a ship repaired while
   * the game was closed too) and, while one runs, repaints the ship at the berth now and then.
   * Returns true when something finished.
   */
  tickRepairs(now: number): boolean {
    let finished = false;
    for (const [id, e] of Object.entries(this.garage)) {
      if (settle(e, now)) {
        const spec = SHIPS.find((s) => s.id === id);
        this.dockNotes.push(`Ремонт закончен: ${spec?.label ?? id}.`);
        finished = true;
      }
    }
    const run = this.run;
    if (run?.job && now - run.job.start >= run.job.total * 1000) {
      run.ship = null;
      run.diff = null;
      run.job = null;
      this.dockNotes.push('Ремонт закончен: корабль как новый.');
      this.saveRun();
      finished = true;
    }
    const healed = settleHealing(this.roster, now);
    if (healed > 0) {
      storeRoster(this.roster);
      this.dockNotes.push(healed === 1 ? 'Раненый выздоровел.' : `Выздоровели: ${healed}.`);
    }
    if (finished) storeGarage(this.garage);
    // while a repair runs the dock repaints the ship itself, cell by cell (the drones work); the berth is rebuilt only when it ends
    if (finished) {
      if (this.runPhase === 'dock' || this.runPhase === 'roaddock') this.refreshDockShip();
    }
    return finished;
  }

  /** Builds the ship at the berth again from the repair's progress, so the dock shows it mended. */
  refreshDockShip(): void {
    if (this.mode !== 'run') return;
    if (this.runPhase === 'dock') {
      this.buildDockWorld();
      return;
    }
    const run = this.run;
    if (this.runPhase !== 'roaddock' || !run) return;
    const spec = SHIPS.find((s) => s.id === run.shipId) ?? SHIPS[0];
    let body: GridBody | null = run.ship;
    if (run.job) {
      const st = standing({ damage: null, job: run.job }, this.blueprint(run.shipId), Date.now());
      body = st.diff ? restoreShip(run.shipId, st.diff, this.duty(run.shipId)) : null;
    }
    this.world = new World(this.seed++);
    if (body) this.world.adoptPlayer(body, 0, 0, 0);
    else this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true, duty: this.duty(spec.id) });
    this.state = 'playing';
    this.scene.reset(this.world);
    this.acc = 0;
  }

  /** Pays for something from what the player owns outside a run (Кредиты, Металл); false if it is not enough. */
  spendWallet(c: Cargo): boolean {
    if (this.wallet.credits < c.credits || this.wallet.metal < c.metal) return false;
    this.wallet.credits -= c.credits;
    this.wallet.metal -= c.metal;
    storeWallet(this.wallet);
    return true;
  }

  /** What a new game would wipe, for the question that asks before it does. */
  newGameSummary(): { credits: number; metal: number; quanta: number; run: { mission: number; credits: number; metal: number } | null; people: number; fallen: number; damaged: number; upgraded: number } {
    const run = this.run;
    const d = run ? null : this.savedRun();
    const w = this.wallet;
    let upgraded = 0;
    for (const spec of SHIPS) for (const m of savedLayout(spec.id)?.mods ?? []) if ((m.lv ?? 1) > 1) upgraded++;
    const damaged = Object.values(this.garage).filter((e) => e.damage || e.job).length;
    const cargo = run ? run.cargo : d?.cargo;
    const mission = run ? run.road.missionsDone(run.cleared) + 1 : d ? new Road(d.seed, d.links, d.regens).missionsDone(d.cleared) + 1 : 0;
    return {
      credits: w.credits,
      metal: w.metal,
      quanta: w.quanta,
      run: cargo ? { mission, credits: cargo.credits, metal: cargo.metal } : null,
      people: this.roster.members.length,
      fallen: this.roster.memory.length,
      damaged,
      upgraded,
    };
  }

  /**
   * A new game from nothing: the run, the hold, the resources, the damage and repairs of every ship, all the people
   * (the living, the wounded, the dead in the memory) and the module layouts with their levels are gone; every ship
   * gets its first crew again. It ends at the dock of the first ship.
   */
  newGame(): void {
    this.run = null;
    storeRun(null);
    this.wallet = { credits: 0, metal: 0, quanta: QUANTA_START };
    storeWallet(this.wallet);
    this.garage = {};
    storeGarage(this.garage);
    clearLayouts();
    this.bpCache.clear();
    this.roster = emptyRoster();
    this.ensureCrews();
    this.dockNotes = [];
    for (const f of this.onNewGame) f();
    this.openDock(SHIPS[0].id);
  }

  /** Throws away the run in progress, in memory or saved in the browser: the hold goes with it. */
  abandonRun(): void {
    this.bankRunDamage();
    this.run = null;
    storeRun(null);
  }

  /** A run given up leaves its ship in the garage as damaged as it was (a repair on the road counts as far as it got). */
  private bankRunDamage(): void {
    const run = this.run;
    if (!run) return;
    const bp = this.blueprint(run.shipId);
    const ship = this.runShip();
    let diff: SavedShip | null;
    if (run.job) diff = standing({ damage: null, job: run.job }, bp, Date.now()).diff;
    else if (this.runPhase === 'roaddock') diff = run.diff ?? (run.ship ? captureShip(run.ship, run.blueprint) : null);
    else if (ship) diff = captureShip(ship, run.blueprint);
    else return;
    const e = entryOf(this.garage, run.shipId);
    e.damage = diff;
    e.job = null;
    storeGarage(this.garage);
  }

  /** Is there a run to continue, here or in the browser's save? */
  hasRun(): boolean {
    return !!this.run || !!loadRun();
  }

  /** Leaves for a run on the ship at the berth, as damaged as it is; false while a repair on it runs. */
  startRun(): boolean {
    const spec = SHIPS.find((s) => s.id === this.shipId) ?? SHIPS[0];
    const entry = entryOf(this.garage, spec.id);
    // no flight while a repair runs, and a wreck is not a ship that can fly
    if (entry.job || entry.damage?.allDead) return false;
    this.prepareCrew(spec.id);
    const lent = this.emergencyPilot(spec.id);
    if (lent) this.dockNotes.push(`Нет пилота и нечем платить за найм: док одолжил курсанта-пилота, ${lent}.`);
    if (this.noPilot(spec.id)) {
      this.dockNotes.push('Нет пилота: без него корабль не взлетит. Поставьте пилота на пост в комнате «Экипаж».');
      return false;
    }
    const diff = entry.damage;
    this.bpCache.clear();
    this.run = {
      shipId: spec.id,
      road: new Road((Math.random() * 2 ** 31) >>> 0),
      cleared: 0,
      outcome: null,
      ship: diff ? restoreShip(spec.id, diff, this.duty(spec.id)) : null,
      blueprint: spec.build(),
      battlesWon: 0,
      fighting: null,
      note: diff ? 'Вылет на недочинённом корабле. Впереди первая миссия.' : 'Вылет из дока. Впереди первая миссия.',
      cargo: emptyCargo(),
      deposited: null,
      lost: null,
      fellBackTo: null,
      fate: [],
      crewIds: [],
      report: null,
      job: null,
      diff: null,
    };
    // the ship is out on the run now; if the run is given up its damage is put back in the garage
    entry.damage = null;
    storeGarage(this.garage);
    // until a tutorial hands them out, every new run starts with the premium stand-in topped up
    if (this.wallet.quanta < QUANTA_PER_RUN) {
      this.wallet.quanta = QUANTA_PER_RUN;
      storeWallet(this.wallet);
    }
    this.runPhase = 'map';
    this.saveRun();
    return true;
  }

  // ---------------------------------------------------------------- saving

  /** The run as it stands, written to the browser after every point (never in the middle of a battle). */
  saveRun(): void {
    const run = this.run;
    if (!run || this.runPhase === 'battle') return;
    const saved: SavedRun = {
      v: 1,
      seed: run.road.seed,
      links: run.road.links,
      regens: [...run.road.regens],
      shipId: run.shipId,
      cleared: run.cleared,
      cargo: { ...run.cargo },
      battlesWon: run.battlesWon,
      // After a lost ship the result screen is not saved: a reload goes to the dock the run fell back to.
      phase: this.runPhase === 'roaddock' || this.runPhase === 'over' ? 'roaddock' : 'map',
      note: run.note,
      ship: run.ship ? captureShip(run.ship, run.blueprint) : null,
      job: run.job,
    };
    storeRun(saved);
  }

  /** A run saved in the browser, if any (for the main menu's "Continue"). */
  savedRun(): SavedRun | null {
    return loadRun();
  }

  /** Picks the saved run up where it was left: on the road, or at the dock it stopped at. */
  continueSaved(): boolean {
    const d = loadRun();
    if (!d) return false;
    const spec = SHIPS.find((s) => s.id === d.shipId) ?? SHIPS[0];
    const road = new Road(d.seed, d.links, d.regens);
    this.shipId = spec.id;
    this.mode = 'run';
    this.run = {
      shipId: spec.id,
      road,
      cleared: d.cleared,
      outcome: null,
      ship: d.ship ? restoreShip(spec.id, d.ship, this.duty(spec.id)) : null,
      blueprint: spec.build(),
      battlesWon: d.battlesWon,
      fighting: null,
      note: d.note,
      cargo: { ...d.cargo },
      deposited: null,
      lost: null,
      fellBackTo: null,
      fate: [],
      crewIds: [],
      report: null,
      job: d.job ?? null,
      diff: d.ship ?? null,
    };
    road.ensure(d.cleared);
    if (d.phase === 'roaddock') this.enterRoadDock(false);
    else this.runPhase = 'map';
    this.hasSession = true;
    return true;
  }

  // ---------------------------------------------------------------- the road

  /** The point the player flies to next: the road has no forks, so there is exactly one. */
  canTravel(index: number): boolean {
    const run = this.run;
    if (!run || this.runPhase !== 'map') return false;
    if (this.flightBlock()) return false;
    return index === run.cleared + 1 && !!run.road.points[index];
  }

  travel(index: number): void {
    const run = this.run;
    if (!run || !this.canTravel(index)) return;
    const point = run.road.points[index];
    if (point.kind === 'combat' || point.kind === 'elite' || point.kind === 'boss') {
      this.startBattle(point);
      return;
    }
    run.cleared = index;
    if (point.kind === 'dock' || point.kind === 'gate') {
      this.enterRoadDock(true);
      return;
    }
    run.note = ENABLED[point.kind] ? '' : 'Эта точка пока пуста.';
    run.road.ensure(run.cleared);
    this.saveRun();
  }

  /**
   * The dock on the road: the hold is emptied into the player's resources, the hull is
   * patched (until repairs run on timers at the dock) and the dock screen opens on the
   * ship as it is.
   */
  private enterRoadDock(arriving: boolean): void {
    const run = this.run!;
    const point = run.road.points[run.cleared];
    if (arriving) {
      run.deposited = deposit(run.cargo, this.wallet);
      storeWallet(this.wallet);
      if (run.ship) {
        restAfterBattle(run.ship);
        run.diff = captureShip(run.ship, run.blueprint);
        run.note = `${point.kind === 'gate' ? 'Врата и док' : 'Док'}: корабль в доке. Починить можно в комнате «Ремонт».`;
      } else {
        run.diff = null;
        run.note = 'Док: корабль цел, чинить нечего.';
      }
      run.job = null;
      run.road.ensure(run.cleared);
    } else run.deposited = null;
    if (arriving) {
      const lent = this.emergencyPilot(run.shipId);
      if (lent) this.dockNotes.push(`Нет пилота и нечем платить за найм: док одолжил курсанта-пилота, ${lent}.`);
    }
    const spec = SHIPS.find((s) => s.id === run.shipId) ?? SHIPS[0];
    this.world = new World(this.seed++);
    if (run.ship) this.world.adoptPlayer(run.ship, 0, 0, 0);
    else run.ship = this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true, duty: this.duty(spec.id) });
    this.runPhase = 'roaddock';
    if (arriving && run.ship?.sys) run.ship.sys.crew = spawnCrew(run.ship.grid, this.duty(run.shipId));
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
    this.saveRun();
  }

  /** Leaves the dock on the road: back to the map, on to the next point. */
  leaveRoadDock(): void {
    if (this.runPhase !== 'roaddock' || !this.run) return;
    const run = this.run;
    // a repair not finished leaves with the ship as far as it got
    if (run.job) {
      const bp = this.blueprint(run.shipId);
      const st = standing({ damage: null, job: run.job }, bp, Date.now());
      run.ship = st.diff ? restoreShip(run.shipId, st.diff, this.duty(run.shipId)) : null;
      run.diff = st.diff;
      run.job = null;
    }
    this.run.deposited = null;
    this.runPhase = 'map';
    this.saveRun();
  }

  /** What winning the fight in progress would put in the hold, and what wouldn't fit. */
  pendingReward(): HoldResult | null {
    const run = this.run;
    if (!run || !run.fighting) return null;
    return previewAdd(run.cargo, shipHoldCap(run.shipId), rewardFor(run.fighting));
  }

  private startBattle(point: RoadPoint): void {
    const run = this.run!;
    const enc = encounterFor(point);
    const spec = SHIPS.find((s) => s.id === run.shipId) ?? SHIPS[0];
    const lock = this.world.lockFace;
    const autopilot = this.world.autopilot;
    this.world = new World(this.seed++);
    this.world.lockFace = lock;
    this.world.autopilot = autopilot;
    this.world.setCelestials(enc.celestials);
    this.world.sector = enc.sector;
    this.world.skySeed = enc.skySeed;
    if (run.ship) this.world.adoptPlayer(run.ship, 0, 0, 0);
    else run.ship = this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true, duty: this.duty(spec.id) });
    enc.enemies.forEach((id, i) => {
      const es = ENEMIES.find((e) => e.id === id)!;
      const spread = enc.enemies.length === 1 ? 0 : (i / (enc.enemies.length - 1) - 0.5) * 1.5;
      const a = -Math.PI / 2 + spread;
      const dist = id === 'boss' ? 520 : 380;
      const ex = Math.cos(a) * dist;
      const ey = Math.sin(a) * dist;
      this.world.spawnShip(es.build(), ex, ey, Math.atan2(-ex, ey), { name: es.label, team: 1, ai: es.ai });
    });
    run.crewIds = (run.ship?.sys?.crew ?? []).flatMap((c) => (c.memberId === null ? [] : [c.memberId]));
    run.fighting = point;
    this.runPhase = 'battle';
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
  }

  /** After the battle's end screen: the winnings go into the hold and the player is back on the road; a lost ship ends in the result screen. */
  continueRun(): void {
    const run = this.run;
    if (!run || this.runPhase !== 'battle') return;
    const point = run.fighting!;
    const ship = this.world.player;
    if (this.state === 'lost' || !ship) {
      this.loseShip(ship);
      return;
    }
    run.ship = ship;
    restAfterBattle(ship);
    const rows = this.crewAfterBattle(ship, run.shipId, point.kind);
    run.battlesWon++;
    const got = addToHold(run.cargo, shipHoldCap(run.shipId), rewardFor(point));
    run.cleared = point.index;
    run.fighting = null;
    run.road.ensure(run.cleared);
    const name = point.kind === 'boss' ? 'Рубеж взят' : point.kind === 'elite' ? 'Элитный бой выигран' : 'Бой выигран';
    run.note = `${name}: в трюм +${got.gained.credits} кр. и +${got.gained.metal} мет.` + (got.lostMetal > 0 ? ` (трюм полон, ${got.lostMetal} мет. не влезло)` : '');
    if (point.kind === 'boss') {
      this.wallet.quanta += QUANTA_PER_BOSS;
      storeWallet(this.wallet);
      run.note += ` +${QUANTA_PER_BOSS} квант за рубеж.`;
    }
    if (rows.length) run.report = { title: point.kind === 'boss' ? 'Рубеж взят' : point.kind === 'elite' ? 'Элитный бой выигран' : 'Бой выигран', rows };
    if (rows.some((r) => r.fate !== 'ok')) run.note += ' Посты опустели до ближайшего дока.';
    const block = this.flightBlock();
    if (block) run.note += ' ' + block;
    this.runPhase = 'map';
    this.saveRun();
  }

  /** The ship is gone: what it carried goes with it, and the run falls back to the last dock on a whole ship of the same class. */
  private loseShip(ship: GridBody | null): void {
    const run = this.run!;
    // the crew takes to the escape pods that are still whole; without them nobody gets away
    const fx = ship ? shipEffects(ship.grid) : null;
    const out = abandonShip(this.roster, run.shipId, { seats: fx?.podSeats ?? 0, chance: fx?.podChance ?? 0, med: fx?.rescue ?? 0 }, Math.random);
    run.fate = [];
    if (out.saved.length) run.fate.push(`Капсулы: спаслись ${out.saved.map((m) => m.name).join(', ')} (ранены).`);
    if (out.lost.length) run.fate.push(`Погибли с кораблём: ${out.lost.map((f) => `${f.name} (${ROLE_NAMES[f.role]}, ур. ${f.lv})`).join(', ')}.`);
    if (!fx || fx.podSeats === 0) run.fate.push('Спасательных капсул на корабле не было.');
    const dock = run.road.lastDock(run.cleared);
    run.lost = { ...run.cargo };
    run.cargo = emptyCargo();
    run.fellBackTo = dock;
    run.cleared = dock;
    run.road.regenAfter(dock);
    run.road.ensure(run.cleared);
    run.ship = null;
    run.fighting = null;
    run.job = null;
    run.diff = null;
    // a ship lost stays in the garage as a wreck (the spare is always there, so it is never out of action); the run goes on at the dock on the spare
    if (run.shipId !== SPARE_SHIP) {
      const e = entryOf(this.garage, run.shipId);
      e.damage = wreckOf(this.blueprint(run.shipId));
      e.job = null;
      storeGarage(this.garage);
      run.shipId = SPARE_SHIP;
      run.blueprint = this.blueprint(SPARE_SHIP);
      this.shipId = SPARE_SHIP;
    }
    run.outcome = 'defeat';
    this.runPhase = 'over';
    this.saveRun();
  }

  /** From the result screen after a lost ship back to the road, at the dock. */
  resumeAfterLoss(): void {
    const run = this.run;
    if (!run || this.runPhase !== 'over') return;
    run.outcome = null;
    run.lost = null;
    run.note = run.shipId === SPARE_SHIP ? 'Вы получили запасной истребитель у последнего дока. Участок дороги собран заново.' : 'Вы получили такой же целый корабль у последнего дока. Участок дороги собран заново.';
    this.enterRoadDock(true);
  }

  /** Falls back to the last dock on purpose: the hold is deposited there, the points past it don't count and the stretch is written anew. */
  retreat(): void {
    const run = this.run;
    if (!run || this.runPhase !== 'map') return;
    const dock = run.road.lastDock(run.cleared);
    if (dock === run.cleared) return;
    run.cleared = dock;
    run.road.regenAfter(dock);
    this.enterRoadDock(true);
  }

  /** How many points back the last dock is, for the warning on a dangerous point. */
  pointsToDock(): number {
    const run = this.run;
    return run ? run.cleared - run.road.lastDock(run.cleared) : 0;
  }

  /** The run's ship as it is right now — mid-battle a hull split may have replaced the body. */
  private runShip(): GridBody | null {
    const run = this.run;
    if (!run) return null;
    return this.runPhase === 'battle' ? this.world.player : run.ship;
  }

  /** Hull left on the carried ship, as a share of the ship as built. */
  runHull(): number {
    const run = this.run;
    if (!run) return 1;
    const ship = this.runShip();
    if (ship) return ship.grid.cells / run.blueprint.cells;
    // No ship yet (before the first battle) is a whole one; no ship any more is a lost one.
    return this.runPhase === 'battle' || run.outcome === 'defeat' ? 0 : 1;
  }

  runCrewAlive(): number {
    const crew = this.runShip()?.sys?.crew;
    return crew ? crew.filter((c) => !c.dead).length : 0;
  }

  spawnTarget(x?: number, y?: number, angle?: number): GridBody {
    const p = this.world.player;
    const ang = this.world.rng() * Math.PI * 2;
    const dist = 130 + this.world.rng() * 80;
    const cx = x ?? (p ? p.x : 0) + Math.cos(ang) * dist;
    const cy = y ?? (p ? p.y : 0) + Math.sin(ang) * dist;
    const b = this.world.spawn(buildFreighter(), cx, cy, angle ?? this.world.rng() * Math.PI * 2, 'ship');
    b.w = (this.world.rng() - 0.5) * 0.3;
    return b;
  }

  /**
   * Sandbox: a ship of the given enemy kind appears some way off the player, facing it.
   * An ally flies for the player's side (same team) and picks fights with the enemies.
   */
  spawnShip(id: string, ally = false): void {
    if (this.mode === 'run') return;
    const es = ENEMIES.find((e) => e.id === id);
    if (!es) return;
    const p = this.world.player;
    const a = this.world.rng() * Math.PI * 2;
    const dist = ally ? 120 : id === 'boss' ? 560 : 360;
    const x = (p ? p.x : 0) + Math.cos(a) * dist;
    const y = (p ? p.y : 0) + Math.sin(a) * dist;
    const heading = p ? Math.atan2(p.x - x, -(p.y - y)) : 0;
    this.world.spawnShip(es.build(), x, y, ally ? (p?.angle ?? 0) : heading, { name: ally ? 'Союзник' : es.label, team: ally ? 0 : 1, ai: es.ai });
  }

  /** Sandbox: everything but the player's own ship leaves the scene. */
  clearScene(): void {
    if (this.mode === 'run') return;
    for (const b of this.world.bodies) if (b !== this.world.player) b.removed = true;
    this.clearTargets();
  }

  breakEngine(): void {
    const p = this.world.player;
    if (!p) return;
    const engines = p.grid.modules.filter((m) => m.kind === 'engine' && m.coreAlive);
    if (engines.length === 0) return;
    const m = engines[Math.floor(this.world.rng() * engines.length)];
    const x = p.grid.xOf(m.core);
    const y = p.grid.yOf(m.core);
    const wp = p.localToWorld(x + 0.5, y + 0.5, { x: 0, y: 0 });
    this.world.explode(wp.x, wp.y, 3.2, 200, 0.4);
  }

  weaponRows(): WeaponRow[] {
    const p = this.world.player;
    if (!p) return [];
    const rows: WeaponRow[] = [];
    for (const m of p.grid.modules) if (m.weapon) rows.push({ weapon: m.weapon, module: m });
    return rows.sort((a, b) => a.weapon.id - b.weapon.id);
  }

  selectWeapon(id: number): void {
    this.selectedWeapon = this.selectedWeapon === id ? null : id;
  }

  toggleWeapon(id: number): void {
    const row = this.weaponRows().find((r) => r.weapon.id === id);
    if (row) row.weapon.enabled = !row.weapon.enabled;
  }

  setPriority(p: EnergyPriority): void {
    const sys = this.world.player?.sys;
    if (sys) sys.priority = p;
  }

  setLockFace(v: boolean): void {
    this.world.lockFace = v;
  }

  clearTargets(): void {
    const sys = this.world.player?.sys;
    if (sys) sys.focus = null;
    for (const r of this.weaponRows()) r.weapon.target = null;
    this.selectedWeapon = null;
  }

  private assignTarget(ref: TargetRef): void {
    const sys = this.world.player?.sys;
    if (!sys) return;
    if (this.selectedWeapon !== null) {
      const row = this.weaponRows().find((r) => r.weapon.id === this.selectedWeapon);
      if (row) row.weapon.target = ref;
      this.selectedWeapon = null;
    } else {
      sys.focus = ref;
      for (const r of this.weaponRows()) r.weapon.target = null;
    }
  }

  pickEnemy(wx: number, wy: number): TargetRef | null {
    const p = this.world.player;
    if (!p?.sys) return null;
    let best: { ref: TargetRef; d: number } | null = null;
    for (const b of this.world.bodies) {
      if (b.removed || b.kind !== 'ship' || !b.sys || b.sys.dead || b.sys.team === p.sys.team) continue;
      const lp = b.worldToLocal(wx, wy, { x: 0, y: 0 });
      let bd = Infinity;
      let bx = 0;
      let by = 0;
      const ix = Math.floor(lp.x);
      const iy = Math.floor(lp.y);
      for (let j = -3; j <= 3; j++) {
        for (let i = -3; i <= 3; i++) {
          if (!b.grid.isOccupied(ix + i, iy + j)) continue;
          const cx = ix + i + 0.5;
          const cy = iy + j + 0.5;
          const d = Math.hypot(cx - lp.x, cy - lp.y);
          if (d < bd) {
            bd = d;
            bx = cx;
            by = cy;
          }
        }
      }
      if (bd <= 3.5) {
        if (!best || bd < best.d) best = { ref: shipRef(b, bx, by), d: bd };
      } else {
        const dc = Math.hypot(b.x - wx, b.y - wy);
        if (dc < b.radius + 3 && (!best || dc + 4 < best.d)) best = { ref: shipRef(b), d: dc + 4 };
      }
    }
    return best ? best.ref : null;
  }

  private evaluate(): void {
    if (this.state !== 'playing') return;
    if (this.mode === 'run' ? this.runPhase !== 'battle' : this.scenario.enemies.length === 0) return;
    if (!this.world.player) {
      this.state = 'lost';
      return;
    }
    const enemyAlive = this.world.bodies.some((b) => !b.removed && b.kind === 'ship' && b.sys && !b.sys.dead && b.sys.team === 1);
    // A ship whose own reactor is already counting down hasn't won anything yet.
    if (!enemyAlive && (this.world.player.sys?.countdown ?? -1) < 0) this.state = 'won';
  }

  toast(text: string, key?: string): void {
    const now = performance.now();
    const old = key ? this.toasts.find((t) => t.key === key) : undefined;
    if (old) {
      old.text = text;
      old.time = now;
    } else {
      this.toasts.push({ text, time: now, key });
      if (this.toasts.length > 4) this.toasts.shift();
    }
  }

  private salvaged = 0;
  private lastWorld: World | null = null;

  /** What the world says about wrecks: metal and money into the hold, a survivor into the barracks, enemies out of an ambush. */
  private handleNotes(): void {
    const notes = this.world.notes.splice(0);
    const run = this.mode === 'run' ? this.run : null;
    const hold = (credits: number, metal: number): { credits: number; metal: number; lostMetal: number } => {
      if (!run) return { credits, metal, lostMetal: 0 };
      const got = addToHold(run.cargo, shipHoldCap(run.shipId), { credits, metal });
      return { ...got.gained, lostMetal: got.lostMetal };
    };
    for (const n of notes as WorldNote[]) {
      if (n.type === 'salvage') {
        const got = hold(0, n.metal);
        this.salvaged += got.metal;
        this.toast(got.lostMetal > 0 && got.metal === 0 ? 'Обломки: трюм полон, металл уплывает.' : `Добыча с обломков: +${this.salvaged} мет.`, 'salvage');
      } else if (n.type === 'trap') {
        this.toast(n.text);
      } else if (n.type === 'ambush') {
        for (let i = 0; i < n.n; i++) {
          const id = this.world.rng() < 0.5 ? 'scout' : 'raider';
          const es = ENEMIES.find((e) => e.id === id)!;
          const a = this.world.rng() * Math.PI * 2;
          const ex = n.x + Math.cos(a) * 160;
          const ey = n.y + Math.sin(a) * 160;
          this.world.spawnShip(es.build(), ex, ey, a, { name: es.label, team: 1, ai: es.ai });
        }
      } else if (n.type === 'find') {
        const f = n.find;
        if (f.type === 'metal') {
          const got = hold(0, f.amount);
          this.toast(got.lostMetal > 0 ? `${f.text} Не влезло: ${got.lostMetal}.` : f.text);
        } else if (f.type === 'credits') {
          hold(f.amount, 0);
          this.toast(f.text);
        } else if (f.type === 'survivor') {
          this.toast(this.takeSurvivor() ? f.text : 'Осмотр остова: в капсуле живой космонавт, но в казарме нет места. Он остался в космосе.');
        } else {
          this.toast(f.text);
        }
      }
    }
  }

  /** A rescued astronaut: wounded, in the barracks, waiting to be healed. */
  private takeSurvivor(): boolean {
    if (inBarracks(this.roster).length >= CREW.barracksMax) return false;
    const r = this.world.rng;
    const t = r();
    const rar = t < 0.5 ? 1 : t < 0.85 ? 2 : 3;
    const m = makeMember(this.roster, r, ROLES[Math.floor(r() * ROLES.length)], Math.min(10, rar * 2 - 1 + Math.floor(r() * 2)), rar);
    m.status = 'hurt';
    m.healEnd = null;
    this.roster.members.push(m);
    storeRoster(this.roster);
    return true;
  }

  tick(frameDt: number): void {
    // Behind the title and the dock (both full screens of their own) the world stands still and isn't drawn.
    if (this.screen === 'title' || (this.mode === 'run' && this.runPhase === 'dock')) return;
    const dt = Math.min(frameDt, 0.05);
    if (this.world !== this.lastWorld) {
      this.lastWorld = this.world;
      this.salvaged = 0;
      this.toasts = [];
    }
    let simDt = 0;
    const halted = this.mode === 'run' && this.runPhase !== 'battle';
    if (!this.paused && !halted) {
      const scale = this.slowMo ? 0.25 : 1;
      this.acc += dt * scale;
      simDt = dt * scale;
      let steps = 0;
      const t0 = performance.now();
      while (this.acc >= STEP && steps < 6) {
        this.world.step(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps > 0) this.stepMs = this.stepMs * 0.9 + ((performance.now() - t0) / steps) * 0.1;
      if (steps === 6) this.acc = 0;
      if (this.world.notes.length > 0) this.handleNotes();
      this.evaluate();
    }
    this.scene.render(this.world, dt, simDt);
  }

  pointerAction(wx: number, wy: number): void {
    if (this.tool === 'fly') {
      const enemy = this.pickEnemy(wx, wy);
      if (enemy) {
        this.assignTarget(enemy);
        return;
      }
      this.world.target = this.clampToSurface(wx, wy);
    } else {
      this.world.explode(wx, wy, this.crater.radius, this.crater.damage, this.crater.pen);
    }
  }

  private clampToSurface(wx: number, wy: number): { x: number; y: number } {
    for (const c of this.world.celestials) {
      if (!isSolid(c)) continue;
      const dx = wx - c.x;
      const dy = wy - c.y;
      const d = Math.hypot(dx, dy);
      const limit = c.radius + 2;
      if (d < limit) {
        const k = d > 1e-6 ? limit / d : 0;
        return d > 1e-6 ? { x: c.x + dx * k, y: c.y + dy * k } : { x: c.x + limit, y: c.y };
      }
    }
    return { x: wx, y: wy };
  }

  currentDeckCompartments(): { rooms: Room[]; doors: DoorInfo[] } | null {
    const p = this.world.player;
    const z = this.scene.layerView;
    if (!p?.sys || z === OUTER_VIEW) return null;
    const graph = ensureRooms(p);
    return { rooms: roomsOnDeck(graph, z), doors: doorsOnDeck(p.grid, graph, z) };
  }

  currentDeckCrew(): Crew[] | null {
    const p = this.world.player;
    const z = this.scene.layerView;
    if (!p?.sys?.crew || z === OUTER_VIEW) return null;
    return crewOnDeck(p.sys.crew, z);
  }

  toggleDoor(doorId: number): void {
    const p = this.world.player;
    if (!p) return;
    const door = p.grid.doors[doorId];
    if (door) setDoorOpen(p.grid, doorId, !door.open);
  }

  totals(): { bodies: number; debris: number; cells: number } {
    let cells = 0;
    let debris = 0;
    for (const b of this.world.bodies) {
      cells += b.grid.cells;
      if (b.kind === 'debris') debris++;
    }
    return { bodies: this.world.bodies.length, debris, cells };
  }
}
