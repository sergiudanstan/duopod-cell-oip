// DuoPod transfer robot: a ceiling-mounted 2-axis parallel robot (5-bar + two orientation parallelograms) in its portal.
// Kinematics from the joint centres fitted on the vendor STEP (duopod-cell-pro / duopod-cell-mujoco, checked there
// against MuJoCo): motor axes ±0.125 m, upper arms 0.450 m, lower arms 0.930 m, plate joints ±0.090 m.
//
// Frame: part-local metres, origin on the belt top under the robot, +Y up, +X across the belts (the robot plane is
// local X-Y; z = 0). The model (duopod.glb, our own procedural model, no vendor CAD) is every body in the reference pose;
// each tick the behavior solves the IK for the TCP and poses every body with one rigid transform (setSubPose).
//
// PLC handshake (as the six-axis robot and the gantry): an INT command picks a row of the point table (1 ready,
// 2 pick, 3 place), a rising Execute starts the move, Done reads true while idle on a point. Moves between points at
// different x run as a goal-post: up to the travel height, across, down, overlapped with minimum-jerk profiles. The
// vacuum is latched only on arrival (never mid-stroke), VacuumOk reports a carried load. Enable low holds the robot
// where it is (the motion clock stops). The actual TCP is reported in mm.

// ---------------------------------------------------------------- geometry
const B = 0.125, L1 = 0.450, L2 = 0.930, E = 0.090, HJ = 0.039, TOOL = 0.110
const ZM = 1.16                                   // motor-axis height above the belt top (mounting face at 1.33)
const O1 = [0.04153, 0.11641], O2 = [-0.11434, 0.05052]
const REF_ELBOW = [0.56495, 0.09458]
const REF = {
  A: [[-B, ZM], [B, ZM]],
  E: [[-REF_ELBOW[0], ZM + REF_ELBOW[1]], [REF_ELBOW[0], ZM + REF_ELBOW[1]]],
  J: [[-E, ZM - 0.705], [E, ZM - 0.705]],
  F: [0, ZM - 0.744],
}

const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0])
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
function elbowFor(tcp, s) {
  const A = [s * B, ZM], P = [tcp[0] + s * E, tcp[1] + TOOL + HJ]
  const dx = P[0] - A[0], dz = P[1] - A[1], d = Math.hypot(dx, dz)
  if (d > L1 + L2 || d < Math.abs(L1 - L2) || d < 1e-9) return null
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
  const mx = A[0] + a * dx / d, mz = A[1] + a * dz / d
  const e1 = [mx + h * dz / d, mz - h * dx / d], e2 = [mx - h * dz / d, mz + h * dx / d]
  return s * e1[0] > s * e2[0] ? e1 : e2
}

// ---------------------------------------------------------------- motion
const ease = (s) => s * s * s * (10 + s * (6 * s - 15))
// pieces [t0, t1, from, to] per axis; between pieces an axis holds its value
function axisAt(v0, pieces, t) {
  let v = v0
  for (const [a, b, f, to] of pieces) {
    if (t <= a) return v
    v = t >= b ? to : f + (to - f) * ease((t - a) / (b - a))
    if (t < b) return v
  }
  return v
}
// goal-post plan from p0 to p1 through `travel` (metres), timings of the duopod cycle scaled by k
function plan(p0, p1, travel, k) {
  const T = (v) => v * k
  const sameX = Math.abs(p1[0] - p0[0]) < 1e-3
  if (sameX) {
    const dz = Math.abs(p1[1] - p0[1]), dur = T(Math.max(0.12, 0.24 * dz / 0.158))
    return { T: dur, xs: [], zs: [[0, dur, p0[1], p1[1]]], x0: p0[0], z0: p0[1] }
  }
  const up = p0[1] < travel - 1e-3, down = p1[1] < travel - 1e-3
  const xs0 = up ? T(0.16) : T(0.0), xDur = T(0.30 * Math.max(0.6, Math.abs(p1[0] - p0[0]) / 0.4))
  const zs = []
  if (up) zs.push([0, T(0.30), p0[1], travel])
  let end = xs0 + xDur
  if (down) { const d0 = xs0 + xDur - T(0.14); zs.push([d0, d0 + T(0.30), up ? travel : p0[1], p1[1]]); end = d0 + T(0.30) }
  return { T: end, xs: [[xs0, xs0 + xDur, p0[0], p1[0]]], zs, x0: p0[0], z0: p0[1] }
}

