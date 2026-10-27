/**
 * Application controller: connects engine messages, client state mirror,
 * renderer, HUD, menus and input.
 *
 * Interaction model
 *  - At most one state-changing command is in flight.  The engine answers
 *    every command with a state (or a prompt / error), which clears it.
 *  - One movement may be buffered while waiting, so held keys feel smooth
 *    without ever running ahead of the engine.
 *  - Visual movement starts only once the engine has confirmed the new
 *    position; rotation is local and free.
 */
import {
  DIR_OFFSETS, FACING_TO_DIR, type CommandMessage, type Direction, type EngineMessage, type Panel, type StateMessage,
} from '@thang/protocol';
import { Connection, type Transport } from './protocol/connection.ts';
import { WorkerConnection, useWasmEngine } from './wasm/worker-connection.ts';
import { openCommandMenu, openUseMenu } from './ui/command-menus.ts';
import { AimLayer, LookLayer, type TargetingHooks } from './ui/targeting.ts';
import { HeadingFollower } from './camera/heading.ts';
import { GameState, type StateChange } from './state/game-state.ts';
import { firstStepToward } from './state/pathing.ts';
import { TileAtlas } from './sprites/atlas.ts';
import { SceneRenderer } from './renderer/scene.ts';
import { InputManager } from './input/input-manager.ts';
import type { InputEvent, InputHandler } from './input/actions.ts';
import { Hud, type ContextHint } from './ui/hud.ts';
import { UiManager } from './ui/layer.ts';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings, type UiContext } from './ui/context.ts';
import { PromptLayer } from './ui/prompt-layer.ts';
import { MenuLayer, TextLayer } from './ui/menu-layer.ts';
import { PanelLayer } from './ui/panel-view.ts';
import {
  DeathLayer, InventoryLayer, MapLayer, StoreLayer, TitleLayer,
  openMessageLog, openSystemMenu, startBirth,
} from './ui/screens.ts';
import { Sfx } from './audio/sfx.ts';
import { loadBindings } from './input/bindings.ts';
import { ControlsLayer } from './ui/controls.ts';
import { h } from './ui/dom.ts';

const COMMAND_TIMEOUT_MS = 8000;

