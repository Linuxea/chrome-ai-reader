#!/usr/bin/env python3
"""F15 web search, end to end: the BUILT extension against the LIVE DeepSeek API.

Drives the real side-panel UI (opened as a tab), the real ai-chat port, the
real service worker and the real provider code, and checks what the user sees
plus what actually went over the wire:

    composer switch -> send pipeline -> ai-chat port -> service worker -> live API
    -> progress events -> trace line + source chips -> persistence -> reload

Not part of `npm test` (it needs a browser, network and an API key): it is the
regression run for the acceptance criteria AC-01..AC-08 in
docs/design/设计方案_F15_联网搜索.md.

Prerequisites
  - python3 with Playwright (`pip install playwright`); a Chrome for Testing
    under ~/.cache/ms-playwright, or F15_CHROME=<path to the chrome binary>
  - `npm run build` (dist/ is what gets loaded)
  - DEEPSEEK_API_KEY in the environment (never printed)

Usage
  python3 scripts/e2e-web-search.py              # the full run, ~1.5 min
  F15_FAULT=1 python3 scripts/e2e-web-search.py  # also drop the first stream once
                                                 # (exercises the automatic retry)
  F15_E2E_OUT=<dir>    where screenshots / captured requests / results.json go
                      (default /tmp/opencode/e2e)
  F15_USE_PROXY=1      keep the environment's proxy (default: connect direct)

How it is set up
  - Chrome for Testing, new headless, dist/ loaded as an unpacked extension in
    a throw-away profile.
  - The side-panel page is opened as a TAB. Its per-tab state is seeded with a
    short article, so page extraction (not part of this feature) is skipped and
    the model's "search or not" decision is made on a known text.
  - The worker's fetch is hooked from inside the service worker: every request
    body is captured (the real wire format), and responses are tee'd to disk.
"""
import glob
import json
import os
import re
import sys
import time
import traceback

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.environ.get('F15_DIST') or os.path.join(ROOT, 'dist')
OUT = os.environ.get('F15_E2E_OUT') or '/tmp/opencode/e2e'
PROFILE = os.path.join(OUT, 'profile')


def find_chrome():
    """F15_CHROME, else the newest Chrome for Testing in Playwright's cache."""
    if os.environ.get('F15_CHROME'):
        return os.environ['F15_CHROME']
    found = glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome'))
    return sorted(found, key=lambda p: [int(x) for x in re.findall(r'chromium-(\d+)', p)] or [0])[-1] if found else None


# The article the panel is "reading": DeepSeek's 2026-11-13 release note (the
# same text the phase-0 measurements used).
ARTICLE = """在 DeepSeek App（含网页端）的对话服务中，联网搜索、文件输入、阅读链接、语音交互及安全等能力与模型推理相互配合，构成了用户熟悉的对话体验。而开发者如果想要在应用中实现类似功能，除接入原有 DeepSeek API 外，往往还需耗费大量精力去对接外部工具、处理调用衔接。

今天，我们正式开放这套全家桶应用 API：在原有 API 中开启对应参数，即可获得深度思考搜索、文件输入等对话功能；语音及相关底层能力也已开放独立接口（含 OCR、ASR、TTS 等），支持单独或组合调用。开发者可以在自己的应用中轻松实现复杂的对话功能，甚至 1:1 复刻出完整的 DeepSeek App。

本次更新将 DeepSeek App 的各项交互功能直接整合进原有 API。开启对应参数后，相关工具调用与上下文拼接均由服务端自动完成。目前，V4.1-Flash 模型（deepseek-flash）已在 Messages、Responses 与 Chat Completions 接口下支持以下能力：

联网搜索：在非思考模式下，打开 deepseek_web_search 工具后，模型可根据提问自动发起网页或图片搜索并附引用作答；深度思考搜索：在思考模式下，打开 deepseek_web_search 工具后，模型可在多步推理中自主联网搜索与阅读链接；文件输入：支持上传 PDF、Office、图片等格式的文件，完成纯文本提取或图文版面解析后，拼入对话上下文供模型作答；阅读链接：将 deepseek_read_url 工具打开后，模型可自动识别用户消息中的链接，抓取网页内容并结合上下文作答；模型安全：开启安全校验参数后，我们将提供基础风控，审核模型输入输出，命中风险时返回拒答标识。

此外，为方便开发者更灵活地接入自有工作流，上述底层能力及语音能力均支持作为独立接口单独调用，包括：Search、Fetch、OCR、ASR、TTS。使用上述接口，开发者即可实现与 DeepSeek App 基本一致的功能。为直观演示这一效果，我们基于新版 API 构建并开源了一份轻量的前端 Demo，支持直接导入 DeepSeek 历史对话。

用户调用 DeepSeek API 使用扩展能力时，除收取 Token 费用外，也将收取相关工具的调用费用。"""
KEY = os.environ.get('DEEPSEEK_API_KEY')
if not KEY:
    sys.exit('missing DEEPSEEK_API_KEY')

