// Export our own procedural DuoPod model (duopod-cell-pro, ?cad=0: no vendor CAD) to a GLB with one node per moving body,
// every body in the CAD reference pose, geometry baked in the OIP frame (metres, +Y up, origin = belt top under the robot).
// Usage: node tools/export_glb.mjs [path/to/duopod-cell-pro] -> parts/duopod/duopod.glb
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import("/opt/homebrew/lib/node_modules/playwright/index.mjs");
const here = dirname(fileURLToPath(import.meta.url));
const pro = process.argv[2] || join(homedir(), "code/duopod-cell-pro");
const out = join(here, "..", "_build", "duopod.glb");
const PORT = 8791;

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: pro, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({ channel: "chrome", headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html?cad=0&physics=0`);
  await page.waitForFunction(() => window.pcReady && window.pcRobot, { timeout: 45000 });
  await page.waitForTimeout(1500);
  // CAD reference pose: TCP (foam face) at x = 0, z = 306 mm -> every body matrix is the identity
  await page.evaluate(() => {
    document.querySelector('.mode-switch button[data-mode="manual"]').click();
    const ins = document.querySelectorAll("#jog input[type=number]");
    ins[0].value = 0; ins[0].dispatchEvent(new Event("change"));
    ins[1].value = 306; ins[1].dispatchEvent(new Event("change"));
  });
  await page.waitForTimeout(600);
  const b64 = await page.evaluate(async () => {
    const THREE = await import("three");
    const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
    const { parts, motors, motorCables } = window.pcRobot;
    const I = new THREE.Matrix4().elements;
    for (const n of Object.keys(parts)) {
      const m = parts[n].g.matrix;
      const dev = Math.max(...m.elements.map((v, i) => Math.abs(v - I[i])));
      if (dev > 1e-4) throw new Error(`${n} is not at the reference pose (${dev})`);
      m.identity();                                   // remove the 1e-16 IK round-off: the reference pose exactly
    }
    const root = new THREE.Scene();
    const bake = (src, node) => {
      src.updateWorldMatrix(true, true);
      src.traverse((o) => {
        if (!o.visible) return;
        if (o.isInstancedMesh) {
          const im = new THREE.Matrix4();
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, im);
            const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(o.matrixWorld, im));
            node.add(new THREE.Mesh(g, o.material));
          }
        } else if (o.isMesh && !o.isInstancedMesh) {
          let vis = true;
          for (let p = o; p; p = p.parent) if (p.visible === false) vis = false;
          if (!vis) return;
          const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
          node.add(new THREE.Mesh(g, o.material));
        }
      });
    };
    const bodies = ["head", "upperL", "upperR", "lowerL", "lowerR", "plate", "tri", "rod1", "rod2"];
    const counts = {};
    for (const n of bodies) {
      const node = new THREE.Group(); node.name = n; root.add(node);
      bake(parts[n].g, node);
      if (n === "head") { bake(motors, node); for (const c of motorCables) bake(c, node); }
      counts[n] = node.children.length;
    }
    console.log(JSON.stringify(counts));
    const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
    let s = "";
    const u8 = new Uint8Array(glb);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (errors.length) throw new Error(errors.join("\n"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(b64, "base64"));
  console.log(out, (Buffer.from(b64, "base64").length / 1e6).toFixed(2), "MB");
} finally {
  await browser.close();
  server.kill();
}
