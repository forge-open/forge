import modal

app = modal.App("forge-hf-check")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("huggingface_hub")
)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("huggingface-secret")],
    timeout=120,
)
def check_hf():
    import os
    from huggingface_hub import HfApi

    token = os.environ.get("HF_TOKEN")

    if not token:
        raise RuntimeError("HF_TOKEN was not injected")

    api = HfApi(token=token)

    repo = "nvidia/GLM-5.2-NVFP4"

    info = api.model_info(repo)

    print("=" * 60)
    print("FORGE — HUGGING FACE ACCESS TEST")
    print("=" * 60)

    print(f"Repository : {info.id}")
    print(f"Author     : {info.author}")
    print(f"Private    : {info.private}")
    print(f"Downloads  : {info.downloads}")
    print(f"Likes      : {info.likes}")

    print("\n✓ Hugging Face authentication works")
    print("✓ GLM 5.2 NVFP4 repository is accessible")
    print("=" * 60)

    return {
        "repository": info.id,
        "accessible": True,
    }


@app.local_entrypoint()
def main():
    result = check_hf.remote()
    print("\nResult:", result)