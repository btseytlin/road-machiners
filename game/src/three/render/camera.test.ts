import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraRig, KeyPan, TruckFollow } from './camera';

function rigAt(): CameraRig {
  const container = {
    clientWidth: 1280,
    clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  } as HTMLElement;
  return new CameraRig(container);
}

describe('camera picking', () => {
  it('hits the vehicle model but not nearby ground inside the old click radius', () => {
    const container = {
      clientWidth: 1280,
      clientHeight: 720,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    } as HTMLElement;
    const rig = new CameraRig(container);
    rig.tick(0);
    const model = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    model.updateMatrixWorld(true);
    const center = rig.screenOf({ x: 0, y: 0, z: 0 });

    expect(rig.hitDistance(center.x, center.y, model)).not.toBeNull();
    expect(rig.hitDistance(center.x + 25, center.y, model)).toBeNull();
  });

  it('hits the end of a long model past the old radius at zoom 4', () => {
    const rig = rigAt();
    rig.setZoom(4);
    rig.tick(0);
    const model = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 2));
    model.updateMatrixWorld(true);
    const center = rig.screenOf({ x: 0, y: 0, z: 0 });
    const end = rig.screenOf({ x: 2.8, y: 0, z: 0 });
    const past = rig.screenOf({ x: 3, y: 0, z: 0 });

    expect(Math.hypot(end.x - center.x, end.y - center.y)).toBeGreaterThan(30);
    expect(rig.hitDistance(end.x, end.y, model)).not.toBeNull();
    expect(rig.hitDistance(past.x + 150, past.y, model)).toBeNull();
  });

  it('ignores a box in front and orders two boxes along one ray by distance', () => {
    const rig = rigAt();
    rig.tick(0);
    const far = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const near = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const toCamera = rig.camera.position.clone().normalize().multiplyScalar(6);
    near.position.copy(toCamera);
    far.updateMatrixWorld(true);
    near.updateMatrixWorld(true);
    const center = rig.screenOf({ x: 0, y: 0, z: 0 });

    const farDistance = rig.hitDistance(center.x, center.y, far);
    const nearDistance = rig.hitDistance(center.x, center.y, near);
    expect(farDistance).not.toBeNull();
    expect(nearDistance).not.toBeNull();
    expect(nearDistance!).toBeLessThan(farDistance!);
  });
});

describe('camera pan', () => {
  it('moves ground content with the drag on both screen axes', () => {
    const container = {
      clientWidth: 1280,
      clientHeight: 720,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    } as HTMLElement;
    const rig = new CameraRig(container);
    rig.tick(0);
    const before = rig.screenOf({ x: 0, y: 0, z: 0 });
    rig.panBy(10, 20);
    rig.tick(0);
    const after = rig.screenOf({ x: 0, y: 0, z: 0 });

    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
  });
});

describe('camera leash', () => {
  it('stops a pan at the leash radius', () => {
    const container = {
      clientWidth: 1280,
      clientHeight: 720,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    } as HTMLElement;
    const rig = new CameraRig(container);
    rig.tick(0);
    rig.leash({ x: 0, y: 0, z: 0 }, 50);

    rig.panBy(5, 0);
    const small = rig.focus();
    for (let i = 0; i < 100; i++) rig.panBy(400, 300);
    const far = rig.focus();

    expect(Math.hypot(small.x, small.z)).toBeLessThan(50);
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(50, 6);
  });

  it('rejects a radius that is not a finite positive number', () => {
    const container = { clientWidth: 1280, clientHeight: 720 } as HTMLElement;
    const rig = new CameraRig(container);
    expect(() => rig.leash({ x: 0, y: 0, z: 0 }, -1)).toThrow();
  });
});

describe('camera lead', () => {
  const container = {
    clientWidth: 1280,
    clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  } as HTMLElement;

  it('puts a followed truck halfway to the screen edge behind it', () => {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 4, 2]) {
      const rig = new CameraRig(container);
      rig.follow({ x: 0, y: 0, z: 0 }, heading);
      rig.tick(Number.POSITIVE_INFINITY);
      const truck = rig.screenOf({ x: 0, y: 0, z: 0 });
      const ahead = rig.screenOf({ x: Math.cos(heading), y: 0, z: Math.sin(heading) });
      const dx = ahead.x - truck.x;
      const dy = ahead.y - truck.y;
      // The truck moves off center opposite to where it faces on screen.
      const ox = truck.x - 640;
      const oy = truck.y - 360;
      expect(ox * dx + oy * dy).toBeLessThan(0);
      expect(Math.abs(ox * dy - oy * dx)).toBeLessThan(1e-6 * Math.hypot(ox, oy) * Math.hypot(dx, dy) + 1e-3);
      // Halfway: the nearer edge along that line is as far from the truck as from the center.
      const toEdge = Math.min(640 / Math.abs(ox || 1e-9), 360 / Math.abs(oy || 1e-9));
      expect(toEdge).toBeCloseTo(2, 3);
    }
  });

  it('centers the truck without a heading', () => {
    const rig = new CameraRig(container);
    rig.follow({ x: 5, y: 0, z: 7 });
    rig.tick(Number.POSITIVE_INFINITY);
    const truck = rig.screenOf({ x: 5, y: 0, z: 7 });
    expect(truck.x).toBeCloseTo(640, 3);
    expect(truck.y).toBeCloseTo(360, 3);
  });
});

