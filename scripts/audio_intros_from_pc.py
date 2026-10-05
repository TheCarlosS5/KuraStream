#!/usr/bin/env python3
"""
Detects anime openings by audio on THIS PC and stores the results on the home server, which is
too weak to decode audio itself.

  1. Server (light): dumps episodes/seasons state     -> php_backend/scripts/intro_state.php dump
  2. This PC (heavy): ffmpeg + Chromaprint on the local, synced copy of the library
                                                      -> php_backend/scripts/audio_intros_local.php
  3. Server (light): stores the changed timings        -> php_backend/scripts/intro_state.php apply

Usage:  python scripts/audio_intros_from_pc.py [--show "Yuru Camp"]
SSH: KURA_SSH_HOST (169.254.33.13), KURA_SSH_USER (carlos), KURA_SSH_PASS or an SSH key/agent,
KURA_APP_DIR (/home/carlos/KuraStream). Local library: KURA_LIBRARY (./library). Needs paramiko.
"""
import argparse
import os
import subprocess
import sys
import tempfile

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = os.environ.get('KURA_SSH_HOST', '169.254.33.13')
USER = os.environ.get('KURA_SSH_USER', 'carlos')
APP = os.environ.get('KURA_APP_DIR', '/home/carlos/KuraStream')
LIBRARY = os.environ.get('KURA_LIBRARY', os.path.join(ROOT, 'library'))


def remote(client, cmd):
    _, out, err = client.exec_command(cmd, timeout=600)
    data = out.read()
    code = out.channel.recv_exit_status()
    if code != 0:
        raise SystemExit(f'Error en el servidor ({code}): {err.read().decode("utf-8", "replace")}')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--show', help='solo esta serie (id)')
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=os.environ.get('KURA_SSH_PASS'), timeout=20)
    with tempfile.TemporaryDirectory() as tmp:
        state = os.path.join(tmp, 'state.json')
        updates = os.path.join(tmp, 'updates.json')
        print('1/3 Leyendo el estado del servidor...', flush=True)
        with open(state, 'wb') as f:
            f.write(remote(client, f'cd {APP} && php php_backend/scripts/intro_state.php dump'))

        print('2/3 Analizando el audio en esta PC...', flush=True)
        cmd = ['node', os.path.join(ROOT, 'scripts', 'run-php.mjs'), '-c', os.path.join(ROOT, 'php.ini'),
               os.path.join(ROOT, 'php_backend', 'scripts', 'audio_intros_local.php'),
               f'--state={state}', f'--out={updates}', f'--library={LIBRARY}']
        if args.show:
            cmd.append(f'--show={args.show}')
        subprocess.run(cmd, cwd=ROOT, check=True)

        print('3/3 Guardando los resultados en el servidor...', flush=True)
        remote_file = f'/tmp/kura_intro_updates_{os.getpid()}.json'
        sftp = client.open_sftp()
        sftp.put(updates, remote_file)
        sftp.close()
        print(remote(client, f'cd {APP} && php php_backend/scripts/intro_state.php apply {remote_file}; rm -f {remote_file}')
              .decode('utf-8', 'replace').strip())
    client.close()


if __name__ == '__main__':
    main()
