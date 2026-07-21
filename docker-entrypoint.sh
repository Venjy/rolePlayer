#!/bin/sh
set -eu

# The same initializer also runs while building the image. Repeating it here is
# required for existing volumes and bind mounts that hide the image seed files.
node --disable-warning=ExperimentalWarning dist/server/initialize-deployment-databases.js

exec node --disable-warning=ExperimentalWarning dist/server/index.js
