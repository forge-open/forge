from forge.config.settings import load_config
from forge.router.model_router import ModelRouter

def test_model_router_switching():
    cfg = load_config()
    router = ModelRouter(cfg)

    assert router.active_model_key == "glm"
    router.set_active_model("kimi")
    assert router.active_model_key == "kimi"

    provider_kimi = router.get_provider()
    assert provider_kimi.config.name == "Kimi-K2.5"

    router.set_active_model("glm")
    provider_glm = router.get_provider()
    assert provider_glm.config.name == "GLM-5.2"
