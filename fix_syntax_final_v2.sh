#!/bin/bash

# Fix dynamic imports inside Promise.all array: remove semicolon inside parens
grep -lR "import('@replikanti/flowlint-core';" tests | xargs -r sed -i "s|import('@replikanti\/flowlint-core';|import('@replikanti/flowlint-core')|g"

# Fix await import in e2e-integration: await import('...core'; -> await import('...core')
grep -lR "await import('@replikanti/flowlint-core';" tests | xargs -r sed -i "s|await import('@replikanti\/flowlint-core';|await import('@replikanti/flowlint-core')|g"
