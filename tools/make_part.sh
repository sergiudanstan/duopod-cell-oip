#!/bin/zsh
# Rebuild the DuoPod part: export our procedural model from duopod-cell-pro, weld + Draco, write the manifest.
# Needs the OIP checkout (for gltf-transform and check-part): OIP=~/code/_vendor/open-industry-project
set -e
here=${0:A:h}/..
OIP=${OIP:-$HOME/code/_vendor/open-industry-project}
node $here/tools/export_glb.mjs
(cd $OIP && npx gltf-transform weld $here/_build/duopod.glb $here/_build/duopod_weld.glb && npx gltf-transform draco $here/_build/duopod_weld.glb $here/_build/duopod_draco.glb)
node $here/tools/build_part.mjs
(cd $OIP && npm run -s check-part -- $here/parts/duopod.transfer-robot)
