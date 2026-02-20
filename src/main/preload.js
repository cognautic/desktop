const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // API Key Management
  getApiKeys: () => ipcRenderer.invoke("get-api-keys"),
  saveApiKey: (provider, apiKey) =>
    ipcRenderer.invoke("save-api-key", { provider, apiKey }),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // File System
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  getCwd: () => ipcRenderer.invoke("get-cwd"),
  getHomeDir: () => ipcRenderer.invoke("get-home-dir"),
  readDir: (path) => ipcRenderer.invoke("read-dir", path),
  readFile: (path) => ipcRenderer.invoke("read-file", path),
  selectFile: () => ipcRenderer.invoke("select-file"),
  readFileBuffer: (path) => ipcRenderer.invoke("read-file-buffer", path),
  writeFile: (path, content) =>
    ipcRenderer.invoke("write-file", { filePath: path, content }),
  deleteFile: (path) => ipcRenderer.invoke("delete-file", path),
  renameFile: (oldPath, newPath) =>
    ipcRenderer.invoke("rename-file", { oldPath, newPath }),
  getParentDir: (path) => ipcRenderer.invoke("get-parent-dir", path),

  // Model Management
  fetchModels: (provider) => ipcRenderer.invoke("fetch-models", provider),

  // Message Handling
  sendMessage: (message, provider, model, conversationId) =>
    ipcRenderer.invoke("send-message", {
      message,
      provider,
      model,
      conversationId,
    }),

  // Streaming
  startStream: (message, attachments, provider, model, conversationId) =>
    ipcRenderer.send("start-stream", {
      message,
      attachments,
      provider,
      model,
      conversationId,
    }),
  submitToolOutputs: (toolOutputs, provider, model, conversationId) =>
    ipcRenderer.send("submit-tool-outputs", {
      toolOutputs,
      provider,
      model,
      conversationId,
    }),
  onStreamChunk: (callback) =>
    ipcRenderer.on("stream-chunk", (event, chunk) => callback(chunk)),
  onStreamError: (callback) =>
    ipcRenderer.on("stream-error", (event, error) => callback(error)),
  onStreamComplete: (callback) =>
    ipcRenderer.on("stream-complete", () => callback()),
  removeStreamListeners: () => {
    ipcRenderer.removeAllListeners("stream-chunk");
    ipcRenderer.removeAllListeners("stream-error");
    ipcRenderer.removeAllListeners("stream-complete");
  },

  // Tool Execution
  executeTool: (toolName, parameters, cwd) =>
    ipcRenderer.invoke("execute-tool", { toolName, parameters, cwd }),

  // Conversation Management
  getConversationHistory: (conversationId) =>
    ipcRenderer.invoke("get-conversation-history", conversationId),
  getAllConversations: () => ipcRenderer.invoke("get-all-conversations"),
  createConversation: () => ipcRenderer.invoke("create-conversation"),
  deleteConversation: (conversationId) =>
    ipcRenderer.invoke("delete-conversation", conversationId),

  // Terminal
  createTerminal: (cwd) => ipcRenderer.invoke("create-terminal", cwd),
  writeToTerminal: (data) => ipcRenderer.send("terminal-write", data),
  resizeTerminal: (cols, rows) =>
    ipcRenderer.send("terminal-resize", { cols, rows }),
  onTerminalData: (callback) =>
    ipcRenderer.on("terminal-data", (event, data) => callback(data)),
  removeTerminalListeners: () => {
    ipcRenderer.removeAllListeners("terminal-data");
  },
});
