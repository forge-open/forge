from forge.config.settings import ForgeConfig
from forge.models.manager import get_model_manager
from forge.models.registry import ModelRegistry, ModelSpec
from forge.router.model_router import ModelRouter, RoutingDecision, TaskCategory, classify_task


def test_model_registry_operations():
    registry = ModelRegistry()
    spec = ModelSpec(
        name="Custom Qwen Model",
        model_id="custom-qwen-test",
        capabilities=["code_generation"],
        coding_capability=9,
        reasoning_capability=9,
        context_size=16384,
        availability="remote"
    )
    registry.register(spec)

    assert registry.get("custom-qwen-test") == spec
    assert registry.get("Custom Qwen Model") == spec
    assert "custom-qwen-test" in registry.get_supported_model_ids()
    assert len(registry.list_models()) >= 3


def test_curated_profiles_include_routing_metadata():
    registry = ModelRegistry()

    gemma = registry.get("gemma3:4b-it-qat")
    slm = registry.get("qwen2.5-coder-1.5b-instruct")
    coder = registry.get("qwen3-coder-30b-a3b-instruct")
    remote = registry.get("qwen3-coder-next")

    assert gemma and gemma.parameter_billions == 4
    assert slm and not slm.supports_tools and "ollama" in slm.engines
    assert coder and coder.supports_tools and coder.context_size >= 128000
    assert remote and remote.availability == "remote" and remote.parameter_billions > coder.parameter_billions


def test_model_manager_operations():
    manager = get_model_manager()
    available = manager.list_available()
    installed = manager.list_installed()

    assert len(available) > 0
    assert len(installed) > 0

    install_res = manager.install_model("qwen3.8-27b-fp8")
    assert install_res["status"] == "not_implemented"
    assert install_res["changed"] is False

    remove_res = manager.remove_model("qwen3.8-27b-fp8")
    assert remove_res["status"] == "not_implemented"
    assert remove_res["changed"] is False


def test_task_classification():
    assert classify_task("What is recursion?", 0) == TaskCategory.CODE_EXPLANATION
    assert classify_task("Write a short function to add two numbers", 0) == TaskCategory.SMALL_CODING_TASK
    assert classify_task("Fix TypeError in user login flow", 0) == TaskCategory.DEBUGGING
    assert classify_task("Refactor authentication module to clean up imports", 0) == TaskCategory.REFACTORING
    assert classify_task("Build a complete full-stack web application", 0) == TaskCategory.LARGE_CODING_TASK
    assert classify_task("Analyze entire codebase architecture", 6) == TaskCategory.REPOSITORY_LEVEL_TASK


def test_model_router_transparent_decisions():
    config = ForgeConfig()
    router = ModelRouter(config)

    decision = router.route_task("Fix bug causing crash in terminal tools")
    assert isinstance(decision, RoutingDecision)
    assert decision.category == TaskCategory.DEBUGGING.value
    assert len(decision.model_name) > 0
    assert len(decision.reasoning) > 0


def test_router_selects_smallest_compatible_model_and_prefers_warm_state():
    router = ModelRouter(ForgeConfig())

    fast = router.route_task("What is a Python list?", latency_budget_ms=1200)
    assert fast.selected_model_id == "qwen2.5-coder-1.5b-instruct"

    warm = router.route_task(
        "Explain this code",
        warm_models={"gemma3:4b-it-qat": True},
        latency_budget_ms=1200,
    )
    assert warm.selected_model_id == "gemma3:4b-it-qat"


def test_router_escalates_for_tools_and_long_context():
    router = ModelRouter(ForgeConfig())

    decision = router.route_task(
        "Debug the repository and fix the failing tests",
        context_files_count=20,
        requires_tools=True,
        required_context_size=100000,
    )

    assert decision.supports_tools is True
    assert decision.context_size >= 100000
    assert decision.selected_model_id == "qwen3-coder-30b-a3b-instruct"


def test_router_honors_explicit_model_override():
    router = ModelRouter(ForgeConfig())

    decision = router.route_task(
        "What is the current model?",
        model_override="gemma3:4b-it-qat",
        requires_tools=True,
    )

    assert decision.selected_model_id == "gemma3:4b-it-qat"
    assert "Explicit model override" in decision.reasoning
