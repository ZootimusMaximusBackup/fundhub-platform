// Merge-tag extraction.
//
// The renderer has to support exactly the tags the copy actually uses, so the
// seeder reports the distinct set it found rather than anyone maintaining a list
// by hand. Tags are reported RAW (`contact.first_name`, `cta-link`, …) — the
// docs mix the CRM namespaced tags with bare ones and this is not the place to
// normalize them.

const TAG = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function extractMergeTags(text) {
  const out = [];
  if (!text) return out;
  for (const m of String(text).matchAll(TAG)) out.push(m[1]);
  return out;
}

// templates -> [{tag, count, channels:[...], templateKeys:[...]}] sorted by tag.
export function collectMergeTags(templates) {
  const byTag = new Map();
  for (const t of templates) {
    for (const tag of [...extractMergeTags(t.subject), ...extractMergeTags(t.body)]) {
      if (!byTag.has(tag)) byTag.set(tag, { tag, count: 0, channels: new Set(), templateKeys: new Set() });
      const e = byTag.get(tag);
      e.count += 1;
      e.channels.add(t.channel);
      e.templateKeys.add(t.templateKey);
    }
  }
  return [...byTag.values()]
    .map((e) => ({
      tag: e.tag,
      count: e.count,
      channels: [...e.channels].sort(),
      templateKeys: [...e.templateKeys].sort(),
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
