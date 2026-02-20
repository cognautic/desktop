const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const dotenvPath = path.resolve(__dirname, "../../.env");
console.log(`[Main] Loading .env from: ${dotenvPath}`);
require('dotenv').config({ path: dotenvPath });
const os = require("os");
const pty = require("node-pty");
const AgentSystem = require("./agent-system");
const telemetry = require("./telemetry");

let mainWindow;
let agentSystem;
let ptyProcess;

function createWindow() {
  // Create development menu with DevTools access
  // Remove menu bar
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    telemetry.trackEvent({ event: 'session_ended' });
    if (ptyProcess) {
      ptyProcess.kill();
    }
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  agentSystem = new AgentSystem();

  telemetry.trackEvent({ event: 'app_opened' });
  telemetry.trackEvent({ event: 'session_started' });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC Handlers for AI Provider Management
ipcMain.handle("get-api-keys", async () => {
  return agentSystem.getApiKeys();
});

ipcMain.handle("save-api-key", async (event, { provider, apiKey }) => {
  return agentSystem.saveApiKey(provider, apiKey);
});

ipcMain.handle("get-settings", async () => {
  return agentSystem.getSettings();
});

ipcMain.handle("save-settings", async (event, settings) => {
  return agentSystem.saveSettings(settings);
});

ipcMain.handle("select-directory", async () => {
  try {
    // Removing mainWindow to avoid GTK crash on Linux (modal dialog issue)
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled) {
      return null;
    }
    return result.filePaths[0];
  } catch (error) {
    console.error("Failed to open directory dialog:", error);
    return null;
  }
});

ipcMain.handle("select-file", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) {
      return null;
    }
    return result.filePaths;
  } catch (error) {
    console.error("Failed to open file dialog:", error);
    return null;
  }
});

ipcMain.handle("fetch-models", async (event, provider) => {
  return agentSystem.fetchModels(provider);
});

ipcMain.handle(
  "send-message",
  async (event, { message, provider, model, conversationId }) => {
    return agentSystem.sendMessage(message, provider, model, conversationId);
  },
);

// Stream response handler
ipcMain.on(
  "start-stream",
  async (event, { message, attachments, provider, model, conversationId }) => {
    console.log("=== IPC START-STREAM RECEIVED ===");

    telemetry.trackEvent({
      event: 'feature_used',
      meta: { feature: 'chat', provider, model }
    });

    console.log("Message:", message);
    console.log("Attachments count:", attachments ? attachments.length : 0);
    console.log("Provider:", provider);
    console.log("Model:", model);
    console.log("Conversation ID:", conversationId);

    try {
      await agentSystem.streamMessage(
        message,
        attachments,
        provider,
        model,
        conversationId,
        (chunk) => {
          console.log("Sending chunk to renderer:", chunk);
          event.reply("stream-chunk", chunk);
        },
        (error) => {
          console.error("Stream error, sending to renderer:", error);
          event.reply("stream-error", error);
        },
        () => {
          console.log("Stream complete, notifying renderer");
          event.reply("stream-complete");
        },
      );
    } catch (error) {
      console.error("IPC stream handler error:", error);
      event.reply("stream-error", error.message);
    }
  },
);

ipcMain.on(
  "submit-tool-outputs",
  async (event, { toolOutputs, provider, model, conversationId }) => {
    console.log("=== IPC SUBMIT-TOOL-OUTPUTS RECEIVED ===");
    console.log("Provider:", provider);
    console.log("Model:", model);
    console.log("Conversation ID:", conversationId);

    try {
      await agentSystem.submitToolOutputs(
        toolOutputs,
        provider,
        model,
        conversationId,
        (chunk) => {
          // console.log('Sending chunk to renderer:', chunk);
          event.reply("stream-chunk", chunk);
        },
        (error) => {
          console.error("Stream error, sending to renderer:", error);
          event.reply("stream-error", error);
        },
        () => {
          console.log("Stream complete, notifying renderer");
          event.reply("stream-complete");
        },
      );
    } catch (error) {
      console.error("IPC submit tool outputs error:", error);
      event.reply("stream-error", error.message);
    }
  },
);

// Tool execution handlers
ipcMain.handle("execute-tool", async (event, { toolName, parameters, cwd }) => {
  return agentSystem.executeTool(toolName, parameters, cwd);
});

