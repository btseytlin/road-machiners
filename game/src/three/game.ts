// The 3D game: wires input to the sim, the sim and physics to the Three.js view, and the HTML UI.
// Sim time only moves while a turn plays. The path preview runs the same physics the turn will run.

import * as THREE from "three";
import { CONFIG } from "../config";
import { PHYSICS } from "../data/physics";
import {
  buildDrive,
  freeDrive,
  restFrame,
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
import { type PreparedTurn } from "../phys/turn";
import { playerVehicle, vehicleById } from "../sim/damage";
import { setupLabel } from "../sim/settings";

import { inOverdrive, isStranded, maxTurn, vehicleStats } from "../sim/stats";
import { clickOrder } from "../sim/steering";
import type { Vehicle, World } from "../sim/types";
import { grayRadius, playerSees, tileOf, visibleTiles } from "../sim/vision";
import { dist, type Vec } from "../sim/vec";
import { TERRAIN } from "../data/terrain";
import { isTowed, setBeacon, unhitch } from "../sim/tow";
import { inCombat } from "../sim/combat";
import { engineOverheating } from "../sim/engine-heat";
import { hostileToPlayer, playerCanAct, setMoveOrder } from "../sim/world";
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
import { FullShopScreen } from "../ui/full-shop";
import { aimActions, HoverHold, InspectPin, SLOT_KEYS, toggleBodyAim, vehicleMarks, WeaponPanel, weaponsForClick } from "../ui/weapons";
import { CameraRig, KeyPan, TruckFollow } from "./render/camera";
import { addScatter } from "./render/scatter";
import { FogView } from "./render/fog";
import { Fx3D, TruckFx } from "./render/fx";
import { CollisionCues, collisionSteps, gunfireSeen, playCookOff, playCrashes, playDryGuns, playShotFx, playUtilitySounds, volleySeen, type CombatHost } from "./volley";
import { Labels, VehicleMarkers } from "./render/labels";
import { ObstacleViews } from "./render/obstacles";
import { CraterViews } from "./render/craters";
import { playBreak } from "./render/partDebris";
import { BreakCues, shownItems, type PartBreak } from "./breakCues";
import { PathView } from "./render/path";
import { previewPlan, throttleColor } from "./plan-preview";
import { RenderScope, SightLimit } from "./render/scope";
import { addSites } from "./render/sites";
import { addShipDecks } from "./render/ship-decks";
import { terrainMesh } from "./render/terrain";
import { RadioLights, VehicleView } from "./render/vehicle";
import { HoverArcsView, WeaponRangeView } from "./render/weaponRange";
import { stormTintStyle, WeatherView } from "./render/weather";
import { stormShare } from "../sim/weather";
import { ZonesView } from "./render/zones";
import { daylightAt, enableSunShadows, lightScene, VehicleLights, sunLight, vehicleLampsOn } from "./render/daylight";
import { markError, markVehicle } from "../sim/detect";
import { ContactsView } from "./render/contacts";
import { CloudViews } from "./render/clouds";
import type { TurnClock } from "./render/hazards";
import { UtilityAim } from "./utility-aim";
import { ShadeView } from "./render/shade";
import { BeaconPulseView } from "./render/beaconPulse";
import { SoundRingView } from "./render/soundRing";
import { reportError } from "./crash";
import { GameSaves, turnFailedNote, type Run } from "./save";
import { GameMenu } from "../ui/game-menu";
import { DeathScreen } from "../ui/death";
import { MIX } from "../data/sounds";
import { CombatScore, CombatWatch, computeEngineGlide, EngineStrain, musicPlaceAt, SoundDirector, SoundLoops, stingOf } from "./sound";
import type { SoundPlayer } from "../audio/player";
import { isBrowserChord, uiRoot } from "../ui/dom";
import { PickRing } from "./render/pick-ring";
import { PointerPicker } from "./pointer";
import { Travel, type Playback, type LiveVision } from "./travel";
import { PlayClock } from "./play-clock";


const PICK_PX = 30;
const MIN_ZONE_HALF_ANGLE = Math.PI / 12;
const LIVE_VISION_STEP = 0.35;

type TurnPhase = ReturnType<UiHost["getTurnPhase"]>;

const MOVE_MS = (TURN_STEPS / PHYSICS.stepsPerSecond) * 1000;
const stepMs = (step: number) => (step / PHYSICS.stepsPerSecond) * 1000;
const MOVED_BY_RULES = 0.5;

const GUN_HEIGHT = 1.6;

export class Game {
  private world: World;
  private drive: Drive;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
  private readonly scene = new THREE.Scene();
  private readonly sun = sunLight();
  private readonly sky = new THREE.HemisphereLight();
  private readonly play = new PlayClock(CONFIG.playEaseMs);
  private readonly vehicleLights = new VehicleLights(this.scene);
  private readonly vignette = Object.assign(document.createElement("div"), {
    className: "vignette",
  });
  private readonly stormTint = Object.assign(document.createElement("div"), {
    className: "storm-tint",
  });
  readonly rig: CameraRig;
  private readonly ground = new THREE.Group();
  private readonly props = new THREE.Group();
  private readonly scopes: RenderScope[];
  private readonly obstacles: ObstacleViews;
  private readonly craters: CraterViews;
  private readonly fog: FogView;
  private readonly lastSeen = new Map<string, number>();
  private readonly shade: ShadeView;
  private uiStale = false;
  private readonly weather: WeatherView;
  private readonly labels: Labels;
  private readonly zones = new ZonesView();
  private readonly contacts = new ContactsView();
  private readonly clouds = new CloudViews();
  private readonly utilityAim = new UtilityAim({ world: () => this.world, apply: (next) => this.apply(next), note: (text) => this.hud.note(this.world, text, "bad") });
  private readonly soundRing = new SoundRingView();
  private readonly beaconPulse = new BeaconPulseView();
  private readonly path: PathView;
  private readonly fx: Fx3D;
  private readonly truckFx: TruckFx;
  private readonly controls: TruckControls;
  readonly sound: SoundDirector;
  private panelOpen = false;
  readonly loops: SoundLoops;
  private readonly combatWatch = new CombatWatch();
  private readonly engineStrain = new EngineStrain();
  private readonly views = new Map<string, VehicleView>();
  private readonly radioLights = new RadioLights();
  private frames: Record<string, VehicleFrame> = {};
  private anim: Playback | null = null;
  private crashCues: CollisionCues | null = null;
  private breakCues = new BreakCues([]);
  private readonly travel = new Travel(CONFIG.travelHoldMs);
  private phase: TurnPhase = null;
  private readonly weaponRange = new WeaponRangeView(PAL.select, READY_ARC_BIT);
  private readonly hoverArcs: HoverArcsView;
  private readonly markers: VehicleMarkers;
  private readonly overlay: HTMLElement;
  private live: LiveVision | null = null;
  private hoverGround: Vec | null = null;
  private readonly picker = new PointerPicker({
    world: () => this.world,
    hit: (x, y, object) => this.rig.hitDistance(x, y, object),
    views: this.views,
    visible: (v) => this.isVehicleVisible(v),
    radiusPick: (x, y) => this.pickVehicle(x, y)?.id ?? null,
  });
  private hovered: string | null = null;
  private readonly hoverHold = new HoverHold((id) => this.setHovered(id), 400);
  private readonly pin = new InspectPin(() => this.onInspectChange(), (v) => this.isVehicleVisible(v));
  private readonly pickRing = new PickRing();
  private selected: string | null = null;
  private readonly sightLimit: SightLimit;
  readonly follow: TruckFollow;
  private planFor: World | null = null;
  private last = performance.now();
  private idleSince = performance.now();
  private pending: ((w: World) => World | null) | null = null;

  readonly hud: Hud;
  private readonly hitCard: HitCard;
  private readonly weapons: WeaponPanel;
  private readonly town: TownScreen;
  private readonly fullShop: FullShopScreen;
  private readonly context: TruckContext;
  private readonly trade: TruckTradeScreen;
  private readonly character: CharacterScreen;
  private readonly inventory: InventoryScreen;
  private readonly menu: GameMenu;
  private readonly death: DeathScreen;
  private readonly saves: GameSaves;

  constructor(
    world: World,
    run: Run,
    container: HTMLElement,
    overlay: HTMLElement,
    player: SoundPlayer,
    private toggleMute: () => void,
    radio: RadioPanel,
  ) {
    this.world = world;
    this.saves = new GameSaves(run, (text) => this.hud.note(this.world, text, "bad"));
    this.drive = buildDrive(this.world);
    setTimeout(() => this.travel.warm(this.world, this.drive));

    this.renderer.setPixelRatio(window.devicePixelRatio);
    enableSunShadows(this.renderer);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(container);
    this.follow = new TruckFollow(this.rig, new KeyPan(this.ignoresKey), this.renderer.domElement);

    this.scene.background = new THREE.Color(PAL.bg);
    this.renderer.domElement.classList.add("view");
    this.scene.add(this.sky);
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.pickRing.mesh);

    this.sightLimit = new SightLimit(this.world.size);
    const groundScope = new RenderScope(this.ground, this.world.size, this.sightLimit, false, false);
    const propScope = new RenderScope(this.props, this.world.size, this.sightLimit, true, true);
    this.craters = new CraterViews(this.world, this.sightLimit, this.scene);
    this.scopes = [groundScope, propScope, this.craters.scope];
    const groundChunks = terrainMesh(this.world, groundScope);
    addSites(this.world.terrain, propScope, this.play);
    addShipDecks(this.world.terrain, propScope);
    this.obstacles = new ObstacleViews(propScope, this.world.terrain);
    this.obstacles.sync(this.world.obstacles, this.world.salvage, this.world.broken);
    addScatter(this.world.terrain, this.world.obstacles, propScope);
    this.fog = new FogView(this.world, groundChunks, this.sightLimit);
    this.path = new PathView(this.world.terrain);
    this.shade = new ShadeView(this.world, groundChunks, this.play);
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
      this.clouds.root,
      this.utilityAim.root,
      this.soundRing.root,
      this.beaconPulse.root,
    );
    this.overlay = overlay;
    this.markers = new VehicleMarkers(overlay, this.rig);
    overlay.append(this.vignette, this.stormTint);
    this.labels = new Labels(overlay);
    this.fx = new Fx3D(this.scene, overlay, this.rig, () => this.world);
    this.truckFx = new TruckFx(this.fx);
    this.controls = new TruckControls({ world: () => this.world, apply: (next) => this.apply(next), commit: (next) => { this.world = next; this.refreshUi(); }, refreshPlan: () => this.refreshPlan(), doused: () => { this.truckFx.douse(); this.hud.pushEvents(this.world); }, revved: () => this.loops.rev(playerVehicle(this.world).chassisId) });
    this.context = new TruckContext({
      world: () => this.world,
      playing: () => this.anim !== null,
      apply: (next) => this.apply(next),
      pushEvents: () => this.hud.pushEvents(this.world),
      note: (text) => this.hud.note(this.world, text, "bad"),
      openTrade: (id) => this.trade.openWith(id),
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
    this.fullShop = new FullShopScreen(host);
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
      dialogue: { world: () => this.world, inspected: () => this.inspected(), busy: () => this.anim !== null, talk: (next) => this.runRescue(() => next), commit: (next) => { this.world = next; this.saves.logWorld(next); this.refreshUi(); }, log: (next) => this.hud.pushEvents(next), playHorn: (id, delayMs) => this.playHorn(id, delayMs) },
      recenter: () => this.runKey("KeyF"),
      ...aimActions({ world: () => this.world, selected: () => this.selected, canAim: () => this.anim === null && playerCanAct(this.world), apply: (w) => this.apply(w) }),
    }, radio);
    this.hitCard = new HitCard(this.hud.getInspectionRoot());
    this.hoverHold.watch(this.hud.getInspectionRoot());
    const saves = this.saves.menuActions(() => this.world);
    this.menu = new GameMenu(saves, () => this.anim !== null, () => setupLabel(this.world.setup));
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
      selectedUtility: () => this.utilityAim.selectedId,
      selectUtility: (id) => this.selectUtility(id),
      pressTurn: () => this.pressTurn(),
      releaseTurn: () => this.releaseTurn(),
      runKey: (code) => this.runKey(code),
      autoTravel: () => this.travel.isAuto(this.world),
      getTurnPhase: () => this.phase,
    };
  }

  debugScreenOf(x: number, y: number): { x: number; y: number } {
    return this.rig.screenOf(groundPoint(this.world.terrain, { x, y }));
  }

  debugOwnTruckHit(x: number, y: number): boolean {
    return this.rig.hitDistance(x, y, this.views.get(playerVehicle(this.world).id)?.root ?? null) !== null;
  }

  debugView(x: number, y: number, zoom: number): void {
    this.follow.release();
    this.rig.setZoom(zoom);
    this.rig.follow(groundPoint(this.world.terrain, { x, y }));
    this.rig.tick(Number.POSITIVE_INFINITY);
    this.rig.follow(null);
  }

  get state(): World { return this.world; }
  logTexts(): string[] { return this.hud.logTexts(); }

  get busy(): boolean { return this.anim !== null; }

  private applyCommand(next: World): void {
    this.apply(next);
    this.saves.afterCommand(next);
  }

  openFullShop(): void {
    if (this.anim) return;
    this.closeScreens(null);
    this.fullShop.open();
  }

  apply(next: World): void {
    this.travel.pause();
    this.world = next;
    this.saves.logWorld(next);
    syncDrive(this.drive, this.world);
    this.refreshUi();
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.resize();
  }

  private modalOpen(): boolean {
    const screens = [this.town, this.fullShop, this.trade, this.character, this.inventory];
    return screens.some((s) => s.isOpen()) || this.world.player.call !== null || this.menu.isOpen();
  }

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
    this.craters.sync(this.world);
    this.hud.renderTop(this.displayWorld());
    this.hud.renderRescue(this.displayWorld());
    if (!this.anim && this.world.player.state === "dead") this.death.show();
    this.weapons.render();
    this.town.render();
    this.fullShop.render();
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
    const v = w.vehicles.find((x) => x.id === this.inspected() && playerSees(w, x.pos)) ?? null;
    this.hud.showInfo(w, v, v ? hostileToPlayer(w, v) : false);
    this.hitCard.render(w, v ? v.id : null);
  }

  private placeHitCard(): void {
    const f = this.frames[this.inspected() ?? ""];
    if (this.anim !== null || this.modalOpen() || !f)
      return this.hitCard.hide();
    this.hitCard.show();
  }

  private orderPoint(): V3 | null {
    const order = playerVehicle(this.anim ? this.anim.before : this.world).order;
    return order === null || order.kind === "brake" ? null : groundPoint(this.world.terrain, order.dest);
  }

  private refreshTargetMarkers(): void {
    this.markers.refresh(vehicleMarks(this.displayWorld(), this.inspected()));
  }

  private readonly ignoresKey = (e: KeyboardEvent): boolean => isBrowserChord(e) || this.isEditingControl();

  private isEditingControl(): boolean {
    return document.activeElement?.matches("input, select, textarea") ?? false;
  }

  private bindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 0 && !this.clickUtility(e)) this.onLeftClick(e);
    });
    window.addEventListener("pointermove", (e) => {
      this.picker.moveTo(e.target === canvas ? e : null);
      if (e.target === canvas) this.onHover(e);
    });
    canvas.addEventListener("pointerleave", () => this.picker.moveTo(null));
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

  private pressTurn(): void {
    if (this.death.isShown() || this.modalOpen()) return;
    if (this.travel.pressTurn(this.travel.isPlaying(this.anim), this.world)) this.endTurn();
  }

  private releaseTurn(): void {
    this.travel.release();
  }

  private runKey(code: string): void {
    const key = this.keys[code];
    if (!key || (key.noModal && this.modalOpen()) || (key.idle && this.travel.isPlaying(this.anim))) return;
    key.run();
  }

  private readonly keys: Record<string, { run: () => void; noModal?: true; idle?: true }> = {
    KeyF: { run: () => this.follow.recenter() },
    KeyM: { run: () => this.toggleMute() },
    KeyQ: { run: () => this.weapons.toggleAuto(), noModal: true },
    KeyX: { run: () => this.weapons.toggleVisible(), noModal: true },
    Digit0: { run: () => this.weapons.selectWeapon(null), noModal: true },
    ...Object.fromEntries(Array.from({ length: SLOT_KEYS }, (_, i) => [`Digit${i + 1}`, { run: () => this.weapons.pressKey(i + 1), noModal: true as const, idle: true as const }])),
    KeyE: { run: () => this.context.use(), noModal: true },
    ArrowLeft: { run: () => this.cycleContext(-1), noModal: true, idle: true },
    ArrowRight: { run: () => this.cycleContext(1), noModal: true, idle: true },
    KeyR: { run: () => this.controls.toggleManual(), noModal: true, idle: true },
    KeyP: { run: () => this.controls.toggleAutoRepair(), noModal: true, idle: true },
    KeyO: { run: () => this.controls.toggleOverdrive(), noModal: true, idle: true },
    KeyG: { run: () => this.controls.douseEngine(), noModal: true, idle: true },
    KeyL: { run: () => this.controls.toggleHeadlights(), noModal: true },
    KeyN: { run: () => this.inspected() && !markError(this.world, this.inspected()!) && this.apply(markVehicle(this.world, this.inspected()!)), noModal: true, idle: true },
    KeyC: { run: () => this.toggleScreen(this.character), idle: true },
    KeyI: { run: () => this.toggleScreen(this.inventory), idle: true },
    Escape: { run: () => { if (this.modalOpen()) this.closeScreens(null); else this.pin.clear(); this.selectUtility(null); } },
  };

  private selectUtility(id: string | null): void {
    if (this.anim || (id !== null && this.modalOpen())) return;
    this.utilityAim.select(id);
    this.refreshUi();
  }

  private closeScreens(keep: CharacterScreen | InventoryScreen | null): void {
    for (const s of [this.town, this.fullShop, this.trade, this.character, this.inventory]) if (s !== keep) s.close();
  }

  private toggleScreen(screen: CharacterScreen | InventoryScreen): void {
    if (this.anim) return;
    this.closeScreens(screen);
    screen.toggle();
  }

  private updateStopCue(): void {
    if (this.picker.updateCue(this.canClick())) this.renderer.domElement.style.cursor = this.picker.stopCue ? "pointer" : "";
  }

  private canClick(): boolean {
    return !this.anim && !this.modalOpen() && playerCanAct(this.world);
  }

  private onLeftClick(e: MouseEvent): void {
    if (this.modalOpen()) return;
    const action = this.picker.action(e.clientX, e.clientY);
    if (action.kind === "vehicle") return this.clickVehicle(action.id);
    if (!this.canClick()) return;
    switch (action.kind) {
      case "stop":
        return this.apply(setMoveOrder(this.world, { kind: "brake" }));
      case "own":
        return;
      case "ground": {
        const p = this.rig.groundUnder(e.clientX, e.clientY, this.ground);
        if (p) this.apply(setMoveOrder(this.world, clickOrder(p, e.shiftKey, playerVehicle(this.world))));
        return;
      }
      default:
        throw new Error(`Unknown pointer action ${JSON.stringify(action)}`);
    }
  }

  private inspected(): string | null { return this.pin.id ?? this.hovered; }

  private onInspectChange(): void {
    this.refreshInfo();
    this.refreshTargetMarkers();
  }

  private clickUtility(e: MouseEvent): boolean {
    if (this.anim || this.modalOpen() || !playerCanAct(this.world)) return false;
    return this.utilityAim.click(this.rig.groundUnder(e.clientX, e.clientY, this.ground));
  }

  // A click on a truck pins its card, and with a gun picked also aims that gun at its body. With none it only inspects.
  private clickVehicle(id: string): void {
    this.pin.click(id);
    if (this.selected !== null && this.canClick()) this.apply(toggleBodyAim(this.world, weaponsForClick(this.world, this.selected), vehicleById(this.world, id)));
  }

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

  private lingers(v: Vehicle): boolean {
    const seen = this.lastSeen.get(v.id);
    return (
      seen !== undefined && this.world.turn - seen <= TERRAIN.vision.lingerTurns
    );
  }

  private isVehicleVisible(v: Vehicle): boolean {
    if (v.id === playerVehicle(this.world).id) return true;
    const f = this.frames[v.id];
    if (this.live && f) return this.live.visible.has(tileOf(this.world, toMap(f.pos)));
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
      id || this.picker.overOwn(e.clientX, e.clientY) || this.modalOpen()
        ? null
        : this.rig.groundUnder(e.clientX, e.clientY, this.ground);
    this.hoverHold.move(id, this.hovered);
  }

  private setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    if (this.pin.id === null) this.onInspectChange();
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

  holdSaves(): void {
    this.saves.noteError();
  }

  private failTurn(err: unknown): void {
    this.travel.abandon(this.world);
    this.saves.noteError();
    this.hud.note(this.world, turnFailedNote(err), "bad");
    reportError(err);
    this.refreshUi();
  }

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
    const { world, playback, towed } = this.travel.beginPlayback(this.world, prepared, now, elapsed, this.frames);
    this.world = world;
    this.saves.logWorld(world);
    this.updateLoops();
    this.anim = playback;
    this.saves.beginTurn();
    this.live = {
      visible: new Set(this.world.player.visible),
      explored: playback.before.player.explored.slice(),
      from: null,
    };
    const seen = (id: string) => this.eventPoint(id) !== null;
    playback.combat = gunfireSeen(this.world.events, seen);
    playback.volley = volleySeen(this.world.events, seen);
    const timed = collisionSteps(world.events, playback.result);
    this.crashCues = new CollisionCues(timed);
    this.sound.accents(world.events, world.player.vehicleId, (e) => {
      const hit = timed.find((t) => t.event === e);
      return hit ? Math.max(0, stepMs(hit.step ?? TURN_STEPS) - elapsed) : null;
    });
    if (!towed) this.playDriveSound(playback.result);
    this.phase = "Moving";
    this.path.clear();
    this.uiStale = true;
  }

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
    playUtilitySounds(host);
    this.weapons.render();
  }

  private landImpacts(a: Playback): void {
    a.impacts = true;
    this.phase = "Results";
    this.craters.revealAll(this.world.turn);
    for (const e of this.world.events) {
      if (e.t !== "destroyed") continue;
      const p = this.eventPoint(e.vehicle);
      if (p) this.fx.explode(p);
    }
    this.playImpactSounds();
    this.hud.pushEvents(this.world);
    const searched = this.world.events.find((e) => e.t === "searched");
    if (searched) this.inventory.openLoot(searched.stock);
    this.uiStale = true;
    for (const b of this.breakCues.rest()) this.playBreak(b);
  }

  private finishPlayback(): void {
    this.anim = null;
    this.fx.releaseRopes();
    this.crashCues = null;
    this.breakCues = new BreakCues([]);
    this.phase = null;
    this.idleSince = performance.now();
    this.saves.afterTurn(this.world);
    const pending = this.pending;
    this.pending = null;
    if (pending) this.runRescue(pending);
    this.hud.flushHorn();
    this.shade.update(this.world);
    this.uiStale = true;
  }

  private rescueCommand(fn: (w: World) => World | null): void {
    if (this.modalOpen()) return;
    if (this.anim) {
      this.pending = fn;
      return;
    }
    this.runRescue(fn);
  }

  private runRescue(fn: (w: World) => World | null): void {
    const next = fn(this.world);
    if (!next) return this.refreshUi();
    this.apply(next);
    this.hud.pushEvents(this.world);
  }

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

  private playImpactSounds(): void {
    for (const e of this.world.events) {
      const p = e.t === "destroyed" && this.eventPoint(e.vehicle);
      if (p) this.sound.at("explosion", p, 0);
    }
    const sting = stingOf(this.world.events, playerVehicle(this.world).id);
    if (sting) this.sound.ui(sting);
  }

  private playDriveSound(result: TurnResult): void {
    const me = playerVehicle(this.world);
    const frames = result.frames[me.id];
    const g = computeEngineGlide(frames, MOVE_MS / 1000, MIX, inOverdrive(this.world, me));
    if (!g) return;
    const strain = this.engineStrain.next(this.world.turn, engineOverheating(this.world));
    if (!isStranded(this.world, me)) {
      this.loops.drive(g, me.chassisId, strain);
      this.sound.engineStrain(strain);
    }
    if (g.brake) this.sound.at("air-brake", frames[0].pos, 0);
  }

  private updateLoops(): void {
    const me = playerVehicle(this.world);
    const at = this.frames[me.id] ? toMap(this.frames[me.id].pos) : me.pos;
    const signs = this.combatWatch.observe(this.world.turn, this.world.vehicles.filter((v) => hostileToPlayer(this.world, v) && this.isVehicleVisible(v)).map((v) => v.id));
    this.loops.update({ stormShare: stormShare(me), inCombat: inCombat(this.world, me), place: musicPlaceAt(at), paused: !this.anim && performance.now() - this.idleSince > MIX.music.pauseDelayMs });
    if (signs.sighted) this.sound.accent("accent-sighted", 0);
  }

  private playPanelSounds(): void {
    const open = this.modalOpen();
    if (open !== this.panelOpen) this.sound.ui(open ? (this.world.player.call ? "radio" : "ui-open") : "ui-close");
    this.panelOpen = open;
  }

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

  private eventPoint(id: string): V3 | null {
    const v =
      this.world.vehicles.find((x) => x.id === id) ??
      this.world.removed.find((x) => x.id === id);
    const f = this.frames[id] ?? (v ? restFrame(this.world, v) : null);
    if (!v || !f || !this.canShowCombatVehicle(v)) return null;
    return { x: f.pos.x, y: f.pos.y + GUN_HEIGHT, z: f.pos.z };
  }

  private combatHost(): CombatHost {
    return { world: this.world, fx: this.fx, sound: this.sound, eventPoint: (id) => this.eventPoint(id), onBurst: (p) => this.craters.reveal(p), views: this.views, breakPart: (b) => this.playBreak(b) };
  }

  private playBreak(b: PartBreak): void {
    if (this.eventPoint(b.vehicle) === null) return;
    if (!this.anim) throw new Error(`Part ${b.part} of ${b.vehicle} broke outside turn playback`);
    const p = playBreak(this.world, this.anim.before, this.obstacles.parts, this.fx, this.views.get(b.vehicle), b);
    if (p) this.sound.at("part-broken", p, 0);
    playCookOff(this.combatHost(), b);
  }

  private refreshPlan(): void {
    if (
      this.travel.isAdvancing(this.anim, this.last) ||
      this.planFor === this.world
    )
      return;
    this.planFor = this.world;
    if (!playerCanAct(this.world)) return this.path.clear();
    const me = playerVehicle(this.world);
    if (!me.order && me.speed === 0) return this.path.clear();
    timed("preview", () => this.planPath(me));
  }

  private planPath(me: Vehicle): void {
    const plan = previewPlan(this.drive, this.world, me);
    this.path.set(plan.turns, plan.first, plan.course, plan.waypoint);
  }

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
    if (!import.meta.env.DEV) requestAnimationFrame((t) => this.tick(t));
    this.frame(now);
    if (import.meta.env.DEV) requestAnimationFrame((t) => this.tick(t));
  }

  private frame(now: number): void {
    const dt = now - this.last;
    this.last = now;
    this.play.beginFrame();
    const { step, speed } = timed("turn-frame", () => {
      const turn = this.advanceTurn(now);
      this.shade.advance();
      return turn;
    });
    this.play.coast(Math.max(0, dt), this.travel.isAdvancing(null, now), speed);
    const playDt = this.play.frameMs() / 1000;
    this.syncVehicles(step, Math.max(0, dt) / 1000, playDt);
    this.obstacles.play(this.anim, step, this.world, this.frames, playDt);
    if (step !== null) playCrashes(this.combatHost(), this.crashCues, step);
    this.drawOverlays();
    const truck = this.frames[playerVehicle(this.world).id].pos;
    const sightRadius = grayRadius(this.world) * PHYSICS.metersPerTile;
    this.sightLimit.set(truck, sightRadius);
    this.rig.leash(truck, sightRadius);
    this.follow.update(truck, this.hud.cameraMode === "auto" ? this.orderPoint() : null, this.anim !== null, dt);
    this.hud.showRecenter(!this.follow.isFollowing());
    lightScene(this.sun, this.sky, truck, daylightAt(this.lightTurn()));
    this.fx.light({ sun: this.sun, sky: this.sky });
    this.vehicleLights.sync(this.world, this.frames, this.lightTurn(), (pos) => this.sightLimit.reaches(pos), truck);
    Object.assign(this.stormTint.style, stormTintStyle(stormShare(playerVehicle(this.world))));
    this.fx.tick(this.play.frameMs(), dt, this.world);
    this.playPanelSounds();
    this.updateLoops();
    this.weather.sync(this.world);
    this.weather.advance(this.play.frameMs());
    this.labels.update(this.world, this.rig, this.sightLimit);
    for (const scope of this.scopes) scope.update(this.rig.camera);
    this.renderer.render(this.scene, this.rig.camera);
    this.refreshPlan();
    this.autoTurn(now);
  }

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

  private lightTurn(): number {
    const a = this.anim;
    if (!a) return this.world.turn;
    return this.world.turn - 1 + Math.min(1, a.elapsed / MOVE_MS);
  }

  private turnClock(): TurnClock | null {
    const a = this.anim;
    return a ? { before: a.before, progress: Math.min(1, a.elapsed / MOVE_MS), moved: a.moved } : null;
  }

  private animStep(now: number, speed: number): number | null {
    const a = this.anim;
    if (!a) return null;
    const from = a.elapsed;
    const elapsed = this.travel.advanceClock(a, now, speed, CONFIG.playbackFrameMs);
    this.play.advance(elapsed - from);
    if (elapsed < MOVE_MS)
      return Math.floor((elapsed / 1000) * PHYSICS.stepsPerSecond);
    if (!a.moved) this.finishMovement(a);
    const impactAt = MOVE_MS + (a.volley ? CONFIG.combatShotMs : 0);
    if (elapsed >= impactAt && !a.impacts) this.landImpacts(a);
    const finishAt = impactAt + (a.volley ? CONFIG.combatReadMs : 0);
    if (elapsed >= finishAt) {
      this.travel.finishClock(elapsed, finishAt);
      this.finishPlayback();
    }
    return null;
  }

  private syncVehicles(step: number | null, dt: number, playDt: number): void {
    const frames: TurnFrames | null = step === null || !this.anim ? null : this.anim.result.frames;
    const landed = !this.anim || this.anim.impacts;
    const glass = daylightAt(this.lightTurn()).glass;
    const now = performance.now();
    this.radioLights.note(this.world, now);
    const shown = [...this.world.vehicles, ...(landed ? [] : this.world.removed)];
    const ids = new Set<string>();
    for (const [i, v] of shown.entries()) {
      this.pin.note(v, i < this.world.vehicles.length);
      const kept = this.frames[v.id];
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
      view.radio(this.radioLights.lit(v.id, now));
      view.outline(look === "dark");
      view.windows(glass);
      view.pose(f, dt);
      view.aim((partId) => this.turretAim((before || v).weaponOrders, f, partId));
      this.truckFx.emit(this.world, display, f, frames !== null, playDt, seen);
    }
    this.pin.settle();
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      this.scene.remove(view.root);
      view.dispose();
      this.views.delete(id);
    }
  }

  private lookOf(v: Vehicle, f: VehicleFrame, seen: boolean): "full" | "dark" | null {
    if (seen || this.lingers(v)) return "full";
    return vehicleLampsOn(this.world, v, this.lightTurn()) && this.sightLimit.reaches(f.pos) ? "dark" : null;
  }

  private turretAim(orders: Vehicle["weaponOrders"], f: VehicleFrame, partId: string): number | null {
    const order = orders[partId] ?? Object.values(orders)[0];
    const target = order && this.frames[order.targetId];
    return target
      ? Math.atan2(target.pos.z - f.pos.z, target.pos.x - f.pos.x)
      : null;
  }

  private drawOverlays(): void {
    this.updateStopCue();
    const hide =
      this.travel.isAdvancing(this.anim, this.last) || this.modalOpen();
    const steer = !hide && playerCanAct(this.world);
    this.zones.root.visible = steer;
    this.path.show(steer, this.displayWorld(), this.modalOpen());
    this.weaponRange.root.visible = false;
    this.hoverArcs.follow(this.displayWorld(), this.inspected(), this.frames, this.modalOpen());
    this.markers.place(this.frames, hide, this.modalOpen());
    this.placeHitCard();
    this.pickRing.follow(this.world, this.hovered, this.frames, hide);
    this.contacts.update(this.world.terrain, this.world.player.contacts, playerVehicle(this.world).pos, this.world.turn, performance.now());
    this.clouds.update(this.world, this.views, this.play.nowMs(), this.turnClock(), this.rig.camera, this.fx.cards);
    this.utilityAim.draw(this.world, this.world.terrain, this.hoverGround, !steer);
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
    const color = hover ? throttleColor(me, hover) : PAL.plan;
    this.zones.hover(this.world.terrain, hover, color);
  }
}
