from forge.config.settings import load_config
from forge.agent.orchestrator import AgentOrchestrator

def test_agent_orchestrator_initialization():
    config = load_config()
    orchestrator = AgentOrchestrator(config)

    assert orchestrator.router.active_model_key == "glm"
    assert orchestrator.registry.get("read_file") is not None
    assert orchestrator.registry.get("run_command") is not None

def test_agent_task_execution_offline():
    config = load_config()
    orchestrator = AgentOrchestrator(config)

    result = orchestrator.run_task("Write a hello world function")
    assert result["model"] == "glm"
    assert "content" in result

def test_agent_collaboration_workflow():
    config = load_config()
    orchestrator = AgentOrchestrator(config)

    collab_res = orchestrator.run_review_collaboration("Refactor authentication handler")
    assert "primary_draft" in collab_res
    assert "kimi_review" in collab_res
    assert "final_implementation" in collab_res
