// The 3D game: wires input to the sim, the sim and physics to the Three.js view, and the HTML UI.
// Sim time only moves while a turn plays. The path preview runs the same physics the turn will run.

import * as THREE from "three";
import { CONFIG } from "../config";
import { PHYSICS } from "../data/physics";
import {
  buildDrive,
  freeDrive,
  restFrame,
  simulateTurn,
  syncDrive,
  TURN_STEPS,
  type Drive,
  type TurnResult,
} from "../phys/drive";
import {
  groundPoint,
  toMap,
  type TurnFrames,
  type V3,
  type VehicleFrame,
} from "../phys/frames";
import { applyTurn, type PreparedTurn } from "../phys/turn";
import { playerVehicle, vehicleById } from "../sim/damage";

import { isStranded, maxTurn, vehicleStats } from "../sim/stats";
import { clickOrder, parkedVehicles, throttleFor } from "../sim/steering";
import { route } from "../sim/path";
import type { Vehicle, World } from "../sim/types";
import { grayRadius, playerSees, tileOf, visibleTiles } from "../sim/vision";
import { dist, type Vec } from "../sim/vec";
import { TERRAIN } from "../data/terrain";
import { isTowed, setBeacon, unhitch } from "../sim/tow";
import { inCombat } from "../sim/combat";
import { cloneWorld, hostileToPlayer, playerCanAct, setMoveOrder } from "../sim/world";
import { TruckContext, TruckControls } from "./truck-controls";
import { PAL } from "../render/palette";
import { READY_ARC_BIT } from "./render/models";
import { timed } from "../perf";
import { CharacterScreen } from "../ui/character";
import { HitCard } from "../ui/hitCard";
import type { UiHost } from "../ui/host";
import { Hud } from "../ui/hud";
import { InventoryScreen } from "../ui/inventory";
import type { RadioPanel } from "../ui/radio";
import { TownScreen, TruckTradeScreen } from "../ui/town";
import { aimAtPart, HoverHold, toggleTarget, vehicleMarks, WeaponPanel, weaponsForClick } from "../ui/weapons";
import { CameraRig, KeyPan, TruckFollow } from "./render/camera";
import { addScatter } from "./render/scatter";
import { FogView } from "./render/fog";
import { Fx3D, TruckFx } from "./render/fx";
import { CollisionCues, collisionSteps, playCrashes, playDryGuns, playShotFx, type CombatHost } from "./volley";
import { Labels, VehicleMarkers } from "./render/labels";
import { ObstacleViews } from "./render/obstacles";
import { playBreak } from "./render/partDebris";
import { BreakCues, shownItems, type PartBreak } from "./breakCues";
import { PathView } from "./render/path";
import { RenderScope, SightLimit } from "./render/scope";
import { addSites } from "./render/sites";
import { addShipDecks } from "./render/ship-decks";
import { terrainMesh } from "./render/terrain";
import { RadioLights, VehicleView } from "./render/vehicle";
import { HoverArcsView, WeaponRangeView } from "./render/weaponRange";
import { WeatherView } from "./render/weather";
import { ZonesView } from "./render/zones";
import { daylightAt, lightScene, NightLights, nightLightsWanted, sunLight, vehicleLampsOn } from "./render/daylight";
import { markError, markVehicle } from "../sim/detect";
import { ContactsView } from "./render/contacts";
import { DustCloudsView } from "./render/dust";
import { ShadeView } from "./render/shade";
import { BeaconPulseView } from "./render/beaconPulse";
import { SoundRingView } from "./render/soundRing";
import { reportError } from "./crash";
import type { SlotId } from "./save-slots";
import { SAVE_HELD_NOTE, SaveHold, saveInTown, saveStore, saveWorld, turnFailedNote } from "./save";
import { GameMenu } from "../ui/game-menu";
import { DeathScreen } from "../ui/death";
import { MIX } from "../data/sounds";
import { CombatScore, CombatWatch, computeEngineGlide, SoundDirector, SoundLoops, stingOf } from "./sound";
import type { SoundPlayer } from "../audio/player";
import { isBrowserChord, uiRoot } from "../ui/dom";
import { Travel, type Playback, type LiveVision } from "./travel";

const PLAN_TURNS = 3; // turns of path preview

const PICK_PX = 30; // click radius around a vehicle's screen position
const MIN_ZONE_HALF_ANGLE = Math.PI / 12; // zones stay visible for trucks that barely turn
const LIVE_VISION_STEP = 0.35; // tiles the truck moves before its sight is recomputed during a turn
// The circle under the hovered vehicle, which a click targets. Sizes are in tiles.
const PICK_RING = { gap: 0.45, width: 0.06, alpha: 0.9, lift: 0.02 };

type TurnPhase = ReturnType<UiHost["getTurnPhase"]>;

const MOVE_MS = (TURN_STEPS / PHYSICS.stepsPerSecond) * 1000; // real time the movement plays over
const stepMs = (step: number) => (step / PHYSICS.stepsPerSecond) * 1000; // real time into the movement of a physics step
const MOVED_BY_RULES = 0.5; // tiles between a vehicle's drawn spot and its sim spot that mean the rules moved it

const GUN_HEIGHT = 1.6; // meters above the body center where shots start and land

