import sys
from pathlib import Path
from forge.config.settings import load_config
from forge.agent.orchestrator import AgentOrchestrator

class ForgeShell:
    """Interactive REPL Shell for Forge AI Coding Harness."""

    def __init__(self, orchestrator: AgentOrchestrator):
        self.orchestrator = orchestrator

    def print_banner(self) -> None:
        active_model = self.orchestrator.router.active_model_key.upper()
        mode = "AUTO" if not self.orchestrator.config.safe_mode else "SAFE"
        cwd = Path.cwd().name
        print("\n" + "=" * 55)
        print(" Forge 🛠️ - AI Coding Harness & Interactive CLI")
        print(f" Active Model: {active_model} | Execution Mode: {mode}")
        print(f" Working Directory: {cwd}")
        print(" Type /help for available slash commands, or type /exit to quit.")
        print("=" * 55 + "\n")

    def print_help(self) -> None:
        print("\nAvailable Slash Commands:")
        print("  /model glm   - Switch active primary model to GLM 5.2")
        print("  /model kimi  - Switch active secondary model to Kimi K2.5")
        print("  /review      - Run GLM 5.2 + Kimi K2.5 collaboration review workflow")
        print("  /status      - Show git status & current active configuration")
        print("  /diff        - Show current git uncommitted diffs")
        print("  /tests       - Run pytest test suite")
        print("  /clear       - Clear screen")
        print("  /exit        - Exit Forge interactive shell\n")

    def run(self) -> None:
        self.print_banner()
        while True:
            try:
                model_name = self.orchestrator.router.active_model_key
                prompt = input(f"forge [{model_name}] > ").strip()
                if not prompt:
                    continue

                if prompt.startswith("/"):
                    if self._handle_slash_command(prompt):
                        break
                    continue

                # Execute coding prompt
                print("\n[Forge Agent Thinking...]\n")
                result = self.orchestrator.run_task(prompt)
                print(f"\nResponse [{result['model']}]:\n{result['content']}\n")

            except (KeyboardInterrupt, EOFError):
                print("\nExiting Forge. Goodbye!")
                break

    def _handle_slash_command(self, cmd: str) -> bool:
        """Returns True if shell should exit."""
        parts = cmd.split()
        op = parts[0].lower()

        if op == "/exit" or op == "/quit":
            print("Exiting Forge. Goodbye!")
            return True
        elif op == "/help":
            self.print_help()
        elif op == "/clear":
            print("\033[H\033[J", end="")
            self.print_banner()
        elif op == "/model":
            if len(parts) > 1:
                target = parts[1].lower()
                self.orchestrator.router.set_active_model(target)
                print(f"Active model set to: {self.orchestrator.router.active_model_key}")
            else:
                print(f"Current active model: {self.orchestrator.router.active_model_key}")
        elif op == "/review":
            task_prompt = input("Enter feature prompt for dual GLM + Kimi review workflow: ").strip()
            if task_prompt:
                print("\n[Executing GLM 5.2 + Kimi K2.5 Collaborative Review...]\n")
                res = self.orchestrator.run_review_collaboration(task_prompt)
                print("\n--- Primary GLM 5.2 Draft ---")
                print(res["primary_draft"])
                print("\n--- Kimi K2.5 Review Feedback ---")
                print(res["kimi_review"])
                print("\n--- Final Refined Implementation ---")
                print(res["final_implementation"] + "\n")
        elif op == "/status":
            stat = self.orchestrator.git.get_status_summary()
            branch = self.orchestrator.git.get_current_branch()
            print(f"\nGit Branch: {branch}")
            print(f"Git Status:\n{stat or 'Clean working tree'}\n")
        elif op == "/diff":
            tool = self.orchestrator.registry.get("git_diff")
            if tool:
                res = tool.execute()
                print(f"\nGit Diff:\n{res.get('diff') or 'No uncommitted changes.'}\n")
        elif op == "/tests":
            tool = self.orchestrator.registry.get("run_tests")
            if tool:
                print("\nRunning test suite...")
                res = tool.execute()
                print(res.get("stdout", "") or res.get("stderr", ""))
        else:
            print(f"Unknown slash command '{op}'. Type /help for list of available commands.")

        return False
