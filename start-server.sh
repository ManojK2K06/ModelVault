#!/bin/bash
cd /home/z/my-project
while true; do
  > dev.log
  bun run dev >> dev.log 2>&1
  echo "Server crashed, restarting in 2s..." >> dev.log
  sleep 2
done