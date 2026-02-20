// ===== State Management =====
const state = {
  currentView: "chat",
  currentConversation: null,
  selectedProvider: null,
  selectedModel: null,
  apiKeys: {},
  conversations: [],
  isStreaming: false,
  workingDirectory: null,
  homeDirectory: null,
  requireToolConfirmation: true,
  // Editor State
  editorInstance: null,
  currentFile: null,
  isMonacoLoaded: false,
  workspaceRoot: null, // The base root we shouldn't go above
  terminalInstance: null,
  // Tree View State
  directoryStates: {}, // Track expanded/collapsed state: { path: true }
  // Multiselect & Context Menu State
  selectedPaths: [],
  contextMenuPath: null,
  pendingAttachments: [],
  // Autosave State
  autosaveEnabled: true,
  autosaveDelay: 2000, // milliseconds
  autosaveTimeout: null,
  hasUnsavedChanges: false,
};

// ===== DOM Elements =====
const elements = {
  // Sidebar
  chatBtn: document.getElementById("chat-btn"),
  historyBtn: document.getElementById("history-btn"),
  settingsBtn: document.getElementById("settings-btn"),

  // Views
  chatView: document.getElementById("chat-view"),
  historyView: document.getElementById("history-view"),
  settingsView: document.getElementById("settings-view"),
  editorView: document.getElementById("editor-view"),

  // Editor
  editorBtn: document.getElementById("editor-btn"),
  fileList: document.getElementById("file-list"),
  refreshFilesBtn: document.getElementById("refresh-files"),
  monacoContainer: document.getElementById("monaco-container"),
  workspaceRootPath: document.getElementById("workspace-root-path"),
  contextMenu: document.getElementById("context-menu"),
  menuRename: document.getElementById("menu-rename"),
  menuDelete: document.getElementById("menu-delete"),

  // Chat
  chatContainer: document.querySelector(".chat-container"),
  messageInput: document.getElementById("message-input"),
  sendBtn: document.getElementById("send-btn"),
  messagesContainer: document.getElementById("messages"),
  modelSelector: document.getElementById("model-selector"),
  selectedModelSpan: document.getElementById("selected-model"),
  attachBtn: document.getElementById("attach-btn"),
  attachmentPreviews: document.getElementById("attachment-previews"),

  // Working Directory
  workingDirSelector: document.getElementById("working-dir-selector"),
  workingDirPath: document.getElementById("working-dir-path"),

  // Modal
  modal: document.getElementById("model-modal"),
  modalClose: document.getElementById("modal-close"),
  providerTabs: document.getElementById("provider-tabs"),
  modelsList: document.getElementById("models-list"),
  modelSearchInput: document.getElementById("model-search-input"),

  // Settings
  settingsTabs: document.querySelectorAll(".settings-tab-btn"),
  settingsSections: document.querySelectorAll(".settings-section"),
  toolConfirmationToggle: document.getElementById("tool-confirmation-toggle"),
  apiKeyInputs: {
    google: document.getElementById("google-key"),
    openai: document.getElementById("openai-key"),
    anthropic: document.getElementById("anthropic-key"),
    openrouter: document.getElementById("openrouter-key"),
    together: document.getElementById("together-key"),
    ollama: document.getElementById("ollama-endpoint"),
  },

  // History
  conversationsList: document.getElementById("conversations-list"),

  // Autosave Settings
  autosaveToggle: document.getElementById("autosave-toggle"),
  autosaveDelayInput: document.getElementById("autosave-delay"),

  // Rename Modal
  renameModal: document.getElementById("rename-modal"),
  renameInput: document.getElementById("rename-input"),
  renameConfirm: document.getElementById("rename-confirm"),
  renameCancel: document.getElementById("rename-cancel"),
  renameModalClose: document.getElementById("rename-modal-close"),
};

// ===== Initialization =====
async function init() {
  // Check if electronAPI is available
  if (!window.electronAPI) {
    console.error(
      "CRITICAL: electronAPI not available! Preload script may have failed.",
    );
    alert(
      "Application failed to initialize properly. Please restart the application.",
    );
    return;
  }

  console.log("Starting application initialization...");

  // 1. Initialize Working Directory FIRST so other parts can use it
  try {
    state.homeDirectory = await window.electronAPI.getHomeDir();
    const cwd = await window.electronAPI.getCwd();
    state.workingDirectory = cwd;
    state.workspaceRoot = cwd; // Set initial CWD as workspace boundary

    if (elements.workingDirPath) {
      elements.workingDirPath.textContent = cwd;
      elements.workingDirPath.title = cwd;
    }
    validateWorkingDirectory(cwd);

    // Initial load of files with a small delay to ensure DOM is ready
    setTimeout(() => loadFiles(), 500);
  } catch (e) {
    console.error("Failed to initialize workspace:", e);
  }

  // 2. Setup everything else
  try {
    setupEventListeners();
    await loadSettings();
    await loadApiKeys();
    await createNewConversation();
    await loadConversations();

    updateGreeting();
    updateLayout();

    console.log("Application initialized successfully");
  } catch (e) {
    console.error("Failed to initialize application:", e);
    alert("Application initialization failed: " + e.message);
  }
}

