from unittest.mock import MagicMock, patch

import httpx

from forge.agent.orchestrator import AgentOrchestrator
from forge.config.settings import load_config


def test_agent_orchestrator_initialization():
    config = load_config()
    orchestrator = AgentOrchestrator(config)

    assert isinstance(orchestrator.router.active_model_key, str)
    assert orchestrator.registry.get("read_file") is not None
    assert orchestrator.registry.get("run_command") is not None


def test_agent_task_execution_mocked():
    config = load_config()
    orchestrator = AgentOrchestrator(config)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"role": "assistant", "content": "print('hello')"}}]
    }

    with patch.object(orchestrator.backend_manager, "get_active_backend", return_value=None), \
        patch.object(httpx.Client, "post", return_value=mock_resp):
        result = orchestrator.run_task("Write a hello world function")
        assert "content" in result
        assert "print('hello')" in result["content"]


def test_agent_collaboration_workflow():
    config = load_config()
    orchestrator = AgentOrchestrator(config)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"role": "assistant", "content": "Implementation / review response"}}]
    }

    with patch.object(httpx.Client, "post", return_value=mock_resp):
        collab_res = orchestrator.run_review_collaboration("Refactor authentication handler")
        assert "primary_draft" in collab_res
        assert "review_feedback" in collab_res
        assert "final_implementation" in collab_res
