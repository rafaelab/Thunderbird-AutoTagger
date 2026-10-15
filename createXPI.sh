#!/bin/bash

cd "$(dirname "$0")/src/"
zip -qr -FS ../xpi/autotagger.xpi . -x '*.DS_Store'