os.makedirs(OUT, exist_ok=True)
RESULTS = []


def check(name, ok, detail=''):
    ok = bool(ok)
    RESULTS.append({'name': name, 'ok': ok, 'detail': str(detail)})
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  — {detail}' if detail else ''), flush=True)


def launch(p):
    args = [f'--disable-extensions-except={DIST}', f'--load-extension={DIST}', '--no-sandbox', '--disable-dev-shm-usage']
    # Direct by default: Chrome honours HTTP(S)_PROXY from the environment.
    if not os.environ.get('F15_USE_PROXY'):
        args.append('--no-proxy-server')
    try:
        return p.chromium.launch_persistent_context(PROFILE, headless=True, channel='chromium', args=args), 'channel=chromium'
    except Exception as e:  # revision not in the cache → use the binary that exists
        print('channel=chromium unavailable:', str(e)[:160])
    chrome = find_chrome()
    if not chrome or not os.path.exists(chrome):
        raise SystemExit('no Chromium found: set F15_CHROME or install a Chrome for Testing')
    return p.chromium.launch_persistent_context(PROFILE, headless=True, executable_path=chrome, args=args), chrome


SEED = """async ({ key, article }) => {
  await chrome.storage.local.set({ apiKey: key });
  await chrome.storage.sync.set({ provider: 'openai', apiBase: '', modelName: 'deepseek-flash', language: 'zh' });
  // Remove anything a previous run left, so the defaults apply (search ON, suggestions ON, agent OFF).
  await chrome.storage.sync.remove(['webSearch', 'suggestQuestions', 'agentMode', 'citations']);
  const tab = await chrome.tabs.getCurrent();
  const paragraphs = article.split(/\\n\\n\\s*/).map(s => s.trim()).filter(Boolean);
  await chrome.storage.session.set({ ['tabState_' + tab.id]: {
    pageContent: article, pageTitle: 'DeepSeek 发布全家桶应用 API', pageExcerpt: paragraphs[0].slice(0, 80),
    pageUrl: location.href, pageParagraphs: paragraphs,
    conversationHistory: [], currentChatId: null, selectedText: '',
    isGenerating: false, isPodcastGenerating: false, imageIndex: 0 } });
  return tab.id;
}"""

PING = "() => { chrome.runtime.sendMessage('f15-ping'); return true; }"