function setupEventListeners() {
  // Sidebar navigation
  elements.chatBtn.addEventListener("click", () => {
    if (state.currentView !== "chat") {
      switchView("chat");
      // Ensure we see the latest messages when returning
      setTimeout(() => {
        elements.messagesContainer.scrollTop =
          elements.messagesContainer.scrollHeight;
      }, 10);
    } else {
      // Already in chat, perhaps scroll to bottom
      elements.messagesContainer.scrollTop =
        elements.messagesContainer.scrollHeight;
    }
  });

  // Add New Chat Button Listener (assuming we add it to DOM)
  const newChatBtn = document.getElementById("new-chat-btn");
  if (newChatBtn) {
    newChatBtn.addEventListener("click", async () => {
      if (state.isStreaming) {
        showNotification(
          "Please wait for the current response to complete",
          "error",
        );
        return;
      }
      await createNewConversation();
      if (state.currentView !== "chat") switchView("chat");
    });
  }

  elements.historyBtn.addEventListener("click", () => switchView("history"));
  elements.editorBtn.addEventListener("click", () => switchView("editor"));
  elements.settingsBtn.addEventListener("click", () => switchView("settings"));

  // Editor Listeners
  if (elements.refreshFilesBtn) {
    elements.refreshFilesBtn.addEventListener("click", () => loadFiles());
  }

  // Context Menu Listeners
  window.addEventListener("click", () => hideContextMenu());

  elements.menuRename.addEventListener("click", () => handleRename());
  elements.menuDelete.addEventListener("click", () => handleDelete());

  // Rename Modal Listeners
  if (elements.renameModalClose) {
    elements.renameModalClose.addEventListener("click", () =>
      closeRenameModal(),
    );
  }
  if (elements.renameCancel) {
    elements.renameCancel.addEventListener("click", () => closeRenameModal());
  }
  if (elements.renameConfirm) {
    elements.renameConfirm.addEventListener("click", () => confirmRename());
  }
  if (elements.renameInput) {
    elements.renameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") confirmRename();
      if (e.key === "Escape") closeRenameModal();
    });
  }
  // Close modal on background click
  if (elements.renameModal) {
    elements.renameModal.addEventListener("click", (e) => {
      if (e.target === elements.renameModal) closeRenameModal();
    });
  }

  if (elements.fileList) {
    elements.fileList.addEventListener("click", (e) => {
      if (e.target === elements.fileList) {
        state.selectedPaths = [];
        loadFiles();
      }
    });
  }

  // Settings Tabs
  elements.settingsTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.settingsTabs.forEach((b) => b.classList.remove("active"));
      elements.settingsSections.forEach((s) => s.classList.remove("active"));

      btn.classList.add("active");
      const tabId = btn.dataset.tab;
      document.getElementById(`settings-${tabId}`).classList.add("active");
    });
  });

  // Tool Confirmation Toggle
  elements.toolConfirmationToggle.addEventListener("change", async (e) => {
    state.requireToolConfirmation = e.target.checked;
    await window.electronAPI.saveSettings({
      requireToolConfirmation: state.requireToolConfirmation,
      autosaveEnabled: state.autosaveEnabled,
      autosaveDelay: state.autosaveDelay,
    });
    showNotification("Settings saved", "success");
  });

  // Autosave Toggle
  if (elements.autosaveToggle) {
    elements.autosaveToggle.addEventListener("change", async (e) => {
      state.autosaveEnabled = e.target.checked;
      await window.electronAPI.saveSettings({
        requireToolConfirmation: state.requireToolConfirmation,
        autosaveEnabled: state.autosaveEnabled,
        autosaveDelay: state.autosaveDelay,
      });
      showNotification(
        `Autosave ${state.autosaveEnabled ? "enabled" : "disabled"}`,
        "success",
      );
    });
  }

  // Autosave Delay Input
  if (elements.autosaveDelayInput) {
    elements.autosaveDelayInput.addEventListener("change", async (e) => {
      const seconds = parseInt(e.target.value);
      if (seconds >= 1 && seconds <= 30) {
        state.autosaveDelay = seconds * 1000; // Convert to milliseconds
        await window.electronAPI.saveSettings({
          requireToolConfirmation: state.requireToolConfirmation,
          autosaveEnabled: state.autosaveEnabled,
          autosaveDelay: state.autosaveDelay,
        });
        showNotification(`Autosave delay set to ${seconds} seconds`, "success");
      }
    });
  }

  // Message input
  elements.messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  elements.sendBtn.addEventListener("click", () => {
    if (state.isStreaming) {
      stopStream();
    } else {
      sendMessage();
    }
  });

  // Model selector
  elements.modelSelector.addEventListener("click", openModelModal);
  elements.modalClose.addEventListener("click", closeModelModal);
  elements.modal.addEventListener("click", (e) => {
    if (e.target === elements.modal) closeModelModal();
  });

  // Model Search
  if (elements.modelSearchInput) {
    elements.modelSearchInput.addEventListener("input", (e) => {
      filterModels(e.target.value);
    });
  }

  // Provider tabs
  document.querySelectorAll(".provider-tab").forEach((tab) => {
    tab.addEventListener("click", (event) => {
      const provider = event.target.dataset.provider;
      selectProvider(provider);
    });
  });

  // API key save buttons
  document.querySelectorAll(".save-key-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const provider = btn.dataset.provider;
      await saveApiKey(provider);
    });
  });

  // Stream listeners
  window.electronAPI.onStreamChunk((chunk) => handleStreamChunk(chunk));
  window.electronAPI.onStreamError((error) => handleStreamError(error));
  window.electronAPI.onStreamComplete(() => handleStreamComplete());

  // Working Directory Selector
  elements.workingDirSelector.addEventListener("click", async () => {
    try {
      const dir = await window.electronAPI.selectDirectory();
      if (dir) {
        state.workingDirectory = dir;
        state.workspaceRoot = dir; // Update workspace root as well
        state.directoryStates = {}; // Reset expansion state

        // Update UI
        elements.workingDirPath.textContent = dir;
        elements.workingDirPath.title = dir;
        if (elements.workspaceRootPath) {
          elements.workspaceRootPath.textContent = dir;
        }

        validateWorkingDirectory(dir);

        // Reload files
        await loadFiles();

        // Respawn Terminal in new CWD (keep UI instance alive)
        if (state.terminalInstance) {
          // Use reset() to clear escape sequence states (cursor modes) from previous session
          state.terminalInstance.reset();
          state.terminalInstance.write('\r\n\x1b[33mSwitching directory...\x1b[0m\r\n');

          const result = await window.electronAPI.createTerminal(dir);

          if (!result || !result.success) {
            state.terminalInstance.write('\r\n\x1b[31mFailed to start terminal process.\x1b[0m\r\n');
            console.error("Failed to respawn terminal:", result);
          } else {
            // Sync dimensions with new process
            if (fitAddon) {
              fitAddon.fit();
              const dims = fitAddon.proposeDimensions();
              if (dims && dims.cols > 0 && dims.rows > 0) {
                window.electronAPI.resizeTerminal(dims.cols, dims.rows);
              }
            }
            state.terminalInstance.focus();
          }
        } else {
          await initTerminal();
        }
      }
    } catch (error) {
      console.error("Failed to select directory:", error);
    }
  });

  // Attachment listeners
  if (elements.attachBtn) {
    elements.attachBtn.addEventListener("click", handleSelectFiles);
  }

  if (elements.messageInput) {
    elements.messageInput.addEventListener("paste", handlePaste);
  }

  // Terminal Listeners (Moved from initTerminal to prevent duplicates)
  // Handle window resize
  window.addEventListener("resize", () => {
    if (fitAddon && terminalInstance) {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0) {
        window.electronAPI.resizeTerminal(dims.cols, dims.rows);
      }
    }
  });

  // Handle terminal clear button
  const terminalClearBtn = document.getElementById("terminal-clear");
  if (terminalClearBtn) {
    terminalClearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (terminalInstance) {
        terminalInstance.clear();
      }
    });
  }

  // Handle terminal toggle button
  const terminalToggleBtn = document.getElementById("terminal-toggle");
  const terminalContainer = document.getElementById("terminal-container");
  if (terminalToggleBtn && terminalContainer) {
    terminalToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      terminalContainer.classList.toggle("collapsed");

      // Re-fit terminal when expanding
      if (!terminalContainer.classList.contains("collapsed")) {
        setTimeout(() => {
          if (fitAddon) {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            if (dims && dims.cols > 0 && dims.rows > 0) {
              window.electronAPI.resizeTerminal(dims.cols, dims.rows);
            }
          }
        }, 300);
      }
    });
  }

  // Allow clicking header to toggle
  const terminalHeader = document.querySelector(".terminal-header");
  if (terminalHeader && terminalContainer) {
    terminalHeader.addEventListener("click", (e) => {
      // Don't toggle if clicking on buttons
      if (e.target.closest("button")) return;

      terminalContainer.classList.toggle("collapsed");

      // Re-fit terminal when expanding
      if (!terminalContainer.classList.contains("collapsed")) {
        setTimeout(() => {
          if (fitAddon) {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            if (dims && dims.cols > 0 && dims.rows > 0) {
              window.electronAPI.resizeTerminal(dims.cols, dims.rows);
            }
          }
        }, 300);
      }
    });
  }

  // Handle terminal output from backend (Singleton listener)
  window.electronAPI.onTerminalData((data) => {
    if (state.terminalInstance) {
      state.terminalInstance.write(data);
    }
  });
}

async function handleSelectFiles() {
  try {
    const filePaths = await window.electronAPI.selectFile();
    if (filePaths && filePaths.length > 0) {
      for (const filePath of filePaths) {
        await addAttachment(filePath);
      }
    }
  } catch (error) {
    console.error("Failed to select files:", error);
    showNotification("Failed to select files", "error");
  }
}

async function handlePaste(event) {
  const items = (event.clipboardData || event.originalEvent.clipboardData)
    .items;
  for (const item of items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      // Since we can't get the real path easily from paste in some browsers/electron envs,
      // we might need to handle it differently if it's just a blob.
      // But usually in Electron, we might get more.
      // For now, let's treat blobs by converting to base64.
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target.result.split(",")[1];
        const mimeType = item.type;
        state.pendingAttachments.push({
          name: `pasted-image-${Date.now()}.${mimeType.split("/")[1]}`,
          path: null,
          content,
          mimeType,
        });
        renderAttachmentPreviews();
      };
      reader.readAsDataURL(file);
    }
  }
}

async function addAttachment(filePath) {
  try {
    const fileData = await window.electronAPI.readFileBuffer(filePath);
    const fileName = filePath.split(/[\\/]/).pop();

    // Avoid duplicates
    if (state.pendingAttachments.some((a) => a.path === filePath)) return;

    state.pendingAttachments.push({
      name: fileName,
      path: filePath,
      content: fileData.content,
      mimeType: fileData.mimeType,
    });
    renderAttachmentPreviews();
  } catch (error) {
    console.error("Failed to add attachment:", error);
    showNotification(`Failed to add attachment: ${filePath}`, "error");
  }
}

function renderAttachmentPreviews() {
  if (!elements.attachmentPreviews) return;

  if (state.pendingAttachments.length === 0) {
    elements.attachmentPreviews.style.display = "none";
    elements.attachmentPreviews.innerHTML = "";
    return;
  }

  elements.attachmentPreviews.style.display = "flex";
  elements.attachmentPreviews.innerHTML = state.pendingAttachments
    .map(
      (att, index) => `
        <div class="attachment-preview">
            ${att.mimeType.startsWith("image/")
          ? `<img src="data:${att.mimeType};base64,${att.content}" alt="${att.name}" title="${att.name}">`
          : `<div class="file-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                        <polyline points="13 2 13 9 20 9"></polyline>
                    </svg>
                    <div style="font-size: 8px; text-align: center; overflow: hidden; text-overflow: ellipsis;">${att.name}</div>
                   </div>`
        }
            <div class="remove-btn" onclick="removeAttachment(${index})">&times;</div>
        </div>
    `,
    )
    .join("");
}

window.removeAttachment = function (index) {
  state.pendingAttachments.splice(index, 1);
  renderAttachmentPreviews();
};

function validateWorkingDirectory(dir) {
  const isRoot = isRootDirectory(dir);

  if (isRoot) {
    elements.messageInput.disabled = true;
    elements.messageInput.placeholder =
      "Please select a sub-directory to continue (Root/Home usage is restricted)";
    elements.sendBtn.disabled = true;
    elements.workingDirPath.classList.add("error-text");
    showNotification(
      "Root or Home directory usage is restricted for safety reasons.",
      "error",
    );
  } else {
    elements.messageInput.disabled = false;
    elements.messageInput.placeholder = "Type your message here...";
    elements.sendBtn.disabled = false;
    elements.workingDirPath.classList.remove("error-text");
  }
}

function isRootDirectory(path) {
  if (!path) return false;
  const cleanPath = path.trim();

  // Linux/Mac root
  if (cleanPath === "/") return true;

  // Windows root (e.g., C:\, D:/, C:)
  // Regex for X:\ or X:/ or X:
  if (/^[a-zA-Z]:[\\/]?$/.test(cleanPath)) return true;

  // User Home Directory check
  if (state.homeDirectory && cleanPath === state.homeDirectory) return true;

  return false;
}