export class Game {
  private world: World;
  private drive: Drive;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
  private readonly scene = new THREE.Scene();
  private readonly sun = sunLight();
  private readonly sky = new THREE.HemisphereLight();
  private readonly nightLights = new NightLights(this.scene);
  private readonly vignette = Object.assign(document.createElement("div"), {
    className: "vignette",
  });
  private readonly stormTint = Object.assign(document.createElement("div"), {
    className: "storm-tint",
  }); // dust haze while inside a storm
  readonly rig: CameraRig;
  private readonly ground = new THREE.Group(); // terrain chunks near the view, for ground picking
  private readonly props = new THREE.Group(); // sites and obstacles near the view
  private readonly scopes: RenderScope[];
  private readonly obstacles: ObstacleViews;
  private readonly fog: FogView;
  private readonly lastSeen = new Map<string, number>(); // vehicle id to the turn the player last saw it
  private readonly shade: ShadeView;
  // A turn step changed what the UI shows. advanceTurn refreshes it once at its end.
  private uiStale = false;
  private readonly weather: WeatherView;
  private readonly labels: Labels;
  private readonly zones = new ZonesView();
  private readonly contacts = new ContactsView();
  private readonly dust = new DustCloudsView();
  private readonly soundRing = new SoundRingView();
  private readonly beaconPulse = new BeaconPulseView();
  private readonly path: PathView;
  private readonly fx: Fx3D;
  private readonly truckFx: TruckFx;
  private readonly controls: TruckControls;
  readonly sound: SoundDirector;
  private panelOpen = false; // last frame's panel state, for open and close sounds
  private readonly loops: SoundLoops;
  private readonly combatWatch = new CombatWatch();
  private readonly views = new Map<string, VehicleView>();
  private readonly radioLights = new RadioLights();
  private frames: Record<string, VehicleFrame> = {}; // last shown pose per vehicle
  // A played turn: physics movement, then shots in flight when there was combat, then time to read results.
  private anim: Playback | null = null;
  private crashCues: CollisionCues | null = null; // collisions of the playing turn, due at their physics step
  private breakCues = new BreakCues([]); // part breaks of the playing turn, due as their round lands
  private readonly travel = new Travel(CONFIG.travelHoldMs);
  private phase: TurnPhase = null;
  private readonly weaponRange = new WeaponRangeView(PAL.select, READY_ARC_BIT);
  private readonly hoverArcs: HoverArcsView;
  private readonly markers: VehicleMarkers;
  private readonly overlay: HTMLElement;
  private live: LiveVision | null = null; // the player's view while a turn plays
  private hoverGround: Vec | null = null;
  private hovered: string | null = null;
  // The pointer needs a moment to travel from a truck to its panel.
  private readonly hoverHold = new HoverHold((id) => this.setHovered(id), 400);
  private readonly pickRing = new THREE.Mesh(
    new THREE.RingGeometry(1, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: PAL.select,
      transparent: true,
      opacity: PICK_RING.alpha,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  private selected: string | null = null;
  private readonly sightLimit: SightLimit;
  readonly follow: TruckFollow;
  private planFor: World | null = null;
  private last = performance.now();
  private idleSince = performance.now(); // when the last turn's playback ended, for the auto turn pace
  // A rescue button pressed while a turn plays runs once the playback ends.
  private pending: ((w: World) => World | null) | null = null;

  private readonly hud: Hud;
  private readonly hitCard: HitCard;
  private readonly weapons: WeaponPanel;
  private readonly town: TownScreen;
  private readonly context: TruckContext;
  private readonly trade: TruckTradeScreen;
  private readonly character: CharacterScreen;
  private readonly inventory: InventoryScreen;
  private readonly menu: GameMenu;
  private readonly death: DeathScreen;

  constructor(
    world: World,
    container: HTMLElement,
    overlay: HTMLElement,
    player: SoundPlayer,
    private toggleMute: () => void,
    radio: RadioPanel,
  ) {
    this.world = world;
    this.drive = buildDrive(this.world);
    setTimeout(() => this.travel.warm(this.world, this.drive));

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(container);
    this.follow = new TruckFollow(this.rig, new KeyPan(this.ignoresKey), this.renderer.domElement);

    this.scene.background = new THREE.Color(PAL.bg);
    this.renderer.domElement.classList.add("view");
    this.scene.add(this.sky);
    this.scene.add(this.sun, this.sun.target);
    this.pickRing.renderOrder = 5;
    this.scene.add(this.pickRing);

    // Ground and props cull separately, so ground picking only hits terrain and the decks.
    this.sightLimit = new SightLimit(this.world.size);
    const groundScope = new RenderScope(this.ground, this.world.size, this.sightLimit, false, false);
    const propScope = new RenderScope(this.props, this.world.size, this.sightLimit, true, true);
    this.scopes = [groundScope, propScope];
    const groundChunks = terrainMesh(this.world, groundScope);
    addSites(this.world.terrain, propScope);
    addShipDecks(this.world.terrain, propScope);
    this.obstacles = new ObstacleViews(propScope, this.world.terrain);
    this.obstacles.sync(this.world.obstacles, this.world.salvage, this.world.broken);
    addScatter(this.world.terrain, this.world.obstacles, propScope);
    this.fog = new FogView(this.world, groundChunks, this.sightLimit);
    this.path = new PathView(this.world.terrain);
    this.shade = new ShadeView(this.world, groundChunks);
    this.weather = new WeatherView(this.world);
    this.hoverArcs = new HoverArcsView(overlay, this.rig);
    this.scene.add(
      this.ground,
      this.props,
      this.shade.mesh,
      this.weather.root,
      this.zones.root,
      this.path.root,
      this.weaponRange.root,
      this.hoverArcs.root,
      this.contacts.root,
      this.dust.root,
      this.soundRing.root,
      this.beaconPulse.root,
    );
    this.overlay = overlay;
    this.markers = new VehicleMarkers(overlay, this.rig);
    overlay.append(this.vignette, this.stormTint);
    this.labels = new Labels(overlay);
    this.fx = new Fx3D(this.scene, overlay, this.rig);
    this.truckFx = new TruckFx(this.fx);
    this.controls = new TruckControls({ world: () => this.world, apply: (next) => this.apply(next), commit: (next) => { this.world = next; this.refreshUi(); }, refreshPlan: () => this.refreshPlan(), doused: () => { this.truckFx.douse(); this.hud.pushEvents(this.world); }, revved: () => this.loops.rev(playerVehicle(this.world).chassisId) });
    this.context = new TruckContext({
      world: () => this.world,
      playing: () => this.anim !== null,
      apply: (next) => this.apply(next),
      pushEvents: () => this.hud.pushEvents(this.world),
      note: (text) => this.hud.note(this.world, text, "bad"),
      openTrade: () => this.trade.openIfReady(),
      openTown: () => this.town.open(),
      openDowned: (id) => this.inventory.openDowned(this.world, id),
      openLoot: (id) => this.inventory.openLoot(id),
    });
    const score = new CombatScore(player, Math.random);
    this.sound = new SoundDirector(player, this.rig, score);
    this.loops = new SoundLoops(player, score);
    uiRoot().addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button"))
        this.sound.ui("ui-click");
    });

    const host = this.uiHost();
    this.weapons = new WeaponPanel(host);
    this.town = new TownScreen(host);
    this.trade = new TruckTradeScreen(host);
    this.character = new CharacterScreen(host);
    this.inventory = new InventoryScreen(host);
    this.hud = new Hud({
      openInventory: () => this.runKey("KeyI"),
      openCharacter: () => this.runKey("KeyC"),
      toggleManual: () => this.runKey("KeyR"),
      toggleAutoRepair: () => this.runKey("KeyP"),
      toggleOverdrive: () => this.runKey("KeyO"),
      toggleHeadlights: () => this.runKey("KeyL"),
      headlightsOn: () => this.world.player.headlights,
      douseEngine: () => this.runKey("KeyG"),
      unhitch: () =>
        this.rescueCommand((w) =>
          w.player.state === "active" && isTowed(w) ? unhitch(w) : null,
        ),
      setBeacon: (on) =>
        this.rescueCommand((w) =>
          playerCanAct(w) && (!on || isStranded(w, playerVehicle(w)))
            ? setBeacon(w, on)
            : null,
        ),
      isBusy: () => this.anim !== null,
      autoTravel: () => this.travel.isAuto(this.world),
      dialogue: { world: () => this.world, hovered: () => this.hovered, busy: () => this.anim !== null, talk: (next) => this.runRescue(() => next), commit: (next) => { this.world = next; this.refreshUi(); }, log: (next) => this.hud.pushEvents(next), playHorn: (id, delayMs) => this.playHorn(id, delayMs) },
      recenter: () => this.runKey("KeyF"),
      aimPart: (vehicleId, partId) => this.anim === null && this.apply(aimAtPart(this.world, weaponsForClick(this.world, this.selected), vehicleById(this.world, vehicleId), partId)),
    }, radio);
    this.hitCard = new HitCard(this.hud.getInspectionRoot());
    this.hoverHold.watch(this.hud.getInspectionRoot());
    const saves = saveStore(window.localStorage, window.sessionStorage, () => this.world, CONFIG.saveSlots);
    const guarded = { ...saves, save: (slot: SlotId) => this.saveNow(() => saves.save(slot)) };
    this.menu = new GameMenu(guarded, () => this.anim !== null);
    this.death = new DeathScreen(saves);

    this.bindInput();
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.refreshUi();
    requestAnimationFrame((t) => this.tick(t));
  }