ipcMain.handle("get-cwd", () => {
  return process.cwd();
});

ipcMain.handle("get-home-dir", () => {
  return require("os").homedir();
});

// Conversation Management
ipcMain.handle("get-conversation-history", async (event, conversationId) => {
  return await agentSystem.getConversationHistory(conversationId);
});

ipcMain.handle("get-all-conversations", async () => {
  return await agentSystem.getAllConversations();
});

ipcMain.handle("create-conversation", async () => {
  return await agentSystem.createConversation();
});

ipcMain.handle("delete-conversation", async (event, conversationId) => {
  return await agentSystem.deleteConversation(conversationId);
});

// Terminal Management
ipcMain.handle("create-terminal", async (event, cwd) => {
  try {
    // Clean up existing terminal if any
    // Clean up existing terminal if any
    if (ptyProcess) {
      try {
        // Prevent old process exit from nullifying the new ptyProcess variable
        ptyProcess.removeAllListeners("exit");
        ptyProcess.kill();
      } catch (e) {
        console.error("Error killing existing terminal:", e);
      }
      ptyProcess = null;
    }

    // Get the default shell for the platform
    const shell =
      os.platform() === "win32"
        ? process.env.COMSPEC || "cmd.exe"
        : process.env.SHELL || "/bin/bash";

    const workingDirectory = cwd || process.env.HOME || process.env.USERPROFILE || process.cwd();

    console.log("Creating terminal with shell:", shell);
    console.log("Platform:", os.platform());
    console.log("CWD:", workingDirectory);

    // Spawn the shell
    ptyProcess = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: workingDirectory,
      env: process.env,
    });

    console.log("Terminal spawned successfully");

    // Send terminal output to renderer
    ptyProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminal-data", data);
      }
    });

    // Handle terminal exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log("Terminal process exited:", exitCode, signal);
      ptyProcess = null;
    });

    return { success: true, shell: shell };
  } catch (error) {
    console.error("Failed to create terminal:", error);
    console.error("Error stack:", error.stack);
    return { success: false, error: error.message };
  }
});

ipcMain.on("terminal-write", (event, data) => {
  if (ptyProcess) {
    ptyProcess.write(data);
  }
});

ipcMain.on("terminal-resize", (event, { cols, rows }) => {
  if (ptyProcess && cols > 0 && rows > 0) {
    try {
      ptyProcess.resize(cols, rows);
    } catch (e) {
      console.error("Failed to resize terminal:", e);
    }
  }
});

ipcMain.handle("get-parent-dir", (event, dirPath) => {
  return path.dirname(dirPath);
});

// File System Operations for Editor
const fs = require("fs").promises;

ipcMain.handle("read-dir", async (event, dirPath) => {
  try {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    return dirents
      .map((dirent) => ({
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        path: path.join(dirPath, dirent.name),
      }))
      .sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
      });
  } catch (error) {
    console.error("Failed to read directory:", error);
    throw error;
  }
});

ipcMain.handle("read-file", async (event, filePath) => {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    console.error("Failed to read file:", error);
    throw error;
  }
});

ipcMain.handle("read-file-buffer", async (event, filePath) => {
  try {
    const buffer = await fs.readFile(filePath);
    const mimeType = getMimeType(filePath);
    return {
      content: buffer.toString("base64"),
      mimeType: mimeType,
    };
  } catch (error) {
    console.error("Failed to read file buffer:", error);
    throw error;
  }
});

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".js": "text/plain", // treat code as text
    ".py": "text/plain",
    ".html": "text/plain",
    ".css": "text/plain",
    ".json": "text/plain",
    ".md": "text/plain",
  };
  return map[ext] || "application/octet-stream";
}

ipcMain.handle("write-file", async (event, { filePath, content }) => {
  try {
    await fs.writeFile(filePath, content, "utf-8");
    return true;
  } catch (error) {
    console.error("Failed to write file:", error);
    throw error;
  }
});

ipcMain.handle("delete-file", async (event, filePath) => {
  try {
    await fs.rm(filePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error("Failed to delete file:", error);
    throw error;
  }
});

ipcMain.handle("rename-file", async (event, { oldPath, newPath }) => {
  try {
    await fs.rename(oldPath, newPath);
    return true;
  } catch (error) {
    console.error("Failed to rename file:", error);
    throw error;
  }
});
