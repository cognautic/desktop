# Changelog

## 0.0.3 - 2026-03-03
- Added support for a custom OpenAI-compatible provider with configurable API key and base URL.
- Added terminal stop controls for AI-run commands (inline `Stop PID` in tool cards and terminal `Ctrl+C` stop button).
- Improved command execution reliability by running AI shell commands through login-shell semantics.
- Improved tool output rendering for `execute_command` to show terminal-style `stdout` / `stderr` instead of raw JSON.
- Upgraded markdown fenced code block rendering, added copy-to-clipboard button, and aligned code block UI with monochrome theme.
- Replaced typing dots with a white streaming loader and kept it visible until stream completion.

## 0.0.2 - 2026-03-01
- Updated desktop UI colors to match the Pixora grayscale palette.
- Replaced orange accent usage in `src/renderer/index.css` with grayscale accent values.
- Bumped app version from `0.0.1` to `0.0.2` in `package.json`.