  private uiHost(): UiHost {
    return {
      world: () => this.displayWorld(),
      apply: (next) => this.applyCommand(next),
      announce: (next) => {
        this.applyCommand(next);
        this.hud.pushEvents(next);
        const sting = stingOf(next.events, playerVehicle(next).id);
        if (sting) this.sound.ui(sting);
      },
      selectedWeapon: () => this.selected,
      selectWeapon: (id) => { if (this.anim || this.modalOpen()) return; this.selected = id; this.refreshUi(); },
      pressTurn: () => this.pressTurn(),
      releaseTurn: () => this.releaseTurn(),
      runKey: (code) => this.runKey(code),
      autoTravel: () => this.travel.isAuto(this.world),
      getTurnPhase: () => this.phase,
    };
  }

  // Screen point of a map point on the ground, for browser test scripts.
  debugScreenOf(x: number, y: number): { x: number; y: number } {
    return this.rig.screenOf(groundPoint(this.world.terrain, { x, y }));
  }

  // Centers the camera on map point x, y at the given zoom and stops following, for browser scripts.
  debugView(x: number, y: number, zoom: number): void {
    this.follow.release();
    this.rig.setZoom(zoom);
    // An infinite step moves the smoothed follow all the way in one tick.
    this.rig.follow(groundPoint(this.world.terrain, { x, y }));
    this.rig.tick(Number.POSITIVE_INFINITY);
    this.rig.follow(null);
  }

  get state(): World { return this.world; }

  // Whether a turn is playing, so the debug console waits instead of changing the world under it.
  get busy(): boolean { return this.anim !== null; }

  // A command from a panel: apply it, and save at once on a town pad.
  private applyCommand(next: World): void {
    this.apply(next);
    if (!this.saves.held) saveInTown(window.localStorage, next, Date.now());
  }

  apply(next: World): void {
    this.travel.pause();
    this.world = next;
    syncDrive(this.drive, this.world);
    this.refreshUi();
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.resize();
  }

  private modalOpen(): boolean {
    return this.town.isOpen() || this.trade.isOpen() || this.character.isOpen() || this.inventory.isOpen() || this.world.player.call !== null || this.menu.isPanelOpen();
  }

  // Until a turn's shots land, the panels show the world as it was when the turn began.
  private displayWorld(): World {
    return this.anim && !this.anim.impacts ? this.anim.before : this.world;
  }

  private refreshUi(): void {
    this.uiStale = false;
    this.menu.refresh();
    const me = playerVehicle(this.world);
    if (
      this.selected &&
      !vehicleStats(this.world, me).weapons.some(
        (mw) => mw.part.id === this.selected,
      )
    )
      this.selected = null;
    if (!this.anim) {
      timed("fog", () => this.fog.update(this.world));
      this.shade.update(this.world);
    }
    if (!this.anim || this.anim.impacts)
      this.obstacles.sync(this.world.obstacles, this.world.salvage, this.world.broken);
    this.hud.renderTop(this.displayWorld());
    this.hud.renderRescue(this.displayWorld());
    if (!this.anim && this.world.player.state === "dead") this.death.show();
    this.weapons.render();
    this.town.render();
    this.trade.render();
    this.character.render();
    this.inventory.render();
    const { action, count, index } = this.context.shown();
    this.hud.renderAction(
      action,
      count,
      index,
      this.displayWorld(),
      () => this.runKey("KeyE"),
      (step) => this.runKey(step === 1 ? "ArrowRight" : "ArrowLeft"),
    );
    this.refreshInfo();
    this.refreshTargetMarkers();
  }

  private cycleContext(step: 1 | -1): void {
    this.context.cycle(step);
    this.refreshUi();
  }