HOOK = """() => {
  if (self.__f15) return 'already';
  self.__f15 = true;
  const orig = self.fetch.bind(self);
  // Worker-side errors / rejections, where Playwright cannot read the console.
  const log = (kind, text) => { try { chrome.storage.session.set({ ['f15log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)]: kind + ': ' + text }); } catch (e) {} };
  self.addEventListener('error', e => log('error', (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')));
  self.addEventListener('unhandledrejection', e => log('unhandledrejection', e.reason && (e.reason.stack || e.reason.message || String(e.reason))));
  for (const level of ['error', 'warn']) {
    const fn = console[level].bind(console);
    console[level] = (...a) => { log('console.' + level, a.map(x => x && x.stack || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')); fn(...a); };
  }
  self.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const watched = init && typeof init.body === 'string' && url.endsWith('/chat/completions');
    const id = 'f15_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    if (watched) chrome.storage.session.set({ [id + 'req']: init.body });
    return orig(input, init).then(res => {
      if (!watched) return res;
      // Tee the stream: one branch for the provider, one kept verbatim as evidence.
      const [mine, theirs] = res.body.tee();
      new Response(theirs).text().then(t => chrome.storage.session.set({ [id + 'raw']: t })).catch(() => {});
      // Fault injection (E2E only): drop `left` more successful streams right
      // after their first search event — the "connection lost before any
      // answer text" case the worker is supposed to retry.
      if (res.ok && self.__f15fault && self.__f15fault.left > 0) {
        self.__f15fault.left -= 1;
        const reader = mine.getReader();
        let seen = '';
        const broken = new ReadableStream({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) { controller.close(); return; }
              controller.enqueue(value);
              seen += new TextDecoder().decode(value, { stream: true });
              if (seen.includes('"call_started"')) { controller.error(new TypeError('network error (injected)')); reader.cancel().catch(() => {}); }
            } catch (e) { controller.error(e); }
          },
          cancel(reason) { return reader.cancel(reason); },
        });
        return new Response(broken, { status: res.status, statusText: res.statusText, headers: res.headers });
      }
      return new Response(mine, { status: res.status, statusText: res.statusText, headers: res.headers });
    });
  };
  return 'hooked';
}"""

TAKE_EVIDENCE = """async () => {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('f15_') || k.startsWith('f15log_'));
  // Request bodies are handed over once; raw streams and logs stay until the browser exits.
  const reqKeys = keys.filter(k => k.endsWith('req'));
  if (reqKeys.length) await chrome.storage.session.remove(reqKeys);
  return keys.sort().map(k => [k, all[k]]);
}"""

TYPE_AND_SEND = """(text) => {
  const el = document.querySelector('#userInput');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}"""

LAST_ANSWER = """() => {
  const msgs = [...document.querySelectorAll('.chat-area .ai-msg')];
  const m = msgs[msgs.length - 1];
  if (!m) return null;
  const trace = m.querySelector('.web-steps');
  const md = m.querySelector('.md-body');
  return {
    summary: trace ? trace.querySelector('summary').textContent : null,
    searching: trace ? trace.className.includes('searching') : false,
    open: trace ? trace.hasAttribute('open') : null,
    steps: [...m.querySelectorAll('.web-step')].map(s => ({ cls: s.className, text: (s.querySelector('.web-step-line') || s).textContent })),
    cards: [...m.querySelectorAll('.web-results a')].map(a => ({ href: a.getAttribute('href'), text: a.textContent })),
    chips: [...m.querySelectorAll('.web-cite')].map(c => ({ tag: c.tagName, text: c.textContent, href: c.getAttribute('href'),
             target: c.getAttribute('target'), rel: c.getAttribute('rel'), title: c.getAttribute('title') })),
    text: md ? md.textContent : null,
    error: (document.querySelector('.error-card') || {}).textContent || null,
    note: (document.querySelector('.msg-note') || {}).textContent || null,
  };
}"""

ANSWER_AT = """(i) => {
  const msgs = [...document.querySelectorAll('.chat-area .ai-msg')];
  const m = msgs[i];
  if (!m) return null;
  const trace = m.querySelector('.web-steps');
  return { summary: trace ? trace.querySelector('summary').textContent : null, chips: m.querySelectorAll('.web-cite').length,
           steps: m.querySelectorAll('.web-step').length, text: (m.querySelector('.md-body') || m).textContent.slice(0, 60) };
}"""

HISTORY = """async () => {
  const tab = await chrome.tabs.getCurrent();
  const s = (await chrome.storage.session.get('tabState_' + tab.id))['tabState_' + tab.id];
  return s ? s.conversationHistory : null;
}"""

SYNC_GET = "async (keys) => await chrome.storage.sync.get(keys)"
SYNC_SET = "async (values) => { await chrome.storage.sync.set(values); return true; }"
LEAK = '\ue000'

