#!/bin/bash

# Fix syntax error in dynamic imports: import('@replikanti/flowlint-core';) -> import('@replikanti/flowlint-core')
# We look for files containing ";)" which is the likely artifact of my bad sed
find tests -name "*.ts" -exec sed -i "s|@replikanti\/flowlint-core';)|@replikanti/flowlint-core')|g" {} +

# Fix paths to apps.
# tests/*.spec.ts needs "../apps/" not "../../apps/"
# But wait, my previous sed replaced "../apps/" with "../../apps/".
# So I need to revert "../../apps/" to "../apps/".
find tests -name "*.ts" -exec sed -i "s|\.\.\/\.\.\/apps\/|../apps/|g" {} +

# Also check test-utils which is in tests/helpers/
# tests/helpers/test-utils.ts needs "../../apps/" (because it is one level deeper).
# If I changed it to "../apps/", it's wrong.
# Let's check where test-utils is.
# flowlint-github-app/tests/helpers/test-utils.ts
# apps is at flowlint-github-app/apps
# So relative path is ../../apps
# My previous sed: s|\.\.\/apps\/|../../apps/|g
# Original in monorepo (flowlint-app/tests/helpers/test-utils.ts) was likely ../../../apps (if apps were one level up from tests? no, tests and apps were siblings in root).
# Wait, flowlint-app/tests -> flowlint-app/apps. So ../apps.
# If test-utils is in tests/helpers, then ../../apps.

# Let's be surgical.
# tests/*.spec.ts -> import from "../apps/..."
# tests/helpers/*.ts -> import from "../../apps/..."

# Fix spec files in tests root
sed -i "s|\.\.\/\.\.\/apps\/|../apps/|g" tests/*.spec.ts

# Helper files should be correct with ../../apps if they were ../../apps before.
# But wait, if they were ../../apps before, and I replaced ../apps with ../../apps, did I break it?
# ../../apps contains ../apps.
# sed s/../apps/../../apps/ on "../../apps" -> "../../../apps".

# Let's verify content of test-utils.ts
