// Emote poses on the player box model (wave, point, sit): net/social.js works out the angles,
// this applies them to the model's limbs. Used for the other players (net/remotePlayer.js)
// and for our own body in the third-person views (render/playerModel.js).
import { emotePose } from '../net/social.js';

/**
 * Pose `root` (a buildModel('player') group) for emote `kind`, `t` ms after it started.
 * Returns true while the emote is playing; false (and the limbs' sideways swing reset) when it is not.
 */
export function applyEmote(root, kind, t) {
  const parts = root.userData.parts, pose = kind ? emotePose(kind, t) : null;
  if (!pose) {
    parts.armR.rotation.z = parts.armL.rotation.z = 0;
    if (root.userData.seated) { root.userData.seated = false; parts.legL.rotation.z = parts.legR.rotation.z = 0; }
    return false;
  }
  parts.armR.rotation.x = pose.armR[0]; parts.armR.rotation.z = pose.armR[1];
  if (pose.armL) { parts.armL.rotation.x = pose.armL[0]; parts.armL.rotation.z = pose.armL[1]; }
  if (pose.legs) {
    parts.legL.rotation.x = parts.legR.rotation.x = pose.legs;
    parts.legL.rotation.z = -0.12; parts.legR.rotation.z = 0.12;
    root.userData.seated = true;
  }
  root.position.y -= pose.drop;
  return true;
}
