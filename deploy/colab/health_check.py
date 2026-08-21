import json
import sys
import time
import urllib.error
import urllib.request


def check_server_health(base_url: str = "http://localhost:8000/v1") -> bool:
    models_endpoint = f"{base_url.rstrip('/')}/models"
    chat_endpoint = f"{base_url.rstrip('/')}/chat/completions"

    print("\n" + "=" * 50)
    print("       Forge Server Health Verification")
    print("=" * 50)
    print(f"Testing Base Endpoint: {base_url}\n")

    # 1. Models endpoint check
    try:
        req = urllib.request.Request(models_endpoint)
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            latency = round((time.time() - t0) * 1000, 2)
            print(f"✅ Models Endpoint OK (Latency: {latency} ms)")
            print(f"Available Models: {[m.get('id') for m in data.get('data', [])]}")
    except Exception as e:
        print(f"❌ Models Endpoint Check Failed: {e}")
        return False

    # 2. Ping completion test
    test_payload = {
        "model": data.get("data", [{}])[0].get("id", "default"),
        "messages": [{"role": "user", "content": "Ping test"}],
        "max_tokens": 10
    }
    try:
        req = urllib.request.Request(
            chat_endpoint,
            data=json.dumps(test_payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=15) as resp:
            cdata = json.loads(resp.read().decode("utf-8"))
            latency = round((time.time() - t0) * 1000, 2)
            reply = cdata.get("choices", [{}])[0].get("message", {}).get("content", "")
            print(f"✅ Chat Completion Test OK (Latency: {latency} ms)")
            print(f"Sample Reply: '{reply.strip()}'")
            print("=" * 50 + "\n")
            return True
    except Exception as e:
        print(f"❌ Chat Completion Test Failed: {e}")
        print("=" * 50 + "\n")
        return False

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/v1"
    check_server_health(url)