// ===== View Management =====
function switchView(viewName) {
  // Update sidebar
  document.querySelectorAll(".sidebar-icon").forEach((icon) => {
    icon.classList.remove("active");
    // Reset to default icon
    const img = icon.querySelector("img");
    if (img) {
      const src = img.src;
      img.src = src.replace("-active.svg", ".svg");
    }
  });

  if (viewName === "chat") {
    elements.chatBtn.classList.add("active");
    const img = elements.chatBtn.querySelector("img");
    if (img) img.src = "assets/icons/chat-active.svg";
  }
  if (viewName === "history") elements.historyBtn.classList.add("active");
  if (viewName === "editor") elements.editorBtn.classList.add("active");
  if (viewName === "settings") elements.settingsBtn.classList.add("active");

  // Update views
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.remove("active");
  });

  if (viewName === "chat") elements.chatView.classList.add("active");
  if (viewName === "history") {
    elements.historyView.classList.add("active");
    loadConversations();
  }
  if (viewName === "editor") {
    elements.editorView.classList.add("active");
    initEditor();
  }
  if (viewName === "settings") elements.settingsView.classList.add("active");

  state.currentView = viewName;
  updateSidebarActivity(); // Refresh activity markers
}

function updateSidebarActivity() {
  if (state.isStreaming && state.currentView !== "chat") {
    elements.chatBtn.classList.add("activity-pulse");
  } else {
    elements.chatBtn.classList.remove("activity-pulse");
  }
}