# Every toast the panel shows during the run (they auto-dismiss after 3 s).
OBSERVE_TOASTS = """() => {
  if (window.__f15obs) return;
  window.__f15obs = [];
  new MutationObserver(() => {
    for (const el of document.querySelectorAll('.toast')) {
      const text = el.textContent || '';
      if (text && !window.__f15obs.includes(text)) window.__f15obs.push(text);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}"""
TOASTS = "() => window.__f15obs || []"


def take_requests(page):
    """Request bodies seen since the last call; every raw stream / request / log is also written to disk."""
    ev = page.evaluate(TAKE_EVIDENCE)
    bodies = []
    for key, value in ev:
        path = f'{OUT}/{key}'
        if key.endswith('raw'):
            with open(path + '.txt', 'w', encoding='utf8') as f:
                f.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))
        elif key.startswith('f15log_'):
            print('  [worker]', value[:400], flush=True)
        elif key.endswith('req'):
            with open(path + '.json', 'w', encoding='utf8') as f:
                f.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))
            bodies.append(json.loads(value))
    return bodies


def chat_requests(bodies):
    return [b for b in bodies if any(isinstance(m.get('content'), str) and '你可以联网搜索' in m['content'] for m in b.get('messages', []))]


def ask(page, text, timeout=150_000):
    page.evaluate(TYPE_AND_SEND, text)
    page.click('.send-btn')
    page.wait_for_selector('.send-btn.stop', timeout=10_000)
    page.wait_for_function("() => !document.querySelector('.send-btn.stop')", timeout=timeout)


