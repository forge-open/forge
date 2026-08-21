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


def test_model_manager_operations():
    manager = get_model_manager()
    available = manager.list_available()
    installed = manager.list_installed()

    assert len(available) > 0
    assert len(installed) > 0

    install_res = manager.install_model("qwen3.8-27b-fp8")
    assert install_res["status"] == "success"

    remove_res = manager.remove_model("qwen3.8-27b-fp8")
    assert remove_res["status"] == "success"


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
    assert "Qwen" in decision.model_name
    assert len(decision.reasoning) > 0