// ===== Settings Management =====
async function loadSettings() {
  try {
    const settings = await window.electronAPI.getSettings();
    if (settings) {
      state.requireToolConfirmation =
        settings.requireToolConfirmation !== false; // Default to true
      elements.toolConfirmationToggle.checked = state.requireToolConfirmation;

      // Load autosave settings
      state.autosaveEnabled = settings.autosaveEnabled !== false; // Default to true
      state.autosaveDelay = settings.autosaveDelay || 2000; // Default 2 seconds

      if (elements.autosaveToggle) {
        elements.autosaveToggle.checked = state.autosaveEnabled;
      }
      if (elements.autosaveDelayInput) {
        elements.autosaveDelayInput.value = state.autosaveDelay / 1000; // Convert to seconds
      }
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
}

// ===== API Key Management =====
async function loadApiKeys() {
  try {
    state.apiKeys = await window.electronAPI.getApiKeys();

    // Set default Ollama endpoint if not configured
    if (!state.apiKeys.ollama) {
      state.apiKeys.ollama = "http://127.0.0.1:11434";
    }

    // Populate input fields
    Object.keys(state.apiKeys).forEach((provider) => {
      if (elements.apiKeyInputs[provider]) {
        elements.apiKeyInputs[provider].value = state.apiKeys[provider];
      }
    });

    // Ensure Ollama endpoint is shown even if not in saved keys
    if (elements.apiKeyInputs.ollama && !elements.apiKeyInputs.ollama.value) {
      elements.apiKeyInputs.ollama.value = "http://127.0.0.1:11434";
    }
  } catch (error) {
    console.error("Failed to load API keys:", error);
  }
}

async function saveApiKey(provider) {
  const input = elements.apiKeyInputs[provider];
  let apiKey = input.value.trim();

  // Handle Ollama endpoint specially
  if (provider === "ollama") {
    // If empty, use default
    if (!apiKey) {
      apiKey = "http://127.0.0.1:11434";
      input.value = apiKey;
    }

    // Validate URL format
    try {
      new URL(apiKey);
    } catch (e) {
      showNotification(
        "Please enter a valid URL (e.g., http://127.0.0.1:11434)",
        "error",
      );
      return;
    }
  } else {
    // For other providers, require API key
    if (!apiKey) {
      showNotification("Please enter an API key", "error");
      return;
    }
  }

  try {
    await window.electronAPI.saveApiKey(provider, apiKey);
    state.apiKeys[provider] = apiKey;

    const btn = document.querySelector(`[data-provider="${provider}"]`);
    btn.classList.add("saved");
    btn.textContent = "Saved!";

    setTimeout(() => {
      btn.classList.remove("saved");
      btn.textContent = "Save";
    }, 2000);

    const message =
      provider === "ollama"
        ? "Ollama endpoint saved successfully"
        : "API key saved successfully";
    showNotification(message, "success");
  } catch (error) {
    console.error(error);
    const message =
      provider === "ollama"
        ? "Failed to save Ollama endpoint"
        : "Failed to save API key";
    showNotification(message, "error");
  }
}

// ===== Model Selection =====
function openModelModal() {
  elements.modal.classList.add("active");
}

function closeModelModal() {
  elements.modal.classList.remove("active");
}

async function selectProvider(provider) {
  // Update active tab
  document.querySelectorAll(".provider-tab").forEach((tab) => {
    tab.classList.remove("active");
  });
  event.target.classList.add("active");

  state.selectedProvider = provider;

  // Check if API key exists (skip for Ollama as it uses endpoint)
  if (provider !== "ollama" && !state.apiKeys[provider]) {
    elements.modelsList.innerHTML = `
      <p class="no-models">
        No API key configured for ${provider}.
        <br><br>
        Please add your API key in Settings.
      </p>
    `;
    return;
  }

  // For Ollama, ensure default endpoint is set
  if (provider === "ollama" && !state.apiKeys.ollama) {
    state.apiKeys.ollama = "http://127.0.0.1:11434";
  }

  // Load models
  elements.modelsList.innerHTML = '<p class="loading">Loading models...</p>';

  try {
    const models = await window.electronAPI.fetchModels(provider);
    state.currentModelList = models;
    if (elements.modelSearchInput) elements.modelSearchInput.value = "";
    displayModels(models);
  } catch (error) {
    const errorMsg =
      provider === "ollama"
        ? `Failed to connect to Ollama. Make sure Ollama is running at ${state.apiKeys.ollama || "http://localhost:11434"}`
        : `Failed to load models: ${error.message}`;

    elements.modelsList.innerHTML = `
      <p class="error-message">
        ${errorMsg}
      </p>
    `;
  }
}

function displayModels(models) {
  if (models.length === 0) {
    elements.modelsList.innerHTML =
      '<p class="no-models">No models available</p>';
    return;
  }

  elements.modelsList.innerHTML = models
    .map(
      (model) => `
    <div class="model-item ${state.selectedModel?.id === model.id ? "selected" : ""}"
         data-model-id="${model.id}"
         data-model-name="${model.name}"
         data-provider="${model.provider}">
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div>
          <div class="model-name">${model.name}</div>
          <div class="model-id">${model.id}</div>
        </div>
        ${model.supportsTools
          ? `
          <span class="capability-badge">
            <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="3" fill="none" style="margin-right: 4px;">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
            </svg>
            Tools
          </span>
        `
          : ""
        }
      </div>
    </div>
  `,
    )
    .join("");

  // Add click listeners
  document.querySelectorAll(".model-item").forEach((item) => {
    item.addEventListener("click", () => {
      const modelId = item.dataset.modelId;
      const modelName = item.dataset.modelName;
      const provider = item.dataset.provider;

      state.selectedModel = { id: modelId, name: modelName };
      state.selectedProvider = provider;

      elements.selectedModelSpan.textContent = modelName;
      closeModelModal();

      // Update selected state
      document
        .querySelectorAll(".model-item")
        .forEach((i) => i.classList.remove("selected"));
      item.classList.add("selected");
    });
  });
}

function filterModels(query) {
  if (!state.currentModelList) return;
  const lowerQuery = query.toLowerCase();
  const filtered = state.currentModelList.filter(
    (model) =>
      model.name.toLowerCase().includes(lowerQuery) ||
      model.id.toLowerCase().includes(lowerQuery),
  );
  displayModels(filtered);
}

// ===== Messaging =====
async function sendMessage() {
  const message = elements.messageInput.value.trim();

  if (!message) return;

  if (!state.selectedModel || !state.selectedProvider) {
    showNotification("Please select a model first", "error");
    openModelModal();
    return;
  }

  if (state.isStreaming) {
    showNotification(
      "Please wait for the current response to complete",
      "error",
    );
    return;
  }

  // Safety check: Don't allow sending if in root directory
  if (isRootDirectory(state.workingDirectory)) {
    showNotification(
      "Cannot send message: Root directory usage is restricted.",
      "error",
    );
    validateWorkingDirectory(state.workingDirectory); // Re-apply UI state just in case
    return;
  }

  // Hide the header on first message
  const chatHeader = document.querySelector(".chat-header");
  if (chatHeader && !chatHeader.classList.contains("hidden")) {
    chatHeader.classList.add("hidden");
  }

  // Update layout to bottom position
  updateLayout();

  // Clear input and attachments
  elements.messageInput.value = "";
  const attachmentsToSend = [...state.pendingAttachments];
  state.pendingAttachments = [];
  renderAttachmentPreviews();

  console.log("Sending message:", message);
  console.log("Selected provider:", state.selectedProvider);
  console.log("Selected model:", state.selectedModel);
  console.log("Attachments:", attachmentsToSend.length);

  // Add user message to UI
  addMessage("user", message, null, null, null, attachmentsToSend);

  // Prepare assistant message container
  const assistantMessageId = `msg-${Date.now()}`;
  addMessage("assistant", "", assistantMessageId);

  // Reset state for new stream
  currentAssistantMessage = "";
  activeTextBuffer = "";
  activeTextElement = null;
  currentMessageId = null;
  pendingToolCalls = [];

  // Start streaming
  state.isStreaming = true;
  updateSendButton();
  updateSidebarActivity();

  try {
    console.log("Calling electronAPI.startStream...");
    window.electronAPI.startStream(
      message,
      attachmentsToSend,
      state.selectedProvider,
      state.selectedModel.id,
      state.currentConversation,
      state.workingDirectory, // Pass CWD
    );
    console.log("startStream called successfully");
  } catch (error) {
    console.error("Error calling startStream:", error);
    handleStreamError(error.message);
  }
}

let currentAssistantMessage = "";
let activeTextBuffer = "";
let activeTextElement = null;
let currentMessageId = null;
let pendingToolCalls = [];

function mergeToolCalls(current, deltas) {
  const result = JSON.parse(JSON.stringify(current));

  for (const delta of deltas) {
    const index = delta.index;

    // Check if this tool call already exists (by ID) to prevent duplicates
    const existingById = result.find(
      (tc) => tc.id && delta.id && tc.id === delta.id,
    );
    if (existingById) {
      console.log("Skipping duplicate tool call with ID:", delta.id);
      continue; // Skip this duplicate
    }

    if (!result[index]) {
      result[index] = {
        index,
        id: delta.id || "",
        type: "function",
        function: { name: "", arguments: "" },
      };
    }

    const target = result[index];

    // Set ID if provided
    if (delta.id) target.id = delta.id;

    // For complete tool calls (Google), replace instead of append
    // For delta tool calls (OpenAI), append
    if (delta.function?.name) {
      // If the name is complete (not a delta), replace it
      if (delta.function.name.length > 0 && !target.function.name) {
        target.function.name = delta.function.name;
      } else {
        // Otherwise append (for streaming deltas)
        target.function.name += delta.function.name;
      }
    }

    if (delta.function?.arguments) {
      // If arguments look complete (start with '{' or '['), replace
      if (
        (delta.function.arguments.startsWith("{") ||
          delta.function.arguments.startsWith("[")) &&
        !target.function.arguments
      ) {
        target.function.arguments = delta.function.arguments;
      } else {
        // Otherwise append (for streaming deltas)
        target.function.arguments += delta.function.arguments;
      }
    }
  }

  return result;
}

function handleStreamChunk(chunk) {
  if (chunk.type === "content") {
    currentAssistantMessage += chunk.content;
    activeTextBuffer += chunk.content;

    // Find the current assistant message
    const messages = document.querySelectorAll(".message.assistant");
    const lastMessage = messages[messages.length - 1];

    if (lastMessage) {
      currentMessageId = lastMessage.id;
      const contentEl = document.getElementById(`${currentMessageId}-content`);
      if (contentEl) {
        // Determine target text element
        if (!activeTextElement || !contentEl.contains(activeTextElement)) {
          activeTextElement = document.createElement("div");
          activeTextElement.className = "text-response";

          // Insert before typing indicator if present, otherwise append
          const typingIndicator = contentEl.querySelector(".typing-indicator");
          if (typingIndicator) {
            contentEl.insertBefore(activeTextElement, typingIndicator);
          } else {
            contentEl.appendChild(activeTextElement);
          }
        }
        activeTextElement.innerHTML = formatContent(activeTextBuffer);
        elements.messagesContainer.scrollTop =
          elements.messagesContainer.scrollHeight;
      }
    }
  }

  if (chunk.type === "tool_call") {
    if (chunk.toolCalls) {
      console.log("Received tool_call chunk:", chunk.toolCalls);
      console.log("Current pendingToolCalls before merge:", pendingToolCalls);
      pendingToolCalls = mergeToolCalls(pendingToolCalls, chunk.toolCalls);
      console.log("Current pendingToolCalls after merge:", pendingToolCalls);

      // Render tool calls immediately as they arrive - pass FULL state
      renderToolCallsInline(pendingToolCalls);
    }
  }

  // Ensure activity pulses if we are not looking at chat
  if (state.currentView !== "chat") {
    updateSidebarActivity();
  }
}

function renderToolCallsInline(toolCalls) {
  // Reset active text element so next text chunk creates a new one
  activeTextElement = null;
  activeTextBuffer = "";

  // Find the current assistant message
  const messages = document.querySelectorAll(".message.assistant");
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return;

  const contentEl = lastMessage.querySelector(".message-content");
  if (!contentEl) return;

  // Remove typing indicator if present
  const typingIndicator = contentEl.querySelector(".typing-indicator");
  if (typingIndicator) {
    typingIndicator.remove();
  }

  // Render each tool call
  for (const toolCall of toolCalls) {
    const toolId = toolCall.id || `tool-${Date.now()}_${Math.random()}`;
    const toolUiId = `tool-ui-${toolId}`;
    let toolBlock = document.getElementById(toolUiId);

    const toolName = toolCall.function.name;
    let args = {};
    let isJsonValid = false;
    try {
      args = JSON.parse(toolCall.function.arguments);
      isJsonValid = true;
    } catch (e) {
      // Arguments might not be complete yet during streaming
      args = { raw: toolCall.function.arguments, status: "streaming..." };
    }

    // Create UI if it doesn't exist
    if (!toolBlock) {
      toolBlock = document.createElement("div");
      toolBlock.className = "tool-call-container";
      toolBlock.id = toolUiId;
      toolBlock.innerHTML = `
                <div class="tool-call-header">
                    <div class="tool-info-group">
                        <svg class="tool-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        <span class="tool-name">
                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" style="margin-right: 6px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                            ${toolName}
                        </span>
                    </div>
                    <span class="tool-status-badge pending">Pending</span>
                </div>
                <div class="tool-args-container"></div>
                <div class="tool-actions" id="actions-${toolId}">
                    <button class="tool-btn reject">Reject</button>
                    <button class="tool-btn approve">Approve & Run</button>
                </div>
            `;

      // Add toggle listener
      toolBlock
        .querySelector(".tool-call-header")
        .addEventListener("click", () => {
          toolBlock.classList.toggle("collapsed");
        });

      contentEl.appendChild(toolBlock);
      elements.messagesContainer.scrollTop =
        elements.messagesContainer.scrollHeight;
    }

    // Update arguments content
    const argsContainer = toolBlock.querySelector(".tool-args-container");

    if (isJsonValid) {
      // Rich formatting for specific tools
      if (toolName === "write_file" && args.content) {
        argsContainer.innerHTML = "";

        const pathInfo = document.createElement("div");
        pathInfo.className = "tool-arg-info";
        pathInfo.innerHTML = `<span class="label">File:</span> <span class="value">${args.path || "Unknown"}</span>`;
        argsContainer.appendChild(pathInfo);

        const contentHeader = document.createElement("div");
        contentHeader.className = "diff-header added";
        contentHeader.textContent = "New Content";
        argsContainer.appendChild(contentHeader);

        const contentDiv = document.createElement("div");
        contentDiv.className = "diff-block added";
        contentDiv.textContent = args.content;
        argsContainer.appendChild(contentDiv);
      } else if (
        toolName === "edit_file" &&
        (args.pattern || args.replacement)
      ) {
        argsContainer.innerHTML = "";

        const pathInfo = document.createElement("div");
        pathInfo.className = "tool-arg-info";
        pathInfo.innerHTML = `<span class="label">File:</span> <span class="value">${args.path || "Unknown"}</span>`;
        argsContainer.appendChild(pathInfo);

        if (args.pattern) {
          const removedHeader = document.createElement("div");
          removedHeader.className = "diff-header removed";
          removedHeader.textContent = "Original / Find pattern";
          argsContainer.appendChild(removedHeader);

          const removedDiv = document.createElement("div");
          removedDiv.className = "diff-block removed";
          removedDiv.textContent = args.pattern;
          argsContainer.appendChild(removedDiv);
        }

        if (args.replacement) {
          const addedHeader = document.createElement("div");
          addedHeader.className = "diff-header added";
          addedHeader.textContent = "Replacement";
          argsContainer.appendChild(addedHeader);

          const addedDiv = document.createElement("div");
          addedDiv.className = "diff-block added";
          addedDiv.textContent = args.replacement;
          argsContainer.appendChild(addedDiv);
        }
      } else if (toolName === "execute_command" && args.command) {
        argsContainer.innerHTML = "";
        const cmdBlock = document.createElement("div");
        cmdBlock.className = "cmd-block";
        cmdBlock.innerHTML = `<span class="cmd-prompt">$</span> ${args.command}`;
        argsContainer.appendChild(cmdBlock);
      } else {
        // Default JSON view for other tools
        argsContainer.innerHTML = `<pre class="tool-args">${JSON.stringify(args, null, 2)}</pre>`;
      }
    } else {
      // Streaming / Invalid JSON view
      argsContainer.innerHTML = `<pre class="tool-args streaming">${toolCall.function.arguments}</pre>`;
    }
  }
}

function stopStream() {
  console.log("Stopping stream...");
  // Reset streaming state
  finishStream();
  showNotification("Stream stopped", "info");
}

function handleStreamError(error) {
  state.isStreaming = false;
  elements.sendBtn.disabled = false;
  updateSendButton(); // <--- Fix: Update button state
  showNotification(`Error: ${error}`, "error");

  // Remove typing indicator
  const messages = document.querySelectorAll(".message.assistant");
  const lastMessage = messages[messages.length - 1];
  if (lastMessage) {
    const contentEl = lastMessage.querySelector(".message-content");
    if (contentEl && contentEl.querySelector(".typing-indicator")) {
      contentEl.innerHTML =
        '<span style="color: var(--text-tertiary);">Failed to generate response</span>';
    }
  }
  pendingToolCalls = []; // Reset
}

async function handleStreamComplete() {
  if (pendingToolCalls.length > 0) {
    console.log("Stream complete, processing tools...", pendingToolCalls);
    await executePendingTools();
  } else {
    finishStream();
  }
}

function finishStream() {
  state.isStreaming = false;
  updateSendButton();
  updateSidebarActivity();

  // Remove typing indicator from the last assistant message
  const messages = document.querySelectorAll(".message.assistant");
  const lastMessage = messages[messages.length - 1];
  if (lastMessage) {
    const typingIndicator = lastMessage.querySelector(".typing-indicator");
    if (typingIndicator) {
      typingIndicator.remove();
    }
  }

  currentAssistantMessage = "";
  currentMessageId = null;
  pendingToolCalls = [];
}

function updateSendButton() {
  const sendIcon = elements.sendBtn.querySelector("img");
  if (state.isStreaming) {
    // Change to stop icon
    sendIcon.src = "assets/icons/x.svg";
    sendIcon.alt = "Stop";
    elements.sendBtn.title = "Stop";
    elements.sendBtn.classList.add("stop-mode");
  } else {
    // Change back to send icon
    sendIcon.src = "assets/icons/send.svg";
    sendIcon.alt = "Send";
    elements.sendBtn.title = "Send";
    elements.sendBtn.classList.remove("stop-mode");
  }
}

async function executePendingTools() {
  // CRITICAL: Save current tool calls to local variable and immediately reset global
  // This prevents old tool calls from accumulating when the next stream starts
  const toolCallsToProcess = [...pendingToolCalls];
  pendingToolCalls = []; // Reset immediately!

  console.log("Processing tool calls:", toolCallsToProcess);

  const toolOutputs = [];
  const messages = document.querySelectorAll(".message.assistant");
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return; // Should not happen

  // Remove typing indicator since we're now processing tools
  const typingIndicator = lastMessage.querySelector(".typing-indicator");
  if (typingIndicator) {
    typingIndicator.remove();
  }

  const contentEl = lastMessage.querySelector(".message-content");

  // Deduplicate tool calls by ID before processing
  const seenToolIds = new Set();
  const uniqueToolCalls = [];

  for (const toolCall of toolCallsToProcess) {
    const toolId = toolCall.id || `tool-${Date.now()}`;
    if (!seenToolIds.has(toolId)) {
      seenToolIds.add(toolId);
      uniqueToolCalls.push(toolCall);
    } else {
      console.log(
        "Skipping duplicate tool call in executePendingTools:",
        toolId,
      );
    }
  }

  // Tool UI blocks are already rendered inline during streaming
  // We just need to handle auto-approval or wait for user decisions

  // Auto-approve if settings allow
  if (!state.requireToolConfirmation) {
    for (const toolCall of uniqueToolCalls) {
      const toolId = toolCall.id;
      const toolName = toolCall.function.name;
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        args = {
          raw: toolCall.function.arguments,
          error: "Failed to parse arguments",
        };
      }

      const toolUi = document.getElementById(`tool-ui-${toolId}`);
      if (toolUi) {
        // Hide buttons and update status
        toolUi.querySelector(".tool-actions").style.display = "none";
        toolUi.querySelector(".tool-status-badge").className =
          "tool-status-badge executing";
        toolUi.querySelector(".tool-status-badge").textContent = "Executing";

        // Execute
        const output = await runTool(toolName, args);

        // Update UI
        toolUi.querySelector(".tool-status-badge").className =
          "tool-status-badge completed";
        toolUi.querySelector(".tool-status-badge").textContent = "Completed";

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: output,
        });
      }
    }
  }

  // If we require confirmation, we pause here basically.
  // The loop above only rendered the blocks. We need to attach listeners to process them individually?
  // OR we process them sequentially?
  // "submitToolOutputs" expects ALL outputs. So we must wait for all tools to be decided.

  if (state.requireToolConfirmation) {
    // We need to wait for user interaction for EACH tool.
    // We can wrap this in a customized promise that resolves when all decisions are made.

    const decisions = await waitForToolDecisions(uniqueToolCalls);

    for (const decision of decisions) {
      if (decision.status === "approved") {
        // Update UI to executing
        const toolUi = document.getElementById(
          `tool-ui-${decision.toolCall.id}`,
        );
        if (toolUi) {
          toolUi.querySelector(".tool-status-badge").className =
            "tool-status-badge executing";
          toolUi.querySelector(".tool-status-badge").textContent = "Executing";
          toolUi.querySelector(".tool-actions").style.display = "none";
        }

        const output = await runTool(
          decision.toolCall.function.name,
          decision.args,
        );

        // Update UI to completed
        if (toolUi) {
          toolUi.querySelector(".tool-status-badge").className =
            "tool-status-badge completed";
          toolUi.querySelector(".tool-status-badge").textContent = "Completed";
        }

        toolOutputs.push({
          tool_call_id: decision.toolCall.id,
          output: output,
        });
      } else {
        // Rejected
        toolOutputs.push({
          tool_call_id: decision.toolCall.id,
          output: { error: "User rejected tool execution" },
        });
      }
    }
  }

  elements.messagesContainer.scrollTop =
    elements.messagesContainer.scrollHeight;

  // Submit all outputs back
  console.log("Submitting tool outputs...");
  window.electronAPI.submitToolOutputs(
    toolOutputs,
    state.selectedProvider,
    state.selectedModel.id,
    state.currentConversation,
    state.workingDirectory,
  );
}

