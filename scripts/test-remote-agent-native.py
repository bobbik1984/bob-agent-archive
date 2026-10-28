"""Offline native boundary tests, with caches and generated harness outside sync folders.

Tauri IPC attributes and the platform AppHandle dispatcher are omitted in the small
harness; the actual command bodies, adapters, vault, DPAPI and existing DSH tests run.
Use --core-fixture <compiled client-contract-fixture.js> for real Core HTTP interop.
"""
from pathlib import Path
import argparse
import os
import queue
import subprocess
import tempfile
import threading
import json
from urllib.parse import urlsplit

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core-fixture',type=Path)
    parser.add_argument('--core-url',help='Existing loopback-only Core fixture, when OS test identity differs from fixture owner')
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    temp=Path(tempfile.gettempdir())
    stage=temp/'bob-core-native-tests'
    (stage/'src/remote_agent').mkdir(parents=True,exist_ok=True)
    for path in (root/'src-tauri/src/remote_agent').glob('*.rs'):
        source=path.read_text(encoding='utf-8')
        if path.name=='mod.rs':
            source=source.replace('#[tauri::command]','')
            start=source.index('pub async fn remote_agent_unlock(')
            end=source.index('pub async fn remote_agent_lock()',start)
            source=source[:start]+source[end:]
        if path.name=='system_protection.rs':
            start=source.index('pub fn unlock(')
            end=source.index('#[cfg(windows)]\nfn dpapi',start)
            source=source[:start]+source[end:]
        (stage/'src/remote_agent'/path.name).write_text(source,encoding='utf-8')
    (stage/'src/lib.rs').write_text('#![allow(dead_code)]\nmod remote_agent;\n',encoding='utf-8')
    (stage/'Cargo.toml').write_text('''[package]
name="bob-core-native-tests"
version="0.1.0"
edition="2021"
[dependencies]
serde_json="1.0"
serde={version="1.0",features=["derive"]}
tokio={version="1",features=["full"]}
futures-util="0.3"
once_cell="1"
reqwest={version="0.12",default-features=false,features=["rustls-tls-webpki-roots","stream","json"]}
axum={version="0.8",features=["ws"]}
rand="0.8"
base64="0.22"
sha2="0.10"
uuid={version="1",features=["v4"]}
urlencoding="2"
aes-gcm="0.10"
argon2="0.5"
rusqlite={version="0.39",features=["bundled"]}
tokio-tungstenite={version="0.29",features=["rustls-tls-webpki-roots"]}
[target.'cfg(windows)'.dependencies]
windows-sys={version="0.52",features=["Win32_Security_Cryptography","Win32_Foundation"]}
''',encoding='utf-8')
    # Use existing resolved dependencies, including locked/yanked versions; never install.
    (stage/'Cargo.lock').write_text((root/'src-tauri/Cargo.lock').read_text(encoding='utf-8'),encoding='utf-8')
    env=os.environ.copy()
    env['CARGO_BUILD_BUILD_DIR']=str(temp/'bob-remote-agent-build')
    env['CARGO_TARGET_DIR']=str(temp/'bob-remote-agent-target')
    if args.core_url:
        url=urlsplit(args.core_url)
        if url.scheme!='http' or url.hostname!='127.0.0.1' or url.username or url.password or url.query or url.fragment or url.path not in ('','/'):
            parser.error('--core-url must be a loopback fixture root')
        env['BOB_CORE_TEST_URL']=args.core_url.rstrip('/')
    child=None
    try:
        if args.core_fixture:
            fixture=args.core_fixture.resolve(strict=True)
            child=subprocess.Popen(['node',str(fixture)],env={**env,'NODE_ENV':'test'},stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            ready=queue.Queue()
            threading.Thread(target=lambda:ready.put(child.stdout.readline()),daemon=True).start()
            data=json.loads(ready.get(timeout=20))
            if data.get('status')!='LOCAL_FIXTURE_READY' or not data.get('origin','').startswith('http://127.0.0.1:'):
                raise RuntimeError('Invalid loopback fixture receipt')
            env['BOB_CORE_TEST_URL']=data['origin']
        command=['cargo','test','--manifest-path',str(stage/'Cargo.toml'),'--offline','--','--test-threads=1']
        if args.core_fixture or args.core_url:command.append('--include-ignored')
        return subprocess.call(command,env=env,cwd=root)
    finally:
        if child:
            child.terminate()
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)

if __name__=='__main__':
    raise SystemExit(main())