/** Engine-driven movement the camera should follow (not manual strafing) */
const AUTO_FACE_ACTIONS = new Set<CommandMessage['action']>(['explore', 'run', 'pathfind', 'navigate_up', 'navigate_down']);

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/** Settings saved before full-resolution rendering defaulted to 3x retro pixels */
function migrateSettings(s: Settings): Settings {
  // Saved settings without a version predate full-resolution rendering
  if (s.version < 2) s.pixelScale = 1;
  s.version = SETTINGS_VERSION;
  return s;
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export class App implements InputHandler {
  readonly state = new GameState();
  readonly conn: Transport;
  readonly input = new InputManager();
  readonly ui: UiManager;
  readonly hud: Hud;
  readonly sfx = new Sfx();
  private renderer: SceneRenderer | null = null;
  private atlas: TileAtlas | null = null;
  private atlasLoading: Promise<void> | null = null;
  private settings: Settings = migrateSettings(loadJson('thang.settings', { ...DEFAULT_SETTINGS, version: 1 }));
  private engineOptions: Record<string, boolean> = loadJson('thang.engineOptions', { autoexplore_commands: true });
  private ctx: UiContext;

  private pending: { cmd: CommandMessage; at: number } | null = null;
  private queued: CommandMessage | null = null;
  private exploring = false;
  /** Whether the player had already won (null until the first state) */
  private wasWinner: boolean | null = null;
  /** Game turn after the last auto-explore step, to notice when it stalls */
  private exploreTurn: number | undefined;
  private dungeonDirty = false;
  private lastHp: number | null = null;
  private title: TitleLayer | null = null;
  private store: StoreLayer | null = null;
  private death: DeathLayer | null = null;
  private promptLayer: PromptLayer | null = null;
  private inventory: InventoryLayer | null = null;
  private overlay = h('div', { class: 'overlay hidden' });
  private optionsPushed = false;

  constructor(private root: HTMLElement) {
    this.conn = useWasmEngine() ? new WorkerConnection() : new Connection(Connection.defaultUrl());
    this.conn.debug = new URLSearchParams(location.search).has('debug');
    // ?debug: reachable from the console (and scripts) as window.thang
    if (this.conn.debug) (window as unknown as { thang?: App }).thang = this;
    const uiRoot = h('div', { class: 'ui-root' });
    this.ui = new UiManager(uiRoot, this.input);
    this.hud = new Hud(this.state, () => this.atlas);
    this.hud.setVisible(false);
    root.append(h('canvas', { class: 'view', id: 'view' }), this.hud.el, uiRoot, this.overlay);

    this.ctx = {
      state: this.state,
      ui: this.ui,
      input: this.input,
      atlas: () => this.atlas,
      send: (m) => this.send(m),
      settings: this.settings,
      applySettings: (s) => this.applySettings(s),
      engineOptions: this.engineOptions,
      facing: () => this.renderer?.cam.facing ?? 0,
      quit: () => this.quit(),
      canQuit: !useWasmEngine(),
      saveBindings: (b) => {
        this.input.setBindings(b);
        saveJson('thang.bindings', b);
      },
    };

    this.input.setBindings(loadBindings(loadJson('thang.bindings', null)));
    this.input.push(this);
    this.input.onDeviceChange = () => this.updateHints();
    this.input.onGamepadConnected = (name) => this.state.note(`Controller connected: ${name}`);
    window.addEventListener('pointerdown', () => this.sfx.unlock());
    window.addEventListener('keydown', () => this.sfx.unlock(), { once: true });

    this.conn.onMessage((m) => this.onMessage(m));
    this.conn.onStatus((s) => {
      if (s === 'open') this.showOverlay(null);
      else if (s === 'closed') this.showOverlay('Connection to the bridge lost — reconnecting…');
    });
    this.state.subscribe((c) => this.onChange(c));
    this.sfx.volume = this.settings.volume;
  }

  start(): void {
    this.showOverlay('Connecting to the Angband engine…');
    this.conn.connect();
    // Gamepads must be polled even before the renderer exists (title menus)
    const poll = () => {
      requestAnimationFrame(poll);
      if (!this.renderer) this.input.poll(1 / 60);
    };
    poll();
  }

  /* ---------------------------------------------------------------- */
  /* Engine messages                                                   */
  /* ---------------------------------------------------------------- */

  private onMessage(m: EngineMessage): void {
    switch (m.type) {
      case 'hello':
        this.state.applyHello(m);
        this.ensureAtlas();
        break;
      case 'state':
        this.pending = null;
        this.state.applyState(m);
        this.afterState(m);
        break;
      case 'prompt':
        this.pending = null;
        this.exploring = false;
        this.queued = null;
        this.state.applyPrompt(m);
        break;
      case 'error':
        this.pending = null;
        this.queued = null;
        if (m.code === 'bad_type') {
          // An engine older than this client (e.g. a long-running dev server)
          this.state.note('The engine is out of date. Restart the game to update it.');
        } else if (m.code !== 'prompt_pending' && m.code !== 'stale_answer') {
          this.state.note(m.message);
        }
        console.warn('[engine error]', m.code, m.message);
        break;
      case 'screen':
        this.characterPages[m.page] = m;
        this.panelLayer?.refresh();
        break;
      case 'info':
        this.ui.open(new TextLayer(m.title, m.text));
        break;
      case 'saved':
        this.state.note(m.ok ? 'Game saved.' : 'Save failed!');
        break;
      case 'birth_stats':
        this.ctx.onBirthStats?.(m.stats);
        break;
      case 'bridge':
        if (m.event === 'engine_exit') {
          this.showOverlay('The engine stopped unexpectedly — restarting and reloading your last save…');
          this.pending = null;
        } else if (m.event === 'engine_failed') {
          this.showOverlay(`The game engine stopped. ${m.message ?? ''}`);
        } else if (m.event === 'engine_started') {
          this.showOverlay(null);
          this.state.note('Engine restarted.');
          // A fresh engine shows the menu; resume the save automatically
          this.resumeAfterRestart = true;
        } else if (m.event === 'replaced') {
          this.showOverlay('This game was opened in another window.');
        } else if (m.event === 'session' && m.session) {
          this.conn.rememberSession(m.session);
        } else if (m.event === 'busy') {
          this.showOverlay(m.message ?? 'The server is full right now. Please try again shortly.');
        } else if (m.event === 'rate_limited') {
          this.state.note('Slow down: some inputs were dropped.');
        }
        break;
    }
  }

  private resumeAfterRestart = false;

  private async ensureAtlas() {
    const hello = this.state.hello!;
    if (!this.atlas || this.atlas.url !== hello.tileset.url) {
      this.atlas = new TileAtlas(hello.tileset);
      this.atlasLoading = this.atlas.load().catch((e) => {
        // Show the problem and try again rather than sit on a black screen
        console.error(e);
        this.showOverlay('Loading the tile set failed — retrying…');
        this.atlas = null;
        setTimeout(() => {
          this.showOverlay(null);
          void this.ensureAtlas();
        }, 2000);
        throw e;
      }).then(() => {
        const canvas = this.root.querySelector<HTMLCanvasElement>('#view')!;
        if (!this.renderer) {
          this.renderer = new SceneRenderer(canvas, this.atlas!);
          this.renderer.settings.fov = this.settings.fov;
          this.renderer.setPixelScale(this.settings.pixelScale);
          this.renderer.onFrame = (dt) => this.frame(dt);
          this.renderer.start();
          this.applySettings({});
        }
        this.renderer.effects.palette = hello.palette;
        this.syncView();
        // The HUD and panels may have been drawn before the atlas could supply tiles
        this.hud.update();
        this.hud.updatePanels();
        this.hud.weapon.setEquipment(this.state.equipment);
      });
    }
    try {
      await this.atlasLoading;
    } catch {
      return; // retry scheduled above
    }
    this.syncPhase();
  }

  private afterState(m: StateMessage): void {
    this.syncPhase();
    if (this.resumeAfterRestart && m.phase === 'menu' && this.state.hello?.saveExists) {
      this.resumeAfterRestart = false;
      this.send({ type: 'load_game' });
      return;
    }
    if (m.phase === 'game' && !this.optionsPushed) {
      this.optionsPushed = true;
      this.send({ type: 'options', set: { ...this.engineOptions } });
    }
    this.continueExplore(m);
    this.flushQueue();
  }

  /** Show the right top-level screen for the engine's phase */
  private syncPhase(): void {
    const phase = this.state.phase;
    if (!this.state.hello || !this.atlas?.loaded) return;
    this.root.classList.toggle('at-title', phase === 'menu');
    if (phase === 'menu') {
      this.hud.setVisible(false);
      this.optionsPushed = false;
      if (this.death) { this.death.close(); this.death = null; }
      if (!this.title || !this.title.isOpen) {
        this.ui.closeAll();
        this.title = new TitleLayer(this.ctx, () => startBirth(this.ctx, () => {}));
        this.ui.open(this.title);
      } else {
        this.title.refresh();
      }
    } else if (phase === 'game') {
      if (this.title?.isOpen) this.ui.closeAll();
      this.title = null;
      if (this.death) { this.death.close(); this.death = null; }
      this.hud.setVisible(true);
    } else if (phase === 'dead') {
      this.exploring = false;
      this.hud.setVisible(true);
      if (!this.death || !this.death.isOpen) {
        this.ui.closeAll();
        this.death = new DeathLayer(this.ctx, () => startBirth(this.ctx, () => {}));
        this.ui.open(this.death);
        this.sfx.play('death');
      }
    }
  }

  private onChange(c: StateChange): void {
    const r = this.renderer;
    const p = this.state.player;
    if (c.phase && this.state.phase === 'menu') {
      // Back at the title: drop the old level from the screen
      this.exploring = false;
      this.queued = null;
      this.lastHp = null;
      this.wasWinner = null;
      this.syncView();
    }
    // Sunrise and nightfall in the town
    if (r && p && !c.levelChanged && p.depth === 0 && r.daytime !== !!p.daytime) r.setOutdoors(true, !!p.daytime);
    if (c.levelChanged && r && p) {
      r.dungeon.clear();
      r.entities.clear();
      r.setOutdoors(p.depth === 0, !!p.daytime);
      r.cam.teleport(p.x, p.y);
      this.faceOpenSide();
      this.hud.showBanner(p.depth === 0 ? 'The Town' : `${p.depth * 50} feet (level ${p.depth})`);
      this.heading.reset();
      this.exploring = false;
    } else if (c.moved && r && p) {
      this.hud.weapon.bob();
      if (this.lastAction && AUTO_FACE_ACTIONS.has(this.lastAction)) this.followPath(p.x - c.moved.fromX, p.y - c.moved.fromY);
      r.cam.moveTo(p.x, p.y, this.cornerPath(c.moved.fromX, c.moved.fromY, p.x, p.y));
    } else if (c.player && r && p && (r.cam.gridX !== p.x || r.cam.gridY !== p.y)) {
      r.cam.teleport(p.x, p.y);
    }
    if (c.map) this.dungeonDirty = true;
    if (c.entities || c.map) this.refreshEntities();
    if (c.player && p) {
      r?.setTorch(p.lightRadius ?? p.light, !!p.unlight);
      this.hud.weapon.setLight(p.lightRadius ?? p.light, !!p.unlight);
      this.hud.weapon.setShape(p.shape);
      if (p.winner && this.wasWinner === false && this.state.phase === 'game') this.celebrate();
      this.wasWinner = !!p.winner;
      if (this.lastHp !== null && p.hp < this.lastHp && this.state.phase === 'game') {
        r?.cam.shake();
        this.hud.hurt();
        this.input.rumble(Math.min(1, 0.3 + (this.lastHp - p.hp) / Math.max(1, p.maxHp)), 150);
      }
      this.lastHp = p.hp;
    }
    if (c.messages) {
      this.hud.addMessages(c.messages);
      // Your own melee attacks swing the weapon (monsters' use mon_* types)
      if (c.messages.some((m) => m.sound === 'hit' || m.sound === 'miss')) this.hud.weapon.swing();
      for (const m of c.messages) {
        this.sfx.play(m.sound);
        // Angband's level-up message (MSG_LEVEL, sound "level")
        if (m.sound === 'level' && /level \d+/i.test(m.text)) this.hud.showBanner(m.text.replace(/\.$/, ''));
      }
    }
    if (c.effects && r) r.effects.play(c.effects);
    if (c.prompt) this.syncPrompt();
    if (c.store) this.syncStore();
    if (c.gear) this.hud.weapon.setEquipment(this.state.equipment);
    if (c.gear && this.inventory?.isOpen) this.inventory.refresh();
    if (c.panels) {
      this.hud.updatePanels();
      if (this.panelLayer?.isOpen) this.panelLayer.refresh();
    }
    // The character sheet reflects the player; keep an open one current
    if (c.player && this.panelLayer?.isOpen && this.characterOpen) this.requestCharacter(this.characterPage);
    this.hud.update();
    this.updateHints();
  }

  /**
   * Bring the 3D view in line with the current state.  Needed when the
   * renderer is created after the first state has already arrived (page
   * load or reload race): that state's level change was applied with no
   * renderer, so the camera would otherwise sit at grid (0,0).
   */
  private syncView(): void {
    const r = this.renderer;
    const p = this.state.player;
    if (!r) return;
    r.dungeon.clear();
    r.entities.clear();
    if (!p || this.state.phase === 'menu') return;
    r.setOutdoors(p.depth === 0, !!p.daytime);
    r.setTorch(p.lightRadius ?? p.light, !!p.unlight);
    r.cam.teleport(p.x, p.y);
    this.faceOpenSide();
    this.dungeonDirty = true;
    this.refreshEntities();
  }

  /**
   * Camera path for a diagonal step that passes a wall corner: curve
   * through the open orthogonal square, or snap if both are solid (Angband
   * allows squeezing diagonally between two walls).
   */
  private cornerPath(fx: number, fy: number, tx: number, ty: number): { via?: [number, number]; snap?: boolean } {
    const dx = tx - fx, dy = ty - fy;
    if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return {};
    const solid = (x: number, y: number) => {
      const s = this.state.featureClassAt(x, y).shape;
      return s === 'wall' || s === 'door_closed';
    };
    const a = solid(fx + dx, fy), b = solid(fx, fy + dy);
    if (a && b) return { snap: true };
    if (a) return { via: [fx, fy + dy] };
    if (b) return { via: [fx + dx, fy] };
    return {};
  }

  private refreshEntities(): void {
    const r = this.renderer;
    const p = this.state.player;
    if (!r || !p) return;
    r.entities.updateMonsters(this.state.monsters, this.state.target ?? null);
    r.entities.updateObjects(this.state.objects, p.x, p.y);
    r.entities.updateTraps(this.state.map.traps, this.state.map.width, this.state.map.inView);
  }

  private syncPrompt(): void {
    const prompt = this.state.prompt;
    if (this.promptLayer && (!prompt || this.promptLayer.prompt.id !== prompt.id)) {
      if (this.promptLayer.isOpen) this.promptLayer.dismiss();
      this.promptLayer = null;
    }
    if (prompt && !this.promptLayer) {
      this.promptLayer = new PromptLayer(this.ctx, prompt);
      this.ui.open(this.promptLayer);
    }
  }

  private syncStore(): void {
    if (this.state.store) {
      if (!this.store || !this.store.isOpen) {
        this.store = new StoreLayer(this.ctx);
        this.ui.open(this.store);
      } else {
        this.store.refresh();
      }
    } else if (this.store) {
      this.store.close();
      this.store = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Sending commands                                                  */
  /* ---------------------------------------------------------------- */

  send(m: Parameters<Transport['send']>[0]): void {
    if (m.type === 'command') {
      // The weapon in hand: launchers fire, and digging uses the weapon (as in Angband)
      if (m.action === 'fire' || m.action === 'fire_at_nearest') this.hud.weapon.shoot();
      else if (m.action === 'tunnel' && this.diggableAt(m.dir)) this.hud.weapon.dig();
      else if (m.action === 'cast') this.hud.weapon.cast(this.state.player?.class ?? '');
      if (!AUTO_FACE_ACTIONS.has(m.action)) this.heading.reset();
      this.lastAction = m.action;
      if (this.pending) {
        // Buffer one command (usually a movement) until the engine answers
        this.queued = m;
        return;
      }
      this.pending = { cmd: m, at: performance.now() };
    }
    if (!this.conn.send(m)) {
      this.pending = null;
      this.state.note('Not connected to the engine.');
    }
  }

  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private flushQueue(): void {
    if (this.pending || !this.queued || this.state.prompt) return;
    if (this.renderer?.cam.busy) {
      // Don't depend on the render loop (throttled in background tabs)
      this.flushTimer ??= setTimeout(() => {
        this.flushTimer = null;
        this.renderer?.cam.finish();
        this.flushQueue();
      }, 180);
      return;
    }
    const q = this.queued;
    this.queued = null;
    this.send(q);
  }

  /** Is the known square in a direction rock or rubble (something to dig)? */
  private diggableAt(dir: Direction | undefined): boolean {
    const p = this.state.player, hello = this.state.hello;
    if (!p || !hello || !dir || !DIR_OFFSETS[dir]) return false;
    const [dx, dy] = DIR_OFFSETS[dir];
    const f = this.state.map.featAt(p.x + dx, p.y + dy);
    const flags = hello.features[f]?.flags ?? [];
    return flags.includes('rock') && !flags.includes('permanent');
  }

  private command(c: Omit<CommandMessage, 'type'>): void {
    this.send({ type: 'command', ...c } as CommandMessage);
  }

  /* ---------------------------------------------------------------- */
  /* Per-frame                                                         */
  /* ---------------------------------------------------------------- */

  private frame(dt: number): void {
    this.input.poll(dt);
    if (this.dungeonDirty && this.renderer && this.atlas && this.state.player) {
      this.dungeonDirty = false;
      const tiles = this.state.features.map((f) => f?.tiles ?? []);
      this.renderer.rebuildDungeon({
        map: this.state.map,
        classes: this.state.featureClasses,
        featureTiles: tiles,
        atlas: this.atlas,
        outdoors: this.state.player.depth === 0,
      });
    }
    if (this.pending && performance.now() - this.pending.at > COMMAND_TIMEOUT_MS) {
      console.warn('[app] engine did not answer; releasing input');
      this.pending = null;
    }
    this.flushQueue();
    if (this.settings.showMinimap && this.state.player) this.hud.drawMinimap(this.renderer?.cam.facing ?? 0);
  }

  /* ---------------------------------------------------------------- */
  /* Game input                                                        */
  /* ---------------------------------------------------------------- */

  private facingDir(offset = 0): Direction {
    return this.renderer!.cam.relativeDir(offset);
  }

  private ahead(offset = 0): { x: number; y: number; dir: Direction } | null {
    const p = this.state.player;
    if (!p || !this.renderer) return null;
    const dir = this.facingDir(offset);
    const [dx, dy] = DIR_OFFSETS[dir];
    return { x: p.x + dx, y: p.y + dy, dir };
  }

  private walk(offset: number, run = false): void {
    const a = this.ahead(offset);
    if (!a) return;
    const shape = this.state.featureClassAt(a.x, a.y).shape;
    if (shape === 'door_closed' && !this.state.monsterAt(a.x, a.y)) {
      // Walking into a known closed door opens it (as the alter command does)
      this.command({ action: 'open', dir: a.dir });
      return;
    }
    this.command({ action: run ? 'run' : 'walk', dir: a.dir });
  }

  handleInput(ev: InputEvent): boolean {
    if (this.state.phase !== 'game' || !this.renderer) return false;
    const g = ev.game;
    if (!g) return false;
    if (this.exploring && g !== 'explore') {
      this.exploring = false;
      if (g === 'cancel') return true;
    }
    const cam = this.renderer.cam;
    switch (g) {
      case 'moveForward': this.walk(0); break;
      case 'moveBack': this.walk(4); break;
      case 'strafeLeft': this.walk(6); break;
      case 'strafeRight': this.walk(2); break;
      case 'runForward': this.walk(0, true); break;
      case 'turnLeft': cam.turn(-1); this.updateHints(); break;
      case 'turnRight': cam.turn(1); this.updateHints(); break;
      case 'walkDir1': case 'walkDir2': case 'walkDir3': case 'walkDir4':
      case 'walkDir6': case 'walkDir7': case 'walkDir8': case 'walkDir9': {
        const dir = Number(g.slice(-1)) as Direction;
        cam.face(dir);
        this.command({ action: 'walk', dir });
        break;
      }
      case 'interact': this.interact(); break;
      case 'attack': this.attack(); break;
      case 'explore':
        if (!ev.repeat) {
          this.exploring = this.settings.autoExploreRepeat;
          this.exploreTurn = undefined;
          this.command({ action: 'explore' });
        }
        break;
      case 'wait': this.command({ action: 'hold' }); break;
      case 'rest': this.command({ action: 'rest', mode: 'as_needed' }); break;
      case 'targetNext': case 'targetPrev':
        this.command({ action: g === 'targetNext' ? 'target_next' : 'target_prev' });
        this.faceTargetSoon = true;
        break;
      case 'goUp': this.command({ action: 'go_up' }); break;
      case 'goDown': this.command({ action: 'go_down' }); break;
      case 'inventory':
        this.inventory = new InventoryLayer(this.ctx);
        this.ui.open(this.inventory);
        break;
      case 'spells': this.command({ action: 'cast' }); break;
      case 'study': this.command({ action: 'study' }); break;
      case 'useMenu': openUseMenu(this.ctx); break;
      case 'commands': this.openCommands(); break;
      case 'aim': this.ui.open(new AimLayer(this.ctx, this.targetingHooks())); break;
      case 'look': this.ui.open(new LookLayer(this.ctx, this.targetingHooks())); break;
      case 'monsterList': this.openPanels('monsterList'); break;
      case 'itemList': this.openPanels('itemList'); break;
      case 'recall': this.openPanels('recall'); break;
      case 'toggleSidebar': this.applySettings({ showSidebar: !this.settings.showSidebar }); break;
      case 'map': this.ui.open(new MapLayer(this.ctx)); break;
      case 'character': this.openPanels('character'); break;
      case 'menu':
        openSystemMenu(this.ctx, {
          save: () => this.send({ type: 'save' }),
          quitToTitle: () => this.send({ type: 'close_game' }),
        });
        break;
      case 'equipment': case 'quiver':
        this.inventory = new InventoryLayer(this.ctx, g);
        this.ui.open(this.inventory);
        break;
      case 'messages': openMessageLog(this.ctx); break;
      case 'save': this.send({ type: 'save' }); break;
      case 'saveQuit':
        // In the browser there is nothing to quit to: save and return to the title
        if (this.ctx.canQuit) this.quit();
        else this.send({ type: 'close_game' });
        break;
      case 'help': this.ui.open(new ControlsLayer(this.ctx)); break;
      case 'cancel':
        if (this.state.target) this.command({ action: 'target_clear' });
        break;
      default:
        if (g.startsWith('cmd:')) this.send({ type: 'command', action: g.slice(4) } as CommandMessage);
    }
    return true;
  }

  private faceTargetSoon = false;

  private targetingHooks(): TargetingHooks {
    return {
      face: (x, y) => {
        const p = this.state.player;
        if (!p || !this.renderer || (x === p.x && y === p.y)) return;
        const ang = Math.atan2(x - p.x, -(y - p.y));
        this.renderer.cam.face(FACING_TO_DIR[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8]);
      },
      // The recall panel follows the engine's tracked monster: give it a moment
      recall: () => setTimeout(() => this.openPanels('recall'), 150),
      cursor: (at) => this.renderer?.entities.setCursor(at),
    };
  }

  private openCommands(): void {
    openCommandMenu(this.ctx, {
      save: () => this.send({ type: 'save' }),
      panels: (w) => this.openPanels(w),
      map: () => this.ui.open(new MapLayer(this.ctx)),
      look: () => this.ui.open(new LookLayer(this.ctx, this.targetingHooks())),
      aim: () => this.handleInput({ game: 'aim', device: this.input.lastDevice, repeat: false }),
      messages: () => openMessageLog(this.ctx),
      system: () => openSystemMenu(this.ctx, {
        save: () => this.send({ type: 'save' }),
        quitToTitle: () => this.send({ type: 'close_game' }),
      }),
    });
  }

  /* ---------------------------------------------------------------- */
  /* Facing while the engine moves us (explore, travel, run)           */
  /* ---------------------------------------------------------------- */

  private lastAction: CommandMessage['action'] | null = null;
  /** Smoothed heading for engine-driven movement (see camera/heading.ts) */
  private heading = new HeadingFollower();

  private followPath(dx: number, dy: number): void {
    const cam = this.renderer?.cam;
    if (!cam) return;
    const turn = this.heading.step(dx, dy, cam.facing);
    if (turn) cam.turn(turn);
  }

  /* ---------------------------------------------------------------- */
  /* Stock subwindows as popups                                        */
  /* ---------------------------------------------------------------- */

  private panelLayer: PanelLayer | null = null;
  private characterPages: (Panel | undefined)[] = [];
  private characterPage = 0;
  private characterOpen = false;

  private requestCharacter(page: number): void {
    this.characterPage = page;
    this.send({ type: 'query', what: 'character', page: page === 1 ? 1 : 0 });
  }

  /** Open a stock Angband subwindow (or the character sheet) as a popup */
  private openPanels(which: 'monsterList' | 'itemList' | 'recall' | 'character'): void {
    if (this.panelLayer?.isOpen) this.panelLayer.close();
    const s = this.state;
    this.characterOpen = which === 'character';
    if (which === 'character') {
      this.requestCharacter(0);
      this.panelLayer = new PanelLayer(this.ctx, [
        { title: 'Character', panel: () => this.characterPages[0], empty: 'Loading…', gridAligned: true },
        { title: 'Character: equipment flags & resistances', panel: () => this.characterPages[1], empty: 'Loading…', gridAligned: true },
      ], (page) => this.requestCharacter(page));
    } else {
      const pages = [
        { key: 'monsterList', title: 'Visible monsters', panel: () => s.panels.monsterList },
        { key: 'itemList', title: 'Visible items', panel: () => s.panels.itemList },
        {
          key: 'recall',
          title: 'Recall',
          panel: () => s.panels[s.lastRecall] ?? s.panels.monsterRecall ?? s.panels.objectRecall,
          empty: 'Target or examine something to recall it.',
        },
      ];
      const start = pages.findIndex((p) => p.key === which);
      this.panelLayer = new PanelLayer(this.ctx, pages);
      this.panelLayer.setPage(start);
    }
    this.ui.open(this.panelLayer);
  }

  /** Contextual primary action, choosing among native commands */
  private interact(): void {
    const s = this.state;
    const p = s.player;
    if (!p) return;
    const here = s.featureClassAt(p.x, p.y).shape;
    if (here === 'stair_down') return this.command({ action: 'go_down' });
    if (here === 'stair_up') return this.command({ action: 'go_up' });
    if (s.floor.length) return this.command({ action: 'pickup' });
    if (here === 'shop') return this.command({ action: 'hold' });
    const a = this.ahead();
    if (!a) return;
    if (s.monsterAt(a.x, a.y)) return this.command({ action: 'walk', dir: a.dir });
    const shape = s.featureClassAt(a.x, a.y).shape;
    if (shape === 'door_closed') return this.command({ action: 'open', dir: a.dir });
    if (shape === 'door_open') return this.command({ action: 'close', dir: a.dir });
    if (shape === 'rubble' || shape === 'passable_rubble') return this.command({ action: 'tunnel', dir: a.dir });
    if (s.map.traps.has(s.map.index(a.x, a.y))) return this.command({ action: 'disarm', dir: a.dir });
    if (shape === 'shop' || shape === 'stair_down' || shape === 'stair_up') return this.walk(0);
    this.state.note('Nothing to interact with here.');
  }

  /** Autofight: melee an adjacent foe, else fire at the nearest, else step toward it */
  private attack(): void {
    const s = this.state;
    const p = s.player;
    if (!p) return;
    const a = this.ahead();
    if (a && s.monsterAt(a.x, a.y)) return this.command({ action: 'walk', dir: a.dir });
    // Any adjacent visible monster: turn to it and strike
    for (const m of s.monsters) {
      if (Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) === 1 && m.inView) {
        const dir = (Object.entries(DIR_OFFSETS).find(([, [dx, dy]]) => dx === m.x - p.x && dy === m.y - p.y)?.[0]);
        if (dir) {
          this.renderer?.cam.face(Number(dir) as Direction);
          return this.command({ action: 'walk', dir: Number(dir) as Direction });
        }
      }
    }
    if (this.hasAmmo() && s.monsters.some((m) => m.inView)) {
      return this.command({ action: 'fire_at_nearest' });
    }
    // Autofight: close in on the nearest visible monster, one step at a time,
    // around walls and other monsters
    const near = s.monsters.filter((m) => m.inView)
      .sort((a, b) => Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) - Math.max(Math.abs(b.x - p.x), Math.abs(b.y - p.y)))[0];
    if (near) {
      const dir = firstStepToward(p, near, (x, y) => {
        const c = s.featureClassAt(x, y);
        return (c.passable || c.shape === 'door_closed') && !s.monsterAt(x, y);
      });
      if (dir) {
        this.renderer?.cam.face(dir);
        return this.command({ action: 'walk', dir });
      }
      this.state.note(`No known way to ${near.name}.`);
      return;
    }
    this.state.note('No foe in sight.');
  }

  /** The game is won: offer to retire now, as the stock game's 'Q' allows */
  private celebrate(): void {
    this.ui.open(new MenuLayer<boolean>(this.ctx, {
      title: 'Victory!',
      subtitle: 'The master of the pit is dead. You may retire now, or play on as long as you like.',
      items: [
        { label: 'Keep playing', data: false },
        { label: 'Retire', detail: 'end this character\'s story as a winner', data: true },
      ],
      onSelect: (i, layer) => {
        layer.close();
        if (i.data) this.command({ action: 'retire' });
      },
    }));
  }

  /** A launcher and ammunition it can fire (not just throwing weapons in the quiver) */
  private hasAmmo(): boolean {
    const launcher = this.state.equipment.find((e) => e.slot === 'shooting')?.item;
    if (!launcher) return false;
    const ammo = /sling/i.test(launcher.name) ? 'shot' : /crossbow/i.test(launcher.name) ? 'bolt' : 'arrow';
    return this.state.quiver.some((q) => q.tval === ammo);
  }

  private continueExplore(m: StateMessage): void {
    const r = this.renderer;
    if (this.faceTargetSoon) {
      this.faceTargetSoon = false;
      const t = this.state.target;
      const p = this.state.player;
      if (t && p && r) {
        const ang = Math.atan2(t.x - p.x, -(t.y - p.y));
        const facing = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
        r.cam.face(FACING_TO_DIR[facing]);
      }
    }
    if (!this.exploring) return;
    const sawMonster = this.state.monsters.some((mm) => mm.inView);
    // The engine refuses silently when the way on is blocked (a closed door
    // it won't open, a known trap): no time passing means no progress
    const stalled = m.turn !== undefined && m.turn === this.exploreTurn;
    this.exploreTurn = m.turn;
    if (m.phase !== 'game' || m.messages.length || sawMonster || this.state.prompt || stalled) {
      if (stalled) this.state.note('Nothing more to explore this way.');
      this.exploring = false;
      this.updateHints();
      return;
    }
    // Continue on the next frame once the step animation settles
    this.queued = { type: 'command', action: 'explore' };
  }

  /** Face the most open direction after arriving on a level */
  private faceOpenSide(): void {
    const p = this.state.player;
    const r = this.renderer;
    if (!p || !r) return;
    let best = 0, bestScore = -1;
    for (let f = 0; f < 8; f += 2) {
      const [dx, dy] = DIR_OFFSETS[FACING_TO_DIR[f]];
      let score = 0;
      for (let k = 1; k <= 4; k++) {
        const c = this.state.featureClassAt(p.x + dx * k, p.y + dy * k);
        if (!c.passable) break;
        score++;
      }
      if (score > bestScore) { bestScore = score; best = f; }
    }
    const steps = best - r.cam.facing;
    if (steps) {
      const inst = r.cam.instant;
      r.cam.instant = true;
      r.cam.turn(steps);
      r.cam.instant = inst;
    }
  }

  /* ---------------------------------------------------------------- */
  /* HUD hints, settings, overlay                                      */
  /* ---------------------------------------------------------------- */

  private updateHints(): void {
    const s = this.state;
    const p = s.player;
    if (!p || s.phase !== 'game' || !this.renderer) {
      this.hud.setHints([]);
      return;
    }
    const pr = this.input.prompts();
    const hints: ContextHint[] = [];
    const here = s.featureClassAt(p.x, p.y).shape;
    const a = this.ahead();
    const aheadMon = a ? s.monsterAt(a.x, a.y) : undefined;
    const aheadShape = a ? s.featureClassAt(a.x, a.y).shape : 'unknown';
    let primary: string | null = null;
    if (here === 'stair_down') primary = 'Descend';
    else if (here === 'stair_up') primary = 'Ascend';
    else if (s.floor.length) primary = `Pick up ${s.floor.length > 1 ? `${s.floor.length} items` : s.floor[0].name}`;
    else if (here === 'shop') primary = 'Enter shop';
    else if (aheadMon) primary = `Attack ${aheadMon.name}`;
    else if (aheadShape === 'door_closed') primary = 'Open door';
    else if (aheadShape === 'door_open') primary = 'Close door';
    else if (aheadShape === 'rubble' || aheadShape === 'passable_rubble') primary = 'Clear rubble';
    // Keyboard players pick up with Angband's own key rather than Space
    const pickup = primary?.startsWith('Pick up') && this.input.lastDevice === 'keyboard' ? pr['cmd:pickup'] : undefined;
    if (primary) hints.push({ button: pickup ?? pr.interact ?? 'A', label: primary });
    if (s.monsters.some((m) => m.inView)) hints.push({ button: pr.attack ?? 'F', label: 'Fire' }, { button: pr.aim ?? 'T', label: 'Aim' });
    else hints.push({ button: pr.explore ?? 'X', label: this.exploring ? 'Exploring…' : 'Explore' });
    hints.push({ button: pr.inventory ?? 'I', label: 'Gear' });
    hints.push({ button: pr.useMenu ?? 'U', label: p.canCast ? 'Cast & use' : 'Use' });
    hints.push({ button: pr.commands ?? 'V', label: 'Commands' });
    this.hud.setHints(hints);
  }

  private applySettings(s: Partial<Settings>): void {
    Object.assign(this.settings, s);
    saveJson('thang.settings', this.settings);
    saveJson('thang.engineOptions', this.engineOptions);
    const r = this.renderer;
    if (r) {
      r.cam.instant = this.settings.instantMovement;
      r.entities.instant = this.settings.instantMovement;
      r.cam.camera.fov = this.settings.fov;
      r.cam.camera.updateProjectionMatrix();
      if (r.settings.pixelScale !== this.settings.pixelScale) r.setPixelScale(this.settings.pixelScale);
    }
    this.sfx.volume = this.settings.volume;
    this.hud.minimap.canvas.classList.toggle('hidden', !this.settings.showMinimap);
    this.hud.sidebar.classList.toggle('hidden', !this.settings.showSidebar);
    this.input.glyphOverride = this.settings.controllerGlyphs;
    this.updateHints();
  }

  /**
   * Save and quit.  The bridge stops a local game server (or quits the
   * desktop app); the engine saves on the way out.  A hosted server keeps
   * running, so there the game is saved and left at the title.
   */
  private quit(): void {
    this.ui.closeAll((l) => l !== this.title && l !== this.death);
    if (this.state.phase === 'game') this.send({ type: 'close_game' });
    const ended = () => {
      this.conn.close();
      this.ui.closeAll();
      this.hud.setVisible(false);
      this.showOverlay('Your game is saved. You can close this window.');
      // Works where the page was opened by script (some launchers); harmless otherwise
      window.close();
    };
    // Local servers close the socket as they stop
    const offStatus = this.conn.onStatus((s) => {
      if (s === 'closed') {
        offStatus();
        offMsg();
        clearTimeout(fallback);
        ended();
      }
    });
    const savedHere = () => {
      offStatus();
      offMsg();
      clearTimeout(fallback);
      // Hosted (or an older bridge): nothing shut down; the game is saved at the title
      this.showOverlay('Your game is saved. You can close this tab.');
      setTimeout(() => this.showOverlay(null), 4000);
    };
    const offMsg = this.conn.onMessage((m) => {
      if (m.type === 'bridge' && m.event === 'shutdown_refused') savedHere();
    });
    // A bridge that predates "quit" ignores the request
    const fallback = setTimeout(savedHere, 3000);
    this.conn.send({ type: 'shutdown' });
  }

  private showOverlay(text: string | null): void {
    this.overlay.textContent = text ?? '';
    this.overlay.classList.toggle('hidden', !text);
  }
}