  private refreshInfo(): void {
    const w = this.displayWorld();
    const v = w.vehicles.find((x) => x.id === this.hovered && playerSees(w, x.pos)) ?? null;
    this.hud.showInfo(w, v, v ? hostileToPlayer(w, v) : false);
    this.hitCard.render(w, v ? v.id : null);
  }

  // Combat details stay in the fixed inspection panel and hide during playback.
  private placeHitCard(): void {
    const f = this.hovered ? this.frames[this.hovered] : undefined;
    if (this.anim !== null || this.modalOpen() || !f)
      return this.hitCard.hide();
    this.hitCard.show();
  }

  // Ground point of the order the truck drives, or null without one. While a turn plays, the order
  // is the one the turn started with, since the turn may have finished it.
  private orderPoint(): V3 | null {
    const order = playerVehicle(this.anim ? this.anim.before : this.world).order;
    return order === null || order.kind === "brake" ? null : groundPoint(this.world.terrain, order.dest);
  }

  private refreshTargetMarkers(): void {
    this.markers.refresh(vehicleMarks(this.displayWorld(), this.hovered));
  }

  private readonly ignoresKey = (e: KeyboardEvent): boolean => isBrowserChord(e) || this.isEditingControl();

  private isEditingControl(): boolean {
    return document.activeElement?.matches("input, select, textarea") ?? false;
  }

