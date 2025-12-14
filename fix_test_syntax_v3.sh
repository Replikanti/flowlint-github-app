#!/bin/bash

# Revert my stupid sed: core'); -> core';
# This fixes static imports like: import { x } from '...core');
find tests -name "*.ts" -exec sed -i "s|@replikanti\/flowlint-core');|@replikanti/flowlint-core';|g" {} +

# But this breaks dynamic imports: await import('...core'); -> await import('...core';) which is also wrong.
# Dynamic imports need: import('...core') without semicolon inside parens.

# Strategy:
# 1. Revert everything to core' (no closing paren, no semicolon)
# find tests -name "*.ts" -exec sed -i "s|@replikanti\/flowlint-core');|@replikanti/flowlint-core'|g" {} +
# find tests -name "*.ts" -exec sed -i "s|@replikanti\/flowlint-core';|@replikanti/flowlint-core'|g" {} +

# 2. Add correct ending based on context
# Static imports start with "import ". They need ";".
# Dynamic imports start with "import(". They need ")".

# Let's try to fix static imports specifically.
# Search for lines starting with "import" and ending with "core')" or "core'" and append ";"
grep -lR "^import.*@replikanti/flowlint-core" tests | xargs -r sed -i "s|@replikanti\/flowlint-core');|@replikanti/flowlint-core';|g"

# Search for dynamic imports (await import) and ensure they have ")"
# These usually don't start with "import".
grep -lR "await import" tests | xargs -r sed -i "s|@replikanti\/flowlint-core';|@replikanti/flowlint-core')|g" 
# Wait, if I revert above, I might have broken dynamic imports again.

# Let's do it cleaner.
# Reset both to simple string.
find tests -name "*.ts" -exec sed -i "s|@replikanti\/flowlint-core');|@replikanti/flowlint-core|g" {} +
find tests -name "*.ts" -exec sed -i "s|@replikanti\/flowlint-core';|@replikanti/flowlint-core|g" {} +

# Now add correct suffixes
# Static:
find tests -name "*.ts" -exec sed -i "s|^import .*@replikanti/flowlint-core$|&';|g" {} +
# Dynamic:
find tests -name "*.ts" -exec sed -i "s|await import('@replikanti/flowlint-core$|&')|g" {} +

