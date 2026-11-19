#!/bin/zsh
# Lay out the cell with OIP's own add-part (every param checked). OIP world: metres, +Y up, floor y = 0, belt top
# y = 0.85; the robot plane is x-y at z = 0; products flow toward -Z (rotationY 90 deg turns a belt's +X to -Z).
set -e
P=${0:A:h}/..
OIP=${OIP:-$HOME/code/_vendor/open-industry-project}
# start from an empty project: drop the scene and the built-in copies, keep our own part
rm -f $P/scene.json $P/project.json; rm -rf $P/parts/oip.*
cd $OIP
add() { npm run -s add-part -- $P "$@" | grep -E "^\+|error|✗" || true; }
add $P/parts/duopod.transfer-robot --id robot --at 0,0.85,0 --rot 0
BELT="fpmUnits=false,standHeight=0.85,friction=0.4,beltColor=#3a5a46"
# infeed A1 (accumulation, 0.4 m/s), pick conveyor A2 (0.6 m/s: the faster belt opens the gap the blade rises into),
# outfeed B (0.4 m/s)
add oip.belt-conveyor --id beltA1 --at 0.2,0.85,1.75 --rot 90 --params "$BELT,segments=[[1.45,0]],width=0.22,speed=0.4,runTag=BeltA1Run"
add oip.belt-conveyor --id beltA2 --at 0.2,0.85,0.30 --rot 90 --params "$BELT,segments=[[0.70,0]],width=0.22,speed=0.6,runTag=BeltA2Run"
add oip.belt-conveyor --id beltB  --at -0.2,0.85,0.55 --rot 90 --params "$BELT,segments=[[2.30,0]],width=0.30,speed=0.4,runTag=BeltBRun"
# escapement blade at the A1/A2 junction (PLC), fixed end stop at the pick point (carton centred on the robot plane)
add oip.blade-stop --id bladeQ --at 0.2,0.85,0.30 --rot 90 --params "width=0.22,raiseHeight=0.06,tag=BladeUp"
add oip.blade-stop --id endStop --at 0.2,0.85,-0.135 --rot 90 --params "width=0.22,raiseHeight=0.06,active=true"
# cartons 250 (along the flow) x 180 x 120 mm, 3 kg; the PLC gates the feed so the queue never backs up to the spawner
add oip.box-spawner --id feed --at 0.2,1.40,1.55 --rot 90 --params "boxesPerMinute=40,length=0.25,width=0.18,height=0.12,mass=3,boxColor=#c49a6c,runTag=FeedRun,conveyorId=beltA1,keepSpacing=true"
add oip.despawner --id sink --at -0.2,0.85,-1.62 --rot 90 --params "length=0.30,width=0.40,height=0.40,countTag=Delivered,showReadout=true"
# photo-eyes across the belts. eyeHead sits 20 mm upstream of the blade: the queue head; it clears only in the gap
# A2 opens (faster belt), which is where the PLC stops A1 and raises the blade.
# the belts (beam along the sensor's +Z, here world +X), lens 70 mm above the belt
EYE="maxRange=0.30"
add oip.diffuse-sensor --id eyeStop --at 0.06,0.82,-0.085 --rot 90 --params "$EYE,tag=EyeStop"
add oip.diffuse-sensor --id eyeZone --at 0.06,0.82,0.10 --rot 90 --params "$EYE,tag=EyeZone"
add oip.diffuse-sensor --id eyeGate --at 0.06,0.82,0.255 --rot 90 --params "$EYE,tag=EyeGate"
add oip.diffuse-sensor --id eyeHead --at 0.06,0.82,0.32 --rot 90 --params "$EYE,tag=EyeHead"
add oip.diffuse-sensor --id eyeFull --at 0.06,0.82,1.15 --rot 90 --params "$EYE,tag=EyeFull"
add oip.diffuse-sensor --id eyeB0 --at -0.38,0.82,0.0 --rot 90 --params "maxRange=0.34,tag=EyeB0"
add oip.diffuse-sensor --id eyeB1 --at -0.38,0.82,-0.155 --rot 90 --params "maxRange=0.34,tag=EyeB1"
# operator devices on the -X side
add oip.push-button --id estop --at -0.95,1.10,0.40 --rot -90 --params "emergencyStop=true,tag=EStopOk,text=E-STOP"
add oip.push-button --id start --at -0.95,1.10,0.25 --rot -90 --params "tag=StartPB,text=START,buttonColor=#1e8f3a"
add oip.stack-light --id stack --at 0.80,2.33,0.72 --params "tag=StackLight"
# add-part writes a manifest without the program: bind plc/ and tests/
python3 - $P/project.json <<'PY'
import json, sys, glob, os
f = sys.argv[1]; p = json.load(open(f)); d = os.path.dirname(f)
q = {k: p[k] for k in ("version", "name", "scene")}
q["program"] = ["plc/program.st"]
t = sorted(os.path.relpath(x, d) for x in glob.glob(os.path.join(d, "tests", "*.test.json")))
if t: q["tests"] = t
q["packages"] = p["packages"]
open(f, "w").write(json.dumps(q, indent=2) + "\n")
PY
