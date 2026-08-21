import modal

app = modal.App("forge-qwen-fp8-inspect")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("huggingface_hub")
)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("huggingface-secret")],
    timeout=120,
)
def inspect_model():
    from huggingface_hub import HfApi

    api = HfApi()

    repo = "Qwen/Qwen3.8-27B-FP8"

    files = list(
        api.list_repo_tree(
            repo,
            recursive=True,
            expand=True,
        )
    )

    print("=" * 70)
    print("FORGE — QWEN3.8 27B FP8 CHECKPOINT INSPECTION")
    print("=" * 70)

    total_bytes = 0
    file_count = 0

    for item in files:
        size = getattr(item, "size", None)

        if size is not None:
            file_count += 1
            total_bytes += size

            print(
                f"{size / (1024**3):10.2f} GB  "
                f"{item.path}"
            )

    print("-" * 70)

    print(f"Repository            : {repo}")
    print(f"Files with known size : {file_count}")
    print(
        f"Total repository size : "
        f"{total_bytes / (1024**3):.2f} GB"
    )
    print(
        f"Total repository size : "
        f"{total_bytes / (1024**4):.3f} TB"
    )

    print("=" * 70)

    return {
        "repository": repo,
        "files": file_count,
        "total_gb": round(total_bytes / (1024**3), 2),
        "total_tb": round(total_bytes / (1024**4), 3),
    }


@app.local_entrypoint()
def main():
    result = inspect_model.remote()
    print("\nResult:", result)