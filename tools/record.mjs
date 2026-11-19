// Stills + an MP4 of the cell running in OIP's own editor (local dev server of the OIP checkout).
//   node tools/scene_file.mjs && node tools/record.mjs [outDir]
// Loads _build/duopod-cell.scene.json through the editor's Import Project path, presses START (a PLC force held for
// 0.3 s, as the button would), then shoots the stills and records the running cycle.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const oip = process.env.OIP ?? join(homedir(), 'code/_vendor/open-industry-project')
const outDir = resolve(process.argv[2] ?? join(homedir(), 'Downloads/duopod_cell_oip'))
const req = createRequire(join(oip, 'package.json'))
const pw = await import(pathToFileURL(req.resolve('playwright')).href)
const chromium = pw.chromium ?? pw.default.chromium
const ffmpeg = (await import(pathToFileURL(req.resolve('ffmpeg-static')).href)).default
const PORT = 5231, URL = `http://localhost:${PORT}/app/`, W = 2400, H = 1500, CLIP = 24
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const sceneText = readFileSync(join(project, '_build/duopod-cell.scene.json'), 'utf8')
mkdirSync(outDir, { recursive: true })
const vidDir = join(outDir, '.raw'); rmSync(vidDir, { recursive: true, force: true })

const vite = spawn(process.execPath, [join(oip, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'],
        { cwd: oip, stdio: 'ignore' })
for (let t = Date.now(); ; await wait(500)) {
        try { if ((await fetch(URL)).ok) break } catch { /* not up yet */ }
        if (Date.now() - t > 60000) { vite.kill(); throw new Error('vite did not start') }
}
const browser = await chromium.launch({ channel: 'chrome', headless: false })
const context = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: 'light',
        recordVideo: { dir: vidDir, size: { width: W, height: H } } })
const page = await context.newPage()
const ready = () => page.waitForFunction(() => !!(globalThis.__oip?.store && __oip.controller && __oip.view), null, { timeout: 120000 })
let clipStart = 0, clipEnd = 0, box = null
const t0 = Date.now()
try {
        await page.goto(URL, { timeout: 120000 }); await ready()
        await page.evaluate(() => { localStorage.clear(); localStorage.setItem('oip-web/tutorial-done', '1') })
        await page.goto(URL, { timeout: 120000 }); await ready()
        const err = await page.evaluate((t) => __oip.importSceneText(t, 'duopod-cell.scene.json'), sceneText)
        if (err) throw new Error(`import refused: ${err}`)
        await page.waitForFunction(() => { const c = document.querySelector('.viewport-cover'); return !c || c.classList.contains('ready') }, null, { timeout: 90000 })
        await page.waitForFunction(() => __oip.assetsBusy?.() !== true, null, { timeout: 90000 }).catch(() => {})
        await wait(2500)
        // frame the cell, then a 3/4 view from the operator side
        // camera: az about +Y (0 looks toward -Z), el above the horizon, d = distance; target null keeps the current one
        const cam = (az, el, d, target = null) => page.evaluate(({ az, el, d, target }) => {
                const c = __oip.view.controls
                if (az === null) { __oip.view.focusOn(__oip.store.getState().scene.parts.filter((p) => p.type === 'part').map((p) => p.id)); return }
                if (target) c.target.set(...target)
                const r = d ?? c.object.position.distanceTo(c.target)
                c.object.position.set(c.target.x + r * Math.cos(el) * Math.sin(az), c.target.y + r * Math.sin(el), c.target.z + r * Math.cos(el) * Math.cos(az))
                c.update()
        }, { az, el, d, target })
        const unselect = () => page.evaluate(() => __oip.store.clearSelection())
        const shot = async (name) => { await unselect(); await wait(200); return page.locator('canvas').first().screenshot({ path: join(outDir, name) }) }
        await cam(null); await wait(1500)
        const iso = await page.evaluate(() => __oip.view.controls.object.position.distanceTo(__oip.view.controls.target) * 0.8)
        await cam(-2.3, 0.45, iso); await wait(800)
        await shot('cell_iso.png')
        await page.evaluate(() => __oip.controller.run()); await wait(1500)
        const f = await page.evaluate(() => __oip.controller.forcePlcValue('StartPB', 'TRUE'))
        if (f) throw new Error(`START force refused: ${f}`)
        await wait(300); await page.evaluate(() => __oip.controller.releasePlcForces('StartPB'))
        await unselect()
        // wait for the first carton to be picked, then record the clip
        for (let t = Date.now(); Date.now() - t < 60000; await wait(250)) {
                const n = await page.evaluate(() => Number(__oip.controller.plcGlobalTags?.Picked ?? 0))
                if (n >= 1) break
        }
        box = await page.locator('canvas').first().boundingBox()
        clipStart = (Date.now() - t0) / 1000
        await wait(CLIP * 1000)
        clipEnd = (Date.now() - t0) / 1000
        await unselect(); await wait(300)
        await shot('cell_running.png')
        await cam(-2.0, 0.30, 1.6, [0.05, 1.05, 0]); await wait(2200)
        await shot('robot_pick.png')
        console.log('PLC tags:', await page.evaluate(() => {
                const g = __oip.controller.plcGlobalTags ?? {}
                return { Picked: g.Picked, Delivered: g.Delivered, Step: g.Step, StackLight: g.StackLight, ColumnAlarm: g.ColumnAlarm }
        }))
} finally {
        await context.close()
        await browser.close()
        vite.kill()
}
// the video timeline is not a wall clock while the page loads, so cut the clip from the END: the last part of the
// recording after clipEnd is the two camera moves (~3 s), drop it, keep CLIP seconds before it
const raw = join(vidDir, readdirSync(vidDir).find((f) => f.endsWith('.webm')))
const dur = Number(spawnSync(ffmpeg, ['-i', raw], { encoding: 'utf8' }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/)
        .slice(1).reduce((a, x) => a * 60 + Number(x), 0))
const tail = (Date.now() - t0) / 1000 - clipEnd
const ss = Math.max(0, dur - tail - CLIP)
const even = (v) => Math.floor(v / 2) * 2
const crop = `crop=${even(box.width)}:${even(box.height)}:${even(box.x)}:${even(box.y)}`
const encode = (name, vf) => {
        const r = spawnSync(ffmpeg, ['-y', '-ss', ss.toFixed(2), '-t', String(CLIP), '-i', raw, ...(vf ? ['-vf', vf] : []),
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', join(outDir, name)], { encoding: 'utf8' })
        if (r.status !== 0) throw new Error(r.stderr.slice(-800))
}
encode('duopod_cell_oip.mp4', crop) // the 3D viewport only
encode('duopod_cell_oip_editor.mp4', 'scale=1600:-2') // the whole editor: scene tree, viewport, the PLC program running
rmSync(vidDir, { recursive: true, force: true })
console.log(`clip ${clipStart.toFixed(1)}-${clipEnd.toFixed(1)} s wall, raw ${dur.toFixed(1)} s, cut at ${ss.toFixed(1)} s`)
for (const f of ['cell_iso.png', 'cell_running.png', 'robot_pick.png', 'duopod_cell_oip.mp4', 'duopod_cell_oip_editor.mp4']) console.log(join(outDir, f))
