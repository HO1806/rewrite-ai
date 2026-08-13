# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) rather than opening a public issue.

Include what you can: affected version, reproduction steps, and impact. Expect an acknowledgement within a few days.

## Threat model

Rewrite AI holds one thing worth attacking: your provider API key.

**How it is protected:**

- Stored in `chrome.storage.local`, never `chrome.storage.sync`, so it is not replicated to your Google account.
- Read only in the background service worker. The content script — which runs on every page — never loads settings, so the key does not enter a page's process.
- Sent only to the provider you have selected. Base URLs are restricted to `https`, or `http` on loopback for local model servers.
- Switching provider clears a base URL the new provider does not use, so a URL configured for one provider cannot receive another provider's key.
- Never written to the console. Validation failures report field paths, not values.

**What we rely on you for:**

- A base URL you enter for a custom server or Ollama receives your key. Only point it at hosts you trust.
- The extension requests `host_permissions` for the supported provider origins. A custom server needs an additional host grant.

## Scope

In scope: anything that exfiltrates the API key, injects script into a page, or escalates the extension's privileges.

Out of scope: the content of model output, and the security practices of the AI providers themselves.