// ---------------------------------------------------------------- state (kept between ticks, one instance each)
let tcp = null, move = null, clock = 0, target = 0, vac = false

definePart({
  params: {
    commandTag: { type: 'tag', dir: 'in', stType: 'INT', default: 'RobotCmd', label: 'Command tag (point row)', group: 'Comms',
      values: [{ value: 1, label: 'ready' }, { value: 2, label: 'pick' }, { value: 3, label: 'place' }],
      desc: 'Row of the point table to move to: 1 ready, 2 pick, 3 place. Set it before the Execute edge.' },
    executeTag: { type: 'tag', dir: 'in', stType: 'BOOL', default: 'RobotExecute', label: 'Execute tag (rising edge)', group: 'Comms',
      desc: 'A rising edge starts the move to the commanded point.' },
    doneTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: 'RobotDone', label: 'Done tag', group: 'Comms',
      desc: 'True while the robot stands on a point and no move is running.' },
    busyTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: 'RobotBusy', label: 'Busy tag', group: 'Comms',
      desc: 'True while a move runs (also while it is held by Enable).' },
    pointTag: { type: 'tag', dir: 'out', stType: 'INT', default: 'RobotPoint', label: 'At point tag', group: 'Comms',
      desc: 'The point row the robot stands on (0 while moving).' },
    vacuumTag: { type: 'tag', dir: 'in', stType: 'BOOL', default: 'Vacuum', label: 'Vacuum tag', group: 'Comms',
      desc: 'Vacuum on/off. Latched only while the robot stands still on a point, as a real cup seals or releases.' },
    vacOkTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: 'VacuumOk', label: 'Vacuum OK tag', group: 'Comms',
      desc: 'True while the gripper actually carries a load (the vacuum switch of the ejector).' },
    enableTag: { type: 'tag', dir: 'in', stType: 'BOOL', default: 'RobotEnable', label: 'Enable tag', group: 'Comms',
      desc: 'Safety enable: low stops the motion where it is until it returns. Always on until a program drives it.' },
    xTag: { type: 'tag', dir: 'out', stType: 'REAL', default: 'RobotX', label: 'TCP x tag (mm)', group: 'Comms',
      desc: 'Actual TCP across the belts, mm (0 = robot centre).' },
    zTag: { type: 'tag', dir: 'out', stType: 'REAL', default: 'RobotZ', label: 'TCP z tag (mm)', group: 'Comms',
      desc: 'Actual TCP height above the belt top, mm (the foam face of the vacuum pad).' },
    points: { type: 'numberList', arity: 2, columns: ['x mm', 'z mm'], label: 'Points (row 1 ready, 2 pick, 3 place)', group: 'Motion',
      default: [[0, 306], [200, 280], [200, 122], [-200, 122]],
      desc: 'TCP points in the robot plane, mm: x across the belts, z above the belt top. Row 0 is the rest pose (the vendor CAD pose).' },
    travel: { type: 'number', default: 280, min: 200, max: 306, step: 1, label: 'Travel height (mm)', group: 'Motion',
      desc: 'TCP height for moves across: the carton bottom then clears the guides by 100 mm.' },
    timeScale: { type: 'number', default: 1, min: 0.5, max: 3, step: 0.05, label: 'Motion time scale', group: 'Motion',
      desc: 'Stretches every move; 1 = the duopod cycle (peak 2.5 m/s, 2.8 g, checked against the motor and the vacuum).' },
  },
  grippers: ['gripper'],
  lamps: ['vacuum'],
  step(ctx) {
    const P = ctx.params
    const pts = P.points.length ? P.points : [[0, 306]]
    const pt = (i) => { const r = pts[Math.max(0, Math.min(pts.length - 1, i))]; return [r[0] / 1000, r[1] / 1000] }
    if (!tcp) { tcp = pt(0); target = 0 }
    const enabled = ctx.tagDriven(P.enableTag) ? ctx.readTag(P.enableTag) : true

    // start a move on the Execute edge
    if (ctx.rising(P.executeTag)) {
      const row = Math.round(ctx.readNumber(P.commandTag))
      if (row >= 0 && row < pts.length) {
        move = plan(tcp, pt(row), P.travel / 1000, P.timeScale); clock = 0; target = row
      }
    }
    if (move && enabled) {
      clock += ctx.dt
      const t = Math.min(clock, move.T)
      tcp = [axisAt(move.x0, move.xs, t), axisAt(move.z0, move.zs, t)]
      if (clock >= move.T) { tcp = pt(target); move = null }
    }
    const idle = !move

    // vacuum: latched on arrival only
    if (idle) vac = ctx.readTag(P.vacuumTag)
    ctx.grips.gripper = vac
    const holding = ctx.measured.grips.gripper
    ctx.lamps.vacuum = vac

    // pose every body from the TCP (pivot rotations about the plane normal, local +Z)
    const th = [elbowFor(tcp, -1), elbowFor(tcp, 1)]
    if (th[0] && th[1]) {
      const A = REF.A, El = th, J = [[tcp[0] - E, tcp[1] + TOOL + HJ], [tcp[0] + E, tcp[1] + TOOL + HJ]]
      const F = [tcp[0], tcp[1] + TOOL]
      const pose = (link, pivRef, pivNew, d) => {
        const c = Math.cos(d), s = Math.sin(d)
        const px = pivNew[0] - (c * pivRef[0] - s * pivRef[1]), py = pivNew[1] - (s * pivRef[0] + c * pivRef[1])
        ctx.setSubPose(link, { position: [px, py, 0], quat: [0, 0, Math.sin(d / 2), Math.cos(d / 2)] })
      }
      for (let i = 0; i < 2; i++) {
        const side = i ? 'R' : 'L'
        pose('upper' + side, REF.A[i], A[i], wrap(ang(A[i], El[i]) - ang(REF.A[i], REF.E[i])))
        pose('lower' + side, REF.E[i], El[i], wrap(ang(El[i], J[i]) - ang(REF.E[i], REF.J[i])))
      }
      const dF = [F[0] - REF.F[0], F[1] - REF.F[1]]
      ctx.setSubPose('plate', { position: [dF[0], dF[1], 0] })
      ctx.setSubPose('vacLed', { position: [0.07 + dF[0], REF.F[1] - 0.035 + dF[1], 0.0165] })
      ctx.setSubPose('gripper', { position: [tcp[0], tcp[1], 0] })
      ctx.setSubPose('tri', { position: [El[1][0] - REF.E[1][0], El[1][1] - REF.E[1][1], 0] })
      const Bp = [B + O1[0], ZM + O1[1]]
      pose('rod1', Bp, Bp, wrap(ang(A[1], El[1]) - ang(REF.A[1], REF.E[1])))
      const lowRef = [REF.E[1][0] + O2[0], REF.E[1][1] + O2[1]], lowNew = [El[1][0] + O2[0], El[1][1] + O2[1]]
      pose('rod2', lowRef, lowNew, wrap(ang(El[1], J[1]) - ang(REF.E[1], REF.J[1])))
    }

    // feedback
    ctx.writeTag(P.doneTag, idle)
    ctx.writeTag(P.busyTag, !idle)
    ctx.writeNumber(P.pointTag, idle ? target : 0)
    ctx.writeTag(P.vacOkTag, holding)
    ctx.writeNumber(P.xTag, Math.round(tcp[0] * 10000) / 10)
    ctx.writeNumber(P.zTag, Math.round(tcp[1] * 10000) / 10)
    ctx.display('state', !enabled ? 'HOLD' : idle ? `AT ${target}` : 'MOVING')
  },
})