function waitForToolDecisions(toolCalls) {
  return new Promise((resolve) => {
    const results = new Array(toolCalls.length).fill(null);
    let decidedCount = 0;

    toolCalls.forEach((toolCall, index) => {
      const toolUi = document.getElementById(`tool-ui-${toolCall.id}`);
      const approveBtn = toolUi.querySelector(".approve");
      const rejectBtn = toolUi.querySelector(".reject");

      // Parse args once
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (e) { }

      const checkDone = () => {
        decidedCount++;
        if (decidedCount === toolCalls.length) {
          resolve(results);
        }
      };

      approveBtn.addEventListener("click", () => {
        results[index] = { toolCall, args, status: "approved" };
        // Disable buttons
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        toolUi.querySelector(".tool-status-badge").textContent = "Queued";
        checkDone();
      });

      rejectBtn.addEventListener("click", () => {
        results[index] = { toolCall, args, status: "rejected" };
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        toolUi.querySelector(".tool-status-badge").className =
          "tool-status-badge rejected";
        toolUi.querySelector(".tool-status-badge").textContent = "Rejected";
        toolUi.querySelector(".tool-actions").style.display = "none";
        checkDone();
      });
    });
  });
}

async function runTool(name, args) {
  try {
    console.log(`Executing tool ${name}...`, args);
    const result = await window.electronAPI.executeTool(
      name,
      args,
      state.workingDirectory,
    );
    console.log("Tool result:", result);
    return result;
  } catch (e) {
    console.error("Tool execution error:", e);
    return { error: e.message };
  }
}

