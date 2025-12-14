#!/bin/bash

# Convert packages/tracing... back to relative imports in apps/
# apps/api/src -> ../../../packages/tracing
find apps/api/src -name "*.ts" -exec sed -i 's|packages\/tracing|../../../packages/tracing|g' {} +

# apps/worker/src -> ../../../packages/tracing
find apps/worker/src -name "*.ts" -exec sed -i 's|packages\/tracing|../../../packages/tracing|g' {} +

# packages/tracing/github-tracer.ts -> ./exports (local)
# No need to change back to relative if it's within same dir, but I used ./exports which is fine.

# Fix imports in config-loader (ensure @replikanti/flowlint-core is found)
# It should be found if installed.
