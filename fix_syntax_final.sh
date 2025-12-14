#!/bin/bash

# Fix static imports ending with ')
grep -lR "^import.*@replikanti/flowlint-core')" tests | xargs -r sed -i "s|@replikanti\/flowlint-core')|@replikanti/flowlint-core';|g"

# Verify no more errors
grep "@replikanti/flowlint-core')" tests/*.ts tests/helpers/*.ts