describe('camera lead hold', () => {
  const container = {
    clientWidth: 1280,
    clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  } as HTMLElement;

  it('keeps the current shift when the lead is held', () => {
    const rig = new CameraRig(container);
    rig.follow({ x: 0, y: 0, z: 0 }, 0);
    rig.tick(Number.POSITIVE_INFINITY);
    const shifted = rig.focus();

    rig.follow({ x: 0, y: 0, z: 0 }, Math.PI, false);
    rig.tick(10_000);
    const held = rig.focus();

    expect(held.x).toBeCloseTo(shifted.x, 3);
    expect(held.z).toBeCloseTo(shifted.z, 3);
  });
});

describe('camera view exit', () => {
  const container = {
    clientWidth: 1280,
    clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  } as HTMLElement;

  it('reports a point that moves out of the view', () => {
    const rig = new CameraRig(container);
    rig.tick(0);
    expect(rig.pointLeftView({ x: 0, y: 0, z: 0 })).toBe(false);

    const far = { x: 500, y: 0, z: -500 };
    expect(rig.pointLeftView(far)).toBe(true);
    expect(rig.pointLeftView(far)).toBe(false);
  });

  it('ignores a point that a pan moves out of the view', () => {
    const rig = new CameraRig(container);
    rig.tick(0);
    const truck = { x: 0, y: 0, z: 0 };
    rig.pointLeftView(truck);

    rig.panBy(2000, 0);
    rig.tick(0);

    expect(rig.pointLeftView(truck)).toBe(false);
  });

  it('ignores a point that a zoom moves out of the view', () => {
    const rig = new CameraRig(container);
    rig.follow({ x: 0, y: 0, z: 0 });
    rig.tick(Number.POSITIVE_INFINITY);
    rig.follow(null);
    const edge = { x: 20, y: 0, z: -20 };
    rig.pointLeftView(edge);

    rig.zoomBy(-2000);
    rig.tick(0);

    expect(rig.pointLeftView(edge)).toBe(false);
  });
});

describe('truck follow', () => {
  const container = {
    clientWidth: 1280,
    clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  } as HTMLElement;
  const truck = { x: 0, y: 0, z: 0 };

  function pointer(type: string, button: number, x: number, y: number): Event {
    return Object.assign(new Event(type), { button, clientX: x, clientY: y });
  }

  function setup(): { follow: TruckFollow; canvas: EventTarget } {
    vi.stubGlobal('window', new EventTarget());
    const canvas = new EventTarget();
    const rig = new CameraRig(container);
    const follow = new TruckFollow(rig, new KeyPan(() => false), canvas as HTMLElement);
    follow.update(truck, null, true, 0);
    return { follow, canvas };
  }

  function drag(canvas: EventTarget): void {
    canvas.dispatchEvent(pointer('pointerdown', 2, 0, 0));
    window.dispatchEvent(pointer('pointermove', 2, 50, 0));
    window.dispatchEvent(pointer('pointerup', 2, 50, 0));
  }

  afterEach(() => vi.unstubAllGlobals());

  it('stops following on a right drag and keeps the pan through later frames', () => {
    const { follow, canvas } = setup();

    drag(canvas);
    for (let i = 0; i < 10; i++) follow.update(truck, null, true, 100);

    expect(follow.isFollowing()).toBe(false);
  });

  it('follows again when a hostile first comes into sight', () => {
    const { follow, canvas } = setup();
    drag(canvas);

    follow.noteDanger(true);

    expect(follow.isFollowing()).toBe(true);
  });

  it('keeps a pan while the same hostile stays in sight', () => {
    const { follow, canvas } = setup();
    follow.noteDanger(true);
    drag(canvas);

    follow.noteDanger(true);

    expect(follow.isFollowing()).toBe(false);
  });

  it('follows again when the truck drives out of view', () => {
    const { follow, canvas } = setup();
    drag(canvas);
    follow.update(truck, null, true, 16);

    follow.update({ x: 500, y: 0, z: -500 }, null, true, 16);

    expect(follow.isFollowing()).toBe(true);
  });
});

describe('truck follow while planning', () => {
  const container = {
    clientWidth: 1280,
    clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  } as HTMLElement;

  function setup(): { follow: TruckFollow; rig: CameraRig } {
    vi.stubGlobal('window', new EventTarget());
    const rig = new CameraRig(container);
    const follow = new TruckFollow(rig, new KeyPan(() => false), new EventTarget() as HTMLElement);
    return { follow, rig };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('brings the view to the truck at boot', () => {
    const { follow, rig } = setup();

    follow.update({ x: 10, y: 0, z: 10 }, null, false, Number.POSITIVE_INFINITY);

    expect(rig.focus().x).toBeCloseTo(10, 3);
  });

  it('holds the view still after a turn while the view still lags the truck', () => {
    const { follow, rig } = setup();
    follow.update({ x: 0, y: 0, z: 0 }, null, true, Number.POSITIVE_INFINITY);
    follow.update({ x: 10, y: 0, z: 0 }, null, true, 100);
    const lagging = rig.focus();

    follow.update({ x: 10, y: 0, z: 0 }, null, false, 5000);

    expect(rig.focus().x).toBeCloseTo(lagging.x, 6);
    expect(lagging.x).toBeLessThan(10);
  });

  it('brings the view to the truck on recenter while planning', () => {
    const { follow, rig } = setup();
    follow.update({ x: 0, y: 0, z: 0 }, null, true, Number.POSITIVE_INFINITY);
    follow.update({ x: 10, y: 0, z: 0 }, null, true, 100);

    follow.recenter();
    follow.update({ x: 10, y: 0, z: 0 }, null, false, Number.POSITIVE_INFINITY);

    expect(rig.focus().x).toBeCloseTo(10, 3);
  });
});