function addMessage(
  role,
  content,
  id = null,
  toolCalls = null,
  toolCallId = null,
  attachments = null,
) {
  const messageId = id || `msg-${Date.now()}`;
  const avatar = role === "user" ? "U" : role === "tool" ? "T" : "A";
  const roleName =
    role === "user" ? "You" : role === "tool" ? "Tool Output" : "Assistant";

  // Handle Tool Outputs - Try to merge into existing Tool Call UI
  if (role === "tool" && toolCallId) {
    const toolUi = document.getElementById(`tool-ui-${toolCallId}`);
    if (toolUi) {
      let formattedContent = "";
      try {
        const json = JSON.parse(content);
        formattedContent = JSON.stringify(json, null, 2);
      } catch (e) {
        formattedContent = content;
      }

      // Check if output already exists to avoid duplication
      if (!toolUi.querySelector(".tool-output-section")) {
        const outputDiv = document.createElement("div");
        outputDiv.className = "tool-output-section";

        // Parse the output to check if it's a background command with PID
        let outputHtml = `<div class="tool-output-header">Output</div><pre>${formattedContent}</pre>`;

        try {
          const json = JSON.parse(content);
          if (json.pid && json.background) {
            // This is a background command - add terminate button
            outputHtml = `
              <div class="tool-output-header">
                Output
                <button class="terminate-btn" onclick="terminateProcess(${json.pid})" title="Terminate process">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                  </svg>
                  Terminate PID ${json.pid}
                </button>
              </div>
              <pre>${formattedContent}</pre>
            `;
          }
        } catch (e) {
          // Not JSON or doesn't have PID, use default
        }

        outputDiv.innerHTML = outputHtml;
        // Append to toolUi
        toolUi.appendChild(outputDiv);

        // Mark as completed if not already (safeguard)
        const statusBadge = toolUi.querySelector(".tool-status-badge");
        if (statusBadge) {
          statusBadge.textContent = "Completed";
          statusBadge.className = "tool-status-badge completed";
        }
        const actions = toolUi.querySelector(".tool-actions");
        if (actions) actions.style.display = "none";
      }
      return; // Helper return: Don't render separate message for tool output if merged
    }
  }

  // Determine if we should hide the header (grouping messages)
  let hideHeader = false;
  const lastMsg = elements.messagesContainer.lastElementChild;

  if (role === "tool") {
    hideHeader = true; // Always hide tool output headers
  } else if (role === "assistant") {
    // Hide if previous message was assistant or tool (visual grouping)
    if (
      lastMsg &&
      (lastMsg.classList.contains("assistant") ||
        lastMsg.classList.contains("tool"))
    ) {
      hideHeader = true;
    }
  }

  const messageEl = document.createElement("div");
  messageEl.className = `message ${role} ${hideHeader ? "no-header" : ""}`;
  messageEl.id = messageId;

  let contentHtml = "";
  if (
    role === "assistant" &&
    !content &&
    (!toolCalls || toolCalls.length === 0)
  ) {
    contentHtml =
      '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
  } else if (role === "tool") {
    // Format tool output (usually JSON)
    try {
      const json = JSON.parse(content);
      contentHtml = `<pre class="tool-output-block">${JSON.stringify(json, null, 2)}</pre>`;
    } catch (e) {
      contentHtml = `<pre class="tool-output-block">${content}</pre>`;
    }
  } else {
    contentHtml = formatContent(content);
  }

  // Render attachments if present
  let attachmentsHtml = "";
  if (attachments && attachments.length > 0) {
    attachmentsHtml = `<div class="message-attachments">`;
    for (const att of attachments) {
      if (att.mimeType.startsWith("image/")) {
        attachmentsHtml += `
                    <div class="message-attachment image">
                        <img src="data:${att.mimeType};base64,${att.content}" alt="${att.name}" onclick="window.open('data:${att.mimeType};base64,${att.content}')">
                    </div>
                `;
      } else {
        attachmentsHtml += `
                    <div class="message-attachment file">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>
                        <span>${att.name}</span>
                    </div>
                `;
      }
    }
    attachmentsHtml += `</div>`;
  }

  messageEl.innerHTML = `
    <div class="message-header">
      <div class="message-avatar">${avatar}</div>
      <div class="message-role">${roleName}</div>
    </div>
    <div class="message-content" id="${messageId}-content">
      ${contentHtml}
      ${attachmentsHtml}
    </div>
  `;

  elements.messagesContainer.appendChild(messageEl);
  elements.messagesContainer.scrollTop =
    elements.messagesContainer.scrollHeight;

  // Render tool calls if present (for history or new messages)
  if (toolCalls && toolCalls.length > 0) {
    renderToolCallsInline(toolCalls);

    // If this is history loading (implied by content being present or just by logic),
    // we should mark tools as completed and hide actions if they are old.
    // A simple heuristic: if we are not streaming, assume executed.
    if (!state.isStreaming) {
      toolCalls.forEach((tc) => {
        const toolUi = document.getElementById(`tool-ui-${tc.id}`);
        if (toolUi) {
          const statusBadge = toolUi.querySelector(".tool-status-badge");
          if (statusBadge) {
            statusBadge.textContent = "Completed";
            statusBadge.className = "tool-status-badge completed";
          }
          const actions = toolUi.querySelector(".tool-actions");
          if (actions) actions.style.display = "none";

          // Auto-collapse completed tools in history
          toolUi.classList.add("collapsed");
        }
      });
    }
  }

  // Update layout when message is added
  updateLayout();

  return messageId;
}

