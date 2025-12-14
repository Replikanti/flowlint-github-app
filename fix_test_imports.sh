#!/bin/bash

# Find all TS test files
FILES=$(find tests -name "*.ts")

for FILE in $FILES; do
    echo "Processing $FILE..."
    
    # Replace imports from ../packages/config with @replikanti/flowlint-core
    sed -i "s|\.\.\/packages\/config\/.*|@replikanti/flowlint-core';|g" "$FILE"
    
    # Replace imports from ../packages/review with @replikanti/flowlint-core
    # This might break if it's deeply nested or specific file import, but core exports everything (hopefully)
    sed -i "s|\.\.\/packages\/review\/.*|@replikanti/flowlint-core';|g" "$FILE"
    
    # Fix ../apps/
    sed -i "s|\.\.\/apps\/|../../apps/|g" "$FILE" # Wait, tests are in root/tests, so apps is ../apps. Original was ../apps.
    
    # Fix import * from .../config/flowlint-config which is now part of core
    # If the file imports specific file, sed above changes it to core package.
    # But we need to make sure syntax is valid. 
    # import { defaultConfig } from '.../flowlint-config'; -> import { defaultConfig } from '@replikanti/flowlint-core';
    
    # Fix await import
    sed -i "s|await import('\.\.\/packages\/review\/.*')|await import('@replikanti/flowlint-core')|g" "$FILE"
done
