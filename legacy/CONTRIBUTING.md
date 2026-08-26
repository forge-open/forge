# Contributing to Forge

Thank you for your interest in contributing to **Forge**, the open source AI coding harness and CLI!

## Code Guidelines
1. **Python standard**: Python 3.9+, strict type hints, simple clean modules.
2. **Safety first**: Never bypass safety confirmation without explicit `--auto` mode.
3. **No hardcoding**: Do not hardcode API tokens or strict endpoints in source code.
4. **Decoupled Architecture**: Keep provider, inference server, model router, context builder, and CLI separate.
5. **Model Vault**: Ensure model verification and local manifest checks before any remote model download.

## Running Tests
```bash
pip install -e .[dev]
pytest
```

## Pull Request Process
1. Fork the repo and create a feature branch (`git checkout -b feature/my-feature`).
2. Add tests for your changes.
3. Verify all tests pass cleanly.
4. Submit a Pull Request with details on proposed changes.
