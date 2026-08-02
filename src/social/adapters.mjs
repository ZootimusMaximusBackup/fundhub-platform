// Social channel publish adapters — used by publishDue via registerDefaultAdapters.
//
// Facebook posts through Graph when the channel has a decrypted token.
// Instagram and other channels refuse unless SOCIAL_PUBLISH_DRY_RUN=1 so the
// cron can be verified without inventing provider credentials.

import { decryptToken } from "../adplatforms/tokens.mjs";
import { callPlatform } from "../adplatforms/_api.mjs";

const API_VERSION = () => process.env.META_API_VERSION || "v21.0";
const BASE = "https://graph.facebook.com";

function channelFromPost(post) {
  return {
    partner_id: post.channel_partner_id || post.partner_id,
    encrypted_access_token: post.encrypted_access_token || null,
    external_account_id: post.external_account_id || null
  };
}

function tokenFrom(channel) {
  if (!channel?.encrypted_access_token) return null;
  try {
    return decryptToken(channel.encrypted_access_token, { partnerId: channel.partner_id });
  } catch {
    return null;
  }
}

function dryRunId(channelName, post) {
  return `dryrun:${channelName}:${post.id}:${Date.now()}`;
}

function refuse(message) {
  const e = new Error(message);
  e.platformMessage = message;
  throw e;
}

export async function facebookPost(post) {
  if (process.env.SOCIAL_PUBLISH_DRY_RUN === "1") {
    return { external_post_id: dryRunId("facebook", post) };
  }
  const channel = channelFromPost(post);
  const token = tokenFrom(channel);
  if (!token) refuse("social channel has no access token");
  const pageId = channel.external_account_id;
  if (!pageId) refuse("social channel has no external_account_id");
  const res = await callPlatform({
    url: `${BASE}/${API_VERSION()}/${pageId}/feed`,
    token,
    body: { message: post.caption || "" }
  });
  return { external_post_id: res?.id || res?.post_id || null };
}

export async function instagramPost(post) {
  if (process.env.SOCIAL_PUBLISH_DRY_RUN === "1") {
    return { external_post_id: dryRunId("instagram", post) };
  }
  refuse(
    "instagram publish needs a media container — set SOCIAL_PUBLISH_DRY_RUN=1 to exercise the cron, or attach media first"
  );
}

function otherChannelPost(channelName) {
  return async (post) => {
    if (process.env.SOCIAL_PUBLISH_DRY_RUN === "1") {
      return { external_post_id: dryRunId(channelName, post) };
    }
    refuse(
      `no live publish adapter for ${channelName} — set SOCIAL_PUBLISH_DRY_RUN=1 or wire the provider`
    );
  };
}

/** registerDefaultAdapters(registerFn) — wires known channels onto scheduler. */
export function registerDefaultAdapters(registerFn) {
  registerFn("facebook", { post: facebookPost });
  registerFn("instagram", { post: instagramPost });
  for (const ch of ["tiktok", "linkedin", "x", "youtube_shorts", "threads", "pinterest"]) {
    registerFn(ch, { post: otherChannelPost(ch) });
  }
}

export default { registerDefaultAdapters, facebookPost, instagramPost };
