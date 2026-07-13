#!/usr/bin/env bash
#
# emulator.sh — start / stop / wait for an AWS emulator used by the E2E suite.
#
# Usage:
#   scripts/emulator.sh start <localstack|floci|ministack|ministack-pip>
#   scripts/emulator.sh wait  <localstack|floci|ministack|ministack-pip>
#   scripts/emulator.sh stop  <localstack|floci|ministack|ministack-pip>
#
# All emulators listen on port 4566 (the E2E default E2E_ENDPOINT is
# http://localhost:4566). The docker variants (localstack/floci/ministack) run
# as containers; `ministack-pip` installs ministack from PyPI and runs it as a
# background process — used on macOS/Windows CI where Linux containers are not
# available.

set -euo pipefail

# Host port the emulator is published on (default 4566, matching E2E_ENDPOINT's
# default). Override with EMU_PORT to run alongside an emulator that already owns
# 4566 (e.g. a developer's own LocalStack). The container/process always listens
# on 4566 internally; only the host publish port changes.
PORT="${EMU_PORT:-4566}"
CONTAINER_PORT=4566
ENDPOINT="http://localhost:${PORT}"
PID_DIR="${TMPDIR:-/tmp}/nlsd-emulator"
mkdir -p "${PID_DIR}"

usage() {
  echo "usage: $0 <start|stop|wait> <localstack|floci|ministack|ministack-pip>" >&2
  exit 2
}

# --- docker variants ----------------------------------------------------------

image_for() {
  case "$1" in
    localstack) echo "localstack/localstack:3" ;;
    floci)      echo "floci/floci:latest" ;;
    ministack)  echo "ministackorg/ministack" ;;
    *) return 1 ;;
  esac
}

container_for() {
  echo "nlsd-emu-$1"
}

start_docker() {
  local name="$1" image container
  image="$(image_for "${name}")"
  container="$(container_for "${name}")"

  if docker ps -a --format '{{.Names}}' | grep -qx "${container}"; then
    docker start "${container}" >/dev/null
  else
    docker run -d --name "${container}" -p "${PORT}:${CONTAINER_PORT}" "${image}" >/dev/null
  fi
  echo "[emulator] ${name} started (container ${container}) on ${ENDPOINT}"
}

stop_docker() {
  local name="$1" container
  container="$(container_for "${name}")"
  if docker ps -a --format '{{.Names}}' | grep -qx "${container}"; then
    docker rm -f "${container}" >/dev/null 2>&1 || true
    echo "[emulator] ${name} stopped and removed (${container})"
  else
    echo "[emulator] ${name} not running"
  fi
}

# --- pip variant (ministack-pip) ---------------------------------------------

pip_pidfile() { echo "${PID_DIR}/ministack-pip.pid"; }
pip_logfile() { echo "${PID_DIR}/ministack-pip.log"; }
pip_venvdir() { echo "${PID_DIR}/ministack-venv"; }

# Resolve the python interpreter inside a venv, handling both the POSIX
# (`bin/python`) and Windows (`Scripts/python.exe`) layouts.
venv_python() {
  local venv="$1"
  if [[ -x "${venv}/bin/python" ]]; then
    echo "${venv}/bin/python"
  else
    echo "${venv}/Scripts/python.exe"
  fi
}

start_pip() {
  local pidfile logfile venv PY VPY
  pidfile="$(pip_pidfile)"
  logfile="$(pip_logfile)"
  venv="$(pip_venvdir)"

  if [[ -f "${pidfile}" ]] && kill -0 "$(cat "${pidfile}")" 2>/dev/null; then
    echo "[emulator] ministack-pip already running (pid $(cat "${pidfile}"))"
    return 0
  fi

  # Portable python: windows-latest Git Bash ships `python` but often not
  # `python3`; prefer python3 where it exists, fall back to python.
  PY="$(command -v python3 || command -v python)"
  if [[ -z "${PY}" ]]; then
    echo "[emulator] no python3/python on PATH" >&2
    return 1
  fi

  # Install into a dedicated virtualenv. macOS (Homebrew) and other modern
  # distros mark the system interpreter as PEP 668 "externally-managed", so a
  # plain `pip install` aborts; a venv sidesteps that and keeps CI hermetic on
  # every OS. Creating a venv over an existing one is idempotent.
  "${PY}" -m venv "${venv}"
  VPY="$(venv_python "${venv}")"

  # Install ministack from PyPI (idempotent).
  "${VPY}" -m pip install --quiet --disable-pip-version-check ministack

  # ministack listens on 4566 by default.
  nohup "${VPY}" -m ministack >"${logfile}" 2>&1 &
  echo $! >"${pidfile}"
  echo "[emulator] ministack-pip started (pid $(cat "${pidfile}")) on ${ENDPOINT}"
}

stop_pip() {
  local pidfile
  pidfile="$(pip_pidfile)"
  if [[ -f "${pidfile}" ]]; then
    kill "$(cat "${pidfile}")" 2>/dev/null || true
    rm -f "${pidfile}"
    echo "[emulator] ministack-pip stopped"
  else
    echo "[emulator] ministack-pip not running"
  fi
}

# --- readiness ----------------------------------------------------------------

# DynamoDB ListTables over the emulator's endpoint. Works for every emulator
# because they all speak the DynamoDB wire protocol on :4566.
list_tables_ok() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "${ENDPOINT}/" \
    -H 'Content-Type: application/x-amz-json-1.0' \
    -H 'X-Amz-Target: DynamoDB_20120810.ListTables' \
    -H 'Authorization: AWS4-HMAC-SHA256 Credential=dummy/x/x/dynamodb/aws4_request' \
    -d '{}' 2>/dev/null || echo 000)"
  # 200 = ready; 4xx also means an HTTP server is answering the DynamoDB port.
  [[ "${code}" == "200" || "${code}" =~ ^4 ]]
}

localstack_health_ok() {
  curl -s "${ENDPOINT}/_localstack/health" 2>/dev/null | grep -q '"dynamodb"'
}

wait_ready() {
  local name="$1" tries=0 max=60
  echo "[emulator] waiting for ${name} on ${ENDPOINT} ..."
  while (( tries < max )); do
    if [[ "${name}" == "localstack" ]]; then
      if localstack_health_ok; then echo "[emulator] ${name} ready"; return 0; fi
    fi
    if list_tables_ok; then echo "[emulator] ${name} ready"; return 0; fi
    tries=$((tries + 1))
    sleep 2
  done
  echo "[emulator] TIMEOUT waiting for ${name}" >&2
  return 1
}

# --- dispatch -----------------------------------------------------------------

[[ $# -eq 2 ]] || usage
action="$1"
name="$2"

case "${name}" in
  localstack|floci|ministack) is_docker=1 ;;
  ministack-pip) is_docker=0 ;;
  *) usage ;;
esac

case "${action}" in
  start)
    if [[ "${is_docker}" -eq 1 ]]; then start_docker "${name}"; else start_pip; fi
    ;;
  stop)
    if [[ "${is_docker}" -eq 1 ]]; then stop_docker "${name}"; else stop_pip; fi
    ;;
  wait)
    wait_ready "${name}"
    ;;
  *)
    usage
    ;;
esac
