#!/usr/bin/env python3
import urllib.request, json, base64, os, sys, time

token = os.environ.get('GH_TOKEN')
repo  = os.environ.get('GITHUB_REPOSITORY', 'CHRISEVO24/blw-tracker')

if not token:
    print("No GH_TOKEN - skipping")
    sys.exit(0)

with open('history.json', 'rb') as f:
    history = json.loads(f.read())

all_keys = sorted(history.keys())
print(f"Disk: {len(all_keys)} snapshots, latest={all_keys[-1] if all_keys else 'none'}")

# Keep last 20 snapshots
keep = all_keys[-20:]
slim = {k: history[k] for k in keep}
slim_raw = json.dumps(slim).encode()
slim_b64 = base64.b64encode(slim_raw).decode()

print(f"Pushing {len(slim)} snapshots, {len(slim_raw)/1024/1024:.1f}MB")

for attempt in range(5):
    try:
        req = urllib.request.Request(
            f'https://api.github.com/repos/{repo}/contents/history.json',
            headers={'Authorization': f'token {token}', 'Accept': 'application/vnd.github.v3+json'}
        )
        with urllib.request.urlopen(req) as r:
            file_sha = json.loads(r.read()).get('sha', '')
        print(f"Attempt {attempt+1}: SHA={file_sha[:8]}")

        body = json.dumps({
            'message': 'Auto update history.json [skip ci]',
            'content': slim_b64,
            'sha': file_sha
        }).encode()

        req2 = urllib.request.Request(
            f'https://api.github.com/repos/{repo}/contents/history.json',
            data=body, method='PUT',
            headers={
                'Authorization': f'token {token}',
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            }
        )
        with urllib.request.urlopen(req2) as r:
            result = json.loads(r.read())

        if 'content' in result:
            new_sha = result['content']['sha'][:8]
            print(f"SUCCESS: {file_sha[:8]} -> {new_sha}")
            sys.exit(0)
        else:
            print(f"Attempt {attempt+1}: {result.get('message')}")
            time.sleep(5)
    except Exception as e:
        print(f"Attempt {attempt+1} error: {e}")
        time.sleep(5)

print("All attempts done")
sys.exit(0)
