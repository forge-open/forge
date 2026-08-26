import argparse
import sys
from forge.config.settings import load_config
from forge.agent.orchestrator import AgentOrchestrator
from forge.cli.shell import ForgeShell

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Forge: Open source AI coding harness and CLI for open weight models."
    )
    parser.add_argument(
        "--model",
        type=str,
        choices=["glm", "kimi"],
        help="Specify active model: 'glm' (GLM 5.2 Primary) or 'kimi' (Kimi K2.5 Secondary)"
    )
    parser.add_argument(
        "--review",
        action="store_true",
        help="Run collaborative code review workflow between GLM 5.2 and Kimi K2.5"
    )
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Enable autonomous mode (bypasses safe mode tool confirmation prompts)"
    )
    parser.add_argument(
        "prompt",
        nargs="*",
        help="Optional prompt task to execute directly without starting interactive shell"
    )

    args = parser.parse_args()

    config = load_config()
    if args.auto:
        config.safe_mode = False
    if args.model:
        config.primary_model = args.model

    orchestrator = AgentOrchestrator(config)
    if args.model:
        orchestrator.router.set_active_model(args.model)

    if args.review:
        prompt_text = " ".join(args.prompt) if args.prompt else "Review current project diffs and check for bugs."
        print(f"\n[Executing Collaborative Code Review Workflow...]\n")
        res = orchestrator.run_review_collaboration(prompt_text)
        print("\n=== GLM 5.2 Draft ===")
        print(res["primary_draft"])
        print("\n=== Kimi K2.5 Review ===")
        print(res["kimi_review"])
        print("\n=== Final Implementation ===")
        print(res["final_implementation"] + "\n")
        sys.exit(0)

    if args.prompt:
        prompt_text = " ".join(args.prompt)
        print(f"\n[Running task with active model '{orchestrator.router.active_model_key}']...\n")
        res = orchestrator.run_task(prompt_text)
        print(res["content"])
        sys.exit(0)

    # Launch REPL shell
    shell = ForgeShell(orchestrator)
    shell.run()

if __name__ == "__main__":
    main()
