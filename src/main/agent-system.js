const fs = require('fs').promises;

// Polyfill File for Electron/Node environment (fixes undici/cheerio error)
if (typeof global.File === 'undefined') {
    const { Blob } = require('buffer');
    class File extends Blob {
        constructor(sources, name, options) {
            super(sources, options);
            this.name = name;
            this.lastModified = options?.lastModified || Date.now();
        }
    }
    global.File = File;
    global.File.prototype[Symbol.toStringTag] = 'File';
}

const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');
const util = require('util');
const axios = require('axios');
const cheerio = require('cheerio');

const execPromise = util.promisify(exec);

const SYSTEM_PROMPT = `
You are **Cog**, an advanced agentic AI coding assistant developed by **Cognautic**, integrated into the **Cognautic Desktop** environment.
Your primary function is to assist users with complex coding tasks, file system operations, and command execution directly on their machine.

**Your Capabilities & Tools:**
- **File Systems**: You can read, write, edit (single or multiple chunks), delete, and list files and directories.
- **Terminal Execution**: You can execute shell commands.
- **Knowledge**: You have access to the user's local codebase and environment.

**Core Directives:**
1.  **Identity**: You are "Cog". You are helpful, precise, and agentic. **DO NOT** prefix your responses with "Cog:" or "Assistant:". Just speak directly.
2.  **Proactiveness**: Don't just answer; DO. If a user asks to "make a react app", use your tools to actually run the commands and create files.
3.  **Completeness**: **ALWAYS** complete the task given by the user. Do not leave work incomplete. If a task requires multiple steps (like creating a file and then running it), perform ALL steps.
4.  **Speed & Efficiency**: **AVOID** \`npx create-react - app\` as it is slow and bloated. Instead, manually create the folder structure and files (\`package.json\`, \`index.html\`, \`src / App.js\` etc.) using your file tools. This gives you more control and is much faster.
5.  **Parallelism**: If you start a background task (like \`npm install\`), **IMMEDIATELY** continue working. Do not wait for it to finish. Create the other files (components, styles) *while* the installation runs in the background.
6.  **Safety**: Be careful with destructive commands (rm -rf).

**HYPER-CRITICAL RULE FOR COMMAND EXECUTION:**
1.  **Analyze the command duration**: Will this command take more than 5 seconds? (e.g., 'npm start', 'npm install', 'python server.py').
2.  **IF YES**: You **MUST** use the \`execute_command\` tool with \`background: true\`.
3.  **IF NO**: Use default (background: false).
4.  **Confirm**: If you start a background process, explicitly inform the user of the **PID**.

**Examples requiring \`background: true\`:**
- \`npm run dev\` / \`npm start\`
- \`npm install\`
- \`node server.js\`
- \`pip install <package>\`
- \`git clone <url>\`
`;

class AgentSystem {
    constructor() {
        this.configDir = path.join(os.homedir(), '.cognautic');
        this.configFile = path.join(this.configDir, 'config.json');
        this.conversationsDir = path.join(this.configDir, 'conversations');
        this.memoryFile = path.join(this.configDir, 'memory.json');
        this.apiKeys = {};
        this.settings = { requireToolConfirmation: true }; // Default setting
        this.memory = {};
        this.conversations = {};
        this.runningProcesses = new Map();
        this.modelCapabilities = new Map(); // Track capabilities like tool support
        this.init();
    }

