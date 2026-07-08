---
name: slack-messaging
description: "Slack channel and thread messaging skill with context-aware session management. Reads messages, sends replies, searches channels and users, drafts and schedules messages -- all via Slack MCP tools. Use this skill whenever the user wants to read Slack messages, reply in Slack, send a Slack message, check a Slack channel, respond to a Slack thread, monitor Slack conversations, draft a Slack message, schedule a Slack message, find a Slack channel or user, or do anything involving Slack communication. Also activate when the user mentions 'check Slack', 'reply on Slack', 'send to #channel', 'DM someone on Slack', 'what did they say in Slack', 'catch up on Slack', 'Slack thread', 'post in Slack', or references any Slack channel by name (e.g., '#general', '#engineering'). This skill manages session boundaries: thread replies stay in the same session to preserve conversational context, while new top-level channel messages start a fresh session to keep conversations isolated."
metadata:
  version: 1.0.0
  tags: slack, messaging, channels, threads, communication, mcp, chat, team-communication
---

# Slack Messaging

Read, send, search, draft, and schedule Slack messages across channels and threads. This skill wraps the Slack MCP tools with clear workflows and -- critically -- enforces context boundaries: thread conversations keep their context within a single session, while each new channel-level conversation gets a fresh session.

---

## Why Context Boundaries Matter

Slack conversations have natural scoping. A thread is one continuous discussion -- if you lose context mid-thread, your replies become disjointed and unhelpful. But two unrelated messages in a channel are separate conversations -- mixing their context causes confusion and information leakage between topics.

This skill enforces these boundaries so your Slack interactions stay coherent:

- **Thread = one session.** All replies within the same thread share context. You remember what was said earlier in the thread and can reference it.
- **New channel message = new session.** Each top-level message you respond to in a channel starts fresh. No carryover from previous conversations.

---

## Session Management Rules

### When to Keep the Same Session (Thread Continuity)

Stay in the **same Claude Code session** when:

1. You are replying to a thread and need to send a follow-up reply in that same thread
2. The user asks you to continue a conversation you already started in a thread
3. You are reading and responding to multiple messages within a single thread
4. The user says things like "reply again", "follow up", "add to that thread", "also mention..."

In practice: if you have a `thread_ts` and you're sending another message with the same `thread_ts`, you are in the same conversation. Keep your context.

### When to Start a New Session (Channel Isolation)

Start a **new Claude Code session** (fresh context) when:

1. The user asks you to respond to a different top-level message in a channel
2. You move from one channel conversation to an unrelated one
3. The user asks you to "check Slack" or "read messages" in a channel -- each message that needs a response is its own session
4. The user says things like "now respond to that other message", "handle the next one", "what about the message from [someone else]"

**How to start a new session**: Tell the user explicitly: "This is a separate conversation. To keep context clean, please start a new Claude Code session (`claude` in terminal) for this response." If running autonomously, use subagents -- each top-level channel message gets its own subagent to maintain isolation.

---

## Available Tools

All tools are accessed via the Slack MCP integration. Here is what each one does and when to use it:

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `slack_read_channel` | Read messages from a channel (newest first) | `channel_id`, `limit`, `oldest`, `latest` |
| `slack_read_thread` | Read all replies in a thread | `channel_id`, `message_ts` |
| `slack_send_message` | Send a message to a channel or thread | `channel_id`, `message`, `thread_ts` (for replies) |
| `slack_send_message_draft` | Save a draft without sending | `channel_id`, `message`, `thread_ts` |
| `slack_schedule_message` | Schedule a message for later | `channel_id`, `message`, `post_at` (Unix timestamp) |
| `slack_search_channels` | Find channels by name or description | `query` |
| `slack_search_users` | Find users by name, email, or role | `query` |
| `slack_search_public` | Search messages in public channels | `query` with search modifiers |
| `slack_search_public_and_private` | Search all channels (needs user consent) | `query` with search modifiers |

### Resolving IDs

Most tools require `channel_id` rather than channel names. Always resolve names to IDs first:

1. **Channel**: Use `slack_search_channels` with the channel name (e.g., query "engineering") to get the `channel_id`
2. **User**: Use `slack_search_users` with the person's name or email to get their `user_id` (usable as `channel_id` for DMs)

Cache resolved IDs within your session to avoid redundant lookups.

---

## Core Workflows

### 1. Read Channel Messages

```
1. Resolve channel name -> channel_id (slack_search_channels)
2. Read messages (slack_read_channel with channel_id)
3. Present a summary: who said what, timestamps, thread indicators
4. If a message has thread replies, note the reply count
```

**Tip**: Use `limit` to control how many messages to fetch (default 100, max 100). Use `oldest`/`latest` timestamps to narrow a time range.

### 2. Read a Thread

```
1. Get the channel_id and parent message's timestamp (message_ts)
2. Read thread (slack_read_thread with channel_id + message_ts)
3. Present the full conversation in order
```

The `message_ts` is the timestamp of the parent message that started the thread. You get it from `slack_read_channel` results or from a link the user shares.

