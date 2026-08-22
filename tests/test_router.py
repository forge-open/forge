from forge.config.settings import load_config
from forge.router.model_router import ModelRouter


def test_model_router_switching():
    cfg = load_config()
    router = ModelRouter(cfg)

    assert isinstance(router.active_model_key, str)
    router.set_active_model("qwen2.5-coder-7b-instruct")
    assert router.active_model_key == "qwen2.5-coder-7b-instruct"

    provider_coder = router.get_provider()
    assert provider_coder.config.name == "qwen2.5-coder-7b-instruct"

    router.set_active_model("qwen3.8-27b-fp8")
    provider_qwen = router.get_provider()
    assert provider_qwen.config.name == "qwen3.8-27b-fp8"
