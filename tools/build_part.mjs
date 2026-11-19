// Build parts/duopod/manifest.json: the rig (one mesh link per body of our own GLB, the portal as boxes, the vacuum
// gripper and its LED) with the Draco GLB embedded as base64, so the part is one self-contained folder.
// Usage: node tools/build_part.mjs   (after tools/export_glb.mjs + the Draco step in tools/make_glb.sh)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "parts", "duopod.transfer-robot");
const glb = readFileSync(join(root, "_build", "duopod_draco.glb")).toString("base64");
const ZM = 1.16, MOUNT = 1.33, FLOOR = -0.85;          // part frame: origin on the belt top under the robot, +Y up
const PX = 0.80, PZ = 0.72, BEAM = 0.08, TOPY = MOUNT + 0.03 + BEAM / 2;
const box = (name, size, offset, extra = {}) => ({ name, shape: { kind: "box", size }, offset, color: [0.72, 0.74, 0.77], metalness: 0.75, roughness: 0.38, collision: "none", ...extra });
const mesh = (name) => ({ name, shape: { kind: "mesh", asset: "model", node: name }, offset: [0, 0, 0] });
const portal = [];
for (const sx of [-1, 1]) for (const sz of [-1, 1]) portal.push(box(`post_${sx > 0 ? "p" : "m"}${sz > 0 ? "p" : "m"}`, [BEAM, TOPY + BEAM / 2 - FLOOR, BEAM], [sx * PX, (TOPY + BEAM / 2 + FLOOR) / 2, sz * PZ]));
for (const sz of [-1, 1]) portal.push(box(`beamX_${sz > 0 ? "p" : "m"}`, [2 * PX + BEAM, BEAM, BEAM], [0, TOPY, sz * PZ]));
for (const sx of [-1, 1]) portal.push(box(`beamZ_${sx > 0 ? "p" : "m"}`, [BEAM, BEAM, 2 * PZ - BEAM], [sx * PX, TOPY, 0]));
// carriers over the robot head (x ±0.12) and the adapter plate inside the rod-1 pivots (x ±0.165): rod pair 1 rises
// past the head edge, so nothing may hang over it (found and checked in duopod-cell-pro / duopod-cell-mujoco)
for (const sx of [-1, 1]) portal.push(box(`carrier_${sx > 0 ? "p" : "m"}`, [BEAM, BEAM, 2 * PZ - BEAM], [sx * 0.12, TOPY, 0]));
portal.push(box("mountPlate", [0.33, 0.03, 0.42], [0, MOUNT + 0.015, 0]));

const manifest = {
  id: "duopod.transfer-robot",
  name: "DuoPod 2-axis transfer robot",
  category: "Equipment",
  assets: [{ id: "model", mime: "model/gltf-binary", data: glb }],
  geometry: {
    kind: "rig",
    links: [
      ...portal,
      mesh("head"), mesh("upperL"), mesh("upperR"), mesh("lowerL"), mesh("lowerR"), mesh("plate"), mesh("tri"), mesh("rod1"), mesh("rod2"),
      { name: "vacLed", shape: { kind: "box", size: [0.009, 0.009, 0.009] }, offset: [0.07, ZM - 0.744 - 0.035, 0.0165], collision: "none",
        lamps: [{ name: "vacuum", emissive: [0.15, 1.0, 0.35], offColor: [0.02, 0.06, 0.03] }] },
      // TCP = foam face of the vacuum pad; the pickup volume is the pad (160 x 220 mm) and reaches the carton centre 60 mm below
      { name: "gripper", shape: { kind: "frame" }, offset: [0, ZM - 0.744 - 0.110, 0],
        grip: { zone: { size: [0.16, 0.16, 0.22], offset: [0, -0.06, 0] } } },
    ],
    joints: [],
    bounds: { length: 2 * PX + BEAM, width: 2 * PZ + BEAM, top: TOPY + BEAM / 2, bottom: FLOOR },
  },
};
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(join(dir, "manifest.json"), (JSON.stringify(manifest).length / 1e6).toFixed(2), "MB");
