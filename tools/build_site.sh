#!/bin/zsh
# Build the GitHub Pages site: OIP's editor (pinned checkout, MIT) with the DuoPod cell opening on load.
#   tools/build_site.sh [outDir]        default _build/site; publish it as the gh-pages branch
# OIP fetches its shipped files at root paths; site/base-shim.js prefixes them with the Pages subpath.
set -e
P=${0:A:h}/..
OIP=${OIP:-$HOME/code/_vendor/open-industry-project}
OUT=${1:-$P/_build/site}
BASE=/duopod-cell-oip/
node $P/tools/scene_file.mjs $P/dist/duopod-cell.scene.json
(cd $OIP && npx vite build --base $BASE --outDir $OUT --emptyOutDir --logLevel error)
# the marketing site, its videos and the Netlify files are not needed
rm -rf $OUT/{landing,guides,plc,privacy,sim-loop*,og-image.jpg,_headers,_redirects}
cp $P/site/index.html $OUT/index.html
cp $P/site/base-shim.js $P/site/autoload.js $OUT/app/
perl -0pi -e "s#<head>#<head>\n<script src=\"${BASE}app/base-shim.js\"></script>\n<script src=\"${BASE}app/autoload.js\"></script>#" $OUT/app/index.html
grep -q autoload.js $OUT/app/index.html
cp $P/dist/duopod-cell.scene.json $OUT/
cp $OIP/LICENSE $OUT/LICENSE-OIP.txt
touch $OUT/.nojekyll
find $OUT -size +100M | grep . && { echo "✗ a file over 100 MB"; exit 1; }
du -sh $OUT
