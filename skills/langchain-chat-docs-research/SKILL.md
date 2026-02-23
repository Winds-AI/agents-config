---
name: langchain-chat-docs-research
description: Manual, low-token Chat LangChain research flow for complex LangChain, LangGraph, and LangSmith questions using `agent-browser`. Use when local code/docs are insufficient and you need direct answer text, code snippets, and docs links.
---
# LangChain Chat Docs Research

1. Open Chat LangChain.
agent-browser open https://chat.langchain.com

2. Start a clean thread for unrelated questions.
agent-browser find role button click --name "New Chat"

3. Write the research question.
agent-browser find placeholder "Ask me anything about LangChain..." fill "<QUESTION>"
report back if this fails, maybe placeholder changed on website.

4. Submit.
agent-browser press Enter

5. Wait until generation is done.

agent-browser wait --fn "(() => ![...document.querySelectorAll('button')].some(b => (b.textContent||'').trim()==='Stop'))()"
Purpose: stop polling as soon as `Stop` button disappears.

6. Extract last assistant response as JSON.
agent-browser eval --json "(() => { const last = Array.from(document.querySelectorAll('main .prose')).at(-1); if (!last) return { ok:false, error:'no_assistant_message_found' }; const text = (last.innerText||'').trim(); const code = Array.from(last.querySelectorAll('pre code')).map(x => (x.innerText||'').trim()); const links = Array.from(last.querySelectorAll('a[href]')).map(a => a.href); return { ok:true, text, code, links:Array.from(new Set(links)) }; })()"

Purpose: return full answer text + code blocks + links in one payload.

Read fields from result:

- `data.result.text`
- `data.result.code`
- `data.result.links`
