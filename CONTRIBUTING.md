# Contributing to Forge

Thank you for your interest in contributing to Forge! We welcome contributions from developers of all skill levels.

---

## 🛠️ Local Development Setup

1. **Fork & Clone Repository**:
   ```bash
   git clone https://github.com/your-username/forge.git
   cd forge
   ```

2. **Create Virtual Environment**:
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

3. **Install Dependencies in Editable Mode**:
   ```bash
   pip install -e ".[dev]"
   ```

4. **Run Unit Tests**:
   ```bash
   pytest
   ```

---

## 🧪 Testing Guidelines

- Write unit tests for any new commands, UI handlers, or agent logic.
- Place test files in `tests/`.
- Ensure all tests run offline using mocks without requiring a live remote model backend.

---

## 🎨 Code Style & Linting

- Follow PEP 8 guidelines.
- Use `ruff` for code linting:
  ```bash
  ruff check forge/ tests/
  ```

---

## 📬 Submitting Pull Requests

1. Create a feature branch:
   ```bash
   git checkout -b feature/my-cool-feature
   ```
2. Commit your changes with clear, descriptive commit messages.
3. Push to your fork and submit a Pull Request against `main`.
4. Ensure all CI test checks pass.
