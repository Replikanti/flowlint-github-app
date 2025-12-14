#!/bin/bash

# Fix syntax error in dynamic imports: import('@replikanti/flowlint-core'; -> import('@replikanti/flowlint-core');
find tests -name "*.ts" -exec sed -i "s|@replikanti\/flowlint-core';|@replikanti/flowlint-core');|g" {} +

# Fix also packages/github which I might have broken
# But tests import ../packages/github.
# The previous sed s/../packages/review/ -> core might have touched it? No.

# Fix ../packages/github -> ../../packages/github if needed (depends on file depth)
# In tests/*.spec.ts, it is ../packages/github. (Correct)
# In tests/helpers/*.ts, it is ../../packages/github. (Correct)