  // Input: left click orders or targets, wheel zooms, keys like the 2D game.
  private bindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.onLeftClick(e);
    });
    window.addEventListener("pointermove", (e) => e.target === canvas && this.onHover(e));
    canvas.addEventListener("wheel", (e) => this.rig.zoomBy(e.deltaY), { passive: true });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") this.releaseTurn();
    });
    window.addEventListener("blur", () => this.travel.pause());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.travel.pause();
    });
    window.addEventListener("keydown", (e) => {
      if (this.ignoresKey(e) || this.death.isShown()) return;
      if (e.code === "Space" && !this.modalOpen()) {
        e.preventDefault();
        if (!e.repeat) this.pressTurn();
      }
      this.runKey(e.code);
    });
  }

  // Plays a turn when a press asks for one. Space and the turn button both come here.
  private pressTurn(): void {
    if (this.death.isShown() || this.modalOpen()) return;
    if (this.travel.pressTurn(this.travel.isPlaying(this.anim), this.world)) this.endTurn();
  }

  private releaseTurn(): void {
    this.travel.release();
  }

  // Runs a key's action under its gates. The key and its HUD button both come here.
  private runKey(code: string): void {
    const key = this.keys[code];
    if (!key || (key.noModal && this.modalOpen()) || (key.idle && this.travel.isPlaying(this.anim))) return;
    key.run();
  }

  // Single-key actions. noModal keys wait for panels and calls to close, idle keys wait for the turn to finish playing.
  private readonly keys: Record<string, { run: () => void; noModal?: true; idle?: true }> = {
    KeyF: { run: () => this.follow.recenter() },
    KeyM: { run: () => this.toggleMute() },
    KeyQ: { run: () => this.weapons.toggleAuto(), noModal: true },
    KeyX: { run: () => this.weapons.toggleVisible(), noModal: true },
    Digit0: { run: () => this.weapons.selectWeapon(null), noModal: true },
    ...Object.fromEntries([0, 1, 2, 3].map((i) => [`Digit${i + 1}`, { run: () => this.weapons.selectIndex(i), noModal: true as const, idle: true as const }])),
    KeyE: { run: () => this.context.use(), noModal: true },
    ArrowLeft: { run: () => this.cycleContext(-1), noModal: true, idle: true },
    ArrowRight: { run: () => this.cycleContext(1), noModal: true, idle: true },
    KeyR: { run: () => this.controls.toggleManual(), noModal: true, idle: true },
    KeyP: { run: () => this.controls.toggleAutoRepair(), noModal: true, idle: true },
    KeyO: { run: () => this.controls.toggleOverdrive(), noModal: true, idle: true },
    KeyG: { run: () => this.controls.douseEngine(), noModal: true, idle: true },
    KeyL: { run: () => this.controls.toggleHeadlights(), noModal: true },
    KeyN: { run: () => this.hovered && !markError(this.world, this.hovered) && this.apply(markVehicle(this.world, this.hovered)), noModal: true, idle: true },
    KeyC: { run: () => this.toggleScreen(this.character), idle: true },
    KeyI: { run: () => this.toggleScreen(this.inventory), idle: true },
    Escape: { run: () => this.closeScreens(null) },
  };

  private closeScreens(keep: CharacterScreen | InventoryScreen | null): void {
    for (const s of [this.town, this.trade, this.character, this.inventory]) if (s !== keep) s.close();
  }

  private toggleScreen(screen: CharacterScreen | InventoryScreen): void {
    if (this.anim) return;
    this.closeScreens(screen);
    screen.toggle();
  }

  private onLeftClick(e: MouseEvent): void {
    if (this.anim || this.modalOpen() || !playerCanAct(this.world)) return;
    const picked = this.pickVehicle(e.clientX, e.clientY);
    const me = playerVehicle(this.world);
    if (picked && picked.id !== me.id) return this.targetVehicle(picked);
    const myView = this.views.get(me.id);
    if (
      picked &&
      myView &&
      this.rig.hitsObject(e.clientX, e.clientY, myView.root)
    )
      return this.apply(setMoveOrder(this.world, { kind: "brake" }));
    const p = this.rig.groundUnder(e.clientX, e.clientY, this.ground);
    if (p) this.apply(setMoveOrder(this.world, clickOrder(p, e.shiftKey, playerVehicle(this.world))));
  }

  private targetVehicle(target: Vehicle): void {
    this.apply(toggleTarget(this.world, weaponsForClick(this.world, this.selected), target));
  }

  // While a turn plays, visibility follows the truck's current spot, not the end of the turn.
  // Player shots prove sight at firing time, so their targets stay shown until the shots land,
  // even when a new wreck changes the fog.
  private canShowCombatVehicle(v: Vehicle): boolean {
    return (
      this.isVehicleVisible(v) ||
      this.world.events.some(
        (e) =>
          e.t === "shot" &&
          e.shooter === this.world.player.vehicleId &&
          e.target === v.id,
      )
    );
  }

  // A vehicle out of sight stays drawn for a few turns after the player last saw it, so it does not
  // blink out behind a rock. Display only: it cannot be picked or targeted while lingering.
  private lingers(v: Vehicle): boolean {
    const seen = this.lastSeen.get(v.id);
    return (
      seen !== undefined && this.world.turn - seen <= TERRAIN.vision.lingerTurns
    );
  }

  private isVehicleVisible(v: Vehicle): boolean {
    if (v.id === playerVehicle(this.world).id) return true;
    const f = this.frames[v.id];
    if (this.live && f)
      return this.live.visible.has(tileOf(this.world, toMap(f.pos)));
    return playerSees(this.world, v.pos);
  }

  private pickVehicle(cx: number, cy: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = PICK_PX;
    for (const v of this.world.vehicles) {
      const f = this.frames[v.id];
      if (!f || !this.isVehicleVisible(v)) continue;
      const s = this.rig.screenOf(f.pos);
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  private onHover(e: MouseEvent): void {
    const id = this.pickVehicle(e.clientX, e.clientY)?.id ?? null;
    this.hoverGround =
      id || this.modalOpen()
        ? null
        : this.rig.groundUnder(e.clientX, e.clientY, this.ground);
    this.hoverHold.move(id, this.hovered);
  }

  private setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.refreshInfo();
    this.refreshTargetMarkers();
  }

  endTurn(): void {
    if (this.travel.isPlaying(this.anim) || this.modalOpen() || this.world.player.state === "dead") return;
    this.travel.request(this.world, this.drive);
  }

  private updateTravel(): void {
    const danger = this.world.vehicles.some(
      (v) => hostileToPlayer(this.world, v) && this.isVehicleVisible(v),
    );
    this.follow.noteDanger(danger);
    this.travel.updateWorld(this.world, danger);
  }

  private readonly saves = new SaveHold();

  holdSaves(): void {
    this.saves.noteError();
  }

  private saveNow(write: () => void): void {
    if (this.saves.held) return this.hud.note(this.world, SAVE_HELD_NOTE, "bad");
    write();
  }

  // A turn that throws does not play. The world stays as it was and the next Space or turn press tries again.
  private failTurn(err: unknown): void {
    this.travel.abandon(this.world);
    this.saves.noteError();
    this.hud.note(this.world, turnFailedNote(err), "bad");
    reportError(err);
    this.refreshUi();
  }

  // Begins the ready turn, if there is one. A turn that throws is failed and not begun.
  private tryBeginTurn(now: number, wasPlaying: boolean): "began" | "none" | "failed" {
    try {
      const prepared = this.anim ? null : this.travel.takeReady(this.world, this.drive, now);
      if (prepared) this.beginTurn(prepared, now, this.travel.getRemainder(wasPlaying));
      return prepared ? "began" : "none";
    } catch (err) {
      this.failTurn(err);
      return "failed";
    }
  }

  private beginTurn(prepared: PreparedTurn, now: number, elapsed: number): void {
    const { world, playback, towed } = this.travel.beginPlayback(this.world, prepared, now, elapsed);
    this.world = world;
    // The score must follow this turn's combat before its crash accents arrive.
    this.updateLoops();
    this.anim = playback;
    this.saves.beginTurn();
    this.live = {
      visible: new Set(this.world.player.visible),
      explored: playback.before.player.explored.slice(),
      from: null,
    };
    playback.combat = this.world.events.some(
      (e) =>
        (e.t === "shot" &&
          this.eventPoint(e.shooter) !== null &&
          this.eventPoint(e.target) !== null) ||
        (e.t === "guardShot" && this.eventPoint(e.target) !== null),
    );
    // Crashes are known now, so the score can time its accent's peak onto the step the trucks touch.
    const timed = collisionSteps(world.events, playback.result);
    this.crashCues = new CollisionCues(timed);
    this.sound.accents(world.events, world.player.vehicleId, (e) => {
      const hit = timed.find((t) => t.event === e);
      return hit ? Math.max(0, stepMs(hit.step ?? TURN_STEPS) - elapsed) : null;
    });
    // A towed truck's engine is off.
    if (!towed) this.playDriveSound(playback.result);
    this.phase = "Moving";
    this.path.clear();
    this.uiStale = true;
  }

  // Movement is over: adopt the physics state, fire the volley.
  private finishMovement(a: Playback): void {
    a.moved = true;
    freeDrive(this.drive);
    this.drive = a.result.next;
    syncDrive(this.drive, this.world);
    for (const [id, fs] of Object.entries(a.result.frames))
      this.frames[id] = fs[fs.length - 1];
    this.live = null;
    this.phase = a.combat ? "Firing" : "Results";
    timed("fog", () => this.fog.update(this.combatFogWorld()));
    const host = this.combatHost();
    playCrashes(host, this.crashCues, null);
    this.breakCues = new BreakCues(this.world.events);
    playDryGuns(host, playShotFx(host, this.breakCues));
    this.weapons.render();
  }

  // Shots land: explosions, new wrecks, the log and the new part values.
  private landImpacts(a: Playback): void {
    a.impacts = true;
    this.phase = "Results";
    for (const e of this.world.events) {
      if (e.t !== "destroyed") continue;
      const p = this.eventPoint(e.vehicle);
      if (p) this.fx.explode(p);
    }
    this.playImpactSounds();
    this.hud.pushEvents(this.world);
    // A finished search opens the loot beside the truck's grid.
    const searched = this.world.events.find((e) => e.t === "searched");
    if (searched) this.inventory.openLoot(searched.stock);
    this.uiStale = true;
    // Last, so a failed lookup in the cosmetic effects cannot skip the rest of the landing.
    for (const b of this.breakCues.rest()) this.playBreak(b);
  }

  private finishPlayback(): void {
    this.anim = null;
    this.crashCues = null;
    this.breakCues = new BreakCues([]);
    this.phase = null;
    this.idleSince = performance.now();
    this.saves.finishTurn();
    if (!this.saves.held) saveWorld(window.localStorage, this.world, CONFIG.saveTurns, Date.now());
    const pending = this.pending;
    this.pending = null;
    if (pending) this.runRescue(pending);
    this.hud.flushHorn();
    // Queued here, since refreshUi skips the shade once the next turn has begun.
    this.shade.update(this.world);
    this.uiStale = true;
  }

  // Tow and beacon buttons stay live while turns run on their own. A press during playback waits for its end.
  private rescueCommand(fn: (w: World) => World | null): void {
    if (this.modalOpen()) return;
    if (this.anim) {
      this.pending = fn;
      return;
    }
    this.runRescue(fn);
  }

  // The command returns null when the world changed since the press and it no longer applies.
  private runRescue(fn: (w: World) => World | null): void {
    const next = fn(this.world);
    if (!next) return this.refreshUi();
    this.apply(next);
    this.hud.pushEvents(this.world);
  }

  // Turns run on their own while the player is knocked out, towed or waiting on the beacon.
  private autoTurn(now: number): void {
    if (this.anim || this.modalOpen() || this.world.player.state === "dead")
      return;
    if (!this.travel.autoAllowed(this.world) || now - this.idleSince < CONFIG.autoTurnMs)
      return;
    this.endTurn();
  }

  private playHorn(id: string, delayMs: number): void {
    const v = vehicleById(this.world, id), f = this.frames[v.id] ?? restFrame(this.world, v);
    this.sound.honk({ x: f.pos.x, y: f.pos.y + GUN_HEIGHT, z: f.pos.z }, delayMs, v.chassisId);
  }

  // Explosions where they happen, then one result sting for the turn.
  private playImpactSounds(): void {
    for (const e of this.world.events) {
      const p = e.t === "destroyed" && this.eventPoint(e.vehicle);
      if (p) this.sound.at("explosion", p, 0);
    }
    const sting = stingOf(this.world.events, playerVehicle(this.world).id);
    if (sting) this.sound.ui(sting);
  }

  // A stranded truck is pushed, so its engine stays quiet, as the sim's soundRange() rule says. Its brakes still hiss.
  private playDriveSound(result: TurnResult): void {
    const frames = result.frames[playerVehicle(this.world).id];
    const g = computeEngineGlide(frames, MOVE_MS / 1000, MIX, this.world.player.overdrive);
    if (!g) return;
    if (!isStranded(this.world, playerVehicle(this.world))) this.loops.drive(g, playerVehicle(this.world).chassisId);
    if (g.brake) this.sound.at("air-brake", frames[0].pos, 0);
  }

  private updateLoops(): void {
    const me = playerVehicle(this.world);
    const f = this.frames[me.id];
    const at = f ? toMap(f.pos) : me.pos;
    const signs = this.combatWatch.observe(this.world.turn, this.world.vehicles.filter((v) => hostileToPlayer(this.world, v) && this.isVehicleVisible(v)).map((v) => v.id));
    this.loops.update({ stormTiles: this.weather.stormTilesFrom(at.x, at.y), inCombat: inCombat(this.world, me), paused: !this.anim && performance.now() - this.idleSince > MIX.music.pauseDelayMs });
    if (signs.sighted) this.sound.accent("accent-sighted", 0);
  }

  private playPanelSounds(): void {
    const open = this.modalOpen();
    if (open !== this.panelOpen) this.sound.ui(open ? (this.world.player.call ? "radio" : "ui-open") : "ui-close");
    this.panelOpen = open;
  }

  // The fog while shots fly also shows the tiles of vehicles the volley involves.
  private combatFogWorld(): World {
    const visible = new Set(this.world.player.visible);
    for (const v of [...this.world.vehicles, ...this.world.removed]) {
      if (this.canShowCombatVehicle(v)) visible.add(tileOf(this.world, v.pos));
    }
    return {
      ...this.world,
      player: {
        ...this.world.player,
        visible: [...visible].sort((a, b) => a - b),
      },
    };
  }

  // Where effects for a vehicle play, or null when the player may not see it.
  private eventPoint(id: string): V3 | null {
    const v =
      this.world.vehicles.find((x) => x.id === id) ??
      this.world.removed.find((x) => x.id === id);
    const f = this.frames[id] ?? (v ? restFrame(this.world, v) : null);
    if (!v || !f || !this.canShowCombatVehicle(v)) return null;
    return { x: f.pos.x, y: f.pos.y + GUN_HEIGHT, z: f.pos.z };
  }

  private combatHost(): CombatHost {
    return { world: this.world, fx: this.fx, sound: this.sound, eventPoint: (id) => this.eventPoint(id), views: this.views, breakPart: (b) => this.playBreak(b) };
  }

  // Scrap, the part's own burst and the break sound, for a truck the player may see.
  private playBreak(b: PartBreak): void {
    if (this.eventPoint(b.vehicle) === null) return;
    const p = playBreak(this.world, this.obstacles.parts, this.fx, this.views.get(b.vehicle), b);
    if (p) this.sound.at("part-broken", p, 0);
  }

  // The path preview chains physics turns from the current state, so it shows what will happen.
  private refreshPlan(): void {
    if (
      this.travel.isAdvancing(this.anim, this.last) ||
      this.planFor === this.world
    )
      return;
    this.planFor = this.world;
    // A knocked-out or towed truck takes no orders, and a towed one has no body to preview.
    if (!playerCanAct(this.world)) return this.path.clear();
    const me = playerVehicle(this.world);
    if (!me.order && me.speed === 0) return this.path.clear();
    timed("preview", () => this.planPath(me));
  }

  private planPath(me: Vehicle): void {
    const turns: VehicleFrame[][] = [];
    const w = cloneWorld(this.world);
    let d = this.drive;
    let v = me;
    for (let i = 0; i < PLAN_TURNS; i++) {
      const r = simulateTurn(d, w);
      turns.push(r.frames[me.id]);
      w.events = [];
      applyTurn(w, r);
      if (d !== this.drive) freeDrive(d);
      d = r.next;
      v = w.vehicles.find((x) => x.id === me.id)!;
      if (!v.order && v.speed < 0.05) break;
    }
    if (d !== this.drive) freeDrive(d);
    // A course longer than the simulated turns continues as the route the driver will take.
    const order = v.order?.kind === "brake" ? null : v.order;
    const course = order
      ? v.direct
        ? [v.pos, order.dest]
        : [
            v.pos,
            ...route(w, v.pos, order.dest, vehicleStats(w, v).radius, parkedVehicles(w, v.id), v),
          ]
      : null;
    const first =
      me.order?.kind === "through"
        ? PAL.throttle[
            throttleFor(
              Math.hypot(
                me.order.dest.x - me.pos.x,
                me.order.dest.y - me.pos.y,
              ),
              me.speed,
            )
          ]
        : PAL.plan;
    this.path.set(turns, first, course, !v.direct);
  }

  // One refresh for everything this frame changed, so a frame that ends a turn and begins the next refreshes once.
  private flushUi(): void {
    if (this.uiStale) this.refreshUi();
  }

  private advanceTurn(now: number): { step: number | null; speed: number } {
    if (this.modalOpen() || this.isEditingControl() || document.hidden)
      this.travel.pause();
    const speed = this.travel.getSpeed(now, CONFIG.travelFastSpeed);
    const wasPlaying = this.anim !== null;
    let step = this.animStep(now, speed);
    this.updateLiveVision();
    this.updateTravel();
    const began = this.tryBeginTurn(now, wasPlaying);
    if (began === "failed") return { step, speed };
    if (began === "began") {
      step = this.animStep(now, speed);
      this.updateTravel();
    }
    this.travel.prepareNext(this.world, this.anim, now);
    this.flushUi();
    return { step, speed };
  }

  private tick(now: number): void {
    // Outside dev the next frame is booked first, so an error in this frame does not stop the game.
    if (!import.meta.env.DEV) requestAnimationFrame((t) => this.tick(t));
    this.frame(now);
    if (import.meta.env.DEV) requestAnimationFrame((t) => this.tick(t));
  }

  private frame(now: number): void {
    const dt = now - this.last;
    this.last = now;
    const { step, speed } = timed("turn-frame", () => {
      const turn = this.advanceTurn(now);
      this.shade.advance();
      return turn;
    });
    // The first frame's rAF time can come before the performance.now() the clock started from.
    this.syncVehicles(step, Math.max(0, dt) / 1000);
    this.obstacles.play(this.anim, step, this.world, this.frames, Math.max(0, dt) / 1000);
    if (step !== null) playCrashes(this.combatHost(), this.crashCues, step);
    this.drawOverlays();
    // syncVehicles gives every vehicle a frame, the player's included.
    const truck = this.frames[playerVehicle(this.world).id].pos;
    // Gray vision centers on the drawn truck, so its edge moves with the truck while a turn plays. The
    // camera cannot pan past it.
    const sightRadius = grayRadius(this.world, playerVehicle(this.world).pos) * PHYSICS.metersPerTile;
    this.sightLimit.set(truck, sightRadius);
    this.rig.leash(truck, sightRadius);
    this.follow.update(truck, this.hud.cameraMode === "auto" ? this.orderPoint() : null, this.anim !== null, dt);
    this.hud.showRecenter(!this.follow.isFollowing());
    lightScene(this.sun, this.sky, truck, daylightAt(this.lightTurn()));
    const lit = this.world.vehicles
      .filter((v) => this.frames[v.id] && this.sightLimit.reaches(this.frames[v.id].pos))
      .map((v) => ({
        chassisId: v.chassisId,
        frame: this.frames[v.id],
        on: vehicleLampsOn(this.world, v, this.lightTurn()),
        player: v.id === this.world.player.vehicleId,
      }));
    this.nightLights.update(nightLightsWanted(this.world.turn, lit), truck, lit);
    const at = playerVehicle(this.world).pos;
    const stormy = this.world.weather.some((e) => e.kind === "storm" && dist(at, e.pos) <= e.radius);
    this.stormTint.style.display = stormy ? "" : "none";
    this.fx.tick(dt * speed);
    this.playPanelSounds();
    this.updateLoops();
    this.weather.advance(dt);
    this.weather.sync(this.world);
    this.labels.update(this.world, this.rig, this.sightLimit);
    for (const scope of this.scopes) scope.update(this.rig.camera);
    this.renderer.render(this.scene, this.rig.camera);
    // The preview runs after the frame is drawn, so a click shows at once.
    this.refreshPlan();
    this.autoTurn(now);
  }

  // Recomputes the player's sight from the truck's current spot once it has moved far enough.
  private updateLiveVision(): void {
    const live = this.live;
    const f = this.frames[playerVehicle(this.world).id];
    if (!live || !this.anim || !f) return;
    const at = toMap(f.pos);
    if (live.from && dist(live.from, at) < LIVE_VISION_STEP) return;
    live.from = at;
    live.visible = visibleTiles(this.world, at);
    for (const t of live.visible) live.explored[t] = 1;
    const player = { ...this.world.player, visible: [...live.visible].sort((a, b) => a - b), explored: live.explored };
    timed("fog", () => this.fog.update({ ...this.world, player }));
  }

  // The clock the light shows. While a turn's movement plays it glides from the previous turn to this one,
  // so the sun moves and changes color continuously instead of once per turn.
  private lightTurn(): number {
    const a = this.anim;
    if (!a) return this.world.turn;
    return this.world.turn - 1 + Math.min(1, a.elapsed / MOVE_MS);
  }

  // Physics step shown now while the movement plays, or null otherwise. Advances the playback phases.
  private animStep(now: number, speed: number): number | null {
    const a = this.anim;
    if (!a) return null;
    const elapsed = this.travel.advanceClock(a, now, speed, CONFIG.playbackFrameMs);
    if (elapsed < MOVE_MS)
      return Math.floor((elapsed / 1000) * PHYSICS.stepsPerSecond);
    if (!a.moved) this.finishMovement(a);
    const impactAt = MOVE_MS + (a.combat ? CONFIG.combatShotMs : 0);
    if (elapsed >= impactAt && !a.impacts) this.landImpacts(a);
    const finishAt = impactAt + (a.combat ? CONFIG.combatReadMs : 0);
    if (elapsed >= finishAt) {
      this.travel.finishClock(elapsed, finishAt);
      this.finishPlayback();
    }
    return null;
  }

  // dt: seconds since the last drawn frame.
  private syncVehicles(step: number | null, dt: number): void {
    const frames: TurnFrames | null = step === null || !this.anim ? null : this.anim.result.frames;
    const landed = !this.anim || this.anim.impacts;
    const glass = daylightAt(this.lightTurn()).glass;
    const now = performance.now();
    this.radioLights.note(this.world, now);
    const shown = [...this.world.vehicles, ...(landed ? [] : this.world.removed)];
    const ids = new Set<string>();
    for (const v of shown) {
      const kept = this.frames[v.id];
      // Between turns, a vehicle moved outside a turn, such as by a debug script, jumps to its new spot.
      const stale = !this.anim && kept && dist(toMap(kept.pos), v.pos) > MOVED_BY_RULES;
      const f = frames?.[v.id]?.[step!] ?? (kept && !stale ? kept : restFrame(this.world, v));
      this.frames[v.id] = f;
      const seen = landed ? this.isVehicleVisible(v) : this.canShowCombatVehicle(v);
      if (seen) this.lastSeen.set(v.id, this.world.turn);
      const look = this.lookOf(v, f, seen);
      if (!look) continue;
      const before = !landed && this.anim!.before.vehicles.find((x) => x.id === v.id);
      const display = before ? { ...v, items: shownItems(before.items, v.items, this.breakCues.shown(v.id)) } : v;
      ids.add(v.id);
      let view = this.views.get(v.id);
      if (!view) {
        view = new VehicleView(v, seen);
        this.views.set(v.id, view);
        this.scene.add(view.root);
      }
      view.update(display, seen);
      view.lamps(vehicleLampsOn(this.world, v, this.lightTurn()));
      view.radio(this.radioLights.lit(this.world, v.id, now));
      view.outline(look === "dark");
      view.windows(glass);
      view.pose(f, dt);
      view.aim((partId) => this.turretAim((before || v).weaponOrders, f, partId));
      this.truckFx.emit(this.world, display, f, frames !== null, dt);
    }
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      this.scene.remove(view.root);
      view.dispose();
      this.views.delete(id);
    }
  }

  // Out of sight at night, a truck in gray vision shows its lit lamps on a black shape.
  private lookOf(v: Vehicle, f: VehicleFrame, seen: boolean): "full" | "dark" | null {
    if (seen || this.lingers(v)) return "full";
    return vehicleLampsOn(this.world, v, this.lightTurn()) && this.sightLimit.reaches(f.pos) ? "dark" : null;
  }

  // A turret points at its own ordered target, else at the first ordered target. While a turn plays,
  // orders come from the turn's start, so turrets keep aim at what they fire on.
  private turretAim(orders: Vehicle["weaponOrders"], f: VehicleFrame, partId: string): number | null {
    const order = orders[partId] ?? Object.values(orders)[0];
    const target = order && this.frames[order.targetId];
    return target
      ? Math.atan2(target.pos.z - f.pos.z, target.pos.x - f.pos.x)
      : null;
  }

  // The ring is rebuilt only when the hovered vehicle's radius changes.
  private placePickRing(hide: boolean): void {
    const v =
      this.hovered && this.hovered !== playerVehicle(this.world).id
        ? this.world.vehicles.find((x) => x.id === this.hovered)
        : undefined;
    const f = v && this.frames[v.id];
    this.pickRing.visible = !hide && !!f;
    if (!v || !f || hide) return;
    const S = PHYSICS.metersPerTile;
    const r = vehicleStats(this.world, v).radius + PICK_RING.gap;
    const geo = this.pickRing.geometry;
    if (geo.parameters.outerRadius !== (r + PICK_RING.width / 2) * S) {
      geo.dispose();
      this.pickRing.geometry = new THREE.RingGeometry(
        (r - PICK_RING.width / 2) * S,
        (r + PICK_RING.width / 2) * S,
        48,
      ).rotateX(-Math.PI / 2);
    }
    const p = groundPoint(this.world.terrain, toMap(f.pos));
    this.pickRing.position.set(p.x, p.y + PICK_RING.lift * S, p.z);
  }

  private drawOverlays(): void {
    const hide =
      this.travel.isAdvancing(this.anim, this.last) || this.modalOpen();
    // Steering zones and the path preview only help a driver who can give orders.
    const steer = !hide && playerCanAct(this.world);
    this.zones.root.visible = steer;
    this.path.show(steer, this.displayWorld(), this.modalOpen());
    this.weaponRange.root.visible = false;
    this.hoverArcs.follow(this.displayWorld(), this.hovered, this.frames, this.modalOpen());
    this.markers.place(this.frames, hide, this.modalOpen());
    this.placeHitCard();
    this.placePickRing(hide);
    this.contacts.update(this.world.terrain, this.world.player.contacts, playerVehicle(this.world).pos, this.world.turn, performance.now());
    this.dust.update(this.world, this.world.terrain, performance.now());
    const meFrame = this.frames[playerVehicle(this.world).id];
    const listener = meFrame ? toMap(meFrame.pos) : playerVehicle(this.world).pos;
    this.soundRing.update(this.world.terrain, this.world.player.contacts, listener, this.world.turn, performance.now());
    this.beaconPulse.update(this.world.terrain, this.world.player.beacon, listener, performance.now());
    if (hide) return;
    const me = playerVehicle(this.world);
    const s = vehicleStats(this.world, me);
    const sel = s.weapons.filter((m) => m.part.id === this.selected);
    this.weaponRange.set(this.world.terrain, me.pos, me.heading, sel);
    this.zones.update(
      this.world.terrain,
      me.pos,
      me.heading,
      me.speed,
      Math.max(MIN_ZONE_HALF_ANGLE, maxTurn(s, me.speed) / 2),
    );
    const hover = this.hoverGround;
    const color = hover
      ? PAL.throttle[
          throttleFor(
            Math.hypot(hover.x - me.pos.x, hover.y - me.pos.y),
            me.speed,
          )
        ]
      : PAL.plan;
    this.zones.hover(this.world.terrain, hover, color);
  }
}

