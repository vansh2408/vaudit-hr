/**
 * Slack Web API wrapper using global fetch.
 * Phase 0 stub — `sendSlackDm` opens an IM and posts a message.
 */

const SLACK_API = "https://slack.com/api";

interface SlackResponse {
  ok: boolean;
  error?: string;
  channel?: { id: string };
}

async function slackPost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<SlackResponse> {
  const token = process.env["SLACK_BOT_TOKEN"];
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is not configured");
  }
  const res = await fetch(`${SLACK_API}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as SlackResponse;
  if (!json.ok) {
    throw new Error(`Slack ${endpoint} failed: ${json.error ?? "unknown"}`);
  }
  return json;
}

export interface SendSlackDmInput {
  userId: string;
  text: string;
}

export async function sendSlackDm(input: SendSlackDmInput): Promise<void> {
  const open = await slackPost("conversations.open", { users: input.userId });
  const channelId = open.channel?.id;
  if (!channelId) {
    throw new Error("Slack conversations.open returned no channel id");
  }
  await slackPost("chat.postMessage", {
    channel: channelId,
    text: input.text,
  });
}