### 3. Send a Channel Message

```
1. Resolve channel_id
2. Draft the message content
3. Show the draft to the user for approval
4. Send (slack_send_message with channel_id + message)
5. Report the message link back to the user
```

### 4. Reply in a Thread

```
1. Get channel_id and the parent message's thread_ts
2. Read the existing thread for context (slack_read_thread)
3. Draft your reply informed by thread context
4. Show draft to user for approval
5. Send (slack_send_message with channel_id + message + thread_ts)
6. Report the message link
```

Set `reply_broadcast: true` if the reply should also appear in the main channel (the user must request this -- don't default to it, as it notifies everyone in the channel).

### 5. Draft a Message (Without Sending)

```
1. Resolve channel_id
2. Compose the message
3. Save draft (slack_send_message_draft)
4. Tell the user where to find it: Slack's "Drafts & Sent" section
```

Only one draft per channel is allowed. If a draft already exists, tell the user to edit or delete it in Slack first.

### 6. Schedule a Message

```
1. Resolve channel_id
2. Compose the message
3. Convert the desired time to a Unix timestamp (must be at least 2 minutes in the future, max 120 days)
4. Schedule (slack_schedule_message with channel_id + message + post_at)
5. Confirm the scheduled time to the user
```

### 7. Search Messages

```
1. Choose search scope:
   - Public only: slack_search_public (no consent needed)
   - All channels: slack_search_public_and_private (ask user consent first)
2. Build query with modifiers:
   - in:#channel-name  — filter by channel
   - from:@username    — filter by author
   - before:/after:/on:YYYY-MM-DD — date filters
   - "exact phrase"    — exact match
   - is:thread         — only threaded messages
3. Present results with context
```

### 8. Monitor and Respond to Channel (Multi-Message)

This is where session management matters most. When the user asks you to "check Slack and respond to messages":

```
1. Read the channel (slack_read_channel)
2. Identify messages that need responses
3. For each message that needs a response:
   a. If it's a thread reply -> read the full thread first (same session if it's one thread)
   b. If it's a new top-level message -> TELL THE USER to handle it in a new session
      OR spawn a subagent for isolation
4. Draft each response with appropriate context
5. Get approval before sending anything
```

The critical rule: **never mix context between unrelated channel conversations.** If you're handling message A about a deployment issue and message B about a team lunch, those are separate sessions.

---

## Message Formatting

Slack uses its own markdown variant (mrkdwn). Follow these rules:

| Format | Syntax | Note |
|--------|--------|------|
| Bold | `*bold*` | Single asterisks, NOT double |
| Italic | `_italic_` | Underscores |
| Code | `` `code` `` | Backticks |
| Code block | ` ```code``` ` | Triple backticks |
| Quote | `> quoted text` | Angle bracket |
| Link | `<https://example.com\|display text>` | Pipe separator |
| User mention | `<@USER_ID>` | Use resolved user ID |
| Channel mention | `<#CHANNEL_ID>` | Use resolved channel ID |

Do NOT use `**double asterisks**` or `## headers` -- they don't render in Slack.

---

## Approval Before Sending

Never send a message without the user's explicit approval. The workflow is always:

1. **Draft** the message
2. **Present** it: show the exact text, the target channel/thread, and who will see it
3. **Wait** for "send it", "looks good", "approved", or similar confirmation
4. **Send** only after approval
5. **Report** the message link

This exists because Slack messages are visible to your team immediately. A poorly worded message, a reply in the wrong thread, or an accidental channel ping can't be unseen. The 10-second approval step prevents real embarrassment.

---

## DMs (Direct Messages)

To send a DM, use the recipient's `user_id` as the `channel_id` in `slack_send_message`. Find their user_id with `slack_search_users`.

To read DMs, use `slack_read_channel` with the DM channel ID. You can find DM channels by searching with `slack_search_public_and_private` using `in:@username`.

---

## Error Handling

| Error | What It Means | What to Do |
|-------|---------------|------------|
| `channel_not_found` | Bad channel ID or no access | Re-resolve with `slack_search_channels` |
| `not_in_channel` | Bot/user not a member | Ask user to invite you or join the channel |
| `msg_too_long` | Over 5000 chars | Split the message into parts |
| `draft_already_exists` | One draft per channel limit | Tell user to clear existing draft in Slack |
| `invalid_scheduled_time` | `post_at` not 2+ min in future | Recalculate the timestamp |

---

## Quick Reference: Tool Selection

| "I want to..." | Tool |
|----------------|------|
| Read recent messages in #channel | `slack_read_channel` |
| Read a full thread | `slack_read_thread` |
| Send a message to #channel | `slack_send_message` |
| Reply in a thread | `slack_send_message` + `thread_ts` |
| Send a DM | `slack_send_message` + user_id as channel_id |
| Save a draft | `slack_send_message_draft` |
| Schedule for later | `slack_schedule_message` |
| Find a channel ID | `slack_search_channels` |
| Find a user ID | `slack_search_users` |
| Search message history | `slack_search_public` or `slack_search_public_and_private` |
