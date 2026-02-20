# Cognautic Desktop

**The Native AI Agentic Workspace for Professional Engineering.**

Cognautic Desktop is a professional-grade, high-performance development environment that bridges the gap between state-of-the-art AI agents and your local system. Built for speed, privacy, and deep system integration, it provides AI agents with the tools they need to help you build, test, and deploy software directly from your desktop.

![Cognautic Logo](src/renderer/assets/icons/desktop-logo.svg)

## ✨ Features

- **Integrated Professional Editor**: Powered by the Monaco Editor (the core of VS Code), providing high-performance code editing with full syntax highlighting and multi-file support.
- **Native Terminal**: Real-time shell access via Xterm.js and `node-pty`, allowing AI agents to execute commands, run tests, and manage system dependencies securely.
- **Multi-Provider AI Engine**: Connect seamlessly to Gemini, OpenAI, Claude, OpenRouter, and local Ollama instances.
- **Local-First Privacy**: Your configuration, conversation history, and project data stay on your machine. We never touch your data.
- **Agentic Tool Safety**: 
  - **Confirmation Mode (Default)**: Every file modification or command execution requires your explicit approval.
  - **No-Confirmation Mode**: Advanced mode for hands-free automation (use with caution).
- **Cross-Platform**: Tailored experiences for Linux, Windows, and macOS.

## 🛠️ Built With

- **Electron 28**: Native application wrapper for full system access.
- **Monaco Editor**: Industrial-strength code editing.
- **Xterm.js & Node-PTY**: True terminal emulation.
- **Vite & Modern JS**: Lightweight and fast frontend.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **C++ Build Tools** (Required for compiling `node-pty`)
  - Linux: `sudo apt install build-essential`
  - Windows: Visual Studio Build Tools
  - macOS: Xcode Command Line Tools

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/cognautic/desktop.git
   cd desktop
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```
   *Note: This will automatically run native module rebuilds and prepare external libraries.*

3. **Run in development mode:**
   ```bash
   npm run dev
   ```

### Building for Production

To create a standalone executable for your platform:

```bash
npm run dist
```
The output will be located in the `dist/` directory.

## 🛡️ Privacy & Security

Cognautic Desktop is designed with a "Security-First" mindset. 
- **No Telemetry**: We do not collect any usage data or personal information.
- **Transparency**: You can review every tool call initiated by the AI before it executes.
- **Full Control**: You choose which AI provider handles your prompts.

## ⚖️ License

This project is licensed under the **Elastic License 2.0**. See the [LICENSE](LICENSE) file for the full text.