function formatContent(content) {
  if (!content) return "";

  // Simple markdown-like formatting
  let formatted = content
    .replace(/\n/g, "<br>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/```([\s\S]+?)```/g, "<pre><code>$1</code></pre>");

  return formatted;
}

// ===== Conversation Management =====
async function createNewConversation() {
  try {
    const conversation = await window.electronAPI.createConversation();
    state.currentConversation = conversation.id;
    elements.messagesContainer.innerHTML = "";

    // Show header for new conversation
    const chatHeader = document.querySelector(".chat-header");
    if (chatHeader) {
      chatHeader.classList.remove("hidden");
    }
  } catch (error) {
    console.error("Failed to create conversation:", error);
  }
}

async function loadConversations() {
  try {
    state.conversations = await window.electronAPI.getAllConversations();
    displayConversations();
  } catch (error) {
    console.error("Failed to load conversations:", error);
  }
}

function displayConversations() {
  if (state.conversations.length === 0) {
    elements.conversationsList.innerHTML =
      '<p class="no-models">No conversations yet</p>';
    return;
  }

  elements.conversationsList.innerHTML = state.conversations
    .map((conv) => {
      const preview =
        conv.messages[0]?.content?.substring(0, 100) || "New conversation";
      const date = new Date(
        conv.updatedAt || conv.createdAt,
      ).toLocaleDateString();

      return `
      <div class="conversation-item" data-conversation-id="${conv.id}">
        <div class="conversation-info">
          <div class="conversation-preview">${preview}</div>
          <div class="conversation-date">${date}</div>
        </div>
        <button class="delete-conversation" data-conversation-id="${conv.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
    })
    .join("");

  // Add event listeners
  document.querySelectorAll(".conversation-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (!e.target.closest(".delete-conversation")) {
        loadConversation(item.dataset.conversationId);
      }
    });
  });

  document.querySelectorAll(".delete-conversation").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const conversationId = btn.dataset.conversationId;
      await deleteConversation(conversationId);
    });
  });
}

async function loadConversation(conversationId) {
  try {
    const conversation =
      await window.electronAPI.getConversationHistory(conversationId);
    state.currentConversation = conversationId;

    // Clear and populate messages
    elements.messagesContainer.innerHTML = "";
    conversation.messages.forEach((msg) => {
      addMessage(
        msg.role,
        msg.content,
        null,
        msg.tool_calls,
        msg.tool_call_id,
        msg.attachments,
      );
    });

    // Hide header if conversation has messages
    const chatHeader = document.querySelector(".chat-header");
    if (chatHeader) {
      if (conversation.messages.length > 0) {
        chatHeader.classList.add("hidden");
      } else {
        chatHeader.classList.remove("hidden");
      }
    }

    switchView("chat");
  } catch (error) {
    console.error("Failed to load conversation:", error);
  }
}

async function deleteConversation(conversationId) {
  try {
    await window.electronAPI.deleteConversation(conversationId);
    await loadConversations();

    if (state.currentConversation === conversationId) {
      await createNewConversation();
    }
  } catch (error) {
    console.error("Failed to delete conversation:", error);
  }
}

// ===== Utilities =====
function updateGreeting() {
  const hour = new Date().getHours();
  let greeting = "How can I help you today?";

  if (hour >= 5 && hour < 12) {
    greeting = "Good morning! How can I help you today?";
  } else if (hour >= 12 && hour < 17) {
    greeting = "Good afternoon! How can I help you today?";
  } else if (hour >= 17 && hour < 21) {
    greeting = "Good evening! How can I help you today?";
  } else {
    greeting = "Good night! Still working? How can I help you?";
  }

  const greetingEl = document.getElementById("greeting");
  if (greetingEl) greetingEl.textContent = greeting;
}

function showNotification(message, type = "info") {
  // Simple notification system - could be enhanced
  console.log(`[${type.toUpperCase()}] ${message}`);

  // You could add a toast notification here
  const notification = document.createElement("div");
  notification.className = `${type}-message`;
  notification.textContent = message;
  notification.style.position = "fixed";
  notification.style.top = "20px";
  notification.style.right = "20px";
  notification.style.zIndex = "10000";
  notification.style.minWidth = "300px";

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function updateLayout() {
  const hasMessages = elements.messagesContainer.children.length > 0;

  if (hasMessages) {
    elements.chatContainer.classList.remove("centered");
    elements.chatContainer.classList.add("has-messages");
  } else {
    elements.chatContainer.classList.remove("has-messages");
    elements.chatContainer.classList.add("centered");
  }
}

// ===== Editor Management =====
async function initEditor() {
  if (!state.isMonacoLoaded) {
    await loadMonaco();
    state.isMonacoLoaded = true;
  }

  // Initialize terminal if not already initialized (non-blocking)
  if (!state.terminalInstance) {
    initTerminal().catch((err) => {
      console.error("Terminal initialization failed:", err);
      // Don't block editor from working if terminal fails
    });
  }

  // Refresh file list when switching to editor view
  if (state.workingDirectory) {
    await loadFiles();
  }

  // Layout editor if it exists
  if (state.editorInstance) {
    setTimeout(() => state.editorInstance.layout(), 100);
  }
}

let monacoLoadingPromise = null;

function loadMonaco() {
  if (monacoLoadingPromise) return monacoLoadingPromise;

  monacoLoadingPromise = new Promise((resolve, reject) => {
    if (window.monaco) {
      resolve();
      return;
    }

    // Check if require.config has already been called
    if (
      !window.require ||
      !window.require.s ||
      !window.require.s.contexts ||
      !window.require.s.contexts._.config.paths.vs
    ) {
      require.config({
        paths: {
          vs: "../../node_modules/monaco-editor/min/vs",
        },
      });
    }

    require(["vs/editor/editor.main"], function () {
      createEditor();
      resolve();
    });
  });

  return monacoLoadingPromise;
}

function createEditor() {
  state.editorInstance = monaco.editor.create(elements.monacoContainer, {
    value: "// Select a file to view or edit",
    language: "javascript",
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 14,
    fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace",
    scrollBeyondLastLine: false,
    padding: { top: 16, bottom: 16 },
    scrollbar: {
      useShadows: false,
      verticalHasArrows: false,
      horizontalHasArrows: false,
      vertical: "visible",
      horizontal: "visible",
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
    },
  });

  // Add save command (Ctrl+S / Cmd+S)
  state.editorInstance.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    async () => {
      await saveCurrentFile();
    },
  );

  // Add autosave on content change
  state.editorInstance.onDidChangeModelContent(() => {
    if (!state.currentFile || !state.autosaveEnabled) return;

    state.hasUnsavedChanges = true;

    // Clear existing timeout
    if (state.autosaveTimeout) {
      clearTimeout(state.autosaveTimeout);
    }

    // Set new timeout for autosave
    state.autosaveTimeout = setTimeout(async () => {
      if (state.hasUnsavedChanges && state.currentFile) {
        await saveCurrentFile(true); // true = silent autosave
      }
    }, state.autosaveDelay);
  });
}

async function saveCurrentFile(silent = false) {
  if (!state.currentFile) return;

  try {
    const content = state.editorInstance.getValue();
    await window.electronAPI.writeFile(state.currentFile, content);
    state.hasUnsavedChanges = false;
    if (!silent) {
      showNotification("File saved successfully", "success");
    }
  } catch (error) {
    console.error("Failed to save file:", error);
    showNotification("Failed to save file", "error");
  }
}

async function loadFiles() {
  if (!state.workspaceRoot) {
    elements.fileList.innerHTML =
      '<div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 13px;">No workspace selected. Please select a directory to begin.</div>';
    return;
  }

  try {
    console.log("Explorer: Loading", state.workspaceRoot);

    if (elements.workspaceRootPath) {
      elements.workspaceRootPath.textContent = `Scanning: ${state.workspaceRoot}...`;
    }

    // Show loading state
    elements.fileList.innerHTML =
      '<div style="padding: 20px; text-align: center; color: #fff; font-size: 13px;">Scanning directory...</div>';

    // Root container for tree
    const rootContainer = document.createElement("div");
    rootContainer.className = "tree-container";
    rootContainer.style.width = "100.0%";

    // Do the scan
    const fileCount = await renderTree(state.workspaceRoot, rootContainer, 0);

    elements.fileList.innerHTML = "";
    if (fileCount === 0) {
      elements.fileList.innerHTML =
        '<div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 13px;">Folder is empty</div>';
    } else {
      elements.fileList.appendChild(rootContainer);
      if (elements.workspaceRootPath) {
        elements.workspaceRootPath.textContent = `${state.workspaceRoot} (${fileCount} items)`;
      }
    }
    console.log("Explorer: Loaded", fileCount, "items");
  } catch (error) {
    console.error("Explorer Critical Error:", error);
    elements.fileList.innerHTML = `<div style="padding: 20px; color: #ef4444; font-size: 11px;">CRITICAL EXPLORER ERROR: ${error.message}</div>`;
  }
}

async function renderTree(dirPath, container, depth) {
  let totalItems = 0;
  try {
    console.log(`renderTree: Reading ${dirPath} at depth ${depth}`);
    // UI Feedback for deep folders
    if (elements.workspaceRootPath) {
      elements.workspaceRootPath.textContent = `Reading: ${dirPath.split(/[\\/]/).pop()}...`;
    }

    const files = await window.electronAPI.readDir(dirPath);
    if (!files || files.length === 0) {
      console.log("renderTree: No files returned");
      return 0;
    }

    console.log(`renderTree: Got ${files.length} files from ${dirPath}`);
    totalItems = files.length;

    // Sort: Directories first, then alphabetically
    files.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
      return a.isDirectory ? -1 : 1;
    });

    for (const file of files) {
      const isExpanded = state.directoryStates[file.path];
      const isSelected = state.selectedPaths.includes(file.path);

      const item = document.createElement("div");
      item.setAttribute("data-path", file.path);
      item.className = `file-item ${state.currentFile === file.path ? "active" : ""} ${isSelected ? "selected" : ""}`;
      item.style.paddingLeft = `${depth * 14 + 16}px`;

      const iconSvg = file.isDirectory
        ? `<svg class="tree-icon ${isExpanded ? "rotated" : ""}" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;

      const folderIcon = file.isDirectory
        ? `<svg class="folder-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
        : "";

      item.innerHTML = `
                <span class="file-icon">${iconSvg}</span>
                ${folderIcon}
                <span class="file-name">${file.name}</span>
            `;

      // Click handling (selection & expansion)
      item.addEventListener("click", async (e) => {
        e.stopPropagation();

        if (e.ctrlKey || e.metaKey) {
          // Multiselect toggle
          if (state.selectedPaths.includes(file.path)) {
            state.selectedPaths = state.selectedPaths.filter(
              (p) => p !== file.path,
            );
          } else {
            state.selectedPaths.push(file.path);
          }
          loadFiles(); // Refresh UI
        } else {
          // Single select
          state.selectedPaths = [file.path];

          if (file.isDirectory) {
            toggleDirectory(file.path);
          } else {
            openFile(file.path);
          }
        }
      });

      // Right click handling
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.pageX, e.pageY, file.path);
      });

      console.log(`renderTree: Appending item for ${file.name}`);
      container.appendChild(item);

      if (file.isDirectory && isExpanded) {
        const subContainer = document.createElement("div");
        subContainer.className = "tree-sub-container";
        container.appendChild(subContainer);
        const subItems = await renderTree(file.path, subContainer, depth + 1);
        totalItems += subItems;
      }
    }

    console.log(
      `renderTree: Finished ${dirPath}, appended ${files.length} items to container`,
    );
    console.log(
      `renderTree: Container now has ${container.children.length} children`,
    );
  } catch (e) {
    console.error("Tree render error:", e);
  }
  return totalItems;
}

function toggleDirectory(dirPath) {
  state.directoryStates[dirPath] = !state.directoryStates[dirPath];
  loadFiles(); // Re-render tree to show/hide sub-items
}

// ===== Context Menu Logic =====
function showContextMenu(x, y, path) {
  state.contextMenuPath = path;

  // Position menu
  elements.contextMenu.style.left = `${x}px`;
  elements.contextMenu.style.top = `${y}px`;
  elements.contextMenu.style.display = "block";

  // If multiple are selected, maybe disable rename? Or rename bulk?
  // For now, let's just use the clicked path as target and clear others if not included
  if (!state.selectedPaths.includes(path)) {
    state.selectedPaths = [path];
    loadFiles();
  }
}

function hideContextMenu() {
  elements.contextMenu.style.display = "none";
}

async function handleRename() {
  const oldPath = state.contextMenuPath;
  if (!oldPath) return;

  const oldName = oldPath.split(/[\\/]/).pop();

  // Show rename modal
  elements.renameInput.value = oldName;
  elements.renameModal.style.display = "flex";

  // Focus and select the filename (without extension)
  setTimeout(() => {
    elements.renameInput.focus();
    const dotIndex = oldName.lastIndexOf(".");
    if (dotIndex > 0) {
      elements.renameInput.setSelectionRange(0, dotIndex);
    } else {
      elements.renameInput.select();
    }
  }, 100);
}

function closeRenameModal() {
  elements.renameModal.style.display = "none";
  elements.renameInput.value = "";
}

async function confirmRename() {
  const oldPath = state.contextMenuPath;
  if (!oldPath) return;

  const oldName = oldPath.split(/[\\/]/).pop();
  const newName = elements.renameInput.value.trim();

  if (!newName || newName === oldName) {
    closeRenameModal();
    return;
  }

  try {
    const parentDir = await window.electronAPI.getParentDir(oldPath);
    const separator = oldPath.includes("\\") ? "\\" : "/";
    const newPath = parentDir.endsWith(separator)
      ? parentDir + newName
      : parentDir + separator + newName;

    await window.electronAPI.renameFile(oldPath, newPath);
    showNotification("Renamed successfully", "success");

    // If the renamed file was the open one, update state
    if (state.currentFile === oldPath) {
      state.currentFile = newPath;
    }

    state.selectedPaths = [newPath];
    closeRenameModal();
    loadFiles();
  } catch (error) {
    console.error("Rename failed:", error);
    showNotification("Rename failed: " + error.message, "error");
  }
}

async function handleDelete() {
  const pathsToDelete =
    state.selectedPaths.length > 0
      ? state.selectedPaths
      : [state.contextMenuPath];
  if (pathsToDelete.length === 0) return;

  const confirmMsg =
    pathsToDelete.length === 1
      ? `Are you sure you want to delete ${pathsToDelete[0].split(/[\\/]/).pop()}?`
      : `Are you sure you want to delete ${pathsToDelete.length} items?`;

  if (confirm(confirmMsg)) {
    try {
      for (const path of pathsToDelete) {
        await window.electronAPI.deleteFile(path);
      }
      showNotification("Deleted successfully", "success");
      state.selectedPaths = []; // Clear selection
      loadFiles();
    } catch (error) {
      console.error("Delete failed:", error);
      showNotification("Delete failed", "error");
    }
  }
}

async function selectWorkspace() {
  try {
    const result = await window.electronAPI.selectDirectory();
    if (result && !result.canceled && result.filePaths.length > 0) {
      const newRoot = result.filePaths[0];
      state.workspaceRoot = newRoot;
      state.workingDirectory = newRoot;
      state.directoryStates = {}; // Reset expansion state for new project

      elements.workingDirPath.textContent = newRoot;
      elements.workingDirPath.title = newRoot;

      showNotification(`Workspace changed to: ${newRoot}`, "success");
      loadFiles();
      validateWorkingDirectory(newRoot);
    }
  } catch (error) {
    console.error("Failed to select workspace:", error);
    showNotification("Failed to change workspace", "error");
  }
}

async function changeDirectory(newPath) {
  // Boundary check: Don't allow going above workspaceRoot
  if (!newPath.startsWith(state.workspaceRoot)) {
    console.warn("Blocked attempt to navigate beyond workspace root");
    showNotification("Navigation restricted to workspace root", "warning");
    return;
  }

  state.workingDirectory = newPath;
  elements.workingDirPath.textContent = newPath;
  elements.workingDirPath.title = newPath;
  // For tree view, changing directory might not be needed in the same way,
  // but we keep it for Cog's CWD awareness.
}

async function openFile(filePath) {
  console.log("Opening file:", filePath);
  try {
    const content = await window.electronAPI.readFile(filePath);
    console.log("File read result type:", typeof content);
    console.log("File content length:", content ? content.length : "null");

    state.currentFile = filePath;

    const language = getFileLanguage(filePath);
    console.log("Detected language:", language);

    if (state.editorInstance) {
      console.log("Editor instance exists");
      const model = state.editorInstance.getModel();
      if (model) {
        console.log("Setting model language and value");
        monaco.editor.setModelLanguage(model, language);
        state.editorInstance.setValue(content || "");
      } else {
        console.error("Editor model is null");
      }
    } else {
      console.error("Editor instance is null");
      showNotification("Editor not ready", "error");
    }

    // Update active state in list
    document.querySelectorAll(".file-item").forEach((item) => {
      item.classList.remove("active");
      if (item.getAttribute("data-path") === filePath) {
        item.classList.add("active");
      }
    });

    // Ensure current file is selected in multiselect logic
    if (!state.selectedPaths.includes(filePath)) {
      state.selectedPaths = [filePath];
      loadFiles();
    }
  } catch (error) {
    console.error("Failed to open file:", error);
    showNotification("Failed to open file", "error");
  }
}

function getFileLanguage(filePath) {
  const ext = filePath.split(".").pop().toLowerCase();
  const map = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    html: "html",
    css: "css",
    json: "json",
    md: "markdown",
    py: "python",
    c: "c",
    cpp: "cpp",
    java: "java",
    go: "go",
    rs: "rust",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
  };
  return map[ext] || "plaintext";
}

// ===== Terminal Management =====
let terminalInstance = null;
let fitAddon = null;

async function initTerminal() {
  try {
    console.log("Initializing terminal...");

    // 1. If terminal already exists, just fit and focus (Singleton Pattern)
    if (state.terminalInstance) {
      console.log("Terminal already initialized, reusing instance...");
      if (fitAddon) {
        fitAddon.fit();
        setTimeout(() => {
          const dims = fitAddon.proposeDimensions();
          if (dims && dims.cols > 0 && dims.rows > 0) {
            window.electronAPI.resizeTerminal(dims.cols, dims.rows);
          }
        }, 100);
      }
      state.terminalInstance.focus();
      return;
    }

    // 2. Initial Setup
    // Check if xterm is loaded from local files
    if (!window.Terminal || !window.FitAddon) {
      throw new Error(
        "XTerm libraries not loaded. Terminal: " +
        typeof window.Terminal +
        ", FitAddon: " +
        typeof window.FitAddon,
      );
    }

    console.log("✓ XTerm libraries available");

    const terminalElement = document.getElementById("terminal");
    if (!terminalElement) {
      console.error("Terminal element not found");
      return;
    }

    // Create terminal instance using global Terminal
    terminalInstance = new window.Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace",
      theme: {
        background: "#0f0f0f",
        foreground: "#e8e8e8",
        cursor: "#d87d5a",
        cursorAccent: "#0f0f0f",
        selectionBackground: "#d87d5a33",
        black: "#000000",
        red: "#ef4444",
        green: "#10b981",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e5e7eb",
        brightBlack: "#6b7280",
        brightRed: "#f87171",
        brightGreen: "#34d399",
        brightYellow: "#fbbf24",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#f9fafb",
      },
      allowProposedApi: true,
    });

    // Handle Copy/Paste
    terminalInstance.attachCustomKeyEventHandler((arg) => {
      if (arg.type !== "keydown") {
        return true;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

      // Copy: Ctrl+Shift+C (Win/Linux) or Cmd+C (Mac)
      const isCopy = isMac
        ? (arg.metaKey && arg.code === "KeyC")
        : (arg.ctrlKey && arg.shiftKey && arg.code === "KeyC");

      // Paste: Ctrl+Shift+V (Win/Linux) or Cmd+V (Mac)
      const isPaste = isMac
        ? (arg.metaKey && arg.code === "KeyV")
        : (arg.ctrlKey && arg.shiftKey && arg.code === "KeyV");

      if (isCopy) {
        const selection = terminalInstance.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
          return false;
        }
      }

      if (isPaste) {
        navigator.clipboard.readText().then((text) => {
          terminalInstance.paste(text);
        });
        return false;
      }

      return true;
    });

    // Add fit addon using global FitAddon
    console.log("FitAddon type:", typeof window.FitAddon);
    console.log("FitAddon keys:", Object.keys(window.FitAddon || {}));

    let FitAddonClass = window.FitAddon;
    if (typeof FitAddonClass !== 'function' && FitAddonClass.FitAddon) {
      FitAddonClass = FitAddonClass.FitAddon;
    }

    fitAddon = new FitAddonClass();
    terminalInstance.loadAddon(fitAddon);

    // Open terminal in container
    terminalInstance.open(terminalElement);
    fitAddon.fit();

    // Handle terminal input
    terminalInstance.onData((data) => {
      window.electronAPI.writeToTerminal(data);
    });

    state.terminalInstance = terminalInstance; // Set instance before spawning shell to capture initial output

    // Create terminal process
    const terminalResult = await window.electronAPI.createTerminal(state.workingDirectory);
    console.log("Terminal creation result:", terminalResult);

    if (!terminalResult || !terminalResult.success) {
      throw new Error(
        terminalResult?.error || "Failed to create terminal process",
      );
    }

    console.log("Terminal process created with shell:", terminalResult.shell);



    // Fit terminal when switching to editor view
    setTimeout(() => {
      if (fitAddon) {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && dims.cols > 0 && dims.rows > 0) {
          window.electronAPI.resizeTerminal(dims.cols, dims.rows);
        }
      }
    }, 300);

    console.log("Terminal initialized successfully");
  } catch (error) {
    console.error("Failed to initialize terminal:", error);
    // Show notification but don't break the app
    const terminalContainer = document.getElementById("terminal-container");
    if (terminalContainer) {
      terminalContainer.innerHTML = `
        <div class="terminal-header">
          <span class="terminal-title">Terminal (Unavailable)</span>
        </div>
        <div style="padding: 20px; color: var(--text-tertiary); text-align: center;">
          Failed to initialize terminal: ${error.message}
          <br><br>
          Try restarting the application or check the console for details.
        </div>
      `;
    }
  }
}

// ===== Process Management =====
window.terminateProcess = async function (pid) {
  try {
    const result = await window.electronAPI.executeTool('kill_process', { pid });
    if (result.success) {
      showNotification(`Process ${pid} terminated successfully`, 'success');
    } else {
      showNotification(`Failed to terminate process: ${result.error}`, 'error');
    }
  } catch (error) {
    showNotification(`Error terminating process: ${error.message}`, 'error');
  }
};

// ===== Start Application =====
// Wait for DOM to be fully loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  // DOM is already loaded
  init();
}
