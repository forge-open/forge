from forge.cli.shell import generate_banner_art, strip_internal_reasoning


def test_cli_filters_model_internal_protocol_text():
    rendered = strip_internal_reasoning(
        "<analysis>private reasoning</analysis>\n"
        "<think>more private reasoning</think>\n"
        "Here is the user-facing answer."
    )
    assert rendered == "Here is the user-facing answer."


def test_cli_banner_is_ascii_safe():
    banner = generate_banner_art("Gemma3 4B | Ollama | Local")
    assert "FORGE" in banner
    assert "â" not in banner
    assert "Â" not in banner