    async init() {
        try {
            await fs.mkdir(this.configDir, { recursive: true });
            await fs.mkdir(this.conversationsDir, { recursive: true });
            await this.loadConfig();
            await this.loadMemory();
        } catch (error) {
            console.error('Failed to initialize agent system:', error);
        }
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(this.configFile, 'utf8');
            const config = JSON.parse(data);
            this.apiKeys = config.apiKeys || {};
            this.settings = { ...this.settings, ...(config.settings || {}) };
        } catch (error) {
            // Config file doesn't exist yet, will be created on first save
            this.apiKeys = {};
        }
    }

    async saveConfig() {
        const config = {
            apiKeys: this.apiKeys,
            settings: this.settings
        };
        await fs.writeFile(this.configFile, JSON.stringify(config, null, 2));
    }

    async loadMemory() {
        try {
            const data = await fs.readFile(this.memoryFile, 'utf8');
            this.memory = JSON.parse(data);
        } catch (error) {
            this.memory = {};
        }
    }

    async saveMemory() {
        await fs.writeFile(this.memoryFile, JSON.stringify(this.memory, null, 2));
    }

    getApiKeys() {
        return this.apiKeys;
    }

    async saveApiKey(provider, apiKey) {
        this.apiKeys[provider] = apiKey;
        await this.saveConfig();
        return { success: true };
    }

    getSettings() {
        return this.settings;
    }

    async saveSettings(settings) {
        this.settings = { ...this.settings, ...settings };
        await this.saveConfig();
        return { success: true };
    }

    async fetchModels(provider) {
        let apiKey;

        // Ollama doesn't need an API key (local)
        if (provider !== 'ollama') {
            apiKey = this.apiKeys[provider];
            if (!apiKey) {
                throw new Error(`No API key configured for ${provider}`);
            }
        }

        try {
            let models = [];

            switch (provider) {
                case 'google':
                    models = await this.fetchGoogleModels(apiKey);
                    break;
                case 'openai':
                    models = await this.fetchOpenAIModels(apiKey);
                    break;
                case 'customopenai':
                    models = await this.fetchCustomOpenAIModels(apiKey);
                    break;
                case 'anthropic':
                    models = await this.fetchAnthropicModels(apiKey);
                    break;
                case 'openrouter':
                    models = await this.fetchOpenRouterModels(apiKey);
                    break;
                case 'together':
                    models = await this.fetchTogetherModels(apiKey);
                    break;
                case 'ollama':
                    models = await this.fetchOllamaModels();
                    break;
                default:
                    throw new Error(`Unknown provider: ${provider}`);
            }

            return models;
        } catch (error) {
            const detailedError = await this.getDetailedError(error);
            console.error(`Error fetching models for ${provider}:`, detailedError);
            throw new Error(`Failed to fetch ${provider} models: ${detailedError}`);
        }
    }

    async fetchGoogleModels(apiKey) {
        const response = await axios.get(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        return response.data.models
            .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
            .map(m => ({
                id: m.name.replace('models/', ''),
                name: m.displayName || m.name,
                provider: 'google',
                supportsTools: true // Most Gemini models in v1beta support tools
            }));
    }

    async fetchOpenAIModels(apiKey) {
        const response = await axios.get('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        return response.data.data
            .filter(m => m.id.includes('gpt'))
            .map(m => ({
                id: m.id,
                name: m.id,
                provider: 'openai',
                supportsTools: m.id.includes('gpt-4') || m.id.includes('gpt-3.5') // Standard OpenAI models support tools
            }));
    }

    getCustomOpenAIBaseUrl() {
        const rawBase = this.apiKeys.customopenai_base || 'https://api.openai.com/v1';
        return rawBase.replace(/\/+$/, '');
    }

    async fetchCustomOpenAIModels(apiKey) {
        const baseUrl = this.getCustomOpenAIBaseUrl();
        const response = await axios.get(`${baseUrl}/models`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        return (response.data.data || [])
            .map(m => ({
                id: m.id,
                name: m.id,
                provider: 'customopenai',
                supportsTools: true
            }));
    }

    async fetchAnthropicModels(apiKey) {
        // Anthropic doesn't have a models endpoint, return known models
        return [
            { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', supportsTools: true },
            { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', supportsTools: true },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', supportsTools: true },
            { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', provider: 'anthropic', supportsTools: true },
            { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'anthropic', supportsTools: true }
        ];
    }

    async fetchOpenRouterModels(apiKey) {
        const response = await axios.get('https://openrouter.ai/api/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'http://localhost',
                'X-Title': 'Cognautic Desktop'
            }
        });

        const models = response.data.data.map(m => {
            // Check if model supports tools based on supported_parameters
            // Some models have 'tools' or 'function_calling' in supported_parameters
            const supportsTools = m.supported_parameters?.includes('tools') ||
                m.supported_parameters?.includes('function_calling');

            const modelInfo = {
                id: m.id,
                name: m.name || m.id,
                provider: 'openrouter',
                supportsTools
            };

            // Cache capability
            this.modelCapabilities.set(m.id, { supportsTools });

            return modelInfo;
        });

        return models;
    }

    async fetchTogetherModels(apiKey) {
        const response = await axios.get('https://api.together.xyz/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        return response.data
            .filter(m => m.type === 'chat')
            .map(m => ({
                id: m.id,
                name: m.display_name || m.id,
                provider: 'together',
                supportsTools: true // Most together chat models we care about support tools
            }));
    }

    async fetchOllamaModels() {
        // Get endpoint from config or use default (use 127.0.0.1 to avoid ipv6 issues)
        const endpoint = this.apiKeys.ollama || 'http://127.0.0.1:11434';

        try {
            const response = await axios.get(`${endpoint}/api/tags`);
            return response.data.models.map(m => ({
                id: m.name,
                name: m.name,
                provider: 'ollama',
                supportsTools: true // Ollama models support function calling
            }));
        } catch (error) {
            throw new Error(`Failed to connect to Ollama at ${endpoint}. Make sure Ollama is running.`);
        }
    }

    async streamMessage(message, attachments, provider, model, conversationId, onChunk, onError, onComplete) {
        console.log('=== STREAM MESSAGE CALLED ===');
        console.log('Provider:', provider);
        console.log('Model:', model);
        console.log('Message:', message);
        console.log('Attachments count:', attachments ? attachments.length : 0);
        console.log('Conversation ID:', conversationId);

        const apiKey = this.apiKeys[provider];
        if (!apiKey) {
            console.error('No API key for provider:', provider);
            onError('No API key configured for ' + provider);
            return;
        }
        console.log('API key found for provider:', provider);

        if (!model) {
            console.error('No model selected');
            onError('No model explicitly selected or missing model ID');
            return;
        }

        try {
            // Get conversation history
            const conversation = await this.getConversationHistory(conversationId);
            const messages = conversation.messages || [];
            console.log('Loaded conversation with', messages.length, 'messages');

            // Add user message with attachments
            const userMsg = { role: 'user', content: message };
            if (attachments && attachments.length > 0) {
                userMsg.attachments = attachments;
            }
            messages.push(userMsg);
            console.log('Added user message to conversation');

            // Save user message immediately
            await this.saveConversation(conversationId, messages);
            console.log('Saved user message to conversation');

            await this._streamResponse(messages, provider, model, conversationId, apiKey, onChunk, onError, onComplete);
        } catch (error) {
            console.error('Stream error:', error);
            onError(error.message || 'Failed to stream response');
        }
    }

    async submitToolOutputs(toolOutputs, provider, model, conversationId, onChunk, onError, onComplete) {
        console.log('=== SUBMIT TOOL OUTPUTS ===');
        console.log('Tool Outputs:', toolOutputs);

        const apiKey = this.apiKeys[provider];
        if (!apiKey) {
            onError('No API key configured for ' + provider);
            return;
        }

        try {
            const conversation = await this.getConversationHistory(conversationId);
            const messages = conversation.messages || [];

            // Add tool outputs
            for (const output of toolOutputs) {
                messages.push({
                    role: 'tool',
                    tool_call_id: output.tool_call_id,
                    content: typeof output.output === 'string' ? output.output : JSON.stringify(output.output)
                });
            }
            await this.saveConversation(conversationId, messages);

            await this._streamResponse(messages, provider, model, conversationId, apiKey, onChunk, onError, onComplete);
        } catch (error) {
            console.error('Tool output submission error:', error);
            onError(error.message || 'Failed to submit tool outputs');
        }
    }

    async _streamResponse(messages, provider, model, conversationId, apiKey, onChunk, onError, onComplete) {
        let fullResponse = '';
        let toolCalls = [];

        // Wrapper for onChunk to accumulate response
        const chunkWrapper = (chunk) => {
            console.log('Chunk received:', chunk);
            if (chunk.type === 'content') {
                fullResponse += chunk.content;
                console.log('Accumulated response length:', fullResponse.length);
            } else if (chunk.type === 'tool_call') {
                if (chunk.toolCalls) {
                    toolCalls = this.mergeToolCalls(toolCalls, chunk.toolCalls);
                }
            }
            onChunk(chunk);
        };

        // Wrapper for onComplete to save assistant response
        const completeWrapper = async () => {
            console.log('Stream complete. Full response length:', fullResponse.length);
            console.log('Tool calls count:', toolCalls.length);

            const newMessage = { role: 'assistant' };
            if (fullResponse) newMessage.content = fullResponse;
            if (toolCalls.length > 0) newMessage.tool_calls = toolCalls;

            if (newMessage.content !== undefined || newMessage.tool_calls !== undefined) {
                messages.push(newMessage);
                await this.saveConversation(conversationId, messages);
                console.log('Saved assistant response to conversation');
            }
            onComplete();
        };

        console.log('Starting stream for provider:', provider);
        // Stream response based on provider
        switch (provider) {
            case 'google':
                await this.streamGoogle(apiKey, model, messages, chunkWrapper, onError, completeWrapper);
                break;
            case 'openai':
                await this.streamOpenAI(apiKey, model, messages, chunkWrapper, onError, completeWrapper);
                break;
            case 'customopenai':
                await this.streamCustomOpenAI(apiKey, model, messages, chunkWrapper, onError, completeWrapper);
                break;
            case 'anthropic':
                await this.streamAnthropic(apiKey, model, messages, chunkWrapper, onError, completeWrapper);
                break;
            case 'openrouter':
                await this.streamOpenRouter(apiKey, model, messages, chunkWrapper, onError, completeWrapper);
                break;
            case 'together':
                await this.streamTogether(apiKey, model, messages, chunkWrapper, onError, completeWrapper);
                break;
            case 'ollama':
                await this.streamOllama(model, messages, chunkWrapper, onError, completeWrapper);
                break;
            default:
                console.error('Unknown provider:', provider);
                onError('Unknown provider: ' + provider);
                return;
        }
    }

    mergeToolCalls(current, deltas) {
        const result = JSON.parse(JSON.stringify(current)); // Deep copy to avoid mutating state unexpectedly
        for (const delta of deltas) {
            const index = delta.index;
            if (!result[index]) {
                result[index] = {
                    index,
                    id: delta.id || '',
                    type: 'function',
                    function: { name: '', arguments: '' }
                };
            }
            const target = result[index];
            if (delta.id) target.id = delta.id;
            if (delta.function?.name) target.function.name += delta.function.name;
            if (delta.function?.arguments) target.function.arguments += delta.function.arguments;
        }
        return result;
    }

    async getDetailedError(error) {
        let message = error.message;
        let details = '';

        if (error.response) {
            const status = error.response.status;
            const statusText = error.response.statusText;
            let data = error.response.data;

            // Handle stream-based error data
            if (data && typeof data.on === 'function') {
                try {
                    const streamData = await new Promise((resolve) => {
                        let result = '';
                        data.on('data', chunk => {
                            result += chunk.toString();
                        });
                        data.on('end', () => resolve(result));
                        data.on('error', () => resolve('Error reading response stream'));
                        // Timeout after 3 seconds
                        setTimeout(() => resolve(result || 'Stream read timeout'), 3000);
                    });
                    try {
                        const json = JSON.parse(streamData);
                        details = JSON.stringify(json, null, 2);
                        if (json.error?.message) message = json.error.message;
                        else if (json.message) message = json.message;
                    } catch (e) {
                        details = streamData;
                    }
                } catch (e) {
                    details = 'Could not read error stream: ' + e.message;
                }
            } else if (data) {
                if (typeof data === 'object') {
                    try {
                        details = JSON.stringify(data, null, 2);
                    } catch (e) {
                        details = '[Circular/Unserializable Data]';
                    }
                    if (data.error?.message) message = data.error.message;
                    else if (data.message) message = data.message;
                } else {
                    details = data;
                }
            }

            return `[${status} ${statusText}] ${message}\n\nFull Response Content:\n${details}`;
        }

        return message;
    }

    async streamOpenAI(apiKey, model, messages, onChunk, onError, onComplete) {
        console.log('=== STREAMING OPENAI ===');
        console.log('Model:', model);
        console.log('Messages count:', messages.length);

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        ...messages.map(m => {
                            if (m.role === 'user' && m.attachments) {
                                let textContent = m.content;
                                const content = [];

                                // Add images to content array
                                for (const att of m.attachments) {
                                    if (att.mimeType.startsWith('image/')) {
                                        content.push({
                                            type: 'image_url',
                                            image_url: { url: `data:${att.mimeType};base64,${att.content}` }
                                        });
                                    } else {
                                        textContent += `\n\n--- Attachment: ${att.name} ---\n${Buffer.from(att.content, 'base64').toString('utf8')}`;
                                    }
                                }

                                // Text part must be present
                                content.unshift({ type: 'text', text: textContent });
                                return { role: 'user', content };
                            }
                            return m;
                        })
                    ],
                    stream: true,
                    tools: this.getToolDefinitions()
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'stream'
                }
            );

            console.log('OpenAI request sent, waiting for response...');

            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    if (line.includes('[DONE]')) {
                        console.log('Received [DONE] marker');
                        continue;
                    }
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.substring(6));
                            const content = json.choices[0]?.delta?.content || '';
                            if (content) {
                                console.log('Content chunk:', content);
                                onChunk({ type: 'content', content });
                            }

                            // Handle tool calls
                            const toolCalls = json.choices[0]?.delta?.tool_calls;
                            if (toolCalls) {
                                console.log('Tool calls:', toolCalls);
                                onChunk({ type: 'tool_call', toolCalls });
                            }
                        } catch (e) {
                            console.error('Error parsing JSON:', e);
                        }
                    }
                }
            });

            response.data.on('end', () => {
                console.log('OpenAI stream ended');
                onComplete();
            });

            response.data.on('error', (error) => {
                console.error('OpenAI stream error:', error);
                onError(error.message);
            });
        } catch (error) {
            const detailedError = await this.getDetailedError(error);
            console.error('OpenAI stream error detail:', detailedError);
            onError(`OpenAI Error: ${detailedError}`);
        }
    }

    async streamAnthropic(apiKey, model, messages, onChunk, onError, onComplete) {
        // Convert messages format for Anthropic
        const anthropicMessages = messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
        }));

        try {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model,
                    messages: anthropicMessages,
                    system: SYSTEM_PROMPT,
                    max_tokens: 4096,
                    stream: true,
                    tools: this.getToolDefinitions().map(t => ({
                        name: t.function.name,
                        description: t.function.description,
                        input_schema: t.function.parameters
                    }))
                },
                {
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    },
                    responseType: 'stream'
                }
            );

            let fullResponse = '';
            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.substring(6));
                            if (json.type === 'content_block_delta') {
                                const content = json.delta?.text || '';
                                if (content) {
                                    fullResponse += content;
                                    onChunk({ type: 'content', content });
                                }
                            }
                            if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
                                onChunk({ type: 'tool_call', toolCall: json.content_block });
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            });

            response.data.on('end', () => {
                onComplete();
            });

            response.data.on('error', (error) => {
                console.error('Anthropic response stream error:', error);
                onError(error.message);
            });
        } catch (error) {
            const detailedError = await this.getDetailedError(error);
            console.error('Anthropic stream error detail:', detailedError);
            onError(`Anthropic Error: ${detailedError}`);
        }
    }

    async streamCustomOpenAI(apiKey, model, messages, onChunk, onError, onComplete) {
        const baseUrl = this.getCustomOpenAIBaseUrl();
        try {
            const customMessages = [...messages];
            customMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });

            const response = await axios.post(
                `${baseUrl}/chat/completions`,
                {
                    model,
                    messages: customMessages,
                    stream: true,
                    tools: this.getToolDefinitions()
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'stream'
                }
            );

            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    if (line.includes('[DONE]')) continue;
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.substring(6));
                            const content = json.choices[0]?.delta?.content || '';
                            if (content) {
                                onChunk({ type: 'content', content });
                            }

                            const toolCalls = json.choices[0]?.delta?.tool_calls;
                            if (toolCalls) {
                                onChunk({ type: 'tool_call', toolCalls });
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            });

            response.data.on('end', onComplete);
            response.data.on('error', (error) => {
                console.error('Custom OpenAI stream error:', error);
                onError(`Custom OpenAI Stream Error: ${error.message}`);
            });
        } catch (error) {
            const detailedError = await this.getDetailedError(error);
            console.error('Custom OpenAI API error detail:', detailedError);
            onError(`Custom OpenAI Error: ${detailedError}`);
        }
    }

    async streamGoogle(apiKey, model, messages, onChunk, onError, onComplete) {
        console.log('=== STREAMING GOOGLE ===');
        console.log('Model:', model);

        try {
            const contents = [];
            for (let i = 0; i < messages.length; i++) {
                const m = messages[i];
                if (m.role === 'user') {
                    const parts = [{ text: m.content }];

                    // Add attachments if present
                    if (m.attachments) {
                        for (const att of m.attachments) {
                            if (att.mimeType.startsWith('image/')) {
                                parts.push({
                                    inlineData: {
                                        mimeType: att.mimeType,
                                        data: att.content
                                    }
                                });
                            } else {
                                // For text files, just append to the content part or add as new text part
                                parts[0].text += `\n\n--- Attachment: ${att.name} ---\n${Buffer.from(att.content, 'base64').toString('utf8')}`;
                            }
                        }
                    }
                    contents.push({ role: 'user', parts });
                } else if (m.role === 'assistant') {
                    const parts = [];
                    if (m.content) parts.push({ text: m.content });
                    if (m.tool_calls) {
                        for (const toolCall of m.tool_calls) {
                            parts.push({
                                functionCall: {
                                    name: toolCall.function.name,
                                    args: JSON.parse(toolCall.function.arguments)
                                }
                            });
                        }
                    }
                    if (parts.length > 0) {
                        contents.push({ role: 'model', parts });
                    }
                } else if (m.role === 'tool') {
                    let functionName = 'unknown';
                    // Find matching tool_call_id looking backwards
                    for (let j = i - 1; j >= 0; j--) {
                        if (messages[j].tool_calls) {
                            const match = messages[j].tool_calls.find(tc => tc.id === m.tool_call_id);
                            if (match) {
                                functionName = match.function.name;
                                break;
                            }
                        }
                    }

                    contents.push({
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: functionName,
                                response: { content: m.content }
                            }
                        }]
                    });
                }
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;

            const response = await axios.post(
                url,
                {
                    contents,
                    system_instruction: {
                        parts: [{ text: SYSTEM_PROMPT }]
                    },
                    tools: [{ function_declarations: this.getToolDefinitions().map(t => t.function) }]
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    responseType: 'stream'
                }
            );

            let buffer = '';
            const seenFunctionCalls = new Set(); // Track function calls we've already sent

            response.data.on('data', (chunk) => {
                buffer += chunk.toString();

                // Process buffering
                let processing = true;
                while (processing) {
                    processing = false;
                    buffer = buffer.trim();

                    if (buffer.startsWith(',') || buffer.startsWith('[')) {
                        buffer = buffer.substring(1).trim();
                        processing = true;
                        continue;
                    }
                    if (buffer.startsWith(']')) {
                        buffer = buffer.substring(1).trim();
                        processing = true;
                        continue;
                    }

                    if (buffer.length === 0) break;

                    if (buffer.startsWith('{')) {
                        let braceCount = 0;
                        let inString = false;
                        let escape = false;
                        let objectEnd = -1;

                        for (let i = 0; i < buffer.length; i++) {
                            const char = buffer[i];
                            if (escape) {
                                escape = false;
                                continue;
                            }
                            if (char === '\\') {
                                escape = true;
                                continue;
                            }
                            if (char === '"') {
                                inString = !inString;
                                continue;
                            }

                            if (!inString) {
                                if (char === '{') braceCount++;
                                if (char === '}') {
                                    braceCount--;
                                    if (braceCount === 0) {
                                        objectEnd = i;
                                        break;
                                    }
                                }
                            }
                        }

                        if (objectEnd !== -1) {
                            const objectStr = buffer.substring(0, objectEnd + 1);
                            buffer = buffer.substring(objectEnd + 1);
                            processing = true;

                            try {
                                const json = JSON.parse(objectStr);
                                const candidate = json.candidates?.[0];
                                if (candidate) {
                                    const parts = candidate.content?.parts || [];
                                    for (const part of parts) {
                                        if (part.text) {
                                            onChunk({ type: 'content', content: part.text });
                                        }
                                        if (part.functionCall) {
                                            // Create a unique key for this function call to prevent duplicates
                                            const functionKey = `${part.functionCall.name}_${JSON.stringify(part.functionCall.args)}`;

                                            if (!seenFunctionCalls.has(functionKey)) {
                                                seenFunctionCalls.add(functionKey);

                                                const toolCall = {
                                                    index: seenFunctionCalls.size - 1, // Use the count as index
                                                    id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                                    type: 'function',
                                                    function: {
                                                        name: part.functionCall.name,
                                                        arguments: JSON.stringify(part.functionCall.args)
                                                    }
                                                };
                                                onChunk({ type: 'tool_call', toolCalls: [toolCall] });
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                // console.error('Error parsing JSON:', e);
                            }
                        }
                    } else {
                        if (buffer.length > 0 && !buffer.startsWith('{')) {
                            buffer = buffer.substring(1);
                            processing = true;
                        }
                    }
                }
            });

            response.data.on('end', () => {
                onComplete();
            });

            response.data.on('error', (error) => {
                onError(error.message);
            });
        } catch (error) {
            const detailedError = await this.getDetailedError(error);
            console.error('Google stream error:', detailedError);
            if (error.response?.status === 429) {
                onError('Rate limit exceeded (429). Google Gemini Free Tier has strict limits.');
            } else {
                onError(`Google Error: ${detailedError}`);
            }
        }
    }

    async streamOpenRouter(apiKey, model, messages, onChunk, onError, onComplete) {
        try {
            console.log('OpenRouter Request:', { model, messagesCount: messages.length });

            // OpenRouter uses OpenAI-compatible API
            // Determine if we should send tools
            const capabilities = this.modelCapabilities.get(model);
            const supportsTools = capabilities ? capabilities.supportsTools : true; // Default to true if unknown

            const openRouterMessages = messages.map(m => {
                const { attachments, ...rest } = m;
                return rest;
            });

            // Add System Prompt
            openRouterMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });

            const payload = {
                model,
                messages: openRouterMessages,
                stream: true
            };

            if (supportsTools) {
                payload.tools = this.getToolDefinitions();
            } else {
                console.log(`Model ${model} does not support tools, skipping tools parameter.`);
            }

            console.log('OpenRouter Request Payload (Tools Enabled:', supportsTools, '):', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'http://localhost',
                        'X-Title': 'Cognautic Desktop'
                    },
                    responseType: 'stream'
                }
            );

            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    if (line.includes('[DONE]')) continue;
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.substring(6));
                            const content = json.choices[0]?.delta?.content || '';
                            if (content) {
                                onChunk({ type: 'content', content });
                            }

                            const toolCalls = json.choices[0]?.delta?.tool_calls;
                            if (toolCalls) {
                                onChunk({ type: 'tool_call', toolCalls });
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            });

            response.data.on('end', onComplete);
            response.data.on('error', (error) => {
                console.error('OpenRouter stream error:', error);
                onError(`OpenRouter Stream Error: ${error.message}`);
            });
        } catch (error) {
            const detailedError = await this.getDetailedError(error);
            console.error('OpenRouter API error detail:', detailedError);
            onError(`OpenRouter Error: ${detailedError}`);
        }
    }

    async streamTogether(apiKey, model, messages, onChunk, onError, onComplete) {
        try {
            // Together AI uses OpenAI-compatible API
            const togetherMessages = [...messages];
            togetherMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });

            const response = await axios.post(
                'https://api.together.xyz/v1/chat/completions',
                {
                    model,
                    messages: togetherMessages,
                    stream: true,
                    tools: this.getToolDefinitions()
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'stream'
                }
            );

            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    if (line.includes('[DONE]')) continue;
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.substring(6));
                            const content = json.choices[0]?.delta?.content || '';
                            if (content) {
                                onChunk({ type: 'content', content });
                            }

                            const toolCalls = json.choices[0]?.delta?.tool_calls;
                            if (toolCalls) {
                                onChunk({ type: 'tool_call', toolCalls });
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            });

            response.data.on('end', onComplete);
            response.data.on('error', (error) => {
                console.error('Together stream error:', error);
                onError(`Together Stream Error: ${error.message}`);
            });
        } catch (error) {
            const detailedError = await this.getDetailedError(error);
            console.error('Together API error detail:', detailedError);
            onError(`Together Error: ${detailedError}`);
        }
    }

    async streamOllama(model, messages, onChunk, onError, onComplete) {
        // Get endpoint from config or use default (use 127.0.0.1 to avoid ipv6 issues)
        const endpoint = this.apiKeys.ollama || 'http://127.0.0.1:11434';

        // Convert messages to Ollama format
        const ollamaMessages = messages.map(msg => {
            if (msg.role === 'tool') {
                // Convert tool response to user message for Ollama
                return {
                    role: 'user',
                    content: `Tool result: ${msg.content}`
                };
            }
            return {
                role: msg.role,
                content: msg.content || ''
            };
        });

        // Add System Prompt
        ollamaMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });

        const makeRequest = async (includeTools) => {
            const payload = {
                model,
                messages: ollamaMessages,
                stream: true
            };

            if (includeTools) {
                payload.tools = this.getToolDefinitions();
            }

            return await axios.post(
                `${endpoint}/api/chat`,
                payload,
                { responseType: 'stream' }
            );
        };

        try {
            let response;
            try {
                // First try with tools
                response = await makeRequest(true);
            } catch (error) {
                // Safely read error body to check for specific tool error
                // We must be careful because error.response.data is a stream (circular structure)
                let errorBody = '';

                if (error.response && error.response.data) {
                    if (typeof error.response.data.on === 'function') {
                        // It's a stream, read it
                        try {
                            errorBody = await new Promise((resolve) => {
                                let res = '';
                                error.response.data.on('data', c => res += c);
                                error.response.data.on('end', () => resolve(res));
                                error.response.data.on('error', () => resolve('')); // Ignore read errors
                            });
                        } catch (e) {
                            // Ignore stream errors
                        }
                    } else {
                        // It's likely an object or string
                        try {
                            if (typeof error.response.data === 'object') {
                                errorBody = JSON.stringify(error.response.data);
                            } else {
                                errorBody = String(error.response.data);
                            }
                        } catch (e) {
                            errorBody = '[Unserializable Error Data]';
                        }
                    }
                }

                // Check if error is because model doesn't support tools
                // 400 Bad Request + "does not support tools" message
                const isToolError = error.response &&
                    error.response.status === 400 &&
                    (errorBody.includes('does not support tools') ||
                        error.message?.includes('does not support tools'));

                if (isToolError) {
                    console.log(`Model ${model} does not support tools. Retrying without tools...`);
                    // Retry without tools
                    response = await makeRequest(false);
                    // Update capabilities cache
                    this.modelCapabilities.set(model, { supportsTools: false });
                } else {
                    // Since we consumed the stream, replace data with string so getDetailedError can read it
                    if (error.response) {
                        error.response.data = errorBody;
                    }
                    throw error; // Re-throw for outer catch
                }
            }

            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    try {
                        const json = JSON.parse(line);

                        // Handle content
                        if (json.message?.content) {
                            onChunk({ type: 'content', content: json.message.content });
                        }

                        // Handle tool calls
                        if (json.message?.tool_calls) {
                            onChunk({ type: 'tool_call', toolCalls: json.message.tool_calls });
                        }
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            });

            response.data.on('end', onComplete);
            response.data.on('error', (error) => {
                console.error('Ollama stream error:', error);
                onError(`Ollama Stream Error: ${error.message}`);
            });
        } catch (error) {
            const detailedError = await this.getDetailedError(error);
            console.error('Ollama API error detail:', detailedError);
            onError(`Ollama Error: ${detailedError}. Make sure Ollama is running at ${endpoint}`);
        }
    }

    getToolDefinitions() {
        return [
            {
                type: 'function',
                function: {
                    name: 'web_search',
                    description: 'Search the web for information using DuckDuckGo',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Search query' }
                        },
                        required: ['query']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'read_website',
                    description: 'Read and extract text content from a website URL',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'Website URL' }
                        },
                        required: ['url']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'read_file',
                    description: 'Read contents of a file',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path' }
                        },
                        required: ['path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'write_file',
                    description: 'Create a new file or overwrite an existing file with content',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path' },
                            content: { type: 'string', description: 'File content' }
                        },
                        required: ['path', 'content']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'edit_file',
                    description: 'Edit a file by replacing text',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path' },
                            pattern: { type: 'string', description: 'Text or pattern to find' },
                            replacement: { type: 'string', description: 'Text to replace it with' }
                        },
                        required: ['path', 'pattern', 'replacement']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_directory',
                    description: 'List files and folders in a directory',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'Directory path' }
                        },
                        required: ['path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'delete_file',
                    description: 'Delete a file',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path' }
                        },
                        required: ['path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'execute_command',
                    description: 'Execute a terminal command',
                    parameters: {
                        type: 'object',
                        properties: {
                            command: {
                                type: 'string',
                                description: 'Command to execute. WARNING: If this command runs a server, installs packages, or takes >5secs, you MUST set background: true.'
                            },
                            background: {
                                type: 'boolean',
                                description: 'SET TO TRUE for long-running commands (npm start, npx, install). Prevents system freeze.'
                            }
                        },
                        required: ['command']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'kill_process',
                    description: 'Terminate a background process by PID',
                    parameters: {
                        type: 'object',
                        properties: {
                            pid: { type: 'string', description: 'Process ID to kill' }
                        },
                        required: ['pid']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'store_memory',
                    description: 'Store information in memory',
                    parameters: {
                        type: 'object',
                        properties: {
                            key: { type: 'string', description: 'Memory key' },
                            value: { type: 'string', description: 'Value to store' }
                        },
                        required: ['key', 'value']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'recall_memory',
                    description: 'Recall information from memory',
                    parameters: {
                        type: 'object',
                        properties: {
                            key: { type: 'string', description: 'Memory key' }
                        },
                        required: ['key']
                    }
                }
            }
        ];
    }

    async executeTool(toolName, parameters, cwd) {
        console.log(`Executing tool: ${toolName}`, parameters, 'CWD:', cwd);

        // Helper to resolve path against CWD if provided and path is relative
        const resolvePath = (p) => {
            if (cwd && p && !path.isAbsolute(p)) {
                return path.join(cwd, p);
            }
            return p;
        };

        try {
            switch (toolName) {
                case 'web_search':
                    return await this.webSearch(parameters.query);
                case 'read_website':
                    return await this.readWebsite(parameters.url);
                case 'read_file':
                    return await this.readFile(resolvePath(parameters.path));
                case 'write_file':
                    return await this.writeFile(resolvePath(parameters.path), parameters.content);
                case 'edit_file':
                    return await this.editFile(resolvePath(parameters.path), parameters.pattern, parameters.replacement);
                case 'list_directory':
                    // If path parameter is explicitly provided, use it. 
                    // If not provided, use CWD. If both missing, listDirectory defaults to process.cwd()
                    return await this.listDirectory(parameters.path ? resolvePath(parameters.path) : cwd);
                case 'delete_file':
                    return await this.deleteFile(resolvePath(parameters.path));
                case 'execute_command':
                    return await this.executeCommand(parameters.command, cwd, parameters.background);
                case 'kill_process':
                    return await this.killProcess(parameters.pid);
                case 'store_memory':
                    return await this.storeMemory(parameters.key, parameters.value);
                case 'recall_memory':
                    return await this.recallMemory(parameters.key);
                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }
        } catch (error) {
            console.error(`Error executing tool ${toolName}:`, error);
            return { success: false, error: error.message };
        }
    }

    async webSearch(query) {
        try {
            console.log('Performing web search for:', query);
            const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            const results = [];

            $('.result').each((i, element) => {
                if (i >= 5) return false; // Limit to 5 results

                const title = $(element).find('.result__title').text().trim();
                const link = $(element).find('.result__url').attr('href');
                const snippet = $(element).find('.result__snippet').text().trim();

                if (title && link) {
                    results.push({ title, link, snippet });
                }
            });

            return { success: true, results };
        } catch (error) {
            console.error('Web search error:', error);
            return { success: false, error: 'Failed to perform web search: ' + error.message };
        }
    }

    async readWebsite(url) {
        try {
            console.log('Reading website:', url);
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);

            // Remove script and style tags
            $('script').remove();
            $('style').remove();
            $('noscript').remove();

            // Get text content
            const title = $('title').text().trim();
            const text = $('body').text().replace(/\s+/g, ' ').trim();

            // Limit text length to avoid context overflow
            const maxLength = 8000;
            const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text;

            return {
                success: true,
                title,
                content: truncatedText,
                length: text.length
            };
        } catch (error) {
            console.error('Read website error:', error);
            return { success: false, error: 'Failed to read website: ' + error.message };
        }
    }

    async readFile(filePath) {
        try {
            const stats = await fs.stat(filePath);
            if (stats.size > 100 * 1024) { // 100KB limit
                return { success: false, error: 'File is too large to read directly.' };
            }
            const content = await fs.readFile(filePath, 'utf8');
            return { success: true, content };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async writeFile(filePath, content) {
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, 'utf8');
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async editFile(filePath, pattern, replacement) {
        try {
            const data = await fs.readFile(filePath, 'utf8');

            // If pattern looks like a regex (starts/ends with /), treat it as such
            let regex;
            if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
                const lastSlash = pattern.lastIndexOf('/');
                const body = pattern.substring(1, lastSlash);
                const flags = pattern.substring(lastSlash + 1);
                try {
                    regex = new RegExp(body, flags);
                } catch (e) {
                    regex = pattern; // Fallback to string if invalid regex
                }
            } else {
                regex = pattern;
            }

            const newContent = data.replace(regex, replacement);

            if (newContent === data) {
                return { success: false, error: 'Pattern not found in file.' };
            }

            await fs.writeFile(filePath, newContent, 'utf8');
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async listDirectory(dirPath) {
        try {
            // Default to current directory if not provided
            const targetPath = dirPath || process.cwd();
            const items = await fs.readdir(targetPath, { withFileTypes: true });

            const result = items.map(item => ({
                name: item.name,
                type: item.isDirectory() ? 'directory' : 'file'
            }));

            return { success: true, path: targetPath, items: result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteFile(filePath) {
        try {
            await fs.unlink(filePath);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async killProcess(pid) {
        // Convert string PID to number if needed
        const pidNum = parseInt(pid, 10);

        if (this.runningProcesses.has(pidNum)) {
            try {
                // Use tree-kill logic effectively by using negative PID if spawned with shell:true and detached,
                // but process.kill usually works for the main PID.
                // For robust killing of shell trees, we might need 'tree-kill' package, but standard kill is a good start.
                process.kill(pidNum);
                // We don't delete from map immediately, we wait for 'close' event in executeCommand
                // But for safety:
                if (this.runningProcesses.has(pidNum)) {
                    this.runningProcesses.delete(pidNum);
                }
                return { success: true, message: `Process ${pidNum} killed` };
            } catch (error) {
                return { success: false, error: `Failed to kill process ${pidNum}: ${error.message}` };
            }
        } else {
            return { success: false, error: `Process ${pidNum} not found in tracked processes` };
        }
    }

    async executeCommand(command, cwd, background = false) {
        try {
            console.log('Executing command:', command, 'in CWD:', cwd, 'Background:', background);
            const workingDir = cwd || process.cwd();
            const isWindows = process.platform === 'win32';
            const shell = isWindows
                ? (process.env.COMSPEC || 'cmd.exe')
                : (process.env.SHELL || '/bin/bash');

            // Function to handle process logic
            const runProcess = (isBackground) => {
                const spawnArgs = isWindows
                    ? ['/d', '/s', '/c', command]
                    : ['-lc', command];

                const subprocess = spawn(shell, spawnArgs, {
                    cwd: workingDir,
                    env: process.env,
                    detached: isBackground,
                    stdio: 'pipe'
                });
                const pid = subprocess.pid;
                this.runningProcesses.set(pid, subprocess);
                if (isBackground) subprocess.unref();

                // Capture output for logging (and potential return)
                let stdout = '';
                let stderr = '';

                subprocess.stdout.on('data', (data) => {
                    const str = data.toString();
                    stdout += str;
                    if (isBackground) console.log(`[PID ${pid}] stdout: ${str}`);
                });

                subprocess.stderr.on('data', (data) => {
                    const str = data.toString();
                    stderr += str;
                    if (isBackground) console.error(`[PID ${pid}] stderr: ${str}`);
                });

                subprocess.on('close', (code) => {
                    if (this.runningProcesses.has(pid)) {
                        this.runningProcesses.delete(pid);
                    }
                });

                return { subprocess, pid, getOutput: () => ({ stdout, stderr }) };
            };

            if (background) {
                const { pid, getOutput } = runProcess(true);
                return await new Promise((resolve) => {
                    setTimeout(() => {
                        const { stdout, stderr } = getOutput();
                        resolve({
                            success: true,
                            message: `Command started in background with PID ${pid}`,
                            pid: pid,
                            background: true,
                            stdout,
                            stderr
                        });
                    }, 1200);
                });
            } else {
                // Foreground with timeout
                return new Promise((resolve) => {
                    const { subprocess, pid, getOutput } = runProcess(false);
                    let completed = false;

                    const finish = (result) => {
                        if (completed) return;
                        completed = true;
                        resolve(result);
                    };

                    subprocess.on('close', (code) => {
                        const { stdout, stderr } = getOutput();
                        finish({
                            success: code === 0,
                            stdout,
                            stderr,
                            code
                        });
                    });

                    subprocess.on('error', (err) => {
                        const { stdout, stderr } = getOutput();
                        finish({
                            success: false,
                            error: err.message,
                            stdout,
                            stderr
                        });
                    });

                    // If it takes too long, treat as background
                    setTimeout(() => {
                        if (!completed) {
                            console.log(`Command ${command} (PID ${pid}) taking too long, converting to background...`);
                            completed = true;
                            // We don't wait anymore, return what we have and the PID
                            const { stdout, stderr } = getOutput();
                            resolve({
                                success: true, // It started successfully
                                pid: pid,
                                background: true, // Mark as background now
                                message: `Command taking longer than 2s, continuing in background with PID ${pid}.\n\nOutput so far:\n${stdout}\n${stderr}`
                            });
                        }
                    }, 2000);
                });
            }
        } catch (error) {
            return { success: false, error: error.message, stderr: error.stderr };
        }
    }

    async storeMemory(key, value) {
        this.memory[key] = value;
        await this.saveMemory();
        return { success: true };
    }

    async recallMemory(key) {
        return { success: true, value: this.memory[key] || null };
    }

    async getConversationHistory(conversationId) {
        const conversationFile = path.join(this.conversationsDir, `${conversationId}.json`);
        try {
            const data = await fs.readFile(conversationFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return { id: conversationId, messages: [], createdAt: new Date().toISOString() };
        }
    }

    async saveConversation(conversationId, messages) {
        const conversationFile = path.join(this.conversationsDir, `${conversationId}.json`);
        const conversation = {
            id: conversationId,
            messages,
            updatedAt: new Date().toISOString()
        };
        await fs.writeFile(conversationFile, JSON.stringify(conversation, null, 2));
    }

    async getAllConversations() {
        try {
            const files = await fs.readdir(this.conversationsDir);
            const conversations = [];
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const data = await fs.readFile(path.join(this.conversationsDir, file), 'utf8');
                    conversations.push(JSON.parse(data));
                }
            }
            return conversations.sort((a, b) =>
                new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
            );
        } catch (error) {
            return [];
        }
    }

    async createConversation() {
        const id = Date.now().toString();
        const conversation = {
            id,
            messages: [],
            createdAt: new Date().toISOString()
        };
        await this.saveConversation(id, []);
        return conversation;
    }

    async deleteConversation(conversationId) {
        const conversationFile = path.join(this.conversationsDir, `${conversationId}.json`);
        try {
            await fs.unlink(conversationFile);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = AgentSystem;
