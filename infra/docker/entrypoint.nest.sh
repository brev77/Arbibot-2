#!/bin/sh
# Arbibot 2 — NestJS service entrypoint wrapper
# Resolves the ENTRY build-time argument to start the correct service.
#
# This script is copied into the Docker image and set as ENTRYPOINT.
# The CMD is set to the entry point JS file via build arg.

set -e

exec node "${ENTRY:-apps/risk-service/dist/main.js}"