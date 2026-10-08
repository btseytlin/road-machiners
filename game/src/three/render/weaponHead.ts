// A weapon head assembled from its look: the receiver is the head's origin, the barrel joins at its muzzle socket and the
// extra at its extra socket. The truck view and the item icons both build heads here, so they cannot drift apart.

import * as THREE from 'three';
import type { WeaponLook } from '../../render/partLooks';
import { model, socket } from './models';

export function weaponHead(look: WeaponLook): { head: THREE.Group; tip: THREE.Vector3 } {
  const head = new THREE.Group();
  head.add(model(look.receiver));
  const barrel = model(look.barrel);
  barrel.position.copy(socket(look.receiver, 'muzzle'));
  const tip = socket(look.barrel, 'tip').add(barrel.position);
  head.add(barrel);
  if (look.extra) {
    const extra = model(look.extra);
    extra.position.copy(socket(look.receiver, 'extra'));
    head.add(extra);
  }
  return { head, tip };
}