def main():
    console = []
    ctx = None
    with sync_playwright() as p:
        ctx, how = launch(p)
        print('browser:', how, flush=True)
        try:
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=20_000)
            ext_id = worker.url.split('/')[2]
            page = ctx.new_page()
            page.set_viewport_size({'width': 400, 'height': 860})
            page.on('console', lambda m: console.append(f'[panel:{m.type}] {m.text}') if m.type == 'error' else None)
            page.on('pageerror', lambda e: console.append(f'[panel:pageerror] {e}'))

            page.goto(f'chrome-extension://{ext_id}/src/panel/index.html')
            page.wait_for_load_state('networkidle')
            page.evaluate(SEED, {'key': KEY, 'article': ARTICLE})
            page.reload()
            page.wait_for_load_state('networkidle')
            page.wait_for_selector('.web-btn', timeout=15_000)
            page.evaluate(OBSERVE_TOASTS)

            # ---- default state: the switch is ON and nothing was stored to make it so
            btn = page.evaluate("() => { const b = document.querySelector('.web-btn'); return { cls: b.className, pressed: b.getAttribute('aria-pressed'), title: b.title }; }")
            check('R-01 default: switch is on without any stored setting',
                  btn['cls'] == 'web-btn on' and btn['pressed'] == 'true' and page.evaluate(SYNC_GET, ['webSearch']).get('webSearch') is None, btn)
            order = page.evaluate("() => { const k = [...document.querySelector('.input-wrapper').children]; return k.map(e => e.className.split(' ')[0] || e.tagName).join(','); }")
            check('switch sits between the input and the send button', order.endswith('user-input,web-btn,send-btn'), order)
            page.screenshot(path=f'{OUT}/01-switch-on.png')

            # ---- AC-01: a question that needs the web
            page.evaluate(PING)
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=10_000)
            check('worker fetch hooked', worker.evaluate(HOOK) in ('hooked', 'already'))
            if os.environ.get('F15_FAULT'):
                worker.evaluate("() => { self.__f15fault = { left: 1 }; return true; }")
                print('  fault injection armed: the first stream will drop after its first search event', flush=True)
                page.evaluate(OBSERVE_TOASTS)
            t0 = time.time()
            ask(page, '这篇文章发布之后，DeepSeek 又有什么新动态？')
            dt = time.time() - t0
            a = page.evaluate(LAST_ANSWER)
            print('  answer:', json.dumps(a, ensure_ascii=False)[:900], flush=True)
            print('  outcome: error=%r note=%r textChars=%s' % (a and a['error'], a and a['note'], len((a or {}).get('text') or '')), flush=True)
            check('AC-01 trace line above the answer', bool(a and a['summary'] and '已联网搜索' in a['summary']), a and a['summary'])
            check('AC-01 at least one search step, marked done', bool(a and len(a['steps']) >= 1 and all('done' in s['cls'] or 'failed' in s['cls'] for s in a['steps'])), a and len(a['steps']))
            chips = a['chips'] if a else []
            nums = [int(c['text']) for c in chips]
            first_seen = []
            for n in nums:
                if n not in first_seen:
                    first_seen.append(n)
            url_by_num = {}
            for c in chips:
                url_by_num.setdefault(int(c['text']), c['href'])
            numbered = first_seen == list(range(1, len(first_seen) + 1))
            one_url = all(url_by_num[int(c['text'])] == c['href'] for c in chips) and len(set(url_by_num.values())) == len(url_by_num)
            check('AC-01 numbered source chips (1, 2, 3… in order of first citation; a source may be cited again; one URL per number)',
                  len(nums) >= 1 and numbered and one_url, {'chips': nums, 'distinct sources': len(url_by_num)})
            check('R-10 chips are links opening the source in a new tab',
                  all(c['tag'] == 'A' and re.match(r'^https?://', c['href'] or '') and c['target'] == '_blank' and 'noopener' in (c['rel'] or '') and c['title'] for c in chips), chips[:2])
            check('R-12 no private-use marker left in the rendered answer', a and LEAK not in (a['text'] or '') and LEAK not in page.content())
            check('AC-01 answered in a reasonable time (<= 60 s)', dt <= 60, f'{dt:.1f}s')

            page.click('.web-steps > summary')   # expand the trace for the screenshot
            page.wait_for_timeout(300)
            page.screenshot(path=f'{OUT}/02-searched-answer.png')

            # ---- what actually went over the wire (R-03 / R-04 / R-05)
            page.wait_for_timeout(1500)
            bodies = take_requests(page)
            chats = chat_requests(bodies)
            check('a chat request was captured', len(chats) >= 1, len(chats))
            attempts = sum(1 for b in chats if (b['messages'][-1].get('content') or '').endswith('DeepSeek 又有什么新动态？'))
            print(f'  Q1 was sent {attempts} time(s)', flush=True)
            if chats:
                b = chats[-1]
                roles = [m['role'] for m in b['messages']]
                lead = 0
                while lead < len(roles) and roles[lead] == 'system':
                    lead += 1
                check('R-03 tool declared, nothing else added', b.get('tools') == [{'type': 'deepseek_web_search'}]
                      and 'web_search_options' not in b and 'tool_choice' not in b and 'thinking' not in b, b.get('tools'))
                check('R-04 rule is its own system message right after the panel\'s system messages',
                      '你可以联网搜索' in b['messages'][lead - 1]['content'] and sum('你可以联网搜索' in (m.get('content') or '') for m in b['messages'] if isinstance(m.get('content'), str)) == 1,
                      {'roles': roles[:lead + 2], 'ruleHead': b['messages'][lead - 1]['content'][:24]})
                check('R-05 latest_reminder directly before the last user message', roles[-2:] == ['latest_reminder', 'user'], roles[-3:])
                rem = b['messages'][-2]['content']
                check('R-05 reminder format + today\'s local date', bool(re.match(r'^\d{4}-\d{2}-\d{2},星期[一二三四五六日],,Web,中文$', rem)) and rem[:10] == time.strftime('%Y-%m-%d'), rem)
            suggests = [b for b in bodies if '生成 3 个有深度的后续问题' in json.dumps(b, ensure_ascii=False)]
            check('AC-08 the follow-up suggestions request declares no tool', bool(suggests) and all('tools' not in b and 'latest_reminder' not in [m['role'] for m in b['messages']] for b in suggests), len(suggests))

            hist = page.evaluate(HISTORY)
            last = hist[-1] if hist else {}
            web = last.get('web')
            check('R-08 answer saved with its web record', last.get('role') == 'assistant' and bool(web) and len(web['steps']) >= 1 and len(web['citations']) >= 1 and len(web['sources']) >= 1,
                  {k: len(web[k]) if isinstance(web.get(k), list) else web.get(k) for k in ('steps', 'sources', 'citations')} if web else None)
            check('R-08/R-12 stored Markdown is clean (copy / TTS / share read this)', LEAK not in last.get('content', '') and last.get('content', '').strip() != '')
            # Every chip points at its own entry of the saved source list.
            check('R-08/R-10 chip n links to saved source n', bool(web) and all(c['href'] == web['sources'][int(c['text']) - 1]['url'] and c['title'] == web['sources'][int(c['text']) - 1]['title'] for c in chips),
                  f"{len(chips)} chips / {len(web['sources']) if web else 0} saved sources")
            if os.environ.get('F15_FAULT'):
                toasts_now = page.evaluate(TOASTS)
                check('retry (injected drop): Q1 was sent twice with an identical body', attempts == 2 and len(chats) >= 2 and chats[0] == chats[-1], attempts)
                check('retry (injected drop): the panel said so', any('重试' in t for t in toasts_now), toasts_now)
                step_ids = [s['id'] for s in web['steps']] if web else []
                check('retry (injected drop): the saved trace holds only the retried attempt\'s calls (no duplicates)', len(step_ids) > 0 and len(step_ids) == len(set(step_ids)), len(step_ids))
            check('R-08 the web record is absent from what goes back to the model', all('web' not in m for m in (chats[-1]['messages'] if chats else [])))

            # ---- AC-02: a question the article answers
            ask(page, '这次开放了哪些能力？')
            a2 = page.evaluate(LAST_ANSWER)
            check('AC-02 article question: no search trace', bool(a2 and a2['summary'] is None and len(a2['steps']) == 0), a2 and a2['summary'])
            check('AC-02 article question: no source chips', bool(a2 and len(a2['chips']) == 0), a2 and len(a2['chips']))
            page.wait_for_timeout(1200)
            chats2 = chat_requests(take_requests(page))
            multi = chats2[-1] if chats2 else {}
            mroles = [m['role'] for m in multi.get('messages', [])]
            check('multi-turn: history of plain content accepted next to the tool (HTTP 200 implied by the answer)',
                  mroles.count('assistant') >= 1 and mroles[-2:] == ['latest_reminder', 'user'] and all('reasoning_content' not in m and 'web' not in m for m in multi.get('messages', [])), mroles)
            first = page.evaluate(ANSWER_AT, 0)

            # ---- AC-06: reload keeps the trace + chips
            page.reload()
            page.wait_for_load_state('networkidle')
            page.wait_for_selector('.web-steps', timeout=15_000)
            page.evaluate(OBSERVE_TOASTS)
            after = page.evaluate(ANSWER_AT, 0)
            check('AC-06 after reload the saved answer keeps its trace and chips', bool(after and after['summary'] and '已联网搜索' in after['summary'] and after['chips'] == (first or {}).get('chips') and after['chips'] > 0), after)
            page.screenshot(path=f'{OUT}/03-after-reload.png')

            # ---- AC-03: switch off -> the three web pieces are not sent
            page.evaluate(PING)
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=10_000)
            worker.evaluate(HOOK)
            page.click('.web-btn')
            page.wait_for_timeout(300)
            off = page.evaluate("() => ({ cls: document.querySelector('.web-btn').className, pressed: document.querySelector('.web-btn').getAttribute('aria-pressed') })")
            check('switch off: button state + stored setting', off == {'cls': 'web-btn', 'pressed': 'false'} and page.evaluate(SYNC_GET, ['webSearch']).get('webSearch') is False, off)
            page.screenshot(path=f'{OUT}/04-switch-off.png')
            take_requests(page)
            ask(page, '文章里提到的独立接口有哪些？')
            page.wait_for_timeout(1200)
            bodies3 = take_requests(page)
            plain = [b for b in bodies3 if '生成 3 个有深度的后续问题' not in json.dumps(b, ensure_ascii=False)]
            check('AC-03 switch off: request carries no tool, no rule, no reminder',
                  len(plain) >= 1 and all('tools' not in b and 'latest_reminder' not in [m['role'] for m in b['messages']]
                                          and not any(isinstance(m.get('content'), str) and '你可以联网搜索' in m['content'] for m in b['messages']) for b in plain),
                  [{'tools': b.get('tools'), 'roles': [m['role'] for m in b['messages']]} for b in plain])
            page.click('.web-btn')
            page.wait_for_timeout(300)
            check('switch back on: stored setting true', page.evaluate(SYNC_GET, ['webSearch']).get('webSearch') is True)

            # ---- AC-04: an endpoint that refuses the tool shows the API's own message
            page.evaluate(SYNC_SET, {'modelName': 'deepseek-v4-pro'})
            ask(page, '你好', timeout=60_000)
            err = page.evaluate("() => (document.querySelector('.error-card') || {}).textContent || null")
            page.evaluate(SYNC_SET, {'modelName': 'deepseek-flash'})
            check('AC-04 refused tool: the API message is shown, naming deepseek-flash, and the turn stays retryable',
                  bool(err and 'deepseek-flash' in err and '重新发送' in err), (err or '')[:160])
            page.screenshot(path=f'{OUT}/05-refused-tool.png')

            # ---- AC-05: stop while the model is searching
            page.evaluate(PING)
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=10_000)
            worker.evaluate(HOOK)
            page.evaluate(TYPE_AND_SEND, 'DeepSeek 目前最新的模型是什么？')
            page.click('.send-btn')
            page.wait_for_selector('.web-steps.searching', timeout=40_000)
            live = page.evaluate(LAST_ANSWER)
            print('  while searching:', json.dumps(live, ensure_ascii=False)[:400], flush=True)
            page.screenshot(path=f'{OUT}/06-searching.png')
            check('AC-05 the running search is visible while it happens', bool(live and live['searching'] and live['open'] and '正在联网搜索' in (live['summary'] or '')), live and live['summary'])
            page.click('.send-btn.stop')
            page.wait_for_function("() => !document.querySelector('.send-btn.stop')", timeout=15_000)
            page.wait_for_timeout(500)
            stopped = page.evaluate("() => ({ stop: !!document.querySelector('.send-btn.stop'), cursor: !!document.querySelector('.stream-cursor'), note: (document.querySelector('.msg-note') || {}).textContent || null, sendDisabled: (document.querySelector('.send-btn') || {}).disabled })")
            check('AC-05 stop aborts the request and the composer is usable again', stopped['stop'] is False and stopped['cursor'] is False and stopped['sendDisabled'] is True, stopped)
            check('panel is not stuck generating (a new send is accepted)', page.evaluate("() => { const s = document.querySelector('.send-btn'); return s && !s.classList.contains('stop'); }"))

            page.wait_for_timeout(1500)
        except Exception:
            traceback.print_exc()
            check('run completed without exceptions', False, 'exception — see traceback above')
        finally:
            try:
                toasts = page.evaluate(TOASTS)
                print('  toasts seen since the last page load:', toasts, flush=True)
            except Exception:
                pass
            try:
                page.screenshot(path=f'{OUT}/99-final.png') if 'page' in dir() else None
            except Exception:
                pass
            errs = list(console)
            check('no console errors in the panel or the worker', len(errs) == 0, errs[:4])
            ctx.close()

    passed = sum(1 for r in RESULTS if r['ok'])
    print(f'\n{passed}/{len(RESULTS)} checks passed', flush=True)
    with open(f'{OUT}/results.json', 'w', encoding='utf8') as f:
        json.dump({'passed': passed, 'total': len(RESULTS), 'results': RESULTS, 'console': console}, f, ensure_ascii=False, indent=1)
    sys.exit(0 if passed == len(RESULTS) else 1)


if __name__ == '__main__':
    main()
