const TRANSLATIONS = {
  zh: {
    'app.title': '小🍐子',
    'app.fullName': '小🍐子阅读助手',
    'app.settingsTitle': '小🍐子阅读助手 - 设置',
    'settings.heading': '小🍐子阅读助手设置',
    'settings.toggleDark': '切换夜间模式',
    'settings.language': '语言',

    'settings.theme': '外观主题',
    'settings.theme.sujian': '素笺',
    'settings.theme.ocean': '海洋',
    'settings.theme.forest': '森林',

    'settings.llm': '大模型配置',
    'settings.llm.apiKey': 'API Key',
    'settings.llm.apiKey.ph': 'sk-...',
    'settings.llm.apiKey.hint': '你的 API Key 仅保存在本地浏览器中，不会发送到任何第三方服务器。',
    'settings.llm.apiBase': 'API 地址（可选）',
    'settings.llm.apiBase.ph': 'https://api.deepseek.com',
    'settings.llm.apiBase.hint': '留空使用默认地址（DeepSeek）。如需使用其他兼容接口，可在此填写。',
    'settings.llm.model': '模型名称',
    'settings.llm.model.ph': '点击刷新按钮获取可用模型，或手动输入模型名称',
    'settings.llm.refreshModels': '刷新模型列表',
    'settings.llm.model.hint': '选择或输入要使用的模型名称。点击刷新按钮从当前 API 地址获取可用模型列表。',
    'settings.llm.systemPrompt': '自定义 System Prompt（可选）',
    'settings.llm.systemPrompt.ph': '例如：请用简洁的中文回答，回答时附带原文引用',
    'settings.llm.systemPrompt.hint': '追加到默认 prompt 之后，用于个性化 AI 的回答风格或行为。留空则使用默认设置。',

    'settings.tts': 'TTS 语音合成配置',
    'settings.tts.appId': 'App ID',
    'settings.tts.appId.ph': '火山引擎控制台获取的 App ID',
    'settings.tts.accessKey': 'Access Token',
    'settings.tts.accessKey.ph': '火山引擎控制台获取的 Access Token',
    'settings.tts.resourceId': 'Resource ID',
    'settings.tts.resourceId.ph': 'seed-tts-2.0',
    'settings.tts.resourceId.hint': '默认 seed-tts-2.0（豆包语音合成模型2.0）。',
    'settings.tts.speaker': '音色',
    'settings.tts.speaker.ph': 'zh_female_vv_uranus_bigtts',
    'settings.tts.speaker.hint': '默认 zh_female_vv_uranus_bigtts。更多音色见<a href="https://www.volcengine.com/docs/6561/1257544" target="_blank">音色列表</a>。',
    'settings.tts.autoPlay': 'AI 回复后自动朗读',

    'settings.ocr': 'OCR 文字识别配置',
    'settings.ocr.apiKey': 'API Key',
    'settings.ocr.apiKey.ph': '智谱 AI 开放平台获取的 API Key',
    'settings.ocr.apiKey.hint': '用于 GLM-OCR 文字识别服务。前往 <a href="https://open.bigmodel.cn" target="_blank">open.bigmodel.cn</a> 获取 API Key。',

    'settings.suggest': '推荐追问',
    'settings.suggest.toggle': 'AI 回复后自动生成推荐问题',

    'settings.save': '保存设置',
    'settings.saved': '已保存 ✓',

    'settings.commands': '快捷指令',
    'settings.commands.hint': '配置快捷指令后，在聊天框输入 <code>/</code> 即可快速调用。修改即时生效。',
    'settings.commands.empty': '暂无快捷指令，点击下方按钮添加',
    'settings.commands.add': '+ 添加指令',
    'settings.commands.name.ph': '指令名称（不含空格和/）',
    'settings.commands.prompt.ph': 'Prompt 内容',
    'settings.commands.cancel': '取消',
    'settings.commands.save': '保存',
    'settings.commands.edit': '编辑',
    'settings.commands.delete': '删除',

    'settings.data': '数据管理',
    'settings.data.hint': '导出所有设置（大模型配置、TTS 配置、快捷指令）为 JSON 文件备份，或从备份文件导入恢复。',
    'settings.data.export': '导出设置',
    'settings.data.import': '导入设置',

    'sidebar.history': '历史对话',
    'sidebar.back': '返回',
    'sidebar.newChat': '新建聊天',
    'sidebar.exportChat': '导出聊天记录',
    'sidebar.settings': '设置',
    'sidebar.uploadImage': '上传图片',
    'sidebar.remove': '移除',
    'sidebar.input.ph': '输入问题，基于当前页面内容回答...',
    'sidebar.send': '发送',
    'sidebar.clearQuote': '清除引用',
    'sidebar.welcome': '打开任意网页，点击上方按钮或输入问题开始使用。',
    'sidebar.modelStatus': '当前模型：',
    'sidebar.historyEmpty': '暂无历史对话',
    'sidebar.dropHint': '松开以上传图片',

    'action.summarize': '总结',
    'action.translate': '翻译',
    'action.keyInfo': '关键信息',
    'action.retry': '重新发送',
    'action.copy': '复制',
    'action.copied': '已复制',
    'action.tts': '朗读',
    'action.ttsDownload': '下载语音',
    'action.export': '导出',
    'action.outline': '大纲',
    'outline.title': '文章大纲',
    'outline.copySuccess': '大纲已复制',
    'outline.export': '导出 Markdown',
    'outline.noContent': '请先打开一个网页再生成大纲',
    'outline.parseError': '大纲解析失败，请重试',
    'outline.tooShort': '内容太短，无法生成有意义的大纲',
    'outline.copy': '复制大纲',
    'outline.label.summary': '核心论点',
    'outline.label.data': '关键数据',
    'outline.label.quote': '原文引用',

    'error.noApiKey': '请先在设置页面配置 API Key',
    'error.noApiKeySave': '请输入 API Key',
    'error.apiKeyHint': '提示：标准 OpenAI Key 以 sk- 开头。如使用第三方 API，请同时填写 API 地址',
    'error.apiFailed': 'API 请求失败',
    'error.noTtsConfig': '请先在设置页面配置 TTS 语音合成',
    'error.ttsFailed': 'TTS 请求失败',
    'error.ttsError': 'TTS 错误',
    'error.ttsSynthFailed': 'TTS 合成失败',
    'error.noApiKeySuggest': '未配置 API Key，无法生成推荐问题',
    'error.fetchModelsFailed': '获取模型列表失败',
    'error.noOcrApiKey': '请先在设置页面配置 OCR API Key',
    'error.ocrFailed': 'OCR 请求失败',
    'error.extractFailed': '页面内容提取失败',
    'error.noTab': '无法获取当前标签页',
    'error.ocrRunning': 'OCR 识别中，请稍候...',
    'error.ocrPartialFail': '部分图片 OCR 失败，请移除后重试',

    'status.loading': '加载中...',
    'status.modelsLoaded': '已获取 {n} 个模型',
    'status.settingsSaved': '设置已保存',
    'status.commandEmpty': '指令名称和内容不能为空',
    'status.commandInvalid': '指令名称不能包含空格或 /',
    'status.commandDuplicate': '指令名称已存在',
    'status.commandSaved': '指令已保存',
    'status.commandDeleted': '指令已删除',
    'status.exported': '设置已导出',
    'status.invalidFile': '无效的设置文件格式',
    'status.imported': '设置已导入并保存',
    'status.parseError': '解析文件失败：',
    'status.ttsDownloading': '正在生成语音...',

    'chat.today': '今天',
    'chat.yesterday': '昨天',
    'chat.newChat': '新对话',
    'chat.exportTitle': '小🍐子阅读助手 — 聊天记录',
    'chat.exportPage': '页面：',
    'chat.exportTime': '导出时间：',
    'chat.exportModel': '模型：',
    'chat.user': '👤 用户',
    'chat.ai': '🤖 AI 助手',

    'cmd.noMatch': '无匹配的快捷指令',

    'ai.thinking': '思考过程',
    'ai.truncated': '[内容过长，已截断]',
    'ai.quoteTruncated': '[引用内容过长，已截断]',
    'ai.quotePrefix': '以下是用户从页面中引用的内容：',
    'ai.ocrContext': '第{n}张图片的内容是：\n',

    'prompt.default': '你是一个 AI 阅读助手。用户正在阅读一篇网页文章，以下是文章内容，请基于这些内容回答用户的问题。\n\n文章标题：{title}\n\n文章内容：\n{content}',
    'prompt.summarize.full': '请总结这篇网页内容。要求：\n1. 用 3-5 个要点概括核心内容\n2. 保持客观，不添加原文没有的信息\n3. 语言简洁明了',
    'prompt.summarize.quote': '请总结用户引用的这段内容。要求：\n1. 用 3-5 个要点概括核心内容\n2. 保持客观，不添加原文没有的信息\n3. 语言简洁明了',
    'prompt.translate.full': '请将这篇网页内容翻译为中文。要求：\n1. 准确传达原文含义\n2. 语言通顺自然\n3. 专业术语保留英文并附上中文解释',
    'prompt.translate.quote': '请将用户引用的这段内容翻译为中文。要求：\n1. 准确传达原文含义\n2. 语言通顺自然\n3. 专业术语保留英文并附上中文解释',
    'prompt.keyInfo.full': '请提取这篇网页内容的关键信息。要求：\n1. 列出所有重要的事实、数据、观点\n2. 按重要性排序\n3. 每条信息简洁明了',
    'prompt.keyInfo.quote': '请提取用户引用的这段内容的关键信息。要求：\n1. 列出所有重要的事实、数据、观点\n2. 按重要性排序\n3. 每条信息简洁明了',

    // Podcast
    'podcast.button': '播客',
    'podcast.cardTitle': '播客',
    'podcast.generatingScript': '正在生成对话脚本...',
    'podcast.generatingAudio': '正在合成播客音频...',
    'podcast.play': '播放',
    'podcast.pause': '暂停',
    'podcast.done': '播放完成',
    'podcast.replay': '重新播放',
    'podcast.error': '生成失败',
    'podcast.retry': '重试',
    'podcast.noContent': '没有可用的页面内容',
    'podcast.noTtsConfig': '请先在设置中配置 TTS 语音合成凭证',
    'podcast.scriptParseError': '对话脚本格式异常，无法生成播客',
    'podcast.audioError': '播客音频合成失败',
    'podcast.download': '下载音频',
    'podcast.downloading': '正在下载...',
    'podcast.fileName': '播客',

    // Chart Analyzer
    'chart.button': '图表',
    'chart.noCharts': '未检测到图表',
    'chart.detecting': '正在扫描图表...',
    'chart.detected': '检测到 {n} 个图表',
    'chart.extracting': '正在提取数据...',
    'chart.analyzing': '正在分析数据...',
    'chart.extractFailed': '图表数据提取失败',
    'chart.analyzeFailed': '数据分析失败',
    'chart.noContent': '没有可分析的图表内容',
    'chart.noOcrApiKey': '请先在设置页面配置智谱 API Key（用于图表识别）',
    'chart.noApiKey': '请先在设置页面配置 API Key',
    'chart.cardTitle': '图表分析',
    'chart.typeCanvas': 'Canvas 图表',
    'chart.typeSVG': 'SVG 图表',
    'chart.typeImage': '图片图表',
    'chart.selectChart': '请选择要分析的图表',
    'chart.analyze': '分析',
    'chart.insights': '数据洞察',
    'chart.data': '数据表格',
    'chart.stats': '统计信息',
    'chart.exportCSV': '导出 CSV',
    'chart.exportJSON': '导出 JSON',
    'chart.copy': '复制数据',
    'chart.copied': '已复制',
    'chart.noData': '未能提取到有效数据',
    'chart.close': '关闭',
    'chart.label': '标签',
    'chart.value': '值',
    'chart.series': '系列',
    'chart.statMean': '平均值',
    'chart.statMax': '最大值',
    'chart.statMin': '最小值',
    'chart.statGrowth': '增长率',

    'prompt.suggest': '你是一个阅读助手。基于对话历史，生成 3 个有深度的后续问题，帮助用户更深入地理解文章内容。每行一个问题，不要编号，不要额外解释。',
    'prompt.suggestUser': '用户问题：',
    'prompt.suggestAI': 'AI 回复：',
    'prompt.outline': '你是一个内容分析专家。请将文章内容分析为结构化大纲。\n\n要求：\n1. 生成 2-5 个一级标题，每个一级标题下可有 0-4 个二级标题\n2. 为每个标题节点提供：\n   - "summary": 核心论点（1-2 句话）\n   - "data": 关键数据点列表（数字、指标、对比；若无则为空数组）\n   - "quote": 最相关的原文引用（一段原文）\n3. 标题应反映文章的逻辑结构，而非简单复述原文标题\n\n请严格按以下 JSON 格式返回，不要包含任何其他文字：\n{\n  "title": "文章主旨（一句话）",\n  "sections": [\n    {\n      "heading": "标题",\n      "summary": "...",\n      "data": ["...", "..."],\n      "quote": "...",\n      "children": [\n        {\n          "heading": "子标题",\n          "summary": "...",\n          "data": [],\n          "quote": "...",\n          "children": []\n        }\n      ]\n    }\n  ]\n}',
  },

  en: {
    'app.title': 'PearReader',
    'app.fullName': 'PearReader',
    'app.settingsTitle': 'PearReader - Settings',
    'settings.heading': 'PearReader Settings',
    'settings.toggleDark': 'Toggle Dark Mode',
    'settings.language': 'Language',

    'settings.theme': 'Appearance',
    'settings.theme.sujian': 'Parchment',
    'settings.theme.ocean': 'Ocean',
    'settings.theme.forest': 'Forest',

    'settings.llm': 'LLM Configuration',
    'settings.llm.apiKey': 'API Key',
    'settings.llm.apiKey.ph': 'sk-...',
    'settings.llm.apiKey.hint': 'Your API Key is stored locally in the browser and never sent to any third-party server.',
    'settings.llm.apiBase': 'API Base URL (optional)',
    'settings.llm.apiBase.ph': 'https://api.deepseek.com',
    'settings.llm.apiBase.hint': 'Leave empty to use the default (DeepSeek). Fill in to use other OpenAI-compatible endpoints.',
    'settings.llm.model': 'Model Name',
    'settings.llm.model.ph': 'Click refresh to fetch available models, or enter manually',
    'settings.llm.refreshModels': 'Refresh Model List',
    'settings.llm.model.hint': 'Select or enter the model name. Click refresh to fetch available models from the current API base.',
    'settings.llm.systemPrompt': 'Custom System Prompt (optional)',
    'settings.llm.systemPrompt.ph': 'e.g., Please answer concisely in English with source citations',
    'settings.llm.systemPrompt.hint': 'Appended after the default prompt for personalizing AI behavior. Leave empty to use defaults.',

    'settings.tts': 'TTS Voice Configuration',
    'settings.tts.appId': 'App ID',
    'settings.tts.appId.ph': 'App ID from Volcengine console',
    'settings.tts.accessKey': 'Access Token',
    'settings.tts.accessKey.ph': 'Access Token from Volcengine console',
    'settings.tts.resourceId': 'Resource ID',
    'settings.tts.resourceId.ph': 'seed-tts-2.0',
    'settings.tts.resourceId.hint': 'Default: seed-tts-2.0 (Doubao TTS model 2.0).',
    'settings.tts.speaker': 'Speaker',
    'settings.tts.speaker.ph': 'zh_female_vv_uranus_bigtts',
    'settings.tts.speaker.hint': 'Default: zh_female_vv_uranus_bigtts. See the speaker list for more options.',
    'settings.tts.autoPlay': 'Auto-play TTS after AI response',

    'settings.ocr': 'OCR Configuration',
    'settings.ocr.apiKey': 'API Key',
    'settings.ocr.apiKey.ph': 'API Key from Zhipu AI platform',
    'settings.ocr.apiKey.hint': 'Used for GLM-OCR text recognition. Get your API Key at open.bigmodel.cn.',

    'settings.suggest': 'Suggested Follow-ups',
    'settings.suggest.toggle': 'Auto-generate suggested questions after AI response',

    'settings.save': 'Save Settings',
    'settings.saved': 'Saved ✓',

    'settings.commands': 'Quick Commands',
    'settings.commands.hint': 'Type <code>/</code> in the chat input to quickly invoke commands. Changes take effect immediately.',
    'settings.commands.empty': 'No quick commands yet. Click the button below to add one.',
    'settings.commands.add': '+ Add Command',
    'settings.commands.name.ph': 'Command name (no spaces or /)',
    'settings.commands.prompt.ph': 'Prompt content',
    'settings.commands.cancel': 'Cancel',
    'settings.commands.save': 'Save',
    'settings.commands.edit': 'Edit',
    'settings.commands.delete': 'Delete',

    'settings.data': 'Data Management',
    'settings.data.hint': 'Export all settings (LLM config, TTS config, quick commands) as a JSON backup, or import from a backup file.',
    'settings.data.export': 'Export Settings',
    'settings.data.import': 'Import Settings',

    'sidebar.history': 'Chat History',
    'sidebar.back': 'Back',
    'sidebar.newChat': 'New Chat',
    'sidebar.exportChat': 'Export Chat',
    'sidebar.settings': 'Settings',
    'sidebar.uploadImage': 'Upload Image',
    'sidebar.remove': 'Remove',
    'sidebar.input.ph': 'Ask a question based on the current page...',
    'sidebar.send': 'Send',
    'sidebar.clearQuote': 'Clear quote',
    'sidebar.welcome': 'Open any webpage, then click a button above or type a question to get started.',
    'sidebar.modelStatus': 'Current model: ',
    'sidebar.historyEmpty': 'No chat history',
    'sidebar.dropHint': 'Drop to upload image',

    'action.summarize': 'Summarize',
    'action.translate': 'Translate',
    'action.keyInfo': 'Key Info',
    'action.retry': 'Retry',
    'action.copy': 'Copy',
    'action.copied': 'Copied',
    'action.tts': 'Read Aloud',
    'action.ttsDownload': 'Download Audio',
    'action.export': 'Export',
    'action.outline': 'Outline',
    'outline.title': 'Article Outline',
    'outline.copySuccess': 'Outline copied',
    'outline.export': 'Export Markdown',
    'outline.noContent': 'Please open a webpage first',
    'outline.parseError': 'Failed to parse outline, please retry',
    'outline.tooShort': 'Content is too short for a meaningful outline',
    'outline.copy': 'Copy Outline',
    'outline.label.summary': 'Core Argument',
    'outline.label.data': 'Key Data',
    'outline.label.quote': 'Original Quote',

    'error.noApiKey': 'Please configure API Key in Settings',
    'error.noApiKeySave': 'Please enter an API Key',
    'error.apiKeyHint': 'Hint: Standard OpenAI keys start with sk-. If using a third-party API, also fill in the API Base URL',
    'error.apiFailed': 'API request failed',
    'error.noTtsConfig': 'Please configure TTS in Settings',
    'error.ttsFailed': 'TTS request failed',
    'error.ttsError': 'TTS error',
    'error.ttsSynthFailed': 'TTS synthesis failed',
    'error.noApiKeySuggest': 'API Key not configured, cannot generate suggestions',
    'error.fetchModelsFailed': 'Failed to fetch model list',
    'error.noOcrApiKey': 'Please configure OCR API Key in Settings',
    'error.ocrFailed': 'OCR request failed',
    'error.extractFailed': 'Failed to extract page content',
    'error.noTab': 'Cannot access current tab',
    'error.ocrRunning': 'OCR in progress, please wait...',
    'error.ocrPartialFail': 'Some images failed OCR. Please remove them and try again',

    'status.loading': 'Loading...',
    'status.modelsLoaded': '{n} models loaded',
    'status.settingsSaved': 'Settings saved',
    'status.commandEmpty': 'Command name and content cannot be empty',
    'status.commandInvalid': 'Command name cannot contain spaces or /',
    'status.commandDuplicate': 'Command name already exists',
    'status.commandSaved': 'Command saved',
    'status.commandDeleted': 'Command deleted',
    'status.exported': 'Settings exported',
    'status.invalidFile': 'Invalid settings file format',
    'status.imported': 'Settings imported and saved',
    'status.parseError': 'Failed to parse file: ',
    'status.ttsDownloading': 'Generating audio...',

    'chat.today': 'Today',
    'chat.yesterday': 'Yesterday',
    'chat.newChat': 'New Chat',
    'chat.exportTitle': 'PearReader — Chat Record',
    'chat.exportPage': 'Page: ',
    'chat.exportTime': 'Export time: ',
    'chat.exportModel': 'Model: ',
    'chat.user': '👤 User',
    'chat.ai': '🤖 AI Assistant',

    'cmd.noMatch': 'No matching commands',

    'ai.thinking': 'Thinking',
    'ai.truncated': '[Content too long, truncated]',
    'ai.quoteTruncated': '[Quote too long, truncated]',
    'ai.quotePrefix': 'The following is content quoted by the user from the page:',
    'ai.ocrContext': 'Content of image #{n}:\n',

    'prompt.default': 'You are an AI reading assistant. The user is reading a webpage article. Below is the article content. Please answer the user\'s questions based on this content.\n\nArticle title: {title}\n\nArticle content:\n{content}',
    'prompt.summarize.full': 'Please summarize this webpage content. Requirements:\n1. Summarize the core content in 3-5 key points\n2. Stay objective, do not add information not in the original text\n3. Keep the language concise and clear',
    'prompt.summarize.quote': 'Please summarize the quoted content. Requirements:\n1. Summarize the core content in 3-5 key points\n2. Stay objective, do not add information not in the original text\n3. Keep the language concise and clear',
    'prompt.translate.full': 'Please translate this webpage content into Chinese. Requirements:\n1. Accurately convey the original meaning\n2. Use natural and fluent language\n3. Keep technical terms in English with Chinese explanations',
    'prompt.translate.quote': 'Please translate the quoted content into Chinese. Requirements:\n1. Accurately convey the original meaning\n2. Use natural and fluent language\n3. Keep technical terms in English with Chinese explanations',
    'prompt.keyInfo.full': 'Please extract key information from this webpage content. Requirements:\n1. List all important facts, data, and viewpoints\n2. Sort by importance\n3. Keep each point concise and clear',
    'prompt.keyInfo.quote': 'Please extract key information from the quoted content. Requirements:\n1. List all important facts, data, and viewpoints\n2. Sort by importance\n3. Keep each point concise and clear',

    // Podcast
    'podcast.button': 'Podcast',
    'podcast.cardTitle': 'Podcast',
    'podcast.generatingScript': 'Generating script...',
    'podcast.generatingAudio': 'Synthesizing audio...',
    'podcast.play': 'Play',
    'podcast.pause': 'Pause',
    'podcast.done': 'Playback complete',
    'podcast.replay': 'Replay',
    'podcast.error': 'Generation failed',
    'podcast.retry': 'Retry',
    'podcast.noContent': 'No page content available',
    'podcast.noTtsConfig': 'Please configure TTS credentials in settings first',
    'podcast.scriptParseError': 'Script format error, cannot generate podcast',
    'podcast.audioError': 'Podcast audio synthesis failed',
    'podcast.download': 'Download Audio',
    'podcast.downloading': 'Downloading...',
    'podcast.fileName': 'podcast',

    // Chart Analyzer
    'chart.button': 'Chart',
    'chart.noCharts': 'No charts detected',
    'chart.detecting': 'Scanning for charts...',
    'chart.detected': 'Detected {n} chart(s)',
    'chart.extracting': 'Extracting data...',
    'chart.analyzing': 'Analyzing data...',
    'chart.extractFailed': 'Chart data extraction failed',
    'chart.analyzeFailed': 'Data analysis failed',
    'chart.noContent': 'No chart content to analyze',
    'chart.noOcrApiKey': 'Please configure ZhiPu AI API Key in settings (for chart recognition)',
    'chart.noApiKey': 'Please configure API Key in settings',
    'chart.cardTitle': 'Chart Analysis',
    'chart.typeCanvas': 'Canvas Chart',
    'chart.typeSVG': 'SVG Chart',
    'chart.typeImage': 'Image Chart',
    'chart.selectChart': 'Select a chart to analyze',
    'chart.analyze': 'Analyze',
    'chart.insights': 'Data Insights',
    'chart.data': 'Data Table',
    'chart.stats': 'Statistics',
    'chart.exportCSV': 'Export CSV',
    'chart.exportJSON': 'Export JSON',
    'chart.copy': 'Copy Data',
    'chart.copied': 'Copied',
    'chart.noData': 'No valid data extracted',
    'chart.close': 'Close',
    'chart.label': 'Label',
    'chart.value': 'Value',
    'chart.series': 'Series',
    'chart.statMean': 'Mean',
    'chart.statMax': 'Max',
    'chart.statMin': 'Min',
    'chart.statGrowth': 'Growth',

    'prompt.suggest': 'You are a reading assistant. Based on the conversation history, generate 3 in-depth follow-up questions to help the user better understand the article. One question per line, no numbering, no extra explanation.',
    'prompt.suggestUser': 'User question: ',
    'prompt.suggestAI': 'AI response: ',
    'prompt.outline': 'You are a content analysis expert. Analyze the article content into a structured outline.\n\nRequirements:\n1. Generate 2-5 top-level sections, each with 0-4 subsections\n2. For each section node, provide:\n   - "summary": core argument (1-2 sentences)\n   - "data": key data points list (numbers, metrics, comparisons; empty array if none)\n   - "quote": most relevant original text passage (one paragraph)\n3. Section headings should reflect the article\'s logical structure, not simply restate original headings\n\nReturn strictly in the following JSON format, with no other text:\n{\n  "title": "Article main thesis (one sentence)",\n  "sections": [\n    {\n      "heading": "Section title",\n      "summary": "...",\n      "data": ["...", "..."],\n      "quote": "...",\n      "children": [\n        {\n          "heading": "Subsection title",\n          "summary": "...",\n          "data": [],\n          "quote": "...",\n          "children": []\n        }\n      ]\n    }\n  ]\n}',
  }
};

let currentLang = 'zh';

export function t(key, params) {
  let text = TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS.zh[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return text;
}

export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (el.tagName === 'OPTION') {
      el.textContent = t(key);
    } else {
      el.textContent = t(key);
    }
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    el.innerHTML = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
}

export function setLanguage(lang) {
  currentLang = lang;
  applyTranslations();
}

export function loadLanguage(callback) {
  chrome.storage.sync.get(['language'], (data) => {
    currentLang = data.language || 'zh';
    applyTranslations();
    if (callback) callback(currentLang);
  });
}

export function getCurrentLang() {
  return currentLang;
}

if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.language) {
      currentLang = changes.language.newValue || 'zh';
      applyTranslations();
    }
  });
}
