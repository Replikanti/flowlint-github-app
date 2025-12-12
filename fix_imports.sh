#!/bin/bash
find apps -name "*.ts" -exec sed -i 's|\.\.\/\.\.\/\.\.\/packages\/|packages\/|g' {} +
